// Modal «Budget & Honorarofferten» der Projekt-Detailansicht: Offerten verknüpfen, Rollen und Phasen festlegen.

import { SIA_PHASES } from "../../constants";
import { calcSIAHours, calcManualHours, migrateLinkedQuotes, formatCHF } from "../../utils";
import { Modal, FormField } from "../../components/UI";
import { type ViewProps } from "../../types";
import { type BudgetForm } from "./helpers";

/** Budget-Modal; der Formularzustand und die Verknüpfungs-Aktionen liegen in ProjectDetail und werden durchgereicht. */
export function BudgetModal({ data, projectId, budgetForm, setBudgetForm, addLinkedQuote, removeLinkedQuote, changeLinkedRole, onClose, onSave }: {
  data: ViewProps["data"];
  projectId: string;
  budgetForm: BudgetForm;
  setBudgetForm: React.Dispatch<React.SetStateAction<BudgetForm>>;
  addLinkedQuote: (quoteId: string) => void;
  removeLinkedQuote: (quoteId: string) => void;
  changeLinkedRole: (quoteId: string, role: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const ROLES = ["Hauptofferte", "Nachtrag", "Referenz"];
  const linked = budgetForm.linkedQuotes || [];
  const nachtragLinked = linked.filter(lq => lq.role !== "Hauptofferte" && lq.role !== "Referenz");
  const alreadyInOtherProjects = new Set((data.projects || []).filter(p => p.id !== projectId).flatMap(p => migrateLinkedQuotes(p).map(lq => lq.quoteId)));
  const unlinked = (data.quotes || []).filter(q => !linked.some(lq => lq.quoteId === q.id) && !alreadyInOtherProjects.has(q.id));
  const sortedLinked = [
    ...linked.filter(lq => lq.role === "Hauptofferte"),
    ...linked.filter(lq => lq.role !== "Hauptofferte"),
  ];
  return (
    <Modal title="Budget & Honorarofferten" onClose={onClose} onSave={onSave} wide>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>VERKNÜPFTE OFFERTEN</div>

      {sortedLinked.map(lq => {
        const q = (data.quotes || []).find(x => x.id === lq.quoteId);
        if (!q) return null;
        const isNT = lq.role === "Nachtrag";
        const ntIdx = isNT ? nachtragLinked.findIndex(x => x.quoteId === lq.quoteId) : -1;
        const posCode = isNT ? `N${ntIdx + 1}` : null;
        const pos = isNT
          ? ((budgetForm.positions || []).find(p => p.quoteId === lq.quoteId) || (posCode ? (budgetForm.positions || []).find(p => p.code === posCode) : null))
          : null;
        const currentPhases = isNT ? (pos?.enabledPhases || []) : (budgetForm.enabledPhases || []);
        const togglePhase = (phId: string) => {
          if (isNT) {
            setBudgetForm(f => ({
              ...f,
              positions: f.positions.map(p =>
                (p.quoteId ? p.quoteId === lq.quoteId : p.code === posCode)
                  ? { ...p, enabledPhases: (p.enabledPhases || []).includes(phId) ? (p.enabledPhases || []).filter(x => x !== phId) : [...(p.enabledPhases || []), phId] }
                  : p
              ),
            }));
          } else {
            setBudgetForm(f => {
              const phases = f.enabledPhases || [];
              return { ...f, enabledPhases: phases.includes(phId) ? phases.filter(p => p !== phId) : [...phases, phId] };
            });
          }
        };
        const qRoles = q.quoteRoles || data.settings.roles || [];
        const qH = q.mode === "sia" ? (calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []).total || 0)
          : q.mode === "manual" ? (calcManualHours(q.manualPhases || [], qRoles).totalHours || 0) : 0;
        const bgColor = isNT ? "#f0f5fd" : "#faf8f5";
        const borderColor = isNT ? "#c8d8ee" : "#ddd8d0";
        const accentColor = isNT ? "var(--info)" : "var(--positive)";
        return (
          <div key={lq.quoteId} style={{ marginBottom: 12, border: `1px solid ${borderColor}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: bgColor, flexWrap: "wrap" }}>
              {isNT && pos ? (
                <>
                  <input value={pos.code || ""} onChange={e => setBudgetForm(f => ({ ...f, positions: f.positions.map(p => p.quoteId === lq.quoteId ? { ...p, code: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 6) } : p) }))} placeholder="N1" style={{ width: 52, fontWeight: 700, fontSize: 12, height: 26, padding: "0 6px" }} />
                  <input value={pos.label || ""} onChange={e => setBudgetForm(f => ({ ...f, positions: f.positions.map(p => p.quoteId === lq.quoteId ? { ...p, label: e.target.value } : p) }))} placeholder="z.B. Nachtrag Fassade" style={{ flex: 1, minWidth: 80, fontSize: 12, height: 26, padding: "0 6px" }} />
                </>
              ) : lq.role === "Referenz" ? (
                <span style={{ fontSize: 10, fontWeight: 700, background: "#f0f0ee", color: "var(--text4)", padding: "2px 8px", borderRadius: 20 }}>⬡ REF</span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, background: "var(--positive-bg)", color: accentColor, padding: "2px 8px", borderRadius: 20 }}>⬡ HO</span>
              )}
              <span style={{ fontWeight: 600, color: "#b07848" }}>{q.number}</span>
              <span style={{ color: "var(--text4)", fontSize: 11 }}>{q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"}</span>
              {qH > 0 && <span style={{ color: "var(--text3)", fontSize: 11 }}>{qH.toFixed(1)}h · {formatCHF(q.sub || q.total || 0)}</span>}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <select value={lq.role} onChange={e => changeLinkedRole(lq.quoteId, e.target.value)} style={{ fontSize: 11, height: 26, padding: "0 6px" }}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
                <button className="btn btn-danger" style={{ padding: "0 6px", height: 24, fontSize: 10 }} onClick={() => removeLinkedQuote(lq.quoteId)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
              </div>
            </div>
            <div style={{ padding: "10px 14px", background: "var(--surface)" }}>
              <div style={{ fontSize: 10, color: "var(--text4)", marginBottom: 6, letterSpacing: "0.07em" }}>AKTIVIERTE SIA-PHASEN FÜR ZEITERFASSUNG</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {SIA_PHASES.map(ph => (
                  <label key={ph.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, textTransform: "none", color: "var(--text)", padding: "3px 0" }}>
                    <input type="checkbox" checked={currentPhases.includes(ph.id)} onChange={() => togglePhase(ph.id)} style={{ width: "auto" }} />
                    {ph.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {linked.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Noch keine Offerte verknüpft. SIA, Aufwand und Pauschal-Offerten können verknüpft werden.</div>
      )}
      {unlinked.length > 0 && (
        <select defaultValue="" onChange={e => { if (e.target.value) { addLinkedQuote(e.target.value); e.target.value = ""; } }} style={{ fontSize: 12, width: "100%", marginBottom: 16 }}>
          <option value="">{linked.length === 0 ? "Offerte verknüpfen…" : "+ Nachtrag / weitere Offerte hinzufügen…"}</option>
          {unlinked.map(q => <option key={q.id} value={q.id}>{q.number} — {q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"} · {formatCHF(q.total)}</option>)}
        </select>
      )}

      <FormField label="Stundenbudget manuell überschreiben (leert Offerten-Verknüpfung)">
        <input type="number" step="0.5" min={0} value={budgetForm.budgetHours || 0}
          onChange={e => setBudgetForm(f => ({ ...f, budgetHours: +e.target.value, linkedQuotes: [], phasesBudget: [] }))}
          placeholder="0 = aus Offerten berechnet" />
      </FormField>
    </Modal>
  );
}
