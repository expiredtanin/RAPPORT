// Druckvorlage Bürobudget (`studioBudget`) aus einer gespeicherten Budget-Version.

import { formatCHF, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Settings, StudioBudgetVersion } from "../../types";
import { HEADING } from "./shared";

/** Zeile der Budget-Zusammenfassung (Label links, Betrag rechts; `indent` = Unterposition). */
function PRow({ label, value, bold, indent, color }: { label: string; value: string; bold?: boolean; indent?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: indent ? "3px 0 3px 16px" : "5px 0", borderBottom: "1px solid #eee" }}>
      <span style={{ fontSize: indent ? 10 : 11, color: indent ? "#888" : "#444" }}>{label}</span>
      <span style={{ fontSize: indent ? 10 : 11, fontWeight: bold ? 700 : 400, color: color || (indent ? "#888" : "var(--doc-ink)"), fontFamily: bold ? "var(--doc-font-heading)" : "inherit" }}>{value}</span>
    </div>
  );
}

export function StudioBudgetPrint({ snapshot, settings }: { snapshot: StudioBudgetVersion; settings: Settings }) {
  const r = snapshot.results || {};
  const rateOk = (r.currentRate || 0) >= (r.zielHonorar || 0);
  const b = snapshot.b || {};


  return (
    <>
      {/* Kopf */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 48 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>BÜROBUDGET</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 20, marginTop: 4 }}>{snapshot.name}</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
            Erstellt: {snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" }) : "—"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 32 }}>

        {/* Kostenstruktur */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#888", marginBottom: 10, borderBottom: "2px solid var(--doc-accent)", paddingBottom: 6 }}>KOSTENSTRUKTUR / JAHR</div>
          <PRow label="Personalkosten" value={formatCHF(r.personalKosten || 0)} />
          <PRow label="Fixkosten" value={formatCHF((r.fixKosten || 0) + (r.extraKosten || 0))} />
          <PRow label="Basiskosten" value={formatCHF(r.basisKosten || 0)} bold />
          <PRow label={`Reserve (${b.reserve || 0}%)`} value={formatCHF(r.reserve || 0)} indent />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", borderTop: "2px solid var(--doc-accent)", marginTop: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Gesamtkosten</span>
            <span className="doc-heading" style={{ fontSize: 15, fontWeight: 700, ...HEADING }}>{formatCHF(r.gesamtKosten || 0)}</span>
          </div>
        </div>

        {/* Jahresstunden & Kernresultat */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#888", marginBottom: 10, borderBottom: "2px solid var(--doc-accent)", paddingBottom: 6 }}>STUNDENANALYSE</div>
          <PRow label="Jahresstunden (verfügbar)" value={`${r.jahresStundenTotal || 0}h`} />
          <PRow label={`Produktiv (${b.produktivQuote || 70}%)`} value={`${r.produktivStunden || 0}h`} />
          <div style={{ height: 6, background: "#eee", borderRadius: 3, margin: "8px 0", overflow: "hidden" }}>
            <div style={{ width: `${b.produktivQuote || 70}%`, height: "100%", background: "#2d6a4f", borderRadius: 3 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div style={{ background: "#f8f8f6", borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#888", letterSpacing: "0.1em", marginBottom: 4 }}>SELBSTKOSTEN/H</div>
              <div className="doc-heading" style={{ fontSize: 18, ...HEADING, fontWeight: 700 }}>{formatCHF(Math.round(r.selbstkosten || 0))}</div>
            </div>
            <div style={{ background: "#f8f8f6", borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#888", letterSpacing: "0.1em", marginBottom: 4 }}>ZIEL-HONORAR/H</div>
              <div className="doc-heading" style={{ fontSize: 18, ...HEADING, fontWeight: 700, color: "#b5861e" }}>{formatCHF(Math.round(r.zielHonorar || 0))}</div>
              <div style={{ fontSize: 9, color: "#aaa", marginTop: 2 }}>inkl. {b.zielMarge || 25}% Marge</div>
            </div>
          </div>
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 4, border: `1.5px solid ${rateOk ? "#b8dcc8" : "#e8b0b0"}`, background: rateOk ? "#f0f8f4" : "#fdf2f2" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: rateOk ? "#2d6a4f" : "#8a1a1a" }}>
              {rateOk ? "✓ Aktueller Ansatz ausreichend" : "⚠ Aktueller Ansatz zu tief"}
            </div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
              Aktuell: {formatCHF(r.currentRate || 0)}/h · Ziel: {formatCHF(Math.round(r.zielHonorar || 0))}/h · Differenz: {rateOk ? "+" : ""}{formatCHF(Math.round((r.currentRate || 0) - (r.zielHonorar || 0)))}
            </div>
          </div>
        </div>
      </div>

      {/* Personal-Detail */}
      {(snapshot.empSnapshot || []).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#888", marginBottom: 8, borderBottom: "1px solid #ddd", paddingBottom: 5 }}>PERSONAL</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 0", color: "#888", fontWeight: 500, fontSize: 9, borderBottom: "1px solid #eee" }}>Mitarbeiter</th>
                <th style={{ textAlign: "right", padding: "4px 8px", color: "#888", fontWeight: 500, fontSize: 9, borderBottom: "1px solid #eee" }}>Jahreskosten</th>
                <th style={{ textAlign: "right", padding: "4px 0", color: "#888", fontWeight: 500, fontSize: 9, borderBottom: "1px solid #eee" }}>Jahresstunden</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.empSnapshot.filter(r => r.aktiv).map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>{r.name}</td>
                  <td style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #f5f5f5" }}>{formatCHF(r.kosten)}</td>
                  <td style={{ textAlign: "right", padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>{r.stunden}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fixkosten-Detail */}
      {(snapshot.fixSnapshot || []).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#888", marginBottom: 8, borderBottom: "1px solid #ddd", paddingBottom: 5 }}>FIXKOSTEN</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 0", color: "#888", fontWeight: 500, fontSize: 9, borderBottom: "1px solid #eee" }}>Posten</th>
                <th style={{ textAlign: "right", padding: "4px 0", color: "#888", fontWeight: 500, fontSize: 9, borderBottom: "1px solid #eee" }}>CHF/Jahr</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.fixSnapshot.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>{r.label}</td>
                  <td style={{ textAlign: "right", padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>{formatCHF(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 14, borderTop: "1px solid #ddd", fontSize: 9, color: "#aaa", display: "flex", justifyContent: "space-between" }}>
        <div>{settings.name}</div>
        <div>Bürobudget · {snapshot.name}</div>
      </div>
    </>
  );
}
