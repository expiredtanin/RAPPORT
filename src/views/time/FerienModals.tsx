// Zeiterfassung: Dialoge «Ferien — Übersicht» (Pendent/Bestätigt) und «Ferien beantragen».

import { formatDate, localISODate } from "../../utils";
import { FormField, Modal, DatePicker } from "../../components/UI";
import type { AppData, Employee, FerienEntry } from "../../types";

/** Props der Ferien-Dialoge (Zustand und Aktionen kommen aus `useFerienAntrag`). */
interface FerienModalsProps {
  data: AppData;
  selectedEmp: Employee | null;
  employees: Employee[];
  ferienUebersicht: boolean;
  setFerienUebersicht: (open: boolean) => void;
  antragModal: "ferien" | null;
  setAntragModal: (m: "ferien" | null) => void;
  antragForm: Partial<FerienEntry>;
  setAntragForm: (f: Partial<FerienEntry>) => void;
  saveAntrag: () => void;
  editFerien: (f: FerienEntry) => void;
  cancelFerienEdit: (id: string) => void;
  deleteFerien: (id: string) => void;
}

/** Ferien-Übersicht des gewählten Mitarbeiters und Antragsformular. */
export function FerienModals({ data, selectedEmp, employees, ferienUebersicht, setFerienUebersicht, antragModal, setAntragModal, antragForm, setAntragForm, saveAntrag, editFerien, cancelFerienEdit, deleteFerien }: FerienModalsProps) {
  return (
    <>
      {/* Modal: Ferien-Übersicht */}
      {ferienUebersicht && selectedEmp && (
        <Modal title={`Ferien — ${selectedEmp.name}`} onClose={() => setFerienUebersicht(false)} hideSave>
          {(() => {
            const today = localISODate();
            const empFerien = (data.ferienEntries || []).filter(f => f.employeeId === selectedEmp.id).sort((a, b) => (b.dateFrom || "").localeCompare(a.dateFrom || ""));
            if (empFerien.length === 0) return <div style={{ fontSize: 13, color: "var(--text5)", padding: "12px 0" }}>Keine Ferieneinträge vorhanden.</div>;
            const groups = [
              { label: "Pendent", entries: empFerien.filter(f => f.status === "pending") },
              { label: "Bestätigt", entries: empFerien.filter(f => f.status !== "pending") },
            ];
            return groups.filter(g => g.entries.length > 0).map(g => (
              <div key={g.label} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 8 }}>{g.label.toUpperCase()}</div>
                {g.entries.map(f => {
                  const isPending = f.status === "pending";
                  const isEditPending = isPending && !!f.originalData;
                  const displayTo = isPending && f.originalData ? f.originalData.dateTo : f.dateTo;
                  const isPast = displayTo < today;
                  return (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border2)" }}>
                      <div style={{ flex: 1 }}>
                        {isEditPending ? (
                          <>
                            <div style={{ fontSize: 11, color: "var(--text5)", textDecoration: "line-through" }}>{formatDate(f.originalData?.dateFrom)} – {formatDate(f.originalData?.dateTo)}</div>
                            <div style={{ fontSize: 13, color: "#222" }}>{formatDate(f.dateFrom)} – {formatDate(f.dateTo)} <span style={{ fontSize: 10, color: "var(--warning)", fontWeight: 600 }}>neu</span></div>
                          </>
                        ) : (
                          <div style={{ fontSize: 13, color: "#222" }}>{formatDate(f.dateFrom)} – {formatDate(f.dateTo)}</div>
                        )}
                        {f.note && <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>{f.note}</div>}
                      </div>
                      <span style={{ fontSize: 10, padding: "2px 10px", borderRadius: 20, background: isPending ? "#fff8e8" : "var(--positive-bg)", color: isPending ? "var(--warning)" : "var(--positive)", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
                        {isEditPending ? "Änderung" : isPending ? "pendent" : "bestätigt"}
                      </span>
                      {!isPast && !isPending && (
                        <button onClick={() => { setFerienUebersicht(false); editFerien(f); }} style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", fontSize: 13, padding: "0 3px", lineHeight: 1, flexShrink: 0 }} title="Bearbeiten"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>edit</span></button>
                      )}
                      {isPast
                        ? <span style={{ fontSize: 11, color: "var(--text5)", flexShrink: 0, padding: "0 4px" }}>vergangen</span>
                        : isEditPending
                          ? <button onClick={() => cancelFerienEdit(f.id)} style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, flexShrink: 0 }} title="Änderung verwerfen"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                          : <button className="btn btn-sm btn-danger" onClick={() => deleteFerien(f.id)} title="Zurücknehmen"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                      }
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </Modal>
      )}

      {/* Modal: Ferienantrag */}
      {antragModal === "ferien" && (
        <Modal title="Ferien beantragen" onClose={() => setAntragModal(null)} onSave={saveAntrag} overflow>
          {employees.length > 1 && (
            <FormField label="Mitarbeiter">
              <select value={antragForm.employeeId || ""} onChange={e => setAntragForm({ ...antragForm, employeeId: e.target.value })}>
                <option value="">— wählen —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </FormField>
          )}
          <div className="form-row">
            <FormField label="Von"><DatePicker value={antragForm.dateFrom || ""} onChange={e => setAntragForm({ ...antragForm, dateFrom: e.target.value })} /></FormField>
            <FormField label="Bis"><DatePicker value={antragForm.dateTo || ""} onChange={e => setAntragForm({ ...antragForm, dateTo: e.target.value })} /></FormField>
          </div>
          <FormField label="Notiz (optional)"><input value={antragForm.note || ""} onChange={e => setAntragForm({ ...antragForm, note: e.target.value })} /></FormField>
        </Modal>
      )}
    </>
  );
}
