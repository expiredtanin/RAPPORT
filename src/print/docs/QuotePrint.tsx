// Druckvorlage Offerte (`quote`).

import React from "react";
import { calcSIAHours, calcManualHours, formatCHF, formatDate, formatHours, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Quote, Settings } from "../../types";
import { HEADING, type Client } from "./shared";

export function QuotePrint({ quote, client, settings }: { quote: Quote; client: Client; settings: Settings }) {
  // Gespeicherten Satz verwenden (wie bei Rechnungen) — sonst zeigt der
  // Nachdruck einer alten Offerte den AKTUELLEN Studio-Satz neben dem damals
  // berechneten Betrag. Fallback auf settings nur für Offerten von vor diesem Fix.
  const taxRate = quote.mwstRate ?? settings.mwstRate ?? 8.1;
  const roles = quote.quoteRoles || settings.roles || [];
  const siaCalc = quote.mode === "sia" && quote.sia ? calcSIAHours(quote.sia!.baukosten, quote.sia!.schwierigkeit, quote.sia.phases) : null;
  const manCalc = quote.mode === "manual" ? calcManualHours(quote.manualPhases || [], roles) : null;
  const stundenansatz = quote.sia?.stundenansatz || 0;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#666" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>HONORAROFFERTE</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, marginTop: 4 }}>Nr. {quote.number}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>OFFERTE AN</div>
          {client ? (
            <>
              {client.company && <div style={{ fontSize: 12, fontWeight: 500 }}>{client.company}</div>}
              <div style={{ fontSize: 12, fontWeight: client.company ? 400 : 500 }}>{client.name || "—"}</div>
              {client.street && <div style={{ color: "#555" }}>{client.street}</div>}
              {(client.zip || client.city) && <div style={{ color: "#555" }}>{[client.zip, client.city].filter(Boolean).join(" ")}</div>}
              {!client.street && !client.city && client.address && <div style={{ whiteSpace: "pre-line", color: "#555" }}>{client.address}</div>}
            </>
          ) : <div style={{ color: "#aaa" }}>—</div>}
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10 }}>
          <div><span style={{ color: "#888" }}>Datum:</span> <strong>{formatDate(quote.date)}</strong></div>
          {quote.validUntil && <div><span style={{ color: "#888" }}>Gültig bis:</span> <strong>{formatDate(quote.validUntil)}</strong></div>}
        </div>
      </div>

      {quote.notes && <div style={{ marginBottom: 14, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-line" }}>{quote.notes}</div>}

      {/* SIA-Modus */}
      {quote.mode === "sia" && siaCalc && (
        <>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 6, paddingBottom: 5, borderBottom: "1.5px solid var(--doc-accent)" }}>
            HONORARBERECHNUNG NACH SIA 102
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14, fontSize: 10 }}>
            <div>
              <div style={{ color: "#888", marginBottom: 2 }}>Aufwandbestimmende Baukosten</div>
              <div style={{ fontWeight: 500 }}>{formatCHF(quote.sia!.baukosten)}</div>
            </div>
            <div>
              <div style={{ color: "#888", marginBottom: 2 }}>Schwierigkeitsgrad n</div>
              <div style={{ fontWeight: 500 }}>{quote.sia!.schwierigkeit}</div>
            </div>
            <div>
              <div style={{ color: "#888", marginBottom: 2 }}>Stundenansatz</div>
              <div style={{ fontWeight: 500 }}>CHF {stundenansatz}.–/h</div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, fontSize: 9, lineHeight: 1.3 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--doc-ink)", borderBottom: "1px solid var(--doc-ink)" }}>
                <th style={{ textAlign: "left", padding: "4px 0", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>TEILLEISTUNG</th>
                <th className="align-right" style={{ textAlign: "right", padding: "4px 4px", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 45 }}>%</th>
                <th className="align-right" style={{ textAlign: "right", padding: "4px 4px", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 72 }}>STUNDEN</th>
                <th className="align-right" style={{ textAlign: "right", padding: "4px 0", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 90 }}>HONORAR</th>
              </tr>
            </thead>
            <tbody>
              {siaCalc.phases.map(ph => (
                <React.Fragment key={ph.id}>
                  <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                    <td colSpan={4} style={{ padding: "4px 0 1px", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em" }}>
                      Phase {ph.id} · {ph.label}
                    </td>
                  </tr>
                  {ph.items.filter(it => it.enabled !== false && it.hours > 0).map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f2f2f2" }}>
                      <td style={{ padding: "1px 10px", color: "#555" }}>{it.label}</td>
                      <td className="align-right" style={{ textAlign: "right", padding: "1px 4px", color: "#888" }}>{it.pct}%</td>
                      <td className="align-right" style={{ textAlign: "right", padding: "1px 4px" }}>{formatHours(Math.round(it.hours * 60))}</td>
                      <td className="align-right" style={{ textAlign: "right", padding: "1px 0" }}>{formatCHF(it.hours * stundenansatz)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ padding: "1px 0 4px", fontSize: 9, color: "#888", fontStyle: "italic" }}>Total Phase {ph.id}</td>
                    <td className="align-right" style={{ textAlign: "right", padding: "1px 4px 4px", fontWeight: 600 }}>{formatHours(Math.round(ph.hours * 60))}</td>
                    <td className="align-right" style={{ textAlign: "right", padding: "1px 0 4px", fontWeight: 600 }}>{formatCHF(ph.hours * stundenansatz)}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Manueller Modus */}
      {quote.mode === "manual" && manCalc && (
        <>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 8, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
            HONORARSCHÄTZUNG STUNDENAUFWAND
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, fontSize: 10 }}>
            {roles.map(r => (
              <div key={r.id}><strong>{r.id}</strong> <span style={{ color: "#888" }}>{r.label} — CHF {r.rate}.–/h</span></div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 22, fontSize: 10 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--doc-ink)", borderBottom: "1px solid var(--doc-ink)" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>PHASE</th>
                {roles.map(r => (
                  <th key={r.id} className="align-right" style={{ textAlign: "right", padding: "8px 4px", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 40 }}>{r.id}</th>
                ))}
                <th className="align-right" style={{ textAlign: "right", padding: "8px 6px", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 60 }}>Std</th>
                <th className="align-right" style={{ textAlign: "right", padding: "8px 0", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 100 }}>Honorar</th>
              </tr>
            </thead>
            <tbody>
              {manCalc.phases.filter(p => p.totalHours > 0).map(ph => (
                <tr key={ph.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 0" }}>{ph.label}</td>
                  {roles.map(r => {
                    const h = ph.roleDetails.find(rd => rd.id === r.id)?.hours || 0;
                    return <td key={r.id} className="align-right" style={{ textAlign: "right", padding: "6px 4px", color: h ? "var(--doc-ink)" : "#ccc" }}>{h || "—"}</td>;
                  })}
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 6px", fontWeight: 500 }}>{ph.totalHours}</td>
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 0" }}>{formatCHF(ph.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Freier Modus */}
      {quote.mode === "free" && (quote.freeItems || []).length > 0 && (
        <>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 8, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
            LEISTUNGEN / POSITIONEN
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 22, fontSize: 10 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--doc-ink)", borderBottom: "1px solid var(--doc-ink)" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>BESCHREIBUNG</th>
                <th className="align-right" style={{ textAlign: "right", padding: "8px 6px", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 60 }}>MENGE</th>
                <th className="align-right" style={{ textAlign: "right", padding: "8px 6px", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 90 }}>PREIS</th>
                <th className="align-right" style={{ textAlign: "right", padding: "8px 0", fontSize: 9, letterSpacing: "0.1em", color: "#888", fontWeight: 500, width: 100 }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {(quote.freeItems || []).map((it, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 0" }}>{it.desc || "—"}</td>
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 6px" }}>{it.qty}</td>
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 6px" }}>{formatCHF(it.price)}</td>
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 0", fontWeight: 500 }}>{formatCHF(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Total */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <div style={{ width: 320, fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ color: "#666" }}>Netto</span>
            <span>{formatCHF(quote.sub)}</span>
          </div>
          {quote.mwst && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
              <span style={{ color: "#666" }}>MWST {taxRate}%</span>
              <span>{formatCHF(quote.tax)}</span>
            </div>
          )}
          <div className="doc-heading" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "2px solid var(--doc-accent)", marginTop: 6, ...HEADING, fontSize: 15, fontWeight: 700 }}>
            <span>Offertsumme</span>
            <span>{formatCHF(quote.total)}</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 9, color: "#888", borderTop: "1px solid #ddd", paddingTop: 14, lineHeight: 1.6 }}>
        Diese Offerte ist unverbindlich und {quote.validUntil ? `gültig bis ${formatDate(quote.validUntil)}` : "zeitlich unbegrenzt gültig"}.
        {quote.mode !== "free" && " Honorar gemäss SIA-Ordnung 102."} Änderungen am Auftragsumfang können zu einer Anpassung führen.
      </div>
    </>
  );
}
