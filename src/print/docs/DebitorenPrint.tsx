// Druckvorlage Debitorenliste (`debitoren`): offene Posten per Stichtag, je Kunde gruppiert, mit
// Fälligkeitsstruktur. Zahlen aus `debitoren()` (src/debitoren.ts) — dieselben wie Ansicht und CSV.

import React from "react";
import { formatCHF, formatDate, formatSenderAddress } from "../../utils";
import { DEBITOR_BUCKETS, debitoren, mahnLabel } from "../../debitoren";
import { StudioLogo } from "../../components/UI";
import type { AppData, Settings } from "../../types";
import { HEADING } from "./shared";

export function DebitorenPrint({ data, asOf, onlyOverdue, settings }: { data: AppData; asOf: string; onlyOverdue?: boolean; settings: Settings }) {
  const r = debitoren(data, asOf, { onlyOverdue });

  const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px 6px 0", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500, borderBottom: "1px solid var(--doc-ink)" };
  const thR: React.CSSProperties = { ...thStyle, textAlign: "right", padding: "6px 0 6px 8px" };
  const tdStyle: React.CSSProperties = { padding: "4px 8px 4px 0", fontSize: 9, borderBottom: "1px solid #f0f0f0" };
  const tdR: React.CSSProperties = { ...tdStyle, textAlign: "right", padding: "4px 0 4px 8px", whiteSpace: "nowrap" };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 26 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>DEBITORENLISTE</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 20, marginTop: 4 }}>per {formatDate(asOf)}</div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 4 }}>{onlyOverdue ? "nur überfällige Posten · " : ""}Beträge inkl. MWST</div>
        </div>
      </div>

      {/* Fälligkeitsstruktur */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 22, background: "#faf8f5", border: "1px solid #e0dbd4", borderRadius: 6 }}>
        {DEBITOR_BUCKETS.map((b, i) => (
          <div key={b.id} style={{ padding: "10px 12px", borderLeft: i ? "1px solid #e0dbd4" : "none" }}>
            <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#888" }}>{b.label.toUpperCase()}</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, whiteSpace: "nowrap" }}>{formatCHF(r.buckets[b.id].amount)}</div>
            <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{r.buckets[b.id].count} Posten</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
        OFFENE POSTEN ({r.count})
      </div>
      {r.count === 0 ? (
        <div style={{ fontSize: 10, color: "#888", padding: "8px 0" }}>Keine offenen Posten per Stichtag.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>RECHNUNG</th>
              <th style={thStyle}>PROJEKT</th>
              <th style={thStyle}>DATUM</th>
              <th style={thStyle}>FÄLLIG</th>
              <th style={thR}>TAGE</th>
              <th style={thR}>MAHNSTUFE</th>
              <th style={thR}>BETRAG</th>
            </tr>
          </thead>
          {r.groups.map(g => (
            <tbody key={g.clientId || g.clientName} style={{ breakInside: "avoid" }}>
              <tr><td colSpan={7} style={{ padding: "10px 0 3px", fontSize: 9.5, fontWeight: 700 }}>{g.clientName}</td></tr>
              {g.rows.map(x => (
                <tr key={x.id}>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}><strong>{x.number}</strong></td>
                  <td style={{ ...tdStyle, color: "#666" }}>{x.projectName || "—"}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDate(x.date)}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{x.dueDate ? formatDate(x.dueDate) : "—"}</td>
                  <td style={{ ...tdR, color: x.daysOverdue > 0 ? "#8a1a1a" : "#888" }}>{x.daysOverdue}</td>
                  <td style={{ ...tdR, color: "#666" }}>{mahnLabel(x.mahnstufe) || "—"}</td>
                  <td style={{ ...tdR, fontWeight: 600 }}>{formatCHF(x.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={6} style={{ padding: "4px 0", fontSize: 9, color: "#888", textAlign: "right" }}>Zwischensumme {g.clientName}</td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(g.total)}</td>
              </tr>
            </tbody>
          ))}
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--doc-ink)" }}>
              <td colSpan={6} style={{ padding: "6px 0", fontSize: 9, fontWeight: 700 }}>Total offene Posten</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(r.total)}</td>
            </tr>
            <tr>
              <td colSpan={6} style={{ padding: "2px 0", fontSize: 8, color: "#888" }}>überfällig ({r.overdueCount})</td>
              <td style={{ ...tdR, fontSize: 8, color: "#888", borderBottom: "none" }}>{formatCHF(r.overdueTotal)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  );
}
