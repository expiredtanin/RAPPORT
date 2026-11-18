// Karte «Terminprogramm» in der Projekt-Detailansicht: Planungsterminprogramm (SIA-Phasen) und
// Bauprogramm (BKP-Arbeiten) eines Projekts bearbeiten.
//
// Gespeichert wird das ganze Programm am Projekt (`project.schedule`, schedule.ts). Nach jeder Änderung
// rücken Nachfolger über `shiftSuccessors` nach. Zusätzlich: Vorlagen (mit wählbarem Beginn), Stand
// einfrieren und vergleichen, kritischer Weg, Stunden je Planungsphase, PDF (A3 quer).
//
// Bedienung: Klick wählt aus (Leiste mit den Daten und Aktionen), Doppelklick oder Enter öffnet den Dialog.
// Tastatur, solange die Karte aktiv ist: ←/→ einen Tag (mit ⇧ eine Woche) verschieben, Entf löschen,
// Esc Auswahl aufheben, ⌘Z/Ctrl+Z rückgängig (Verlauf nur in dieser Ansicht, bis zum Verlassen).

import { useEffect, useMemo, useRef, useState } from "react";
import { SIA_PHASES } from "../../constants";
import { generateId, localISODate } from "../../utils";
import {
  addDays, baselineDelta, constructionTemplate, criticalPath, dayNum, dependencyConflicts, durationDays, formatDuration,
  holidayDates, moveItem, phaseProgress, planningTemplate, scheduleOf, scheduleRange, shiftSuccessors, trackItems, wouldCreateCycle,
} from "../../schedule";
import { Modal, FormField, DateInput } from "../../components/UI";
import { useConfirm } from "../../hooks/useConfirm";
import { GanttChart } from "./GanttChart";
import { ZOOM_LEVELS } from "./zoom";
import type { Id, Project, ProjectSchedule, ScheduleItem, ScheduleTrack, ViewProps } from "../../types";

const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const initials = (name = "") => name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();
const MAX_UNDO = 40;
/** Ab dieser Länge (Tage) öffnet das Programm eingepasst statt in Wochen. */
const FIT_FROM_DAYS = 150;

const smallBtn = { fontSize: 11, padding: "4px 10px" } as const;

/** Terminprogramm-Karte eines Projekts. */
export function ScheduleEditor({ project, data, update, setPrintContent, canEdit }: {
  project: Project;
  data: ViewProps["data"];
  update: ViewProps["update"];
  setPrintContent: ViewProps["setPrintContent"];
  canEdit: boolean;
}) {
  const today = localISODate();
  const schedule = scheduleOf(project);
  const [track, setTrack] = useState<ScheduleTrack>(() => trackItems(schedule, "planung").length || !trackItems(schedule, "bau").length ? "planung" : "bau");
  const [zoom, setZoom] = useState(() => {
    const r = scheduleRange(schedule.items);
    return r && dayNum(r.end) - dayNum(r.start) > FIT_FROM_DAYS ? "alles" : "woche";
  });
  const [showCritical, setShowCritical] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  /** Dialog: bestehendes Element oder neues (erst beim Speichern eingefügt, nach `afterId`) */
  const [editing, setEditing] = useState<{ item: ScheduleItem; isNew: boolean; afterId?: Id } | null>(null);
  const [history, setHistory] = useState<ProjectSchedule[]>([]);
  const [templateStart, setTemplateStart] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const items = trackItems(schedule, track);
  const baseline = schedule.baselines?.[track];
  const crit = useMemo(() => criticalPath(items), [items]);
  const conflicts = useMemo(() => dependencyConflicts(items), [items]);
  const range = scheduleRange(items);
  const holidays = useMemo(() => range ? holidayDates(data.feiertage, addDays(range.start, -60), addDays(range.end, 60)) : [],
    [data.feiertage, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const employees = data.employees || [];
  const zoomLevel = ZOOM_LEVELS.find(z => z.id === zoom) || ZOOM_LEVELS[1];
  const selected = items.find(it => it.id === selectedId) || null;

  /** Speichert das Programm (Nachfolger rücken nach) und merkt den alten Stand für «Rückgängig». */
  const save = (next: ProjectSchedule) => {
    setHistory(h => [...h.slice(-(MAX_UNDO - 1)), schedule]);
    const shifted = { ...next, items: shiftSuccessors(next.items) };
    update("projects", prev => prev.map(p => p.id === project.id ? { ...p, schedule: shifted } : p));
  };
  const undo = () => {
    const prevState = history[history.length - 1];
    if (!prevState) return;
    setHistory(h => h.slice(0, -1));
    update("projects", prev => prev.map(p => p.id === project.id ? { ...p, schedule: prevState } : p));
  };
  /** Ersetzt die Elemente dieses Programms, das andere bleibt unverändert. */
  const saveTrack = (trackList: ScheduleItem[]) => {
    save({ ...schedule, items: [...schedule.items.filter(it => it.track !== track), ...trackList] });
  };
  const replaceItem = (it: ScheduleItem) => saveTrack(items.map(x => x.id === it.id ? it : x));

  const canLink = (fromId: Id, toId: Id) =>
    !wouldCreateCycle(items, fromId, toId) && !(items.find(it => it.id === toId)?.deps || []).some(d => d.fromId === fromId);
  const link = (fromId: Id, toId: Id) => {
    if (!canLink(fromId, toId)) return;
    saveTrack(items.map(it => it.id !== toId ? it : { ...it, deps: [...(it.deps || []), { fromId }] }));
    setSelectedId(toId);
  };

  /** Neues Element nach dem ausgewählten (gleiche Gruppe, beginnt danach); eingefügt wird erst beim Speichern. */
  const addItem = (kind: ScheduleItem["kind"]) => {
    const after = selected || items[items.length - 1];
    const start = after ? addDays(after.end, after.kind === "milestone" ? 0 : 1) : project.startDate || today;
    const item: ScheduleItem = {
      id: generateId(), label: "", kind, track,
      group: after?.group || "", phaseId: track === "planung" ? after?.phaseId : undefined,
      start, end: kind === "milestone" ? start : addDays(start, 13), deps: after ? [{ fromId: after.id }] : [],
    };
    setEditing({ item, isNew: true, afterId: after?.id });
  };
  const saveEditing = (it: ScheduleItem) => {
    if (!editing) return;
    const item = { ...it, label: it.label.trim() || (it.kind === "milestone" ? "Meilenstein" : "Aufgabe") };
    if (editing.isNew) {
      const idx = editing.afterId ? items.findIndex(x => x.id === editing.afterId) + 1 : items.length;
      saveTrack([...items.slice(0, idx), item, ...items.slice(idx)]);
    } else {
      replaceItem(item);
    }
    setSelectedId(item.id);
    setEditing(null);
  };

  const defaultTemplateStart = track === "planung"
    ? (project.startDate && project.startDate > today ? project.startDate : today)
    : trackItems(schedule, "planung").find(it => it.kind === "milestone" && /baubeginn/i.test(it.label))?.start || today;
  const loadTemplate = () => {
    const start = templateStart || defaultTemplateStart;
    saveTrack(track === "planung" ? planningTemplate(project, SIA_PHASES, start, generateId) : constructionTemplate(start, generateId));
    setZoom("alles"); // Vorlagen umfassen ein bis zwei Jahre
    setTemplateStart("");
  };

  const freezeBaseline = async () => {
    if (baseline && !await askConfirm(`Der eingefrorene Stand vom ${fmtDate(baseline.savedAt)} wird durch den heutigen ersetzt.`, "Neu einfrieren")) return;
    save({ ...schedule, baselines: { ...schedule.baselines, [track]: { savedAt: new Date().toISOString(), items: items.map(({ id, start, end }) => ({ id, start, end })) } } });
    setShowBaseline(true);
  };

  const removeItem = async (it: ScheduleItem) => {
    if (!await askConfirm(`«${it.label}» löschen? Pfeile von und zu diesem Eintrag werden entfernt. (Rückgängig mit ⌘Z)`)) return;
    saveTrack(items.filter(x => x.id !== it.id).map(x => ({ ...x, deps: (x.deps || []).filter(d => d.fromId !== it.id) })));
    setEditing(null);
    setSelectedId(null);
  };
  const clearTrack = async () => {
    if (!await askConfirm(`Das ganze ${track === "planung" ? "Planungsterminprogramm" : "Bauprogramm"} mit ${items.length} Einträgen löschen? (Rückgängig mit ⌘Z, solange die Seite offen ist)`)) return;
    saveTrack([]);
    setSelectedId(null);
  };

  const moveRow = (it: ScheduleItem, dir: -1 | 1) => {
    const idx = items.findIndex(x => x.id === it.id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    saveTrack(next);
  };

  // Tastatur: nur wenn die Karte aktiv ist (Fokus darin) und kein Dialog offen ist
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    if (!canEdit || editing || document.querySelector(".modal-overlay")) return;
    if (!cardRef.current?.contains(document.activeElement)) return;
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (!selected) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      replaceItem(moveItem(selected, (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 7 : 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setEditing({ item: selected, isNew: false });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeItem(selected);
    } else if (e.key === "Escape") {
      setSelectedId(null);
    }
  };
  useEffect(() => { keyRef.current = onKey; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const progressOf = (it: ScheduleItem) => track === "planung" && it.kind === "task" ? phaseProgress(it, project, data.timeEntries || [], today) : null;
  const meta = (it: ScheduleItem) => {
    const emp = employees.find(e => e.id === it.assigneeId);
    const contractor = (data.persons || []).find(p => p.id === it.contractorId);
    const prog = progressOf(it);
    const delta = showBaseline ? baselineDelta(it, baseline) : null;
    // Warnung nur, wenn die Phase läuft und die Stunden der Zeit davonlaufen, oder das Budget überschritten ist
    const over = prog && prog.hoursPct !== null && ((prog.timePct > 0 && prog.hoursPct > prog.timePct + 10) || prog.hoursPct > 100);
    return (
      <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10, color: "var(--text4)", flexShrink: 0 }}>
        {delta !== null && delta !== 0 && <span title="Verschiebung des Endes gegenüber dem eingefrorenen Stand" style={{ color: delta > 0 ? "var(--negative)" : "var(--positive)", fontWeight: 600 }}>{delta > 0 ? "+" : ""}{delta} T</span>}
        {prog && prog.hoursPct !== null && (
          <span title={`Stunden der Phase: ${Math.round(prog.hoursIst)} von ${prog.hoursSoll} h (${prog.hoursPct} %) · Zeit verstrichen: ${prog.timePct} %`}
            style={{ padding: "1px 5px", borderRadius: 8, background: over ? "var(--negative-bg)" : "transparent", color: over ? "var(--negative)" : "var(--text4)" }}>
            {prog.hoursPct} % h
          </span>
        )}
        {contractor && <span title={contractor.name} style={{ maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contractor.name}</span>}
        {emp && <span title={emp.name} style={{ padding: "1px 5px", borderRadius: 8, background: "var(--surface3)", color: "var(--text3)" }}>{initials(emp.name)}</span>}
      </span>
    );
  };
  const describe = (it: ScheduleItem) => {
    const lines: string[] = [];
    const f = crit.float.get(it.id);
    if (f !== undefined) lines.push(f <= 0 ? "Kritisch: kein Puffer" : `Puffer: ${formatDuration(f)}`);
    const emp = employees.find(e => e.id === it.assigneeId);
    if (emp) lines.push(`Verantwortlich: ${emp.name}`);
    const firm = (data.persons || []).find(p => p.id === it.contractorId);
    if (firm) lines.push(`Firma: ${firm.name}`);
    const prog = progressOf(it);
    if (prog && prog.hoursPct !== null) lines.push(`Stunden: ${Math.round(prog.hoursIst)} / ${prog.hoursSoll} h · Zeit ${prog.timePct} %`);
    if (it.note) lines.push(it.note);
    return lines.join("\n") || undefined;
  };

  const totalDays = range ? dayNum(range.end) - dayNum(range.start) + 1 : 0;
  const selFloat = selected ? crit.float.get(selected.id) : undefined;

  return (
    <div ref={cardRef} className="card" tabIndex={-1} style={{ padding: 0, marginTop: 20, outline: "none" }}
      onPointerDownCapture={e => { if (!(e.target as HTMLElement).closest("input, textarea, select, button")) cardRef.current?.focus({ preventScroll: true }); }}>
      {ConfirmModalEl}
      {/* Kopf: Programm, Darstellung */}
      <div style={{ padding: "12px 20px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border2)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginRight: 6 }}>TERMINPROGRAMM</div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 18, padding: 2, gap: 2 }}>
          {(["planung", "bau"] as ScheduleTrack[]).map(t => (
            <button key={t} onClick={() => { setTrack(t); setSelectedId(null); }}
              style={{ border: "none", borderRadius: 16, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                background: track === t ? "var(--text)" : "transparent", color: track === t ? "var(--surface)" : "var(--text3)" }}>
              {t === "planung" ? "Planung" : "Bau"} <span style={{ opacity: 0.6 }}>{trackItems(schedule, t).length || ""}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {items.length > 0 && <>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 18, padding: 2, gap: 2 }} role="group" aria-label="Zoom">
            {ZOOM_LEVELS.map(z => (
              <button key={z.id} onClick={() => setZoom(z.id)} title={z.id === "alles" ? "Ganzes Programm in die Breite einpassen" : undefined}
                style={{ border: "none", borderRadius: 16, padding: "4px 11px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                  background: zoom === z.id ? "var(--surface3)" : "transparent", color: zoom === z.id ? "var(--text)" : "var(--text4)", fontWeight: zoom === z.id ? 600 : 400 }}>
                {z.label}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 11, color: showCritical ? "var(--negative)" : "var(--text3)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}
            title="Einträge ohne Puffer: jede Verspätung verschiebt das Ende">
            <input type="checkbox" checked={showCritical} onChange={e => setShowCritical(e.target.checked)} style={{ width: "auto" }} /> Kritischer Weg
          </label>
          {baseline && (
            <label style={{ fontSize: 11, color: "var(--text3)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }} title={`Vergleich mit dem Stand vom ${fmtDate(baseline.savedAt)} (graue Striche, Verschiebung in Tagen)`}>
              <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} style={{ width: "auto" }} /> Vergleich {fmtDate(baseline.savedAt).slice(0, 6)}
            </label>
          )}
          <button className="btn btn-ghost" style={smallBtn}
            title="Druckt die aktuelle Ansicht (inkl. kritischem Weg und Vergleich, falls eingeschaltet) auf A3 quer"
            onClick={() => setPrintContent({ type: "schedule", project, track, items, baseline: showBaseline ? baseline : undefined, critical: showCritical ? [...crit.critical] : [], holidays, data })}>
            PDF
          </button>
        </>}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "30px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 6 }}>
            {track === "planung" ? "Noch kein Planungsterminprogramm" : "Noch kein Bauprogramm"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, maxWidth: 560, lineHeight: 1.6 }}>
            {track === "planung"
              ? `Vorlage aus den SIA-Phasen des Projekts (${(project.enabledPhases?.length ? project.enabledPhases : ["31", "32", "33", "41", "51", "52", "53"]).join(", ")}) mit Baueingabe, Baubewilligung und Baubeginn — danach Dauern anpassen.`
              : "Vorlage mit der üblichen BKP-Abfolge eines Neubaus: Rohbau, Aufrichte, Installationen, Ausbau, Umgebung, Bauabnahme — danach anpassen."}
          </div>
          {canEdit ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text4)" }}>Beginn</span>
              <div style={{ width: 130 }}><DateInput value={templateStart || defaultTemplateStart} onChange={e => setTemplateStart(e.target.value)} /></div>
              <button className="btn btn-primary" onClick={loadTemplate}>{track === "planung" ? "Aus SIA-Phasen erstellen" : "BKP-Vorlage erstellen"}</button>
              <button className="btn btn-ghost" onClick={() => addItem("task")}>Leer beginnen</button>
            </div>
          ) : <div style={{ fontSize: 12, color: "var(--text4)" }}>Erstellen können Personen mit dem Recht «Projekte».</div>}
          {canEdit && history.length > 0 && <button className="btn btn-ghost" style={{ ...smallBtn, marginTop: 12 }} onClick={undo}>↶ Rückgängig</button>}
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          {/* Zusammenfassung und Bearbeiten */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--text3)" }}>
            {range && <span><strong style={{ color: "var(--text)", fontWeight: 600 }}>{fmtDate(range.start)} – {fmtDate(range.end)}</strong> · {formatDuration(totalDays)}</span>}
            {showCritical && <span style={{ color: "var(--negative)" }}>{crit.critical.size} kritisch</span>}
            {conflicts.length > 0 && <span style={{ color: "var(--negative)" }} title="Pfeile mit «rückt nach» aus, deren Folgeaufgabe zu früh beginnt (gestrichelt)">⚠ {conflicts.length} {conflicts.length === 1 ? "Abhängigkeit verletzt" : "Abhängigkeiten verletzt"}</span>}
            <div style={{ flex: 1 }} />
            {canEdit && <>
              <button className="btn btn-ghost" style={smallBtn} onClick={undo} disabled={!history.length} title="Letzte Änderung rückgängig (⌘Z / Ctrl+Z)">↶ Rückgängig</button>
              <button className="btn btn-ghost" style={smallBtn} onClick={() => addItem("task")} title={selected ? `Neue Aufgabe nach «${selected.label}»` : "Neue Aufgabe am Ende"}>+ Aufgabe</button>
              <button className="btn btn-ghost" style={smallBtn} onClick={() => addItem("milestone")}>+ Meilenstein</button>
              <button className="btn btn-ghost" style={smallBtn} onClick={freezeBaseline}
                title="Heutige Termine als Soll festhalten; «Vergleich» zeigt danach, was sich verschoben hat">{baseline ? "Stand neu einfrieren" : "Stand einfrieren"}</button>
            </>}
          </div>

          {/* Auswahl */}
          {/* Feste Höhe, einzeilig: Auswählen darf den Zeitstrahl nicht verschieben (Doppelklick) */}
          <div style={{ height: 46, boxSizing: "border-box", marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: selected ? "var(--surface2)" : "transparent",
            border: `1px ${selected ? "solid" : "dashed"} var(--border)`, display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap", fontSize: 12, overflow: "hidden" }}>
            {selected ? <>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={`${selected.label} · ${selected.kind === "milestone" ? fmtDate(selected.start) : `${fmtDate(selected.start)} – ${fmtDate(selected.end)}`}`}>
                <strong style={{ fontWeight: 600 }}>{selected.kind === "milestone" ? "◆ " : ""}{selected.label}</strong>
                <span style={{ color: "var(--text3)", marginLeft: 10 }}>
                  {selected.kind === "milestone" ? fmtDate(selected.start) : `${fmtDate(selected.start)} – ${fmtDate(selected.end)} · ${formatDuration(durationDays(selected))}`}
                </span>
                {selFloat !== undefined && <span style={{ marginLeft: 10, color: selFloat <= 0 ? "var(--negative)" : "var(--text4)" }}>{selFloat <= 0 ? "kritisch" : `Puffer ${formatDuration(selFloat)}`}</span>}
              </span>
              {canEdit && <>
                <button className="btn btn-ghost" style={{ ...smallBtn, flexShrink: 0 }} onClick={() => setEditing({ item: selected, isNew: false })}>Bearbeiten</button>
                <button className="btn btn-ghost" style={{ ...smallBtn, flexShrink: 0 }} onClick={() => addItem("task")}>+ Folgeaufgabe</button>
                <button className="btn btn-ghost" style={{ ...smallBtn, flexShrink: 0, color: "var(--negative)" }} onClick={() => removeItem(selected)}>Löschen</button>
              </>}
              <button className="btn btn-ghost" style={{ ...smallBtn, padding: "4px 8px", flexShrink: 0 }} onClick={() => setSelectedId(null)} title="Auswahl aufheben (Esc)">✕</button>
            </> : (
              <span style={{ color: "var(--text4)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {canEdit
                  ? "Klick wählt aus · Doppelklick bearbeitet · Balken ziehen verschiebt (in Wochen, mit Alt tageweise) · Enden ziehen ändert die Dauer · Punkt am Balkenende auf eine Zeile ziehen = «beginnt nach»"
                  : "Klick auf eine Zeile zeigt Termine und Puffer."}
              </span>
            )}
          </div>
          {/* Platz immer reserviert: sonst springt der Zeitstrahl beim ersten Klick und ein Doppelklick träfe die Zeile darüber */}
          {canEdit && (
            <div style={{ fontSize: 10, color: "var(--text4)", margin: "-4px 0 8px 2px", height: 14, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", visibility: selected ? "visible" : "hidden" }}>
              Tastatur: ← → einen Tag, mit ⇧ eine Woche · Enter bearbeiten · Entf löschen · ⌘Z rückgängig · Nachfolger rücken automatisch nach
            </div>
          )}

          <GanttChart
            items={items} dayWidth={zoomLevel.dayWidth} fit={zoom === "alles"} today={today} holidays={holidays}
            critical={showCritical ? crit.critical : undefined}
            baseline={showBaseline ? baseline : undefined}
            conflicts={conflicts} selectedId={selectedId}
            onSelect={id => setSelectedId(prev => (prev === id ? prev : id))}
            onOpen={id => { const it = items.find(x => x.id === id); if (it && canEdit) setEditing({ item: it, isNew: false }); }}
            onChange={canEdit ? it => { replaceItem(it); setSelectedId(it.id); } : undefined}
            onLink={canEdit ? link : undefined}
            canLink={canLink}
            snapDays={zoom === "tag" ? 1 : 7}
            renderMeta={meta}
            describe={describe}
          />
          {canEdit && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ ...smallBtn, color: "var(--text4)", border: "none", boxShadow: "none" }} onClick={clearTrack}>
                {track === "planung" ? "Planungsterminprogramm" : "Bauprogramm"} löschen
              </button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <ItemDialog
          item={editing.item} isNew={editing.isNew} items={items} track={track} data={data}
          onClose={() => setEditing(null)}
          onSave={saveEditing}
          onDelete={() => removeItem(editing.item)}
          onMove={dir => moveRow(editing.item, dir)}
        />
      )}
    </div>
  );
}

/** Dialog «Eintrag bearbeiten»: Stammdaten, Termine, Zuständigkeit, Vorgänger und Nachfolger. */
function ItemDialog({ item, isNew, items, track, data, onClose, onSave, onDelete, onMove }: {
  item: ScheduleItem;
  isNew: boolean;
  items: ScheduleItem[];
  track: ScheduleTrack;
  data: ViewProps["data"];
  onClose: () => void;
  onSave: (it: ScheduleItem) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [f, setF] = useState<ScheduleItem>(item);
  const groups = [...new Set(items.map(it => it.group).filter(Boolean))] as string[];
  const others = items.filter(it => it.id !== item.id);
  const days = durationDays(f);
  const setStart = (start: string) => {
    if (!start) return;
    const len = dayNum(f.end) - dayNum(f.start);
    setF({ ...f, start, end: f.kind === "milestone" ? start : addDays(start, Math.max(0, len)) });
  };
  const setDays = (n: number) => { if (n >= 1) setF({ ...f, end: addDays(f.start, Math.round(n) - 1) }); };
  const deps = f.deps || [];
  const withMe = isNew ? [...items, f] : items.map(x => x.id === f.id ? f : x);
  const candidates = others.filter(o => !deps.some(d => d.fromId === o.id) && !wouldCreateCycle(withMe, o.id, f.id));
  const successors = others.filter(o => (o.deps || []).some(d => d.fromId === item.id));
  const kindLabel = f.kind === "milestone" ? "Meilenstein" : "Aufgabe";
  return (
    <Modal title={isNew ? `Neue${f.kind === "milestone" ? "r" : ""} ${kindLabel}` : `${kindLabel} bearbeiten`} onClose={onClose} onSave={() => onSave(f)} saveLabel={isNew ? "Hinzufügen" : "Speichern"} wide>
      <div className="form-row">
        <FormField label="Bezeichnung" style={{ flex: 3 }}>
          <input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} autoFocus
            placeholder={f.kind === "milestone" ? "z.B. Baueingabe, Aufrichte" : track === "bau" ? "z.B. Baumeisterarbeiten" : "z.B. Vorprojekt"}
            onKeyDown={e => { if (e.key === "Enter") onSave(f); }} />
        </FormField>
        <FormField label="Art">
          <select value={f.kind} onChange={e => {
            const kind = e.target.value as ScheduleItem["kind"];
            setF({ ...f, kind, end: kind === "milestone" ? f.start : dayNum(f.end) > dayNum(f.start) ? f.end : addDays(f.start, 13) });
          }}>
            <option value="task">Aufgabe (Balken)</option>
            <option value="milestone">Meilenstein (Termin)</option>
          </select>
        </FormField>
      </div>
      <div className="form-row">
        <FormField label={f.kind === "milestone" ? "Datum" : "Beginn"}>
          <DateInput value={f.start} onChange={e => setStart(e.target.value)} />
        </FormField>
        {f.kind === "task" && <>
          <FormField label="Ende">
            <DateInput value={f.end} onChange={e => e.target.value && dayNum(e.target.value) >= dayNum(f.start) && setF({ ...f, end: e.target.value })} />
          </FormField>
          <FormField label={`Dauer · ${formatDuration(days)}`}>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={0} step={1} value={Math.floor(days / 7)} title="Wochen" style={{ width: "50%" }}
                onChange={e => setDays(Math.max(0, Number(e.target.value) || 0) * 7 + (days % 7))} />
              <input type="number" min={0} max={6} step={1} value={days % 7} title="Tage" style={{ width: "50%" }}
                onChange={e => setDays(Math.floor(days / 7) * 7 + Math.max(0, Math.min(6, Number(e.target.value) || 0)))} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>Wochen · Tage (Kalendertage)</div>
          </FormField>
        </>}
      </div>
      <div className="form-row">
        <FormField label="Gruppe">
          <input list="schedule-groups" value={f.group || ""} onChange={e => setF({ ...f, group: e.target.value })} placeholder={track === "bau" ? "z.B. Rohbau" : "z.B. 31 Vorprojekt"} />
          <datalist id="schedule-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
        </FormField>
        {track === "planung" ? (
          <FormField label="SIA-Phase (für Stunden Soll/Ist)">
            <select value={f.phaseId || ""} onChange={e => setF({ ...f, phaseId: e.target.value || undefined })}>
              <option value="">— keine —</option>
              {SIA_PHASES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </FormField>
        ) : (
          <FormField label="BKP-Nummer">
            <input value={f.bkp || ""} onChange={e => setF({ ...f, bkp: e.target.value.trim() || undefined })} placeholder="z.B. 211" />
          </FormField>
        )}
        {f.kind === "task" && (
          <FormField label="Fortschritt">
            <select value={f.progress || 0} onChange={e => setF({ ...f, progress: Number(e.target.value) })}>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(p => <option key={p} value={p}>{p === 0 ? "nicht begonnen" : p === 100 ? "erledigt (100 %)" : `${p} %`}</option>)}
            </select>
          </FormField>
        )}
      </div>
      <div className="form-row">
        <FormField label="Verantwortlich (Büro)">
          <select value={f.assigneeId || ""} onChange={e => setF({ ...f, assigneeId: e.target.value || null })}>
            <option value="">— niemand —</option>
            {(data.employees || []).filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </FormField>
        <FormField label={track === "bau" ? "Unternehmer" : "Fachplaner / Firma"}>
          <select value={f.contractorId || ""} onChange={e => setF({ ...f, contractorId: e.target.value || null })}>
            <option value="">— keine —</option>
            {(data.persons || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Notiz">
        <textarea value={f.note || ""} onChange={e => setF({ ...f, note: e.target.value })} rows={2} placeholder="erscheint im Tooltip" />
      </FormField>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>BEGINNT NACH</div>
          {deps.length === 0 && <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 6 }}>Keine Vorgänger — Beginn frei.</div>}
          {deps.map((d, i) => {
            const pred = others.find(o => o.id === d.fromId);
            return (
              <div key={d.fromId} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pred ? `endet ${fmtDate(pred.end)}` : undefined}>
                    {pred?.label || "(gelöscht)"} <span style={{ color: "var(--text4)" }}>{pred ? `· bis ${fmtDate(pred.end).slice(0, 6)}` : ""}</span>
                  </span>
                  <button className="btn btn-ghost" style={{ padding: "1px 7px", fontSize: 11 }} title="Pfeil entfernen" onClick={() => setF({ ...f, deps: deps.filter((_, j) => j !== i) })}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, color: "var(--text4)", fontSize: 11 }}>
                  <span>Abstand</span>
                  <input type="number" step={1} value={d.lagDays || 0} style={{ width: 60, height: 26, fontSize: 11 }} title="Tage nach dem Ende (negativ = Überlappung)"
                    onChange={e => setF({ ...f, deps: deps.map((x, j) => j === i ? { ...x, lagDays: Number(e.target.value) || 0 } : x) })} />
                  <span>Tage</span>
                  <label style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto", cursor: "pointer" }} title="Aus: verschiebt sich nicht mit, ein Konflikt wird nur angezeigt">
                    <input type="checkbox" checked={d.auto !== false} style={{ width: "auto" }}
                      onChange={e => setF({ ...f, deps: deps.map((x, j) => j === i ? { ...x, auto: e.target.checked ? undefined : false } : x) })} /> rückt nach
                  </label>
                </div>
              </div>
            );
          })}
          {candidates.length > 0 && (
            <select value="" onChange={e => e.target.value && setF({ ...f, deps: [...deps, { fromId: e.target.value }] })} style={{ height: 30, fontSize: 12 }}>
              <option value="">+ Vorgänger hinzufügen …</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>DANACH FOLGT</div>
          {successors.length === 0
            ? <div style={{ fontSize: 12, color: "var(--text4)" }}>Nichts — dieser Eintrag schiebt keine anderen.</div>
            : successors.map(s => (
              <div key={s.id} style={{ fontSize: 12, padding: "3px 0", color: "var(--text3)" }}>→ {s.label} <span style={{ color: "var(--text4)" }}>· ab {fmtDate(s.start).slice(0, 6)}</span></div>
            ))}
          {successors.length > 0 && <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>Verschiebt sich dieser Eintrag nach hinten, rücken sie mit.</div>}
        </div>
      </div>

      {!isNew && (
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onMove(-1)} title="Zeile im Programm nach oben">↑</button>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onMove(1)} title="Zeile im Programm nach unten">↓</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-danger" style={{ fontSize: 11 }} onClick={onDelete}>Löschen</button>
        </div>
      )}
    </Modal>
  );
}
