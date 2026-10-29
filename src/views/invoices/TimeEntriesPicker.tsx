// Auswahl der offenen Zeiteinträge eines Stundensatz-Projekts im Rechnungsformular (Häkchen + verrechnete Stunden).

import type React from "react";
import { SIA_PHASES } from "../../constants";
import { formatDate, formatHours } from "../../utils";
import type { AppData, TimeEntry } from "../../types";
import type { InvoiceForm } from "./invoiceHelpers";

/** Tabelle der offenen Zeiteinträge des gewählten Projekts; rendert nichts, wenn es kein Stundensatz-Projekt ist. */
export function TimeEntriesPicker({ form, setForm, data, openEntriesForProject, toggleEntrySelection, updateBilledMinutes }: {
  form: InvoiceForm;
  setForm: React.Dispatch<React.SetStateAction<InvoiceForm>>;
  data: AppData;
  openEntriesForProject: (projectId?: string) => TimeEntry[];
  toggleEntrySelection: (entryId: string, entry: TimeEntry) => void;
  updateBilledMinutes: (entryId: string, minutes: number) => void;
}) {
  if (!form.projectId) return null;
  const proj = data.projects.find(p => p.id === form.projectId);
  if (!proj) return null;
  const bType = proj.billingType || proj.type;
  if (bType !== "stundensatz") return null;
  const openEntries = openEntriesForProject(form.projectId);
  if (openEntries.length === 0) return (
    <div style={{ padding: 14, background: "var(--surface2)", borderRadius: 6, marginBottom: 14, fontSize: 12, color: "var(--text4)" }}>
      Keine offenen Zeiteinträge für dieses Projekt.
    </div>
  );
  const totalErfasst = openEntries.reduce((s, e) => s + e.minutes, 0);
  const totalVerrechnet = Object.entries(form.entrySelections || {})
    .filter(([id, s]) => s.selected && openEntries.some(e => e.id === id))
    .reduce((s, [_, sel]) => s + (sel.billedMinutes || 0), 0);
  const diff = totalErfasst - totalVerrechnet;
  const allSelected = openEntries.every(e => form.entrySelections?.[e.id]?.selected);
  const toggleAll = () => {
    const newSel = { ...form.entrySelections };
    if (allSelected) {
      openEntries.forEach(e => { newSel[e.id] = { ...newSel[e.id], selected: false }; });
    } else {
      openEntries.forEach(e => { newSel[e.id] = { selected: true, billedMinutes: newSel[e.id]?.billedMinutes ?? e.minutes }; });
    }
    setForm(f => ({ ...f, entrySelections: newSel }));
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <label>ZEITEINTRÄGE</label>
        <div style={{ fontSize: 11, color: "var(--text4)" }}>
          Erfasst {formatHours(totalErfasst)} · Verrechnet {formatHours(totalVerrechnet)}
          {diff > 0 && <span style={{ color: "var(--warning)", marginLeft: 8 }}>Nicht verrechnet: {formatHours(diff)}</span>}
        </div>
      </div>
      <div style={{ background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", maxHeight: 280, overflowY: "auto" }}>
        <table style={{ fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f0ebe3" }}>
              <th style={{ width: 36, padding: "6px 8px" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: "auto", cursor: "pointer" }} />
              </th>
              <th style={{ width: 90, padding: "6px 8px" }}>Datum</th>
              <th style={{ width: 60, padding: "6px 8px" }}>Phase</th>
              <th style={{ padding: "6px 8px" }}>Tätigkeit</th>
              <th style={{ width: 70, padding: "6px 8px", textAlign: "right" }}>Erfasst</th>
              <th style={{ width: 100, padding: "6px 8px", textAlign: "right" }}>Verrechnet</th>
            </tr>
          </thead>
          <tbody>
            {openEntries.map(e => {
              const sel = form.entrySelections?.[e.id];
              const selected = sel?.selected;
              const billedMinutes = selected ? (sel?.billedMinutes ?? e.minutes) : 0;
              const hoursBilled = Math.round((billedMinutes / 60) * 100) / 100;
              const phase = SIA_PHASES.find(p => p.id === e.phaseId);
              const pos = (proj?.positions || []).find(p => p.code === e.positionId);
              return (
                <tr key={e.id} style={{ opacity: selected ? 1 : 0.5 }}>
                  <td style={{ padding: "5px 8px" }}>
                    <input type="checkbox" checked={!!selected} onChange={() => toggleEntrySelection(e.id, e)} style={{ width: "auto", cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "5px 8px" }}>{formatDate(e.date)}</td>
                  <td style={{ padding: "5px 8px", color: "var(--text4)" }}>
                    {phase?.id || "—"}
                    {pos && <span style={{ marginLeft: 4, fontWeight: 600, color: "var(--pending)", fontSize: 10, background: "#fffbe8", padding: "0 4px", borderRadius: 20 }}>{pos.code}</span>}
                  </td>
                  <td style={{ padding: "5px 8px", color: "var(--text3)" }}>{e.description || "—"}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--text4)" }}>{formatHours(e.minutes)}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right" }}>
                    {selected ? (
                      <input type="number" step="0.25" min={0}
                        value={hoursBilled}
                        onChange={ev => updateBilledMinutes(e.id, Math.round(+ev.target.value * 60))}
                        style={{ width: 70, height: 26, fontSize: 11, textAlign: "right", padding: "2px 6px" }} />
                    ) : <span style={{ color: "var(--text5)" }}>—</span>}
                    {selected && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 3 }}>h</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
