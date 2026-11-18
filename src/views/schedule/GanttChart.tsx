// Zeitstrahl eines Terminprogramms: links die Zeilen (Gruppen und Aufgaben), rechts Balken, Meilensteine
// und Pfeile auf einem Kalender (Monate, Kalenderwochen, heute, Wochenenden, Feiertage).
//
// Bedienung (nur mit `onChange`): Balken ziehen = verschieben, Enden ziehen = Dauer ändern, den Punkt am
// Balkenende auf eine andere Zeile ziehen = Pfeil «beginnt nach». Ein Klick wählt aus (`onSelect`).
// Ohne `onChange` nur Anzeige (Druck, Büroübersicht). Nachfolger rücken nicht hier nach, sondern in
// der aufrufenden Ansicht über `shiftSuccessors` (schedule.ts).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, dayNum, groupSpans, numToDate, durationDays } from "../../schedule";
import { getWeekNumber } from "../../utils";
import type { DateStr, Id, ScheduleItem } from "../../types";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const ROW_H = 26;
const HEADER_H = 38;

type DragMode = "move" | "start" | "end" | "link";
interface Drag { id: Id; mode: DragMode; x0: number; y0: number; days: number; moved: boolean; px?: number; py?: number }

/** Eine sichtbare Zeile: Gruppenkopf (Sammelbalken) oder Element. */
type Row = { type: "group"; group: string; start: DateStr; end: DateStr; count: number } | { type: "item"; item: ScheduleItem };

export function GanttChart({
  items, dayWidth, labelWidth = 300, from, to, today, holidays = [], critical, baseline, conflicts = [],
  selectedId, onSelect, onChange, onLink, renderMeta, collapsible = true,
}: {
  items: ScheduleItem[];
  dayWidth: number;
  labelWidth?: number;
  /** sichtbarer Zeitraum; fehlt = aus den Elementen (mit etwas Rand) */
  from?: DateStr;
  to?: DateStr;
  /** heute (rote Linie; ohne `from`/Elemente Ausgangspunkt des Zeitraums) */
  today: DateStr;
  /** Feiertage `YYYY-MM-DD` (grau hinterlegt) */
  holidays?: DateStr[];
  /** kritische Elemente (roter Rand, rote Pfeile) */
  critical?: Set<Id>;
  /** eingefrorener Stand: dünner grauer Balken unter dem aktuellen */
  baseline?: { items: { id: Id; start: DateStr; end: DateStr }[] };
  /** verletzte Abhängigkeiten (gestrichelt rot) */
  conflicts?: { fromId: Id; toId: Id }[];
  selectedId?: Id | null;
  onSelect?: (id: Id) => void;
  /** Verschieben/Längen ändern: neues Element (ohne Nachrücken) */
  onChange?: (item: ScheduleItem) => void;
  /** Pfeil gezogen: `toId` beginnt nach `fromId` */
  onLink?: (fromId: Id, toId: Id) => void;
  /** Zusatz rechts in der Zeilenbeschriftung (z.B. Verantwortliche, Soll/Ist) */
  renderMeta?: (item: ScheduleItem) => ReactNode;
  collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Zeitraum: Montag vor dem ersten Element bis zwei Wochen nach dem letzten
  const range = useMemo(() => {
    const starts = items.map(i => dayNum(i.start));
    const ends = items.map(i => dayNum(i.end));
    const t = dayNum(today);
    let s = from ? dayNum(from) : (starts.length ? Math.min(...starts) : t) - 7;
    const e = to ? dayNum(to) : (ends.length ? Math.max(...ends) : t + 60) + 14;
    if (!from) s -= (new Date(s * 86400000).getUTCDay() + 6) % 7; // auf Montag
    return { s, e: Math.max(e, s + 14) };
  }, [items, from, to, today]);
  const x = (d: DateStr | number) => ((typeof d === "number" ? d : dayNum(d)) - range.s) * dayWidth;
  const width = (range.e - range.s + 1) * dayWidth;

  // Zeilen: Gruppenkopf + Elemente (zugeklappte Gruppen ohne Elemente)
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groupSpans(items)) {
      if (g.group) out.push({ type: "group", group: g.group, start: g.start, end: g.end, count: g.items.length });
      if (!collapsed.has(g.group)) for (const item of g.items) out.push({ type: "item", item });
    }
    return out;
  }, [items, collapsed]);
  const rowOf = new Map<Id, number>();
  rows.forEach((r, i) => { if (r.type === "item") rowOf.set(r.item.id, i); });
  const height = HEADER_H + rows.length * ROW_H;

  /** Element mit der Vorschau des laufenden Ziehens. */
  const shown = (it: ScheduleItem): ScheduleItem => {
    if (!drag || drag.id !== it.id || !drag.days) return it;
    if (drag.mode === "move") return { ...it, start: addDays(it.start, drag.days), end: addDays(it.end, drag.days) };
    if (drag.mode === "start" && it.kind === "task") {
      const start = addDays(it.start, drag.days);
      return dayNum(start) <= dayNum(it.end) ? { ...it, start } : it;
    }
    if (drag.mode === "end" && it.kind === "task") {
      const end = addDays(it.end, drag.days);
      return dayNum(end) >= dayNum(it.start) ? { ...it, end } : it;
    }
    return it;
  };
  const byId = new Map(items.map(it => [it.id, shown(it)]));

  // Ziehen über das ganze Fenster verfolgen
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current!;
      const moved = d.moved || Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3;
      const rect = svgRef.current?.getBoundingClientRect();
      const next = { ...d, moved, days: Math.round((e.clientX - d.x0) / dayWidth), px: rect ? e.clientX - rect.left : 0, py: rect ? e.clientY - rect.top : 0 };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current!;
      dragRef.current = null;
      setDrag(null);
      const it = items.find(i => i.id === d.id);
      if (!it) return;
      if (d.mode === "link") {
        const target = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest("[data-item]")?.getAttribute("data-item");
        if (target && target !== d.id) onLink?.(d.id, target);
        return;
      }
      if (!d.moved) { onSelect?.(d.id); return; }
      const next = (() => {
        if (d.mode === "move") return { ...it, start: addDays(it.start, d.days), end: addDays(it.end, d.days) };
        if (d.mode === "start") { const start = addDays(it.start, d.days); return dayNum(start) <= dayNum(it.end) ? { ...it, start } : { ...it, start: it.end }; }
        const end = addDays(it.end, d.days); return dayNum(end) >= dayNum(it.start) ? { ...it, end } : { ...it, end: it.start };
      })();
      if (d.days) onChange?.(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    // nur beim Start eines Ziehens neu binden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.mode]);

  const startDrag = (e: React.PointerEvent, id: Id, mode: DragMode) => {
    if (!onChange && mode !== "link") { onSelect?.(id); return; }
    e.stopPropagation();
    e.preventDefault();
    const d: Drag = { id, mode, x0: e.clientX, y0: e.clientY, days: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };

  // ── Kalenderkopf ──
  const months: { x: number; w: number; label: string }[] = [];
  const weeks: { x: number; label: string }[] = [];
  const shade: { x: number; w: number; kind: "weekend" | "holiday" }[] = [];
  const holidaySet = new Set(holidays);
  for (let n = range.s; n <= range.e; n++) {
    const date = numToDate(n);
    const dow = new Date(n * 86400000).getUTCDay();
    if (date.endsWith("-01") || n === range.s) {
      const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
      const next = dayNum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`);
      const xs = x(n), xe = x(Math.min(next, range.e + 1));
      months.push({ x: xs, w: xe - xs, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` });
    }
    if (dow === 1 && dayWidth * 7 >= 24) weeks.push({ x: x(n), label: `${getWeekNumber(date + "T00:00:00")}` });
    if (holidaySet.has(date)) shade.push({ x: x(n), w: Math.max(dayWidth, 1), kind: "holiday" });
    else if ((dow === 0 || dow === 6) && dayWidth >= 12) shade.push({ x: x(n), w: dayWidth, kind: "weekend" });
  }

  // ── Pfeile ──
  const conflictSet = new Set(conflicts.map(c => `${c.fromId}>${c.toId}`));
  const arrows: { key: string; d: string; kind: "normal" | "critical" | "conflict" }[] = [];
  for (const it of items) for (const dep of it.deps || []) {
    const ri = rowOf.get(it.id), rp = rowOf.get(dep.fromId);
    const pred = byId.get(dep.fromId), succ = byId.get(it.id);
    if (ri === undefined || rp === undefined || !pred || !succ) continue;
    const px = pred.kind === "milestone" ? x(pred.start) + 5 : x(pred.end) + dayWidth;
    const py = HEADER_H + rp * ROW_H + ROW_H / 2;
    const sx = succ.kind === "milestone" ? x(succ.start) - 5 : x(succ.start);
    const sy = HEADER_H + ri * ROW_H + ROW_H / 2;
    const d = sx >= px + 10
      ? `M${px},${py} H${px + 5} V${sy} H${sx - 1}`
      : `M${px},${py} H${px + 5} V${sy + (sy > py ? -ROW_H / 2 : ROW_H / 2)} H${sx - 8} V${sy} H${sx - 1}`;
    const key = `${dep.fromId}>${it.id}`;
    arrows.push({ key, d, kind: conflictSet.has(key) ? "conflict" : critical?.has(it.id) && critical?.has(dep.fromId) ? "critical" : "normal" });
  }

  const todayX: number | null = x(today);
  const toggle = (g: string) => setCollapsed(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  return (
    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--surface)", userSelect: "none" }}>
      {/* Zeilenbeschriftung */}
      <div style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid var(--border)" }}>
        <div style={{ height: HEADER_H, borderBottom: "1px solid var(--border)", background: "var(--surface2)", display: "flex", alignItems: "flex-end", padding: "0 10px 6px", fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>
          AUFGABE
        </div>
        {rows.map((r, i) => r.type === "group" ? (
          <div key={`g-${r.group}`} onClick={() => collapsible && toggle(r.group)}
            style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", background: "var(--surface2)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text3)", cursor: collapsible ? "pointer" : "default" }}>
            {collapsible && <span style={{ fontSize: 9, width: 8 }}>{collapsed.has(r.group) ? "▸" : "▾"}</span>}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.group}</span>
            {collapsed.has(r.group) && <span style={{ fontWeight: 400, color: "var(--text4)" }}>({r.count})</span>}
          </div>
        ) : (
          <div key={r.item.id} data-item={r.item.id} onClick={() => onSelect?.(r.item.id)}
            style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 10px 0 22px", borderBottom: "1px solid var(--border2, var(--border))", fontSize: 12,
              background: r.item.id === selectedId ? "var(--surface3)" : i % 2 ? "var(--surface)" : "transparent", cursor: onSelect ? "pointer" : "default" }}>
            <span style={{ color: r.item.kind === "milestone" ? "var(--text3)" : "var(--text)", fontStyle: r.item.kind === "milestone" ? "italic" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {r.item.kind === "milestone" ? "◆ " : ""}{r.item.bkp ? `${r.item.bkp} ` : ""}{r.item.label}
            </span>
            {renderMeta?.(r.item)}
          </div>
        ))}
        {!rows.length && <div style={{ padding: 16, fontSize: 12, color: "var(--text4)" }}>Noch keine Einträge.</div>}
      </div>

      {/* Kalender und Balken */}
      <div style={{ flex: 1, overflowX: "auto" }}>
        <svg ref={svgRef} width={width} height={Math.max(height, HEADER_H + ROW_H)} style={{ display: "block", fontFamily: "'Inter', sans-serif" }}>
          <defs>
            {(["normal", "critical", "conflict"] as const).map(k => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={k === "normal" ? "var(--text4)" : "var(--negative)"} />
              </marker>
            ))}
          </defs>
          {/* Kopf */}
          <rect x={0} y={0} width={width} height={HEADER_H} fill="var(--surface2)" />
          {months.map(m => (
            <g key={m.x}>
              <line x1={m.x} x2={m.x} y1={0} y2={height} stroke="var(--border)" />
              {m.w > 24 && <text x={m.x + 4} y={14} fontSize={10} fill="var(--text3)">{m.label}</text>}
            </g>
          ))}
          {weeks.map(w => (
            <g key={w.x}>
              <line x1={w.x} x2={w.x} y1={20} y2={height} stroke="var(--border)" strokeOpacity={0.45} />
              <text x={w.x + 3} y={32} fontSize={9} fill="var(--text4)">{w.label}</text>
            </g>
          ))}
          <line x1={0} x2={width} y1={HEADER_H} y2={HEADER_H} stroke="var(--border)" />
          {/* Hintergrund */}
          {shade.map(s => <rect key={`${s.kind}-${s.x}`} x={s.x} y={HEADER_H} width={s.w} height={height - HEADER_H} fill={s.kind === "holiday" ? "var(--warning-bg)" : "var(--surface2)"} opacity={s.kind === "holiday" ? 0.9 : 0.7} />)}
          {rows.map((r, i) => r.type === "group" && <rect key={`gb-${r.group}`} x={0} y={HEADER_H + i * ROW_H} width={width} height={ROW_H} fill="var(--surface2)" opacity={0.6} />)}
          {todayX !== null && todayX >= 0 && todayX <= width && <line x1={todayX} x2={todayX} y1={0} y2={height} stroke="var(--negative)" strokeWidth={1.5} />}

          {/* Pfeile */}
          {arrows.map(a => (
            <path key={a.key} d={a.d} fill="none" strokeWidth={1.2} markerEnd={`url(#arrow-${a.kind})`}
              stroke={a.kind === "normal" ? "var(--text4)" : "var(--negative)"} strokeDasharray={a.kind === "conflict" ? "4 3" : undefined} />
          ))}

          {/* Sammelbalken der Gruppen */}
          {rows.map((r, i) => {
            if (r.type !== "group") return null;
            const gy = HEADER_H + i * ROW_H;
            return <rect key={`gs-${r.group}`} x={x(r.start)} y={gy + ROW_H / 2 - 3} width={Math.max(2, x(r.end) + dayWidth - x(r.start))} height={6} rx={2} fill="var(--text3)" opacity={0.55} />;
          })}

          {/* Elemente */}
          {rows.map((r, i) => {
            if (r.type !== "item") return null;
            const it = byId.get(r.item.id)!;
            const y = HEADER_H + i * ROW_H;
            const isCrit = critical?.has(it.id);
            const sel = it.id === selectedId;
            const base = baseline?.items.find(b => b.id === it.id);
            const label = it.kind === "milestone" ? `${it.start.slice(8, 10)}.${it.start.slice(5, 7)}.` : `${Math.round(durationDays(it) / 7 * 10) / 10} W`;
            if (it.kind === "milestone") {
              const cx = x(it.start), cy = y + ROW_H / 2, s = 7;
              return (
                <g key={it.id} data-item={it.id} style={{ cursor: onChange ? "grab" : "pointer" }} onPointerDown={e => startDrag(e, it.id, "move")}>
                  {base && <path d={`M${x(base.start)},${cy - 4} l4,4 l-4,4 l-4,-4 z`} fill="var(--text4)" opacity={0.45} />}
                  <path d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`} fill={isCrit ? "var(--negative)" : "var(--text)"} stroke={sel ? "var(--accent)" : "none"} strokeWidth={2} />
                  {onLink && <circle cx={cx + s + 5} cy={cy} r={3.5} fill="var(--surface)" stroke="var(--text4)" style={{ cursor: "crosshair" }}
                    onPointerDown={e => startDrag(e, it.id, "link")}><title>Ziehen: Pfeil zu einer Folgeaufgabe</title></circle>}
                  <text x={cx + s + (onLink ? 12 : 4)} y={cy + 3.5} fontSize={10} fill="var(--text3)" pointerEvents="none">{label}</text>
                </g>
              );
            }
            const bx = x(it.start), bw = Math.max(dayWidth, x(it.end) + dayWidth - bx);
            const by = y + 6, bh = ROW_H - 12;
            const prog = Math.max(0, Math.min(100, it.progress || 0));
            return (
              <g key={it.id} data-item={it.id}>
                {base && <rect x={x(base.start)} y={y + ROW_H - 5} width={Math.max(dayWidth, x(base.end) + dayWidth - x(base.start))} height={3} fill="var(--text4)" opacity={0.5} />}
                <rect x={bx} y={by} width={bw} height={bh} rx={3} fill={isCrit ? "var(--negative)" : "var(--accent)"} fillOpacity={isCrit ? 0.3 : 0.35}
                  stroke={isCrit ? "var(--negative)" : sel ? "var(--text)" : "none"} strokeWidth={isCrit || sel ? 1.6 : 0}
                  style={{ cursor: onChange ? "grab" : "pointer" }} onPointerDown={e => startDrag(e, it.id, "move")} />
                {prog > 0 && <rect x={bx} y={by} width={bw * prog / 100} height={bh} rx={3} fill={isCrit ? "var(--negative)" : "var(--accent)"} opacity={0.8} pointerEvents="none" />}
                {onChange && <>
                  <rect x={bx - 2} y={by} width={6} height={bh} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={e => startDrag(e, it.id, "start")} />
                  <rect x={bx + bw - 4} y={by} width={6} height={bh} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={e => startDrag(e, it.id, "end")} />
                </>}
                {onLink && <circle cx={bx + bw + 6} cy={y + ROW_H / 2} r={3.5} fill="var(--surface)" stroke="var(--text4)" style={{ cursor: "crosshair" }}
                  onPointerDown={e => startDrag(e, it.id, "link")}><title>Ziehen: Pfeil zu einer Folgeaufgabe</title></circle>}
                <text x={bx + bw + (onLink ? 14 : 5)} y={y + ROW_H / 2 + 3.5} fontSize={10} fill="var(--text4)" pointerEvents="none">{label}</text>
              </g>
            );
          })}

          {/* Pfeil, der gerade gezogen wird */}
          {drag?.mode === "link" && drag.px !== undefined && (() => {
            const it = byId.get(drag.id);
            const ri = rowOf.get(drag.id);
            if (!it || ri === undefined) return null;
            const sx = it.kind === "milestone" ? x(it.start) + 7 : x(it.end) + dayWidth + 6;
            return <line x1={sx} y1={HEADER_H + ri * ROW_H + ROW_H / 2} x2={drag.px} y2={drag.py} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />;
          })()}
        </svg>
      </div>
    </div>
  );
}
