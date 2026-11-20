// Projekt-Reiter des Dialogs «Neue Rechnung»: Projektwahl, Stand der Verrechnung (Honorar, bisher gestellt, Rest,
// Warnung über 100 %), Art (Akonto/Teil/Schluss), Betragsart und Phasenliste.

import type React from "react";
import { SIA_PHASES } from "../../constants";
import { formatCHF, formatHours, projectFee } from "../../utils";
import type { AppData, Invoice, Project } from "../../types";
import { defaultInvoiceMode, phaseInvoiceAmount, projectBillingStatus } from "./invoiceHelpers";
import type { NewInvoiceState } from "./invoiceHelpers";

const pctLabel = (x: number) => `${Math.round(x)} %`;

/**
 * Inhalt des Projekt-Reiters; `proj` ist das gewählte Projekt, `bType` seine Abrechnungsart, `thisNet` das
 * Netto der Rechnung, die «Weiter» erzeugen würde (für den Stand nach dieser Rechnung und die Warnung).
 */
export function NewInvoiceProjectPane({ ni, setNi, data, invoices, proj, bType, thisNet }: {
  ni: NewInvoiceState;
  setNi: React.Dispatch<React.SetStateAction<NewInvoiceState>>;
  data: AppData;
  invoices: Invoice[];
  proj: Project | null | undefined;
  bType: string | undefined;
  thisNet: number;
}) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", display: "block", marginBottom: 5 }}>PROJEKT</label>
        <select value={ni.projectId} onChange={e => {
          const selProj = (data.projects || []).find(p => p.id === e.target.value);
          setNi(n => ({ ...n, projectId: e.target.value, mode: selProj ? defaultInvoiceMode(selProj) : n.mode }));
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
        const projBudget = projectFee(proj);
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
              flex: 1, padding: "10px 8px", border: `2px solid ${active ? color : "var(--border)"}`,
              borderRadius: 8, background: active ? color : "transparent",
              color: active ? "var(--surface)" : "var(--text3)", fontFamily: "inherit", fontSize: 12,
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
              padding: "5px 12px", border: `1.5px solid ${active ? "var(--text)" : "var(--border)"}`,
              borderRadius: 20, background: active ? "var(--text)" : "transparent",
              color: active ? "var(--surface)" : "var(--text3)", fontFamily: "inherit",
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
                const amt = phaseInvoiceAmount(proj, ph.id, data.quotes || [], data.settings.roles);
                const alreadyBilled = billedInvs.some(i => (i.items || []).some(it => (it.desc || "").includes(phInfo?.label || ph.id)));
                const isSelected = ni.phaseId === ph.id;
                return (
                  <div key={ph.id} onClick={() => !alreadyBilled && setNi(n => ({ ...n, phaseId: ph.id }))} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "7px 4px",
                    borderBottom: "1px solid var(--border2)", cursor: alreadyBilled ? "not-allowed" : "pointer",
                    opacity: alreadyBilled ? 0.4 : 1,
                  }}>
                    <div style={{ width: 13, height: 13, borderRadius: "50%", flexShrink: 0, border: isSelected ? `4px solid ${kind === "akonto" ? "var(--accent)" : "var(--info)"}` : "2px solid var(--border3)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{phInfo?.label || ph.id}</div>
                      <div style={{ fontSize: 10, color: "var(--text4)" }}>{ph.hours}h · offeriert <strong>{formatCHF(amt)}</strong></div>
                    </div>
                    {alreadyBilled && <span style={{ fontSize: 10, color: "var(--positive)", background: "var(--positive-bg)", padding: "2px 6px", borderRadius: 20 }}>✓ verrechnet</span>}
                  </div>
                );
              })}
            </div>
          );
        };

        // Stand der Verrechnung (ohne Entwürfe) und nach dieser Rechnung; nur mit erfasstem Honorar/Budget
        const st = projectBillingStatus(invoices, proj.id, projBudget, thisNet);
        const feeLabel = bType === "stundensatz" ? "Budget" : "Honorar";
        const kindColor = kind === "akonto" ? "var(--accent)" : "var(--info)";
        const takeRest = () => setNi(n => ({ ...n, mode: kind === "akonto" ? "akonto-amount" : "teilrechnung-amount", amt: st.rest }));
        const canTakeRest = kind !== "schluss" && st.rest > 0 && Math.abs(thisNet - st.rest) >= 0.01;
        const row = { display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" } as const;

        return (
          <>
            {/* Stand der Verrechnung */}
            {projBudget > 0 && (
              <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 12 }}>
                <div className="num" style={{ ...row, color: "var(--text3)" }}><span>{feeLabel} total</span><span>{formatCHF(st.fee)}</span></div>
                <div className="num" style={{ ...row, color: "var(--text3)" }}>
                  <span>Bisher gestellt{st.billed !== 0 ? ` · ${pctLabel(st.billedPct)}` : ""}</span><span>{formatCHF(st.billed)}</span>
                </div>
                <div className="num" style={{ ...row, alignItems: "center", fontWeight: 600, color: st.rest < 0 ? "var(--negative)" : "var(--text)", marginTop: 3, paddingTop: 5, borderTop: "1px solid var(--border2)" }}>
                  <span>Rest{canTakeRest && (
                    <button className="btn btn-quiet btn-sm" style={{ marginLeft: 8, fontWeight: 400 }} onClick={takeRest} title="Den Restbetrag als fixen Betrag übernehmen">= Rest übernehmen</button>
                  )}</span>
                  <span>{formatCHF(st.rest)}</span>
                </div>
                {st.drafts !== 0 && (
                  <div className="num" style={{ ...row, fontSize: 11, color: "var(--text4)" }}><span>Offene Entwürfe (nicht eingerechnet)</span><span>{formatCHF(st.drafts)}</span></div>
                )}
              </div>
            )}

            {/* Ebene 1: Art der Rechnung */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <KindBtn id="akonto" label="Akonto" color="var(--accent)" />
              <KindBtn id="teilrechnung" label="Teilrechnung" color="var(--info)" />
              <KindBtn id="schluss" label="Schlussrechnung" color="var(--text)" />
            </div>

            {/* Ebene 2: Sub-Optionen */}
            {kind !== "schluss" && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {bType === "stundensatz" && <SubBtn id="stunden" label="Stunden" />}
                <SubBtn id="percent" label={bType === "stundensatz" ? "% vom Budget" : "% vom Honorar"} />
                <SubBtn id="amount" label="Fixer Betrag" />
                {hasPhaseBudget && <SubBtn id="phase" label="Nach SIA-Phase" />}
              </div>
            )}

            {/* Inputs */}
            {kind !== "schluss" && subMode === "percent" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "var(--warning-bg)" : "var(--info-bg)", borderRadius: 6, border: "1px solid var(--border2)", marginBottom: 10 }}>
                <input type="number" min={1} max={100} step="1" value={ni.pct} onChange={e => setNi(n => ({ ...n, pct: Math.max(0, Math.min(100, +e.target.value || 0)) }))} style={{ width: 80, textAlign: "right", background: "var(--surface)" }} />
                <span style={{ fontSize: 13, color: "var(--text3)" }}>% von {formatCHF(projBudget)} = <strong>{formatCHF(projBudget * ni.pct / 100)}</strong></span>
              </div>
            )}
            {kind !== "schluss" && subMode === "percent" && projBudget <= 0 && (
              <div style={{ fontSize: 11.5, color: "var(--warning)", margin: "-4px 0 10px" }}>Für dieses Projekt ist kein {bType === "stundensatz" ? "Budget" : "Honorar"} erfasst — «%» ergibt 0. Fixen Betrag wählen oder es im Projekt erfassen.</div>
            )}
            {kind !== "schluss" && subMode === "amount" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "var(--warning-bg)" : "var(--info-bg)", borderRadius: 6, border: "1px solid var(--border2)", marginBottom: 10 }}>
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
                  ? "Alle restlichen offenen Stunden bis heute, abzgl. Akonto-/Teilrechnungen, die nicht nach Stunden gestellt wurden."
                  : `Gesamthonorar ${formatCHF(projBudget)} abzgl. bisherige Akonto- und Teilrechnungen.`}
              </div>
            )}

            {/* Stunden-Info */}
            {bType === "stundensatz" && kind !== "schluss" && subMode === "stunden" && (
              <div style={{ padding: "8px 14px", background: kind === "akonto" ? "var(--warning-bg)" : "var(--info-bg)", borderRadius: 6, fontSize: 11, color: kind === "akonto" ? "var(--accent)" : "var(--info)", marginBottom: 10 }}>
                Alle offenen Stunden bis heute vorausgewählt — im nächsten Schritt einzeln ab-/anwählbar.
              </div>
            )}

            {/* Stand nach dieser Rechnung; Warnung, wenn der Vorschlag über das Honorar hinausgeht */}
            {projBudget > 0 && kind !== "schluss" && (
              <div style={{ marginTop: 4 }}>
                <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--surface3)", overflow: "hidden" }} aria-hidden="true">
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(0, st.billedPct))}%`, background: "var(--text4)" }} />
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${Math.min(100, Math.max(0, st.billedPct))}%`, width: `${Math.max(0, Math.min(100, st.afterPct) - Math.min(100, Math.max(0, st.billedPct)))}%`, background: st.over ? "var(--negative)" : kindColor }} />
                </div>
                <div className="num" style={{ fontSize: 11.5, color: "var(--text4)", marginTop: 6 }}>
                  Mit dieser Rechnung gestellt: <b style={{ color: st.over ? "var(--negative)" : "var(--text2)" }}>{formatCHF(st.after)} · {pctLabel(st.afterPct)}</b> des {feeLabel}s
                </div>
                {st.over && (
                  <div role="alert" style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "var(--negative-bg)", color: "var(--negative)", fontSize: 12, lineHeight: 1.45 }}>
                    Der Vorschlag geht {formatCHF(st.after - st.fee)} über das {feeLabel} hinaus.{st.rest > 0 ? ` Offen sind noch ${formatCHF(st.rest)}.` : ` Das ${feeLabel} ist bereits ganz gestellt.`}
                  </div>
                )}
                {st.overWithDrafts && (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "var(--warning-bg)", color: "var(--warning)", fontSize: 12, lineHeight: 1.45 }}>
                    Zusammen mit den offenen Entwürfen ({formatCHF(st.drafts)}) wären {pctLabel((st.after + st.drafts) / st.fee * 100)} des {feeLabel}s gestellt.
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
