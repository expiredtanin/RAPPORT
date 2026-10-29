// Reiter «Ferien & Intern / Absenzen»: pendente Anträge (genehmigen/ablehnen), Ferieneinträge,
// Absenzliste und Ferienanspruch-Übersicht pro Mitarbeiter.

import React from "react";
import { formatDate } from "../../utils";
import type { Absence, AbsenzType, Employee, FerienEntry, ViewProps } from "../../types";
import type { useConfirm } from "../../hooks/useConfirm";
import type { EmployeeCalc } from "./calc";
import type { ModalKind } from "./types";

interface FerienTabProps {
  data: ViewProps["data"];
  update: ViewProps["update"];
  askConfirm: ReturnType<typeof useConfirm>["askConfirm"];
  employees: Employee[];
  absences: Absence[];
  ferienEntries: FerienEntry[];
  absenzTypes: AbsenzType[];
  selectedEmpId: string | null;
  setSelectedEmpId: React.Dispatch<React.SetStateAction<string | null>>;
  setFerienForm: React.Dispatch<React.SetStateAction<Partial<FerienEntry>>>;
  setModal: React.Dispatch<React.SetStateAction<ModalKind>>;
  delFerien: (id: string) => void;
  delAbs: (id: string) => void;
  viewYear: number;
  setViewYear: React.Dispatch<React.SetStateAction<number>>;
  calc: EmployeeCalc;
}

/** Reiter «Ferien & Intern / Absenzen» der Mitarbeiter-Ansicht. */
export default function FerienTab({ data, update, askConfirm, employees, absences, ferienEntries, absenzTypes, selectedEmpId, setSelectedEmpId, setFerienForm, setModal, delFerien, delAbs, viewYear, setViewYear, calc }: FerienTabProps) {
  const { calcFerienYear } = calc;
  return (
    <div>
      {/* Pendente Anträge */}
      {(() => {
        const pendingFerien = (data.ferienEntries || []).filter(f => f.status === "pending");
        const pendingAbs = (data.absences || []).filter(a => a.status === "pending");
        const total = pendingFerien.length + pendingAbs.length;
        if (total === 0) return null;
        const approveFerien = (id: string) => update("ferienEntries", (data.ferienEntries || []).map(f => f.id === id ? { ...f, status: "approved" } : f));
        const rejectFerien = async (id: string) => { if (await askConfirm("Ferienantrag ablehnen?", "Ablehnen")) update("ferienEntries", (data.ferienEntries || []).map(f => f.id === id ? { ...f, status: "rejected" } : f)); };
        const approveAbs = (id: string) => update("absences", (data.absences || []).map(a => a.id === id ? { ...a, status: "approved" } : a));
        const rejectAbs = async (id: string) => { if (await askConfirm("Absenzantrag ablehnen?", "Ablehnen")) update("absences", (data.absences || []).map(a => a.id === id ? { ...a, status: "rejected" } : a)); };
        return (
          <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--warning)", padding: "14px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--warning)", marginBottom: 12 }}>
              ⏳ PENDENTE ANTRÄGE ({total})
            </div>
            <table style={{ fontSize: 12, width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border2)" }}>
                  <th style={{ padding: "4px 8px 4px 0", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>MITARBEITER</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>TYP</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>VON</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>BIS</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>NOTIZ</th>
                  <th style={{ padding: "4px 0", fontWeight: 500, color: "var(--text4)", fontSize: 10, textAlign: "right" }}>AKTION</th>
                </tr>
              </thead>
              <tbody>
                {pendingFerien.map(f => {
                  const emp = employees.find(e => e.id === f.employeeId);
                  return (
                    <tr key={f.id} style={{ borderBottom: "1px solid #f5f2ed" }}>
                      <td style={{ padding: "7px 8px 7px 0", fontWeight: 500 }}>{emp?.name || "—"}</td>
                      <td style={{ padding: "7px 8px" }}><span style={{ background: "var(--st-bg-pausiert)", color: "var(--st-c-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px", fontSize: 10, fontWeight: 600 }}>🌴 Ferien</span></td>
                      <td style={{ padding: "7px 8px" }}>{formatDate(f.dateFrom)}</td>
                      <td style={{ padding: "7px 8px" }}>{formatDate(f.dateTo)}</td>
                      <td style={{ padding: "7px 8px", color: "var(--text4)" }}>{f.note || "—"}</td>
                      <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 11, marginRight: 6, background: "var(--positive)" }} onClick={() => approveFerien(f.id)}>✓ Genehmigen</button>
                        <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => rejectFerien(f.id)}><span className="msr" style={{ fontSize: 16 }}>close</span> Ablehnen</button>
                      </td>
                    </tr>
                  );
                })}
                {pendingAbs.map(a => {
                  const emp = employees.find(e => e.id === a.employeeId);
                  const t = absenzTypes.find(x => x.id === a.type);
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid #f5f2ed" }}>
                      <td style={{ padding: "7px 8px 7px 0", fontWeight: 500 }}>{emp?.name || "—"}</td>
                      <td style={{ padding: "7px 8px" }}><span className="tag" style={{ background: t?.color || "#888", fontSize: 10 }}>{t?.label || a.type || "Absenz"}</span></td>
                      <td style={{ padding: "7px 8px" }}>{formatDate(a.dateFrom)}</td>
                      <td style={{ padding: "7px 8px" }}>{formatDate(a.dateTo)}</td>
                      <td style={{ padding: "7px 8px", color: "var(--text4)" }}>{a.note || "—"}</td>
                      <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 11, marginRight: 6, background: "var(--positive)" }} onClick={() => approveAbs(a.id)}>✓ Genehmigen</button>
                        <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => rejectAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span> Ablehnen</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 16 }}>
        <select value={selectedEmpId || ""} onChange={e => setSelectedEmpId(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Alle Mitarbeiter</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => { setFerienForm({ employeeId: selectedEmpId || (employees[0]?.id || ""), dateFrom: "", dateTo: "", note: "" }); setModal("ferien"); }}>+ Ferien eintragen</button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>FERIENEINTRAGUNGEN</div>

        <table>
          <thead><tr><th>Mitarbeiter</th><th>Von</th><th>Bis</th><th>Notiz</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {ferienEntries.filter(f => !selectedEmpId || f.employeeId === selectedEmpId).length === 0
              ? <tr><td colSpan={6} className="empty-state">Noch keine Ferien eingetragen</td></tr>
              : ferienEntries.filter(f => !selectedEmpId || f.employeeId === selectedEmpId)
                  .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
                  .map(f => {
                    const emp = employees.find(e => e.id === f.employeeId);
                    const statusBadge = !f.status || f.status === "approved"
                      ? <span style={{ fontSize: 10, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>✓ Genehmigt</span>
                      : f.status === "pending"
                      ? <span style={{ fontSize: 10, color: "var(--st-c-pausiert)", background: "var(--st-bg-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>⏳ Ausstehend</span>
                      : <span style={{ fontSize: 10, color: "var(--st-c-abgelehnt)", background: "var(--st-bg-abgelehnt)", border: `1px solid color-mix(in srgb, var(--st-c-abgelehnt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}><span className="msr" style={{ fontSize: 12 }}>close</span> Abgelehnt</span>;
                    return (
                      <tr key={f.id} style={f.status === "rejected" ? { opacity: 0.5 } : {}}>
                        <td>{emp?.name || "—"}</td>
                        <td>{formatDate(f.dateFrom)}</td>
                        <td>{formatDate(f.dateTo)}</td>
                        <td style={{ color: "var(--text4)" }}>{f.note || "—"}</td>
                        <td>{statusBadge}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {(!f.status || f.status === "approved") && <button className="btn btn-ghost" style={{ padding: "2px 7px", fontSize: 11, marginRight: 4 }} onClick={() => { setFerienForm(f); setModal("ferien"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>}
                          <button className="btn btn-danger" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => delFerien(f.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                        </td>
                      </tr>
                    );
                  })
            }
          </tbody>
        </table>
      </div>

      {/* Absenzen-Liste (read-only, Erfassung via MA-Self-Service) */}
      {(() => {
        const filteredAbs = absences.filter(a => !selectedEmpId || a.employeeId === selectedEmpId).sort((a, b) => (a.dateFrom || a.date || "").localeCompare(b.dateFrom || b.date || ""));
        if (filteredAbs.length === 0) return null;
        return (
          <div className="card" style={{ padding: 0, marginBottom: 20 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>INTERN / ABSENZEN</div>
            <table>
              <thead><tr><th>Mitarbeiter</th><th>Typ</th><th>Von</th><th>Bis</th><th>Notiz</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {filteredAbs.map(a => {
                  const emp = employees.find(e => e.id === a.employeeId);
                  const t = absenzTypes.find(x => x.id === a.type);
                  const statusBadge = !a.status || a.status === "approved"
                    ? <span style={{ fontSize: 10, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>✓ Genehmigt</span>
                    : a.status === "pending"
                    ? <span style={{ fontSize: 10, color: "var(--st-c-pausiert)", background: "var(--st-bg-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>⏳ Ausstehend</span>
                    : <span style={{ fontSize: 10, color: "var(--st-c-abgelehnt)", background: "var(--st-bg-abgelehnt)", border: `1px solid color-mix(in srgb, var(--st-c-abgelehnt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}><span className="msr" style={{ fontSize: 12 }}>close</span> Abgelehnt</span>;
                  return (
                    <tr key={a.id} style={a.status === "rejected" ? { opacity: 0.5 } : {}}>
                      <td>{emp?.name || "—"}</td>
                      <td><span className="tag" style={{ background: t?.color || "#888", fontSize: 10 }}>{t?.label || a.type || "Absenz"}</span></td>
                      <td>{formatDate(a.dateFrom || a.date)}</td>
                      <td>{formatDate(a.dateTo || a.date)}</td>
                      <td style={{ color: "var(--text4)" }}>{a.note || "—"}</td>
                      <td>{statusBadge}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-danger" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => delAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Ferien-Übersicht pro Mitarbeiter */}
      {employees.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>FERIENANSPRUCH ÜBERSICHT</div>
            <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
              {[viewYear - 1, viewYear, viewYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <table>
            <thead><tr><th>Mitarbeiter</th><th>Pensum</th><th style={{ textAlign: "right" }}>Anspruch</th><th style={{ textAlign: "right" }}>Übertrag</th><th style={{ textAlign: "right" }}>Bezogen</th><th style={{ textAlign: "right" }}>Geplant</th><th style={{ textAlign: "right" }}>Rest</th></tr></thead>
            <tbody>
              {employees.map(emp => {
                const fs = calcFerienYear(emp, viewYear);
                return (
                  <tr key={emp.id}>
                    <td><strong>{emp.name}</strong></td>
                    <td style={{ color: "var(--text4)" }}>{emp.pensum || 100}%</td>
                    <td style={{ textAlign: "right" }}>{fs.anspruchH}h</td>
                    <td style={{ textAlign: "right", color: "var(--text4)" }}>{fs.ubertragH}h</td>
                    <td style={{ textAlign: "right" }}>{fs.bezogenH}h</td>
                    <td style={{ textAlign: "right", color: "var(--pending)" }}>{fs.zukunftH}h</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: fs.restH < 0 ? "var(--negative)" : "var(--positive)" }}>{fs.restH}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
