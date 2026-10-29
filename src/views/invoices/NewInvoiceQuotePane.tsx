// Offerte-Reiter des Dialogs «Neue Rechnung»: Offertenwahl, Art (Akonto/Teil/Schluss) und Betragsart.

import type React from "react";
import { formatCHF } from "../../utils";
import type { AppData, Invoice, Quote } from "../../types";
import type { NewInvoiceState } from "./invoiceHelpers";

/** Inhalt des Offerte-Reiters; `q` ist die gewählte Offerte. */
export function NewInvoiceQuotePane({ ni, setNi, data, invoices, q }: {
  ni: NewInvoiceState;
  setNi: React.Dispatch<React.SetStateAction<NewInvoiceState>>;
  data: AppData;
  invoices: Invoice[];
  q: Quote | null | undefined;
}) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", display: "block", marginBottom: 5 }}>OFFERTE</label>
        <select value={ni.quoteId} onChange={e => setNi(n => ({ ...n, quoteId: e.target.value }))} style={!ni.quoteId ? { borderColor: "var(--warning)" } : {}}>
          <option value="">— Offerte wählen —</option>
          {(data.quotes || []).map(x => {
            const alrInv = (invoices).filter(i => i.quoteId === x.id || (x.projectId && i.projectId === x.projectId)).reduce((s, i) => s + (i.sub || 0), 0);
            const rem = Math.max(0, (x.sub || 0) - alrInv);
            return <option key={x.id} value={x.id}>{x.number}{x.projectName ? ` · ${x.projectName}` : ""} — {formatCHF(x.total)}{alrInv > 0 ? ` (offen: ${formatCHF(rem)})` : ""}</option>;
          })}
        </select>
      </div>
      {q && (() => {
        const alrInv = (invoices).filter(i => i.quoteId === q.id || (q.projectId && i.projectId === q.projectId)).reduce((s, i) => s + (i.sub || 0), 0);
        const rem = Math.max(0, (q.sub || 0) - alrInv);
        const qKind = ni.mode === "schluss" ? "schluss"
          : (ni.mode === "akonto-percent" || ni.mode === "akonto-amount") ? "akonto"
          : "teilrechnung";
        const qSubMode = (ni.mode === "akonto-percent" || ni.mode === "teilrechnung-percent") ? "percent" : "amount";

        const QKindBtn = ({ id, label, color }: { id: string; label: string; color: string }) => {
          const active = qKind === id;
          return (
            <button onClick={() => {
              if (id === "schluss") return setNi(n => ({ ...n, mode: "schluss" }));
              if (id === "akonto") return setNi(n => ({ ...n, mode: "akonto-percent" }));
              setNi(n => ({ ...n, mode: "teilrechnung-percent" }));
            }} style={{
              flex: 1, padding: "10px 8px", border: `2px solid ${active ? color : "#ddd8d0"}`,
              borderRadius: 8, background: active ? color : "transparent",
              color: active ? "#fff" : "var(--text3)", fontFamily: "inherit", fontSize: 12,
              fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em",
            }}>{label}</button>
          );
        };

        const QSubBtn = ({ id, label }: { id: string; label: string }) => {
          const active = qSubMode === id;
          return (
            <button onClick={() => setNi(n => ({ ...n, mode: qKind === "akonto"
              ? (id === "percent" ? "akonto-percent" : "akonto-amount")
              : (id === "percent" ? "teilrechnung-percent" : "teilrechnung-amount")
            }))} style={{
              padding: "5px 12px", border: `1.5px solid ${active ? "#1a1a18" : "#ddd8d0"}`,
              borderRadius: 20, background: active ? "#1a1a18" : "transparent",
              color: active ? "#f0ede8" : "var(--text3)", fontFamily: "inherit",
              fontSize: 11, cursor: "pointer",
            }}>{label}</button>
          );
        };

        return (
          <>
            {alrInv > 0 && (
              <div style={{ marginBottom: 14, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text3)" }}><span>Total Offerte</span><span>{formatCHF(q.sub)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--positive)" }}><span>Bereits verrechnet</span><span>{formatCHF(alrInv)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--warning)", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border2)" }}><span>Restbetrag</span><span>{formatCHF(rem)}</span></div>
              </div>
            )}

            {/* Ebene 1: Art der Rechnung */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <QKindBtn id="akonto" label="Akonto" color="#b07848" />
              <QKindBtn id="teilrechnung" label="Teilrechnung" color="#2d5a8e" />
              <QKindBtn id="schluss" label="Schlussrechnung" color="#1a1a18" />
            </div>

            {/* Ebene 2: Sub-Optionen */}
            {qKind !== "schluss" && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <QSubBtn id="percent" label="% vom Gesamthonorar" />
                <QSubBtn id="amount" label="Fixer Betrag" />
              </div>
            )}

            {/* Inputs */}
            {qKind !== "schluss" && qSubMode === "percent" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: qKind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${qKind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                <input type="number" min={1} max={100} step="1" value={ni.pct} onChange={e => setNi(n => ({ ...n, pct: Math.max(0, Math.min(100, +e.target.value || 0)) }))} style={{ width: 80, textAlign: "right", background: "var(--surface)" }} />
                <span style={{ fontSize: 13, color: "var(--text3)" }}>% von {formatCHF(q.sub || 0)} = <strong>{formatCHF((q.sub || 0) * ni.pct / 100)}</strong></span>
              </div>
            )}
            {qKind !== "schluss" && qSubMode === "amount" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: qKind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${qKind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text3)" }}>CHF</span>
                <input type="number" min={0} step="50" value={ni.amt} onChange={e => setNi(n => ({ ...n, amt: Math.max(0, +e.target.value || 0) }))} style={{ width: 140, textAlign: "right", background: "var(--surface)" }} />
              </div>
            )}

            {/* Schluss-Info */}
            {qKind === "schluss" && (
              <div style={{ padding: "10px 14px", background: "var(--surface3)", borderRadius: 6, fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                {`Gesamthonorar ${formatCHF(q.sub || 0)} abzgl. bisherige Akonto- und Teilrechnungen.`}
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
