// Zeitstrahl eines Terminprogramms: links die Zeilen (Gruppen und Aufgaben), rechts Balken, Meilensteine
// und Pfeile auf einem Kalender (Monate, Kalenderwochen, heute, Wochenenden, Feiertage).
//
// Bedienung (nur mit `onChange`): Balken ziehen = verschieben, Enden ziehen = Dauer ändern, den Punkt am
// Balkenende auf eine andere Zeile ziehen = Pfeil «beginnt nach». Gezogen wird in Schritten von
// `snapDays` (z.B. ganze Wochen), mit gedrückter Wahltaste (Alt) tageweise. Klick wählt aus (`onSelect`),
// Doppelklick öffnet (`onOpen`). Beim Ziehen erscheinen die neuen Daten; nahe am Rand scrollt die Ansicht mit.
// Ohne `onChange` nur Anzeige (Druck, Büroübersicht). Nachfolger rücken nicht hier nach, sondern in
// der aufrufenden Ansicht über `shiftSuccessors` (schedule.ts). Hover-Stile: `.gantt-*` in global.css.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addDays, dayNum, groupSpans, numToDate, durationDays, formatDuration, glyphOf, markerOf, seriesDates,
  SCHEDULE_MARKERS, SCHEDULE_VARIANTS,
} from "../../schedule";
import { getWeekNumber } from "../../utils";
import type { DateStr, Id, ScheduleItem, ScheduleMarker } from "../../types";

/**
 * Umriss eines Termin-Symbols um (cx, cy) mit Radius s (SCHEDULE_MARKERS): ◆ Meilenstein, ▼ Abgabe,
 * ◇ Entscheid (hohl), ● Sitzung, ■ Lieferung, ★ Abnahme, ▲ Vertragstermin.
 */
function markerPath(m: ScheduleMarker, cx: number, cy: number, s: number): string {
  switch (m) {
    case "abgabe": return `M${cx - s},${cy - s * 0.75} L${cx + s},${cy - s * 0.75} L${cx},${cy + s * 0.95} Z`;
    case "vertrag": return `M${cx - s},${cy + s * 0.75} L${cx + s},${cy + s * 0.75} L${cx},${cy - s * 0.95} Z`;
    case "sitzung": { const r = s * 0.8; return `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`; }
    case "lieferung": { const h = s * 0.75; return `M${cx - h},${cy - h} H${cx + h} V${cy + h} H${cx - h} Z`; }
    case "abnahme": {
      const pts: string[] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? s * 0.45 : s * 1.05, a = -Math.PI / 2 + (k * Math.PI) / 5;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
      }
      return `M${pts.join(" L")} Z`;
    }
    default: return `M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`; // meilenstein, entscheid
  }
}

/** Termin-Symbol als SVG-Pfad (Entscheid hohl). */
function Marker({ m, cx, cy, s, color, stroke, strokeWidth, open }: { m: ScheduleMarker; cx: number; cy: number; s: number; color: string; stroke?: string; strokeWidth?: number; open?: boolean }) {
  const hollow = m === "entscheid" || open;
  return <path d={markerPath(m, cx, cy, s)} fill={hollow ? "var(--surface)" : color} stroke={hollow ? color : stroke || "var(--surface)"}
    strokeWidth={hollow ? Math.max(1.8, strokeWidth || 0) : strokeWidth ?? 1} strokeLinejoin="round" />;
}

/**
 * Legende der im Programm vorkommenden Zeichen (Termin-Symbole, Balkenarten, Unterbrüche, Hervorhebungen).
 * Zeigt nur, was in `items` vorkommt; für Editor und Druck.
 */
export function ScheduleLegend({ items, breaks = 0, critical = false, baseline = false, compact = false }: {
  items: ScheduleItem[];
  /** Anzahl Unterbrüche (> 0 → Eintrag «Bauferien/Unterbruch») */
  breaks?: number;
  critical?: boolean;
  baseline?: boolean;
  compact?: boolean;
}) {
  const markers = SCHEDULE_MARKERS.filter(m => items.some(it => (it.kind === "milestone" || it.variant === "serie") && markerOf(it) === m.id));
  const variants = SCHEDULE_VARIANTS.filter(v => items.some(it => it.kind === "task" && (it.variant || "") === v.id));
  const entry = (key: string, icon: ReactNode, label: string, title?: string) => (
    <span key={key} title={title} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <svg width={22} height={14} style={{ flexShrink: 0 }}>{icon}</svg>{label}
    </span>
  );
  const barIcon = (v: string) => v === "serie"
    ? <><line x1={1} x2={21} y1={7} y2={7} stroke="var(--text4)" /><Marker m="sitzung" cx={5} cy={7} s={3.5} color="var(--text)" /><Marker m="sitzung" cx={16} cy={7} s={3.5} color="var(--text)" /></>
    : <rect x={1} y={3} width={20} height={8} rx={2} fill={v === "reserve" ? "url(#gantt-legend-hatch)" : "var(--accent)"} fillOpacity={v === "extern" ? 0.06 : v === "reserve" ? 1 : 0.38}
      stroke={v === "extern" ? "var(--accent)" : v === "reserve" ? "var(--text4)" : "none"} strokeWidth={1.3} />;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? "4px 14px" : "6px 18px", fontSize: compact ? 9 : 11, color: "var(--text3)", alignItems: "center" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <defs>
          <pattern id="gantt-legend-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="var(--text4)" strokeWidth={1.6} />
          </pattern>
        </defs>
      </svg>
      {markers.map(m => entry(m.id, <Marker m={m.id} cx={11} cy={7} s={5.5} color="var(--text)" />, m.label, m.hint))}
      {variants.map(v => entry(`v-${v.id}`, barIcon(v.id), v.label, v.hint))}
      {breaks > 0 && entry("breaks", <rect x={1} y={1} width={20} height={12} fill="url(#gantt-legend-hatch)" opacity={0.7} />, "Bauferien / Unterbruch")}
      {critical && entry("crit", <rect x={1} y={3} width={20} height={8} rx={2} fill="var(--negative)" fillOpacity={0.3} stroke="var(--negative)" />, "kritischer Weg")}
      {baseline && entry("base", <rect x={1} y={9} width={20} height={3} rx={1.5} fill="var(--text4)" />, "eingefrorener Stand")}
      {entry("today", <line x1={11} x2={11} y1={0} y2={14} stroke="var(--negative)" strokeWidth={1.5} />, "heute")}
    </div>
  );
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** Ab dieser Tagesbreite (px) zeigt der Kopf jeden Tag (Wochentag + Datum) und Dauern in Tagen. */
const DAY_VIEW_MIN = 18;
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Standard-Zeilenhöhe; im Druck kleiner (`rowHeight`), damit das Programm auf eine Seite passt. */
const DEFAULT_ROW_H = 28;
const HEADER_H = 40;
/** Mindestbreite der Trefferfläche eines Balkens in px (kurze Balken bei kleinem Zoom). */
const MIN_HIT = 10;

const fmtShort = (d: DateStr) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const fmtLong = (d: DateStr) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

type DragMode = "move" | "start" | "end" | "link";
interface Drag {
  id: Id; mode: DragMode; x0: number; y0: number; sl0: number; days: number; moved: boolean;
  px?: number; py?: number; target?: Id | null;
}

/** Eine sichtbare Zeile: Gruppenkopf (Sammelbalken) oder Element. */
type Row = { type: "group"; group: string; start: DateStr; end: DateStr; count: number; hasTask: boolean } | { type: "item"; item: ScheduleItem };

export function GanttChart({
  items, dayWidth, fit = false, labelWidth = 300, labelTitle = "Aufgabe", from, to, today, holidays = [], critical,
  baseline, conflicts = [], breaks = [], selectedId, onSelect, onOpen, onChange, onLink, canLink, renderMeta, describe, barColor,
  snapDays = 1, collapsible = true, rowHeight, isDone, sessions, onOpenProtocol,
}: {
  items: ScheduleItem[];
  /** Breite eines Tages in px (ohne `fit`) */
  dayWidth: number;
  /** ganzen Zeitraum in die verfügbare Breite einpassen */
  fit?: boolean;
  labelWidth?: number;
  /** Überschrift der Zeilenspalte */
  labelTitle?: string;
  /** sichtbarer Zeitraum; fehlt = aus den Elementen (mit etwas Rand) */
  from?: DateStr;
  to?: DateStr;
  /** heute (rote Linie; ohne `from`/Elemente Ausgangspunkt des Zeitraums) */
  today: DateStr;
  /** Feiertage `YYYY-MM-DD` (hinterlegt) */
  holidays?: DateStr[];
  /** kritische Elemente (rot) */
  critical?: Set<Id>;
  /** eingefrorener Stand: dünner grauer Balken unter dem aktuellen */
  baseline?: { items: { id: Id; start: DateStr; end: DateStr }[] };
  /** verletzte Abhängigkeiten (gestrichelt rot) */
  conflicts?: { fromId: Id; toId: Id }[];
  /** Bauferien/Unterbrüche: schraffiert über alle Zeilen */
  breaks?: { id: Id; label: string; start: DateStr; end: DateStr }[];
  selectedId?: Id | null;
  onSelect?: (id: Id) => void;
  /** Doppelklick: Element öffnen (Bearbeiten) */
  onOpen?: (id: Id) => void;
  /** Verschieben/Länge ändern: neues Element (ohne Nachrücken) */
  onChange?: (item: ScheduleItem) => void;
  /** Pfeil gezogen: `toId` beginnt nach `fromId` */
  onLink?: (fromId: Id, toId: Id) => void;
  /** false = dieser Pfeil wäre ungültig (z.B. Kreis); Ziel wird beim Ziehen rot statt grün */
  canLink?: (fromId: Id, toId: Id) => boolean;
  /** Zusatz rechts in der Zeilenbeschriftung (z.B. Verantwortliche, Soll/Ist) */
  renderMeta?: (item: ScheduleItem) => ReactNode;
  /** zusätzliche Zeilen im Tooltip eines Elements */
  describe?: (item: ScheduleItem) => string | undefined;
  /** eigene Balkenfarbe je Element (CSS-Farbe, z.B. Ferien in der Büroübersicht) */
  barColor?: (item: ScheduleItem) => string | undefined;
  /** Raster beim Ziehen in Tagen (7 = ganze Wochen); Alt-Taste = tageweise */
  snapDays?: number;
  collapsible?: boolean;
  /** Zeilenhöhe in px (Standard 28, Druck kleiner) */
  rowHeight?: number;
  /** erledigt (z.B. Protokoll-Aufgabe erledigt): Termin abgeschwächt mit ✓ */
  isDone?: (item: ScheduleItem) => boolean;
  /** Terminserie: Sitzungen mit Protokoll-Abgleich (gehalten = gefüllt + klickbar, kommend = hohl, ohne = blass) */
  sessions?: (item: ScheduleItem) => { date: DateStr; state: "gehalten" | "kommend" | "ohne"; protocol?: { id: Id; nummer?: string; date: DateStr } }[];
  /** Klick auf eine gehaltene Sitzung: Protokoll öffnen */
  onOpenProtocol?: (protocolId: Id) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const ROW_H = rowHeight ?? DEFAULT_ROW_H;
  /** Abstand Balken ↔ Zeilenrand und Symbolgrösse wachsen mit der Zeilenhöhe */
  const BAR_PAD = Math.round(ROW_H * 0.21);
  const SYM = Math.min(7, ROW_H * 0.26);
  const hatchId = `gantt-hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dragRef = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Einpassen: verfügbare Breite messen
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!fit || !el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [fit]);
  const dw = fit && boxWidth ? Math.max(0.5, (boxWidth - 2) / (range.e - range.s + 1)) : dayWidth;
  const x = (d: DateStr | number) => ((typeof d === "number" ? d : dayNum(d)) - range.s) * dw;
  const width = (range.e - range.s + 1) * dw;

  // Beim Öffnen und bei neuem Zoom: heute (oder den Anfang) ins Bild
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    const t = dayNum(today);
    el.scrollLeft = t >= range.s && t <= range.e ? Math.max(0, x(t) - el.clientWidth * 0.25) : 0;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { scrollToToday(); }, [dw > 0 ? Math.round(dw * 10) : 0]);

  // Zeilen: Gruppenkopf + Elemente (zugeklappte Gruppen ohne Elemente)
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groupSpans(items)) {
      if (g.group) out.push({ type: "group", group: g.group, start: g.start, end: g.end, count: g.items.length, hasTask: g.items.some(it => it.kind === "task") });
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
      return dayNum(start) <= dayNum(it.end) ? { ...it, start } : { ...it, start: it.end };
    }
    if (drag.mode === "end" && it.kind === "task") {
      const end = addDays(it.end, drag.days);
      return dayNum(end) >= dayNum(it.start) ? { ...it, end } : { ...it, end: it.start };
    }
    return it;
  };
  const byId = new Map(items.map(it => [it.id, shown(it)]));

  // Ziehen über das ganze Fenster verfolgen
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current!;
      const el = scrollRef.current;
      // Nahe am Rand mitscrollen (waagrecht im Zeitstrahl, senkrecht im Fenster)
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientX > r.right - 40) el.scrollLeft += 18;
        else if (e.clientX < r.left + 40 && d.mode !== "link") el.scrollLeft -= 18;
      }
      if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 16);
      else if (e.clientY < 50) window.scrollBy(0, -16);
      const sl = el?.scrollLeft || 0;
      const moved = d.moved || Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3;
      const raw = (e.clientX - d.x0 + (sl - d.sl0)) / dw;
      const step = e.altKey ? 1 : snapDays;
      const days = Math.round(raw / step) * step;
      const rect = svgRef.current?.getBoundingClientRect();
      let target: Id | null = null;
      if (d.mode === "link") {
        target = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest("[data-item]")?.getAttribute("data-item") || null;
        if (target === d.id) target = null;
      }
      const next = { ...d, moved, days, px: rect ? e.clientX - rect.left : 0, py: rect ? e.clientY - rect.top : 0, target };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current!;
      dragRef.current = null;
      setDrag(null);
      const it = items.find(i => i.id === d.id);
      if (!it) return;
      if (d.mode === "link") {
        if (d.target && (!canLink || canLink(d.id, d.target))) onLink?.(d.id, d.target);
        return;
      }
      if (!d.moved) { onSelect?.(d.id); return; }
      if (!d.days) return;
      if (d.mode === "move") onChange?.({ ...it, start: addDays(it.start, d.days), end: addDays(it.end, d.days) });
      else if (d.mode === "start") { const start = addDays(it.start, d.days); onChange?.(dayNum(start) <= dayNum(it.end) ? { ...it, start } : { ...it, start: it.end }); }
      else { const end = addDays(it.end, d.days); onChange?.(dayNum(end) >= dayNum(it.start) ? { ...it, end } : { ...it, end: it.start }); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { dragRef.current = null; setDrag(null); } };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKey); };
    // nur beim Start eines Ziehens neu binden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.mode]);

  const startDrag = (e: React.PointerEvent, id: Id, mode: DragMode) => {
    if (e.button !== 0) return;
    if (!onChange && mode !== "link") { onSelect?.(id); return; }
    e.stopPropagation();
    e.preventDefault();
    const d: Drag = { id, mode, x0: e.clientX, y0: e.clientY, sl0: scrollRef.current?.scrollLeft || 0, days: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };

  // ── Kalenderkopf ──
  const months: { x: number; w: number; label: string }[] = [];
  const weeks: { x: number; label: string; month: string }[] = [];
  /** Tagesansicht: jeder Tag mit Wochentag und Datum */
  const dayView = dw >= DAY_VIEW_MIN;
  const days: { x: number; wd: string; d: string; weekend: boolean; holiday: boolean; isToday: boolean }[] = [];
  const shade: { x: number; w: number; kind: "weekend" | "holiday" }[] = [];
  const holidaySet = new Set(holidays);
  for (let n = range.s; n <= range.e; n++) {
    const date = numToDate(n);
    const dow = new Date(n * 86400000).getUTCDay();
    if (date.endsWith("-01") || n === range.s) {
      const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
      const next = dayNum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`);
      const xs = x(n), xe = x(Math.min(next, range.e + 1));
      // Beschriftung nach Platz: «Mär 2027», «Mär 27», «M» (Januar mit Jahr), sonst keine
      const w = xe - xs;
      // Schwellen ≈ Textbreite bei 10 px (6 px je Zeichen) plus Rand, damit Nachbarn nicht zusammenstossen
      const label = w > 60 ? `${MONTHS[m - 1]} ${y}` : w > 46 ? `${MONTHS[m - 1]} ${String(y).slice(2)}`
        : w > 12 ? (m === 1 && w > 26 ? `’${String(y).slice(2)}` : MONTHS[m - 1][0]) : "";
      months.push({ x: xs, w, label });
    }
    if (dow === 1 && dw * 7 >= 22) weeks.push({ x: x(n), label: `${getWeekNumber(date + "T00:00:00")}`, month: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}` });
    if (dayView) days.push({ x: x(n), wd: WEEKDAYS[dow], d: String(Number(date.slice(8, 10))), weekend: dow === 0 || dow === 6, holiday: holidaySet.has(date), isToday: date === today });
    if (holidaySet.has(date)) shade.push({ x: x(n), w: Math.max(dw, 1), kind: "holiday" });
    else if ((dow === 0 || dow === 6) && dw >= 12) shade.push({ x: x(n), w: dw, kind: "weekend" });
  }

  // ── Pfeile ──
  const conflictSet = new Set(conflicts.map(c => `${c.fromId}>${c.toId}`));
  const arrows: { key: string; d: string; kind: "normal" | "critical" | "conflict"; active: boolean }[] = [];
  for (const it of items) for (const dep of it.deps || []) {
    const ri = rowOf.get(it.id), rp = rowOf.get(dep.fromId);
    const pred = byId.get(dep.fromId), succ = byId.get(it.id);
    if (ri === undefined || rp === undefined || !pred || !succ) continue;
    const px = pred.kind === "milestone" ? x(pred.start) + 7 : x(pred.end) + dw;
    const py = HEADER_H + rp * ROW_H + ROW_H / 2;
    const sx = succ.kind === "milestone" ? x(succ.start) - 7 : x(succ.start);
    const sy = HEADER_H + ri * ROW_H + ROW_H / 2;
    const d = sx >= px + 10
      ? `M${px},${py} H${px + 5} V${sy} H${sx - 1}`
      : `M${px},${py} H${px + 5} V${sy + (sy > py ? -ROW_H / 2 : ROW_H / 2)} H${sx - 8} V${sy} H${sx - 1}`;
    const key = `${dep.fromId}>${it.id}`;
    arrows.push({
      key, d, active: selectedId === it.id || selectedId === dep.fromId,
      kind: conflictSet.has(key) ? "conflict" : critical?.has(it.id) && critical?.has(dep.fromId) ? "critical" : "normal",
    });
  }

  const todayX = x(today);
  const toggle = (g: string) => setCollapsed(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const linkOk = drag?.mode === "link" && drag.target ? !canLink || canLink(drag.id, drag.target) : null;
  const linkTargetRow = drag?.mode === "link" && drag.target ? rowOf.get(drag.target) : undefined;

  /** Tooltip eines Elements. */
  const tip = (it: ScheduleItem) => [
    it.label,
    it.kind === "milestone" ? `${SCHEDULE_MARKERS.find(m => m.id === markerOf(it))!.label}: ${fmtLong(it.start)}`
      : `${fmtLong(it.start)} – ${fmtLong(it.end)} (${formatDuration(durationDays(it))})`,
    it.kind === "task" && it.variant ? (it.variant === "serie"
      ? `Terminserie: ${SCHEDULE_MARKERS.find(m => m.id === markerOf(it))!.label} alle ${formatDuration(it.repeatDays || 14)} (${seriesDates(it).length} Termine)`
      : SCHEDULE_VARIANTS.find(v => v.id === it.variant)!.label) : undefined,
    describe?.(it),
  ].filter(Boolean).join("\n");

  return (
    <div className="gantt" style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--surface)", userSelect: "none" }}
      onPointerLeave={() => setHoverRow(null)}>
      {/* Zeilenbeschriftung */}
      <div style={{ width: `min(${labelWidth}px, 40vw)`, flexShrink: 0, borderRight: "1px solid var(--border)" }}>
        <div style={{ height: HEADER_H, borderBottom: "1px solid var(--border)", background: "var(--surface2)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 8px 6px 10px", fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>
          <span>{labelTitle.toUpperCase()}</span>
          {!fit && onSelect && dayNum(today) >= range.s && dayNum(today) <= range.e && (
            <button type="button" className="no-print" onClick={scrollToToday} title="Zum heutigen Tag scrollen"
              style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 10, fontSize: 10, padding: "1px 8px", color: "var(--text3)", cursor: "pointer", letterSpacing: 0 }}>
              Heute
            </button>
          )}
        </div>
        {rows.map((r, i) => r.type === "group" ? (
          <div key={`g-${r.group}`} onClick={() => collapsible && toggle(r.group)} title={`${r.group}\n${fmtLong(r.start)} – ${fmtLong(r.end)}`}
            onPointerEnter={() => setHoverRow(i)}
            style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", background: "var(--surface2)", borderBottom: "1px solid var(--border)", fontSize: ROW_H < 22 ? 10 : 11, fontWeight: 600, color: "var(--text3)", cursor: collapsible ? "pointer" : "default" }}>
            {collapsible && <span style={{ fontSize: 9, width: 8 }}>{collapsed.has(r.group) ? "▸" : "▾"}</span>}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.group}</span>
            <span style={{ fontWeight: 400, color: "var(--text4)", fontSize: 10 }}>{collapsed.has(r.group) ? `${r.count} ausgeblendet` : `${fmtShort(r.start)}–${fmtShort(r.end)}`}</span>
          </div>
        ) : (
          <div key={r.item.id} data-item={r.item.id} title={tip(r.item)}
            onClick={() => onSelect?.(r.item.id)} onDoubleClick={() => onOpen?.(r.item.id)} onPointerEnter={() => setHoverRow(i)}
            style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 10px 0 22px", borderBottom: "1px solid var(--border2, var(--border))", fontSize: ROW_H < 22 ? 10.5 : 12,
              background: r.item.id === selectedId ? "var(--surface3)" : linkTargetRow === i ? (linkOk ? "var(--positive-bg)" : "var(--negative-bg)") : hoverRow === i ? "var(--surface2)" : "transparent",
              boxShadow: r.item.id === selectedId ? "inset 3px 0 0 var(--accent)" : undefined,
              cursor: onSelect ? "pointer" : "default" }}>
            <span style={{ color: r.item.kind === "milestone" ? "var(--text3)" : "var(--text)", fontStyle: r.item.kind === "milestone" ? "italic" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {isDone?.(r.item) ? <span style={{ fontStyle: "normal", color: "var(--positive)", marginRight: 4 }} title="erledigt">✓</span>
                : glyphOf(r.item) ? <span style={{ fontStyle: "normal", color: "var(--text3)", marginRight: 4 }}>{glyphOf(r.item)}</span> : null}{r.item.bkp ? <span style={{ color: "var(--text4)" }}>{r.item.bkp} </span> : null}{r.item.label}
            </span>
            {renderMeta?.(r.item)}
          </div>
        ))}
        {!rows.length && <div style={{ padding: 16, fontSize: 12, color: "var(--text4)" }}>Noch keine Einträge.</div>}
      </div>

      {/* Kalender und Balken */}
      <div ref={scrollRef} style={{ flex: 1, overflowX: fit ? "hidden" : "auto", minWidth: 0 }}>
        <svg ref={svgRef} width={width} height={Math.max(height, HEADER_H + ROW_H)} style={{ display: "block", fontFamily: "'Inter', sans-serif" }}
          aria-label="Terminprogramm">
          <defs>
            <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={6} stroke="var(--text4)" strokeWidth={1.6} />
            </pattern>
            {(["normal", "critical", "conflict", "active"] as const).map(k => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={k === "normal" ? "var(--text4)" : k === "active" ? "var(--text)" : "var(--negative)"} />
              </marker>
            ))}
          </defs>
          {/* Kopf */}
          <rect x={0} y={0} width={width} height={HEADER_H} fill="var(--surface2)" />
          {months.map(m => (
            <g key={m.x}>
              <line x1={m.x} x2={m.x} y1={0} y2={height} stroke="var(--border)" />
              {m.label && <text x={m.x + (m.w > 22 ? 4 : 2)} y={dayView ? 13 : 15} fontSize={10} fontWeight={dayView ? 600 : 500} fill="var(--text3)">{m.label}</text>}
            </g>
          ))}
          {dayView ? <>
            {/* Tagesansicht: oben Monat + KW, darunter Wochentag und Datum je Tag */}
            {days.map(d => (
              <g key={d.x}>
                <line x1={d.x} x2={d.x} y1={18} y2={height} stroke="var(--border)" strokeOpacity={d.wd === "Mo" ? 0.7 : 0.22} />
                {d.isToday && <rect x={d.x + 1} y={19} width={dw - 2} height={HEADER_H - 20} rx={3} fill="var(--negative)" opacity={0.14} />}
                <text x={d.x + dw / 2} y={27} fontSize={7.5} textAnchor="middle" fill={d.weekend || d.holiday ? "var(--text4)" : "var(--text3)"}>{d.wd}</text>
                <text x={d.x + dw / 2} y={37} fontSize={9.5} textAnchor="middle" fontWeight={d.isToday ? 700 : 500}
                  fill={d.isToday ? "var(--negative)" : d.weekend || d.holiday ? "var(--text4)" : "var(--text)"}>{d.d}</text>
              </g>
            ))}
            {/* Monatsnamen nur am Monatsanfang; jede KW trägt den Monat mit, damit er beim Scrollen sichtbar bleibt */}
            {weeks.filter(w => !months.some(m => m.label && m.x > w.x - 64 && m.x < w.x + 96)).map(w => (
              <text key={`kw-${w.x}`} x={w.x + 3} y={13} fontSize={9} fill="var(--text4)">KW {w.label} · {w.month}</text>
            ))}
          </> : weeks.map(w => (
            <g key={w.x}>
              <line x1={w.x} x2={w.x} y1={22} y2={height} stroke="var(--border)" strokeOpacity={0.4} />
              <text x={w.x + 3} y={33} fontSize={9} fill="var(--text4)">{w.label}</text>
            </g>
          ))}
          <line x1={0} x2={width} y1={HEADER_H} y2={HEADER_H} stroke="var(--border)" />
          {/* Hintergrund: Zeilen (Hover/Auswahl, Klick wählt aus), Wochenenden, Feiertage, Gruppen */}
          {rows.map((r, i) => {
            const sel = r.type === "item" && r.item.id === selectedId;
            const linkHere = linkTargetRow === i;
            return (
              <rect key={`row-${i}`} x={0} y={HEADER_H + i * ROW_H} width={width} height={ROW_H}
                data-item={r.type === "item" ? r.item.id : undefined}
                fill={linkHere ? (linkOk ? "var(--positive-bg)" : "var(--negative-bg)") : sel ? "var(--surface3)" : r.type === "group" ? "var(--surface2)" : hoverRow === i ? "var(--surface2)" : "transparent"}
                opacity={r.type === "group" && !sel ? 0.6 : 1}
                onPointerEnter={() => setHoverRow(i)}
                onClick={() => r.type === "item" && onSelect?.(r.item.id)}
                onDoubleClick={() => r.type === "item" && onOpen?.(r.item.id)} />
            );
          })}
          {breaks.map(b => {
            const bx = x(b.start), bw = Math.max(dw, x(b.end) + dw - bx);
            if (bx + bw < 0 || bx > width) return null;
            return (
              <g key={`brk-${b.id}`} pointerEvents="none">
                <rect x={bx} y={HEADER_H} width={bw} height={height - HEADER_H} fill={`url(#${hatchId})`} opacity={0.35} />
                <rect x={bx} y={HEADER_H} width={bw} height={height - HEADER_H} fill="none" stroke="var(--text4)" strokeOpacity={0.5} strokeDasharray="3 3" />
                {/* Bezeichnung waagrecht, wenn sie passt, sonst senkrecht am linken Rand */}
                {bw > b.label.length * 5.4 + 8
                  ? <text x={bx + 4} y={HEADER_H + 11} fontSize={9} fill="var(--text3)" fontWeight={600}>{b.label}</text>
                  : bw >= 9 && <text x={bx + bw / 2 + 3} y={HEADER_H + 6} fontSize={9} fill="var(--text3)" fontWeight={600} transform={`rotate(90 ${bx + bw / 2 + 3} ${HEADER_H + 6})`}>{b.label}</text>}
                <title>{`${b.label}: ${fmtLong(b.start)} – ${fmtLong(b.end)}`}</title>
              </g>
            );
          })}
          {shade.map(s => <rect key={`${s.kind}-${s.x}`} x={s.x} y={HEADER_H} width={s.w} height={height - HEADER_H} fill={s.kind === "holiday" ? "var(--warning-bg)" : "var(--surface2)"} opacity={s.kind === "holiday" ? 0.9 : 0.6} pointerEvents="none" />)}
          {todayX >= 0 && todayX <= width && (
            <g pointerEvents="none">
              <line x1={todayX} x2={todayX} y1={dayView ? HEADER_H : HEADER_H - 6} y2={height} stroke="var(--negative)" strokeWidth={1.5} />
              {/* In der Tagesansicht ist der Tag im Kopf markiert, sonst ein Schild «heute» */}
              {!dayView && <>
                <rect x={Math.max(0, Math.min(width - 34, todayX - 17))} y={HEADER_H - 13} width={34} height={12} rx={6} fill="var(--negative)" />
                <text x={Math.max(17, Math.min(width - 17, todayX))} y={HEADER_H - 4} fontSize={8.5} fill="#fff" textAnchor="middle" fontWeight={600}>heute</text>
              </>}
            </g>
          )}

          {/* Pfeile (die der Auswahl hervorgehoben) */}
          {arrows.map(a => (
            <path key={a.key} d={a.d} fill="none" strokeWidth={a.active ? 1.8 : 1.2} pointerEvents="none"
              markerEnd={`url(#arrow-${a.active && a.kind === "normal" ? "active" : a.kind})`}
              stroke={a.kind !== "normal" ? "var(--negative)" : a.active ? "var(--text)" : "var(--text4)"}
              strokeOpacity={selectedId && !a.active && a.kind === "normal" ? 0.45 : 1}
              strokeDasharray={a.kind === "conflict" ? "4 3" : undefined} />
          ))}

          {/* Sammelbalken der Gruppen */}
          {rows.map((r, i) => {
            if (r.type !== "group" || !r.hasTask) return null;
            const gy = HEADER_H + i * ROW_H;
            const gx = x(r.start), gw = Math.max(2, x(r.end) + dw - gx);
            return (
              <g key={`gs-${r.group}`} pointerEvents="none">
                <rect x={gx} y={gy + ROW_H / 2 - 3} width={gw} height={6} fill="var(--text3)" opacity={0.6} />
                <path d={`M${gx},${gy + ROW_H / 2 + 3} l0,4 l4,-4 z M${gx + gw},${gy + ROW_H / 2 + 3} l0,4 l-4,-4 z`} fill="var(--text3)" opacity={0.6} />
              </g>
            );
          })}

          {/* Elemente */}
          {rows.map((r, i) => {
            if (r.type !== "item") return null;
            const it = byId.get(r.item.id)!;
            const y = HEADER_H + i * ROW_H;
            const isCrit = critical?.has(it.id);
            const sel = it.id === selectedId;
            const dragging = drag?.id === it.id && drag.moved && drag.mode !== "link";
            const base = baseline?.items.find(b => b.id === it.id);
            const color = isCrit ? "var(--negative)" : barColor?.(it) || "var(--accent)";
            const cls = `gantt-item${sel ? " gantt-selected" : ""}`;
            if (it.kind === "milestone") {
              const cx = x(it.start), cy = y + ROW_H / 2, s = SYM;
              return (
                <g key={it.id} data-item={it.id} className={cls} opacity={isDone?.(it) ? 0.45 : 1} style={{ cursor: onChange ? (dragging ? "grabbing" : "grab") : "pointer" }}
                  onPointerDown={e => startDrag(e, it.id, "move")} onDoubleClick={() => onOpen?.(it.id)} onPointerEnter={() => setHoverRow(i)}>
                  <title>{tip(it)}</title>
                  {base && <path d={`M${x(base.start)},${cy - 4} l4,4 l-4,4 l-4,-4 z`} fill="var(--text4)" opacity={0.5} />}
                  <rect x={cx - 10} y={y + 2} width={20} height={ROW_H - 4} fill="transparent" />
                  {sel && <circle cx={cx} cy={cy} r={s + 4} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                  <Marker m={markerOf(it)} cx={cx} cy={cy} s={s} color={isCrit ? "var(--negative)" : "var(--text)"} />
                  {onLink && <circle className="gantt-knob" cx={cx + s + 6} cy={cy} r={4} fill="var(--surface)" stroke="var(--text3)" strokeWidth={1.2} style={{ cursor: "crosshair" }}
                    onPointerDown={e => startDrag(e, it.id, "link")}><title>Ziehen: Pfeil zu einer Folgeaufgabe</title></circle>}
                  <text x={cx + s + (onLink ? 14 : 5)} y={cy + 3.5} fontSize={10} fill="var(--text3)" pointerEvents="none">{isDone?.(it) ? "✓ " : ""}{dragging ? fmtLong(it.start) : fmtShort(it.start)}</text>
                </g>
              );
            }
            const bx = x(it.start), bw = Math.max(dw, x(it.end) + dw - bx);
            const by = y + BAR_PAD, bh = ROW_H - 2 * BAR_PAD;
            const prog = Math.max(0, Math.min(100, it.progress || 0));
            const hitX = bw < MIN_HIT ? bx - (MIN_HIT - bw) / 2 : bx, hitW = Math.max(bw, MIN_HIT);
            const label = dragging ? `${fmtShort(it.start)} – ${fmtShort(it.end)} · ${dayView ? `${durationDays(it)} T` : formatDuration(durationDays(it))}`
              : it.variant === "serie" ? `${seriesDates(it).length} Termine` : dayView ? `${durationDays(it)} T` : formatDuration(durationDays(it));
            return (
              <g key={it.id} data-item={it.id} className={cls} onDoubleClick={() => onOpen?.(it.id)} onPointerEnter={() => setHoverRow(i)}>
                <title>{tip(it)}</title>
                {base && <rect x={x(base.start)} y={y + ROW_H - 5} width={Math.max(dw, x(base.end) + dw - x(base.start))} height={3} rx={1.5} fill="var(--text4)" opacity={0.55} pointerEvents="none" />}
                {it.variant === "serie" ? (
                  // Terminserie: dünne Linie über den Zeitraum, Symbol an jedem Termin
                  <g pointerEvents="none">
                    <line x1={bx} x2={bx + bw} y1={y + ROW_H / 2} y2={y + ROW_H / 2} stroke={sel ? "var(--text)" : isCrit ? "var(--negative)" : "var(--text4)"} strokeWidth={sel ? 1.6 : 1} />
                    {(sessions ? sessions(it) : seriesDates(it).map(date => ({ date, state: undefined, protocol: undefined }))).map(ses => (
                      <g key={ses.date} opacity={ses.state === "ohne" ? 0.35 : 1}>
                        <Marker m={markerOf(it)} cx={x(ses.date) + dw / 2} cy={y + ROW_H / 2} s={dw * 7 >= 20 ? 4.5 : 3.2}
                          color={isCrit ? "var(--negative)" : "var(--text)"} open={ses.state === "kommend"} strokeWidth={ses.state === "kommend" ? 1.4 : undefined} />
                      </g>
                    ))}
                  </g>
                ) : <>
                  <rect x={bx} y={by} width={bw} height={bh} rx={3} pointerEvents="none"
                    fill={it.variant === "reserve" ? `url(#${hatchId})` : color}
                    fillOpacity={it.variant === "extern" ? 0.06 : it.variant === "reserve" ? 1 : isCrit ? 0.28 : 0.38}
                    stroke={sel ? "var(--text)" : isCrit ? "var(--negative)" : it.variant === "extern" ? color : it.variant === "reserve" ? "var(--text4)" : "none"}
                    strokeWidth={sel ? 1.8 : isCrit || it.variant ? 1.3 : 0}
                    strokeDasharray={it.variant === "reserve" && !sel ? "3 2" : undefined} />
                  {prog > 0 && <rect x={bx} y={by} width={bw * prog / 100} height={bh} rx={3} fill={color} opacity={0.85} pointerEvents="none" />}
                </>}
                <rect x={hitX} y={by - 2} width={hitW} height={bh + 4} fill="transparent" style={{ cursor: onChange ? (dragging ? "grabbing" : "grab") : "pointer" }}
                  onPointerDown={e => startDrag(e, it.id, "move")} />
                {/* Gehaltene Sitzungen öffnen ihr Protokoll (über der Trefferfläche zum Ziehen) */}
                {it.variant === "serie" && sessions && onOpenProtocol && sessions(it).filter(ses => ses.protocol).map(ses => (
                  <circle key={`p-${ses.date}`} cx={x(ses.date) + dw / 2} cy={y + ROW_H / 2} r={7} fill="transparent" style={{ cursor: "pointer" }}
                    onPointerDown={e => { e.stopPropagation(); onOpenProtocol(ses.protocol!.id); }}>
                    <title>{`Protokoll ${ses.protocol!.nummer || ""} vom ${fmtLong(ses.protocol!.date)} öffnen`}</title>
                  </circle>
                ))}
                {onChange && bw >= 14 && <>
                  <rect className="gantt-handle" x={bx} y={by + 2} width={3} height={bh - 4} rx={1.5} fill="var(--text)" pointerEvents="none" />
                  <rect className="gantt-handle" x={bx + bw - 3} y={by + 2} width={3} height={bh - 4} rx={1.5} fill="var(--text)" pointerEvents="none" />
                  <rect x={bx - 3} y={by} width={7} height={bh} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={e => startDrag(e, it.id, "start")}><title>Ziehen: Beginn ändern</title></rect>
                  <rect x={bx + bw - 4} y={by} width={7} height={bh} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={e => startDrag(e, it.id, "end")}><title>Ziehen: Ende ändern</title></rect>
                </>}
                {onLink && <circle className="gantt-knob" cx={bx + bw + 7} cy={y + ROW_H / 2} r={4} fill="var(--surface)" stroke="var(--text3)" strokeWidth={1.2} style={{ cursor: "crosshair" }}
                  onPointerDown={e => startDrag(e, it.id, "link")}><title>Ziehen: Pfeil zu einer Folgeaufgabe</title></circle>}
                <text x={bx + bw + (onLink ? 15 : 5)} y={y + ROW_H / 2 + 3.5} fontSize={10} fill={dragging ? "var(--text)" : "var(--text4)"} fontWeight={dragging ? 600 : 400} pointerEvents="none">{label}</text>
              </g>
            );
          })}

          {/* Pfeil, der gerade gezogen wird */}
          {drag?.mode === "link" && drag.px !== undefined && (() => {
            const it = byId.get(drag.id);
            const ri = rowOf.get(drag.id);
            if (!it || ri === undefined) return null;
            const sx = it.kind === "milestone" ? x(it.start) + 13 : x(it.end) + dw + 7;
            const stroke = linkOk === null ? "var(--accent)" : linkOk ? "var(--positive)" : "var(--negative)";
            return <line x1={sx} y1={HEADER_H + ri * ROW_H + ROW_H / 2} x2={drag.px} y2={drag.py} stroke={stroke} strokeWidth={1.8} strokeDasharray="5 3" pointerEvents="none" />;
          })()}
        </svg>
      </div>
    </div>
  );
}
