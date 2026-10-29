// Projekt-Reiter des Dialogs «Neue Rechnung»: Projektwahl, Art (Akonto/Teil/Schluss), Betragsart und Phasenliste.

import type React from "react";
import { SIA_PHASES } from "../../constants";
import { formatCHF, formatHours } from "../../utils";
import type { AppData, Invoice, Project } from "../../types";
import type { NewInvoiceState } from "./invoiceHelpers";

/** Inhalt des Projekt-Reiters; `proj` ist das gewählte Projekt, `bType` seine Abrechnungsart. */
export function NewInvoiceProjectPane({ ni, setNi, data, invoices, proj, bType }: {
  ni: NewInvoiceState;
  setNi: React.Dispatch<React.SetStateAction<NewInvoiceState>>;
  data: AppData;
  invoices: Invoice[];
  proj: Project | null | undefined;
  bType: string | undefined;
}) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", display: "block", marginBottom: 5 }}>PROJEKT</label>
        <select value={ni.projectId} onChange={e => {
          const selProj = (data.projects || []).find(p => p.id === e.target.value);
          const selBType = selProj ? (selProj.billingType || selProj.type) : "";
          setNi(n => ({ ...n, projectId: e.target.value, mode: selBType === "stundensatz" ? "teilrechnung" : selBType === "pauschal" ? "akonto-percent" : n.mode }));
        }} style={!ni.projectId ? { borderColor: "var(--warning)" } : {}}>
          <option value="">— Projekt wählen —</option>
          {(data.projects || []).filter(p => p.status !== "archiviert").map(p => {
            const bt = p.billingType || p.type;
            const openMins = bt === "stundensatz" ? data.timeEntries.filter(e => e.projectId === p.id && !e.invoiceId).reduce((s, e) => s + e.minutes, 0) : 0;
            return <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}{openMins > 0 ? ` (${formatHours(openMins)} offen)` : ""}</option>;
          })}
        </select>
      </div>
      {proj && (() => {
        const projBudget = proj.budget || proj.budgetAmount || 0;
        const hasPhaseBudget = (proj.phasesBudget || []).filter(p => p.hours > 0).length > 0;
        const kind = ni.mode === "schluss" ? "schluss"
          : (ni.mode === "akonto-percent" || ni.mode === "akonto-amount" || ni.mode === "akonto-phase" || ni.mode === "akonto-stunden") ? "akonto"
          : "teilrechnung";
        const subMode = ni.mode === "akonto-percent" || ni.mode === "teilrechnung-percent" ? "percent"
          : ni.mode === "akonto-amount" || ni.mode === "teilrechnung-amount" ? "amount"
          : ni.mode === "akonto-phase" || ni.mode === "phase" ? "phase"
          : "stunden";

        const KindBtn = ({ id, label, color }: { id: string; label: string; color: string }) => {
          const active = kind === id;
          return (
            <button onClick={() => {
              if (id === "schluss") return setNi(n => ({ ...n, mode: "schluss" }));
              if (id === "akonto") return setNi(n => ({ ...n, mode: bType === "stundensatz" ? "akonto-stunden" : "akonto-percent" }));
              setNi(n => ({ ...n, mode: bType === "stundensatz" ? "teilrechnung" : "teilrechnung-percent" }));
            }} style={{
              flex: 1, padding: "10px 8px", border: `2px solid ${active ? color : "#ddd8d0"}`,
              borderRadius: 8, background: active ? color : "transparent",
              color: active ? "#fff" : "var(--text3)", fontFamily: "inherit", fontSize: 12,
              fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em",
            }}>{label}</button>
          );
        };

        const SubBtn = ({ id, label }: { id: string; label: string }) => {
          const active = subMode === id;
          return (
            <button onClick={() => setNi(n => ({ ...n, mode: kind === "akonto"
              ? (id === "percent" ? "akonto-percent" : id === "amount" ? "akonto-amount" : id === "phase" ? "akonto-phase" : "akonto-stunden")
              : (id === "percent" ? "teilrechnung-percent" : id === "amount" ? "teilrechnung-amount" : id === "phase" ? "phase" : "teilrechnung")
            }))} style={{
              padding: "5px 12px", border: `1.5px solid ${active ? "#1a1a18" : "#ddd8d0"}`,
              borderRadius: 20, background: active ? "#1a1a18" : "transparent",
              color: active ? "#f0ede8" : "var(--text3)", fontFamily: "inherit",
              fontSize: 11, cursor: "pointer",
            }}>{label}</button>
          );
        };

        const PhaseList = () => {
          // Eine Phase gilt als "schon verrechnet", sobald sie in
          // irgendeiner nicht-Schluss-Rechnung auftaucht — Denylist
          // statt Allowlist auf invoiceKind, sonst liesse sich eine
          // manuell verknüpfte Rechnung (invoiceKind==="") oder ein
          // Moduswechsel zur doppelten Fakturierung derselben Phase
          // missbrauchen (Runde-4/6-Fund zum selben Muster).
          const billedInvs = invoices.filter(i => i.projectId === proj.id && i.invoiceKind !== "schluss" && i.status !== "entwurf");
          return (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
              {(proj.phasesBudget || []).filter(p => p.hours > 0).map(ph => {
                const phInfo = SIA_PHASES.find(p => p.id === ph.id);
                const amt = Math.round(ph.hours * (proj.hourlyRate || 0) * 100) / 100;
                const alreadyBilled = billedInvs.some(i => (i.items || []).some(it => (it.desc || "").includes(phInfo?.label || ph.id)));
                const isSelected = ni.phaseId === ph.id;
                return (
                  <div key={ph.id} onClick={() => !alreadyBilled && setNi(n => ({ ...n, phaseId: ph.id }))} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "7px 4px",
                    borderBottom: "1px solid var(--border2)", cursor: alreadyBilled ? "not-allowed" : "pointer",
                    opacity: alreadyBilled ? 0.4 : 1,
                  }}>
                    <div style={{ width: 13, height: 13, borderRadius: "50%", flexShrink: 0, border: isSelected ? `4px solid ${kind === "akonto" ? "#b07848" : "#2d5a8e"}` : "2px solid #ccc" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{phInfo?.label || ph.id}</div>
                      <div style={{ fontSize: 10, color: "var(--text4)" }}>{ph.hours}h × {formatCHF(proj.hourlyRate || 0)}/h = <strong>{formatCHF(amt)}</strong></div>
                    </div>
                    {alreadyBilled && <span style={{ fontSize: 10, color: "var(--positive)", background: "var(--positive-bg)", padding: "2px 6px", borderRadius: 20 }}>✓ verrechnet</span>}
                  </div>
                );
              })}
            </div>
          );
        };

        return (
          <>
            {/* Ebene 1: Art der Rechnung */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <KindBtn id="akonto" label="Akonto" color="#b07848" />
              <KindBtn id="teilrechnung" label="Teilrechnung" color="#2d5a8e" />
              <KindBtn id="schluss" label="Schlussrechnung" color="#1a1a18" />
            </div>

            {/* Ebene 2: Sub-Optionen */}
            {kind !== "schluss" && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {bType === "stundensatz" && <SubBtn id="stunden" label="Stunden" />}
                <SubBtn id="percent" label="% vom Budget" />
                <SubBtn id="amount" label="Fixer Betrag" />
                {hasPhaseBudget && <SubBtn id="phase" label="Nach SIA-Phase" />}
              </div>
            )}

            {/* Inputs */}
            {kind !== "schluss" && subMode === "percent" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${kind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                <input type="number" min={1} max={100} step="1" value={ni.pct} onChange={e => setNi(n => ({ ...n, pct: Math.max(0, Math.min(100, +e.target.value || 0)) }))} style={{ width: 80, textAlign: "right", background: "var(--surface)" }} />
                <span style={{ fontSize: 13, color: "var(--text3)" }}>% von {formatCHF(projBudget)} = <strong>{formatCHF(projBudget * ni.pct / 100)}</strong></span>
              </div>
            )}
            {kind !== "schluss" && subMode === "amount" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${kind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text3)" }}>CHF</span>
                <input type="number" min={0} step="50" value={ni.amt} onChange={e => setNi(n => ({ ...n, amt: Math.max(0, +e.target.value || 0) }))} style={{ width: 140, textAlign: "right", background: "var(--surface)" }} />
              </div>
            )}
            {kind !== "schluss" && subMode === "phase" && hasPhaseBudget && (
              <PhaseList />
            )}

            {/* Schluss-Info */}
            {kind === "schluss" && (
              <div style={{ padding: "10px 14px", background: "var(--surface3)", borderRadius: 6, fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                {bType === "stundensatz"
                  ? "Alle restlichen offenen Stunden bis heute."
                  : `Gesamthonorar ${formatCHF(projBudget)} abzgl. bisherige Akonto- und Teilrechnungen.`}
              </div>
            )}

            {/* Stunden-Info */}
            {bType === "stundensatz" && kind !== "schluss" && subMode === "stunden" && (
              <div style={{ padding: "8px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, fontSize: 11, color: kind === "akonto" ? "#b07848" : "#2d5a8e", marginBottom: 10 }}>
                Alle offenen Stunden bis heute vorausgewählt — im nächsten Schritt einzeln ab-/anwählbar.
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
