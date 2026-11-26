// Terminplanung → «Auslastung»: interner Ressourcenplan (wer arbeitet an was, von–bis, zu wie viel %), unabhängig
// von den Terminprogrammen der Projekte. Oben Balkenplan je Person (Einsätze, Ferien), darunter das Wochenraster
// «wer ist wie ausgelastet» (workload.ts). Bearbeiten und alle Personen sehen: Recht «mitarbeiter» (sonst nur die
// eigene Zeile, nur lesen).

import { useState } from "react";
import { Modal, FormField, DateInput, EmptyState } from "../../components/UI";
import { GanttChart } from "./GanttChart";
import { projectColor } from "../time/projectColor";
import { mondayOf, weeklyLoad } from "../../workload";
import { createWorktime } from "../../worktime";
import { addDays } from "../../schedule";
import { generateId, getWeekNumber } from "../../utils";
import { showToast } from "../../toast";
import { removeWithUndo } from "../../undo";
import type { ResourceEntry, ScheduleItem, ViewProps } from "../../types";

type Draft = Partial<ResourceEntry>;

/** Ressourcenplan mit Wochen-Auslastung. */
export function ResourcePlan({ data, update, userPermissions, myEmployeeId, today, holidays, dayWidth, fit }: {
  data: ViewProps["data"];
  update: ViewProps["update"];
  userPermissions: string[] | null;
  myEmployeeId: string;
  today: string;
  holidays: string[];
  dayWidth: number;
  fit: boolean;
}) {
  const canEdit = !userPermissions || userPermissions.includes("mitarbeiter");
  const [draft, setDraft] = useState<Draft | null>(null);
  const thisMonday = mondayOf(today);
  const weeks = Array.from({ length: 13 }, (_, i) => addDays(thisMonday, (i - 4) * 7));
  const employees = (data.employees || []).filter(e => e.active !== false && !(e.austrittsdatum && e.austrittsdatum < weeks[0]))
    .filter(e => canEdit || e.id === myEmployeeId);
  const plan = (data.resourcePlan || []).filter(r => employees.some(e => e.id === r.employeeId));
  const projectName = (id?: string | null) => (data.projects || []).find(p => p.id === id)?.name || "";
  const labelOf = (r: ResourceEntry) => `${r.label || projectName(r.projectId) || "Einsatz"} · ${r.pensum} %`;

  // Balkenplan: Einsätze und genehmigte Ferien je Person
  const items: ScheduleItem[] = employees.flatMap(emp => [
    ...plan.filter(r => r.employeeId === emp.id).map(r => ({ id: `rp|${r.id}`, label: labelOf(r), kind: "task" as const, track: "planung" as const, group: emp.name, start: r.dateFrom, end: r.dateTo })),
    ...(data.ferienEntries || []).filter(f => f.employeeId === emp.id && f.status !== "rejected" && f.status !== "pending" && f.dateFrom && (f.dateTo || f.dateFrom) >= weeks[0])
      .map(f => ({ id: `ferien|${f.id}`, label: "Ferien", kind: "task" as const, track: "planung" as const, group: emp.name, start: f.dateFrom, end: f.dateTo || f.dateFrom })),
  ]).sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.start.localeCompare(b.start));
  const lastEnd = items.reduce((m, it) => (it.end > m ? it.end : m), addDays(today, 90));

  const wt = createWorktime(data, today);
  const rows = employees.map(emp => ({ emp, load: weeklyLoad(data, emp, plan.filter(r => r.employeeId === emp.id), weeks, today, wt) }));
  const h = (n: number) => `${Math.round(n)}`;
  const tone = (pct: number) => pct > 1.05 ? "var(--negative)" : pct >= 0.7 ? "var(--positive)" : pct > 0 ? "var(--warning)" : "var(--text5)";

  const openNew = () => setDraft({ employeeId: employees[0]?.id || "", label: "", projectId: "", dateFrom: today, dateTo: addDays(today, 13), pensum: 100, note: "" });
  const openEdit = (id: string) => {
    if (!id.startsWith("rp|") || !canEdit) return;
    const r = plan.find(x => x.id === id.slice(3));
    if (r) setDraft({ ...r, projectId: r.projectId || "" });
  };
  const save = () => {
    if (!draft) return;
    const pensum = Number(draft.pensum);
    if (!draft.employeeId) { showToast("Bitte eine Person wählen."); return; }
    if (!(draft.label || "").trim() && !draft.projectId) { showToast("Bitte angeben, an was gearbeitet wird (Text oder Projekt)."); return; }
    if (!draft.dateFrom || !draft.dateTo || draft.dateTo < draft.dateFrom) { showToast("Bitte Von und Bis angeben (Bis nicht vor Von)."); return; }
    if (!(pensum >= 1 && pensum <= 100)) { showToast("Prozent zwischen 1 und 100."); return; }
    const entry: ResourceEntry = {
      id: draft.id || generateId(), employeeId: draft.employeeId, label: (draft.label || "").trim(), projectId: draft.projectId || null,
      dateFrom: draft.dateFrom, dateTo: draft.dateTo, pensum: Math.round(pensum), note: (draft.note || "").trim() || undefined,
    };
    update("resourcePlan", prev => (prev || []).some(x => x.id === entry.id) ? (prev || []).map(x => x.id === entry.id ? entry : x) : [...(prev || []), entry]);
    setDraft(null);
  };
  const remove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    removeWithUndo("Einsatz entfernt", "resourcePlan", x => x.id === id);
    setDraft(null);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px" }}>
        <div style={{ fontSize: 12, color: "var(--text4)", flex: 1 }}>
          Interner Ressourcenplan: wer an was bis wann, unabhängig von den Terminprogrammen der Projekte.{canEdit ? " Balken anklicken zum Bearbeiten." : ""}
        </div>
        {canEdit && employees.length > 0 && <button className="btn btn-primary btn-sm" onClick={openNew}><span className="msr" style={{ fontSize: 16 }}>add</span>Einsatz</button>}
      </div>

      {employees.length === 0 ? (
        <EmptyState icon="groups" title="Keine Mitarbeitenden" text="Die Auslastung zeigt Personen aus «Personal»." />
      ) : (
        <>
          {items.length > 0 ? (
            <GanttChart
              items={items} dayWidth={dayWidth} fit={fit} today={today} holidays={holidays} labelWidth={320}
              labelTitle="Person / Einsatz" from={weeks[0]} to={addDays(lastEnd, 14)}
              describe={it => (it.id.startsWith("rp|") && canEdit ? "Klick: bearbeiten" : undefined)}
              onSelect={openEdit}
              barColor={it => {
                if (it.id.startsWith("ferien|")) return "var(--text4)";
                const r = plan.find(x => `rp|${x.id}` === it.id);
                return r?.projectId ? projectColor(r.projectId).solid : undefined;
              }}
            />
          ) : (
            <EmptyState icon="view_timeline" title="Noch keine Einsätze geplant" text={canEdit ? "Mit «Einsatz» festhalten, wer an was bis wann arbeitet." : "Noch nichts geplant."} />
          )}

          <div className="card" style={{ padding: 0, margin: "16px 0", overflowX: "auto" }}>
            <table style={{ fontSize: 12, minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Person</th>
                  {weeks.map(w => <th key={w} style={{ textAlign: "center", fontWeight: w === thisMonday ? 700 : 500, color: w < thisMonday ? "var(--text4)" : undefined }} title={`Woche ab ${w.split("-").reverse().join(".")}`}>KW {getWeekNumber(w)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, load }) => (
                  <tr key={emp.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{emp.name}</td>
                    {load.map(l => {
                      // vergangen: erfasst; laufende Woche: erfasst + ab heute verplant; kommend: verplant — je gegen verfügbar
                      const used = l.past ? l.ist : l.week === thisMonday ? l.ist + l.planned : l.planned;
                      const pct = l.available > 0 ? used / l.available : 0;
                      return (
                        <td key={l.week} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums", background: l.available > 0 && used > 0 ? `color-mix(in srgb, ${tone(pct)} ${Math.min(40, Math.round(pct * 25))}%, transparent)` : undefined }}
                          title={`${l.past ? "erfasst" : l.week === thisMonday ? "erfasst + verplant" : "verplant"} ${h(used)} h von ${h(l.available)} h verfügbar${l.overbooked ? ` · ${l.overbooked} Tag(e) über 100 %` : ""}`}>
                          {l.available > 0 ? <>{Math.round(pct * 100)}%<div style={{ fontSize: 10, color: "var(--text4)" }}>{h(used)}/{h(l.available)} h</div></> : <span style={{ color: "var(--text5)" }}>–</span>}
                          {l.overbooked > 0 && <div style={{ fontSize: 10, color: "var(--negative)" }}>{l.overbooked}× über 100 %</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text4)", lineHeight: 1.6 }}>
              Vergangene Wochen: erfasste Stunden. Kommende Wochen: Einsätze aus dem Ressourcenplan (Prozent der verfügbaren Zeit), je gegen die verfügbaren Stunden (Pensum, Feiertage, ohne Ferien und Absenzen). Richtwert für die interne Planung.
            </div>
          </div>
        </>
      )}

      {draft && (
        <Modal title={draft.id ? "Einsatz bearbeiten" : "Neuer Einsatz"} onClose={() => setDraft(null)} onSave={save}
          footerStart={draft.id ? <button className="btn btn-quiet" onClick={remove}><span className="msr" style={{ fontSize: 16 }}>delete</span>Entfernen</button> : undefined}>
          <FormField label="Person">
            <select value={draft.employeeId || ""} onChange={e => setDraft({ ...draft, employeeId: e.target.value })}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </FormField>
          <FormField label="An was">
            <input value={draft.label || ""} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="z.B. Wettbewerb Schulhaus, Ausführungspläne" />
          </FormField>
          <FormField label="Projekt (optional, nur für Name und Farbe)">
            <select value={draft.projectId || ""} onChange={e => setDraft({ ...draft, projectId: e.target.value })}>
              <option value="">— kein Projekt —</option>
              {(data.projects || []).filter(p => p.status !== "abgeschlossen" || p.id === draft.projectId).map(p => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
            </select>
          </FormField>
          <div className="form-row">
            <FormField label="Von"><DateInput value={draft.dateFrom || ""} onChange={e => setDraft({ ...draft, dateFrom: e.target.value })} /></FormField>
            <FormField label="Bis"><DateInput value={draft.dateTo || ""} onChange={e => setDraft({ ...draft, dateTo: e.target.value })} /></FormField>
            <FormField label="Anteil %"><input type="number" min={1} max={100} step={5} value={draft.pensum ?? ""} onChange={e => setDraft({ ...draft, pensum: e.target.value === "" ? undefined : +e.target.value })} style={{ maxWidth: 100 }} /></FormField>
          </div>
          <FormField label="Notiz (optional)"><input value={draft.note || ""} onChange={e => setDraft({ ...draft, note: e.target.value })} /></FormField>
        </Modal>
      )}
    </>
  );
}
