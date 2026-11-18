// Karte «Terminprogramm» in der Projekt-Detailansicht: Planungsterminprogramm (SIA-Phasen) und
// Bauprogramm (BKP-Arbeiten) eines Projekts bearbeiten.
//
// Gespeichert wird das ganze Programm am Projekt (`project.schedule`, schedule.ts). Nach jeder Änderung
// rücken Nachfolger über `shiftSuccessors` nach. Zusätzlich: Vorlagen, Stand einfrieren und vergleichen
// (Soll/Ist der Termine), kritischer Weg, Soll/Ist der Stunden je Planungsphase, PDF (A3 quer).

import { useMemo, useState } from "react";
import { SIA_PHASES } from "../../constants";
import { generateId, localISODate } from "../../utils";
import {
  addDays, baselineDelta, constructionTemplate, criticalPath, dayNum, dependencyConflicts, durationDays,
  holidayDates, phaseProgress, planningTemplate, scheduleOf, scheduleRange, shiftSuccessors, trackItems, wouldCreateCycle,
} from "../../schedule";
import { Modal, FormField, DateInput } from "../../components/UI";
import { useConfirm } from "../../hooks/useConfirm";
import { GanttChart } from "./GanttChart";
import { ZOOM_LEVELS } from "./zoom";
import type { Id, Project, ProjectSchedule, ScheduleItem, ScheduleTrack, ViewProps } from "../../types";

const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const initials = (name = "") => name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();

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
  // Zoom passend zur Länge: bis ~5 Monate Wochen, darüber Monate
  const [zoom, setZoom] = useState(() => {
    const r = scheduleRange(schedule.items);
    return r && dayNum(r.end) - dayNum(r.start) > 150 ? "monat" : "woche";
  });
  const [showCritical, setShowCritical] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const items = trackItems(schedule, track);
  const baseline = schedule.baselines?.[track];
  const crit = useMemo(() => criticalPath(items), [items]);
  const conflicts = useMemo(() => dependencyConflicts(items), [items]);
  const range = scheduleRange(items);
  const holidays = useMemo(() => range ? holidayDates(data.feiertage, addDays(range.start, -60), addDays(range.end, 60)) : [],
    [data.feiertage, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const employees = data.employees || [];
  const dayWidth = ZOOM_LEVELS.find(z => z.id === zoom)!.dayWidth;

  /** Speichert das Programm (Nachfolger rücken nach). */
  const save = (next: ProjectSchedule) => {
    const shifted = { ...next, items: shiftSuccessors(next.items) };
    update("projects", prev => prev.map(p => p.id === project.id ? { ...p, schedule: shifted } : p));
  };
  /** Ersetzt die Elemente dieses Programms, das andere bleibt unverändert. */
  const saveTrack = (trackList: ScheduleItem[]) => {
    save({ ...schedule, items: [...schedule.items.filter(it => it.track !== track), ...trackList] });
  };
  const replaceItem = (it: ScheduleItem) => saveTrack(items.map(x => x.id === it.id ? it : x));

  const link = (fromId: Id, toId: Id) => {
    if (wouldCreateCycle(items, fromId, toId)) return;
    saveTrack(items.map(it => it.id !== toId || (it.deps || []).some(d => d.fromId === fromId) ? it : { ...it, deps: [...(it.deps || []), { fromId }] }));
  };

  /** Neues Element nach dem ausgewählten (gleiche Gruppe, beginnt danach). */
  const addItem = (kind: ScheduleItem["kind"]) => {
    const after = items.find(it => it.id === selectedId) || items[items.length - 1];
    const start = after ? addDays(after.end, after.kind === "milestone" ? 0 : 1) : project.startDate || today;
    const it: ScheduleItem = {
      id: generateId(), label: kind === "milestone" ? "Meilenstein" : "Neue Aufgabe", kind, track,
      group: after?.group || "", phaseId: track === "planung" ? after?.phaseId : undefined,
      start, end: kind === "milestone" ? start : addDays(start, 13), deps: after ? [{ fromId: after.id }] : [],
    };
    const idx = after ? items.indexOf(after) + 1 : items.length;
    saveTrack([...items.slice(0, idx), it, ...items.slice(idx)]);
    setSelectedId(it.id);
    setEditing(it);
  };

  const loadTemplate = () => {
    if (track === "planung") {
      saveTrack(planningTemplate(project, SIA_PHASES, project.startDate || today, generateId));
    } else {
      // Bau beginnt nach dem Meilenstein «Vergabe / Baubeginn» der Planung, sonst heute
      const start = trackItems(schedule, "planung").find(it => it.kind === "milestone" && /baubeginn/i.test(it.label))?.start || today;
      saveTrack(constructionTemplate(start, generateId));
    }
    setZoom("monat"); // Vorlagen umfassen ein bis zwei Jahre
  };

  const freezeBaseline = async () => {
    if (baseline && !await askConfirm(`Der eingefrorene Stand vom ${fmtDate(baseline.savedAt)} wird ersetzt.`, "Neu einfrieren")) return;
    save({ ...schedule, baselines: { ...schedule.baselines, [track]: { savedAt: new Date().toISOString(), items: items.map(({ id, start, end }) => ({ id, start, end })) } } });
    setShowBaseline(true);
  };

  const removeItem = async (it: ScheduleItem) => {
    if (!await askConfirm(`«${it.label}» löschen? Pfeile von und zu diesem Eintrag werden entfernt.`)) return;
    saveTrack(items.filter(x => x.id !== it.id).map(x => ({ ...x, deps: (x.deps || []).filter(d => d.fromId !== it.id) })));
    setEditing(null);
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

  const meta = (it: ScheduleItem) => {
    const emp = employees.find(e => e.id === it.assigneeId);
    const contractor = (data.persons || []).find(p => p.id === it.contractorId);
    const prog = track === "planung" ? phaseProgress(it, project, data.timeEntries || [], today) : null;
    const delta = showBaseline ? baselineDelta(it, baseline) : null;
    return (
      <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10, color: "var(--text4)", flexShrink: 0 }}>
        {delta !== null && delta !== 0 && <span style={{ color: delta > 0 ? "var(--negative)" : "var(--positive)" }}>{delta > 0 ? "+" : ""}{delta} T</span>}
        {prog && prog.hoursPct !== null && it.kind === "task" && (
          <span title={`Zeit ${prog.timePct} % · Stunden ${Math.round(prog.hoursIst)} von ${prog.hoursSoll} h`}
            style={{ color: prog.hoursPct > prog.timePct + 10 ? "var(--negative)" : "var(--text4)" }}>
            {prog.timePct}%/{prog.hoursPct}%
          </span>
        )}
        {contractor && <span title={contractor.name} style={{ maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contractor.name}</span>}
        {emp && <span title={emp.name} style={{ padding: "1px 5px", borderRadius: 8, background: "var(--surface3)", color: "var(--text3)" }}>{initials(emp.name)}</span>}
      </span>
    );
  };

  const total = range ? Math.round((dayNum(range.end) - dayNum(range.start) + 1) / 7) : 0;

  return (
    <div className="card" style={{ padding: 0, marginTop: 20 }}>
      {ConfirmModalEl}
      <div style={{ padding: "14px 20px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", borderBottom: "1px solid var(--border2)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginRight: 6 }}>TERMINPROGRAMM</div>
        {(["planung", "bau"] as ScheduleTrack[]).map(t => (
          <button key={t} className={`pill${track === t ? " active" : ""}`} onClick={() => { setTrack(t); setSelectedId(null); }}
            style={track === t ? { background: "var(--text)", color: "var(--surface)" } : {}}>
            {t === "planung" ? "Planung" : "Bau"} ({trackItems(schedule, t).length})
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {items.length > 0 && <>
          {ZOOM_LEVELS.map(z => (
            <button key={z.id} className="pill" onClick={() => setZoom(z.id)}
              style={zoom === z.id ? { background: "var(--surface3)", fontWeight: 600 } : {}}>{z.label}</button>
          ))}
          <label style={{ fontSize: 11, color: "var(--text3)", display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={showCritical} onChange={e => setShowCritical(e.target.checked)} style={{ width: "auto" }} /> Kritischer Weg
          </label>
          {baseline && (
            <label style={{ fontSize: 11, color: "var(--text3)", display: "flex", gap: 4, alignItems: "center" }} title={`Eingefroren am ${fmtDate(baseline.savedAt)}`}>
              <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} style={{ width: "auto" }} /> Vergleich
            </label>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
            onClick={() => setPrintContent({ type: "schedule", project, track, items, baseline: showBaseline ? baseline : undefined, critical: showCritical ? [...crit.critical] : [], holidays, data })}>
            PDF
          </button>
        </>}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "28px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 14 }}>
            {track === "planung"
              ? "Noch kein Planungsterminprogramm. Aus den SIA-Phasen des Projekts erstellen (mit Baueingabe, Bewilligung, Baubeginn) oder leer beginnen."
              : "Noch kein Bauprogramm. Mit der üblichen BKP-Abfolge eines Neubaus beginnen (Rohbau, Installationen, Ausbau, Umgebung) oder leer."}
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={loadTemplate}>{track === "planung" ? "Aus SIA-Phasen erstellen" : "BKP-Vorlage Neubau"}</button>
              <button className="btn btn-ghost" onClick={() => addItem("task")}>Leer beginnen</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--text3)" }}>
            {range && <span>{fmtDate(range.start)} – {fmtDate(range.end)} · {total} Wochen</span>}
            {showCritical && <span style={{ color: "var(--negative)" }}>{crit.critical.size} kritisch</span>}
            {conflicts.length > 0 && <span style={{ color: "var(--negative)" }}>{conflicts.length} {conflicts.length === 1 ? "Abhängigkeit verletzt" : "Abhängigkeiten verletzt"} (gestrichelt)</span>}
            <div style={{ flex: 1 }} />
            {canEdit && <>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => addItem("task")}>+ Aufgabe</button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => addItem("milestone")}>+ Meilenstein</button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={freezeBaseline}
                title="Heutigen Stand als Soll festhalten, um spätere Verschiebungen zu sehen">Stand einfrieren</button>
            </>}
          </div>
          <GanttChart
            items={items} dayWidth={dayWidth} today={today} holidays={holidays}
            critical={showCritical ? crit.critical : undefined}
            baseline={showBaseline ? baseline : undefined}
            conflicts={conflicts} selectedId={selectedId}
            onSelect={id => { setSelectedId(id); const it = items.find(x => x.id === id); if (it && canEdit) setEditing(it); }}
            onChange={canEdit ? replaceItem : undefined}
            onLink={canEdit ? link : undefined}
            renderMeta={meta}
          />
          {canEdit && (
            <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 8 }}>
              Balken ziehen = verschieben · Enden ziehen = Dauer · Punkt am Ende auf eine Zeile ziehen = «beginnt nach» · Klick = bearbeiten.
              Nachfolger rücken automatisch nach{track === "planung" ? "; Prozent rechts = Zeit / Stunden der Phase" : ""}.
            </div>
          )}
        </div>
      )}

      {editing && (
        <ItemDialog
          item={editing} items={items} track={track} data={data}
          onClose={() => setEditing(null)}
          onSave={it => { replaceItem(it); setEditing(null); }}
          onDelete={() => removeItem(editing)}
          onMove={dir => moveRow(editing, dir)}
        />
      )}
    </div>
  );
}

/** Dialog «Eintrag bearbeiten»: Stammdaten, Termine, Zuständigkeit, Vorgänger. */
function ItemDialog({ item, items, track, data, onClose, onSave, onDelete, onMove }: {
  item: ScheduleItem;
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
  const weeks = Math.round(durationDays(f) / 7 * 10) / 10;
  const setStart = (start: string) => {
    if (!start) return;
    const len = dayNum(f.end) - dayNum(f.start);
    setF({ ...f, start, end: f.kind === "milestone" ? start : addDays(start, Math.max(0, len)) });
  };
  const deps = f.deps || [];
  const candidates = others.filter(o => !deps.some(d => d.fromId === o.id) && !wouldCreateCycle(items.map(x => x.id === f.id ? f : x), o.id, f.id));
  return (
    <Modal title={item.kind === "milestone" ? "Meilenstein bearbeiten" : "Aufgabe bearbeiten"} onClose={onClose} onSave={() => onSave(f)} wide>
      <div className="form-row">
        <FormField label="Bezeichnung" style={{ flex: 3 }}>
          <input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} autoFocus />
        </FormField>
        <FormField label="Art">
          <select value={f.kind} onChange={e => {
            const kind = e.target.value as ScheduleItem["kind"];
            setF({ ...f, kind, end: kind === "milestone" ? f.start : dayNum(f.end) > dayNum(f.start) ? f.end : addDays(f.start, 13) });
          }}>
            <option value="task">Aufgabe (Balken)</option>
            <option value="milestone">Meilenstein</option>
          </select>
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Gruppe">
          <input list="schedule-groups" value={f.group || ""} onChange={e => setF({ ...f, group: e.target.value })} placeholder="z.B. Rohbau" />
          <datalist id="schedule-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
        </FormField>
        {track === "planung" ? (
          <FormField label="SIA-Phase (Stunden Soll/Ist)">
            <select value={f.phaseId || ""} onChange={e => setF({ ...f, phaseId: e.target.value || undefined })}>
              <option value="">— keine —</option>
              {SIA_PHASES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </FormField>
        ) : (
          <FormField label="BKP">
            <input value={f.bkp || ""} onChange={e => setF({ ...f, bkp: e.target.value.trim() || undefined })} placeholder="z.B. 211" />
          </FormField>
        )}
      </div>
      <div className="form-row">
        <FormField label={f.kind === "milestone" ? "Datum" : "Beginn"}>
          <DateInput value={f.start} onChange={e => setStart(e.target.value)} />
        </FormField>
        {f.kind === "task" && <>
          <FormField label="Ende">
            <DateInput value={f.end} onChange={e => e.target.value && dayNum(e.target.value) >= dayNum(f.start) && setF({ ...f, end: e.target.value })} />
          </FormField>
          <FormField label="Dauer (Wochen)">
            <input type="number" min={0.2} step={0.5} value={weeks} onChange={e => {
              const w = Number(e.target.value);
              if (w > 0) setF({ ...f, end: addDays(f.start, Math.max(1, Math.round(w * 7)) - 1) });
            }} />
          </FormField>
          <FormField label="Fortschritt %">
            <input type="number" min={0} max={100} step={10} value={f.progress || 0} onChange={e => setF({ ...f, progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
          </FormField>
        </>}
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
        <textarea value={f.note || ""} onChange={e => setF({ ...f, note: e.target.value })} rows={2} />
      </FormField>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>BEGINNT NACH</div>
        {deps.length === 0 && <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 6 }}>Keine Vorgänger.</div>}
        {deps.map((d, i) => {
          const pred = others.find(o => o.id === d.fromId);
          return (
            <div key={d.fromId} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{pred?.label || "(gelöscht)"}</span>
              <span style={{ color: "var(--text4)" }}>Abstand</span>
              <input type="number" step={1} value={d.lagDays || 0} style={{ width: 70, height: 28 }}
                onChange={e => setF({ ...f, deps: deps.map((x, j) => j === i ? { ...x, lagDays: Number(e.target.value) || 0 } : x) })} />
              <span style={{ color: "var(--text4)" }}>Tage</span>
              <label style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--text3)" }} title="Aus: verschiebt sich nicht mit, Konflikt wird nur angezeigt">
                <input type="checkbox" checked={d.auto !== false} style={{ width: "auto" }}
                  onChange={e => setF({ ...f, deps: deps.map((x, j) => j === i ? { ...x, auto: e.target.checked ? undefined : false } : x) })} /> rückt nach
              </label>
              <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setF({ ...f, deps: deps.filter((_, j) => j !== i) })}>Entfernen</button>
            </div>
          );
        })}
        {candidates.length > 0 && (
          <select value="" onChange={e => e.target.value && setF({ ...f, deps: [...deps, { fromId: e.target.value }] })} style={{ maxWidth: 320, height: 30, fontSize: 12 }}>
            <option value="">+ Vorgänger hinzufügen …</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onMove(-1)}>↑ Zeile nach oben</button>
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onMove(1)}>↓ nach unten</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-danger" style={{ fontSize: 11 }} onClick={onDelete}>Löschen</button>
      </div>
    </Modal>
  );
}
