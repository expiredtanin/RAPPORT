// Karte «Rechnungen» der Projekt-Detailansicht: Rechnungen des Projekts mit PDF-Export und Bezahlt/Offen-Summe.

import { formatCHF, formatDate } from "../../utils";
import { StatusBadge, ShareButton } from "../../components/UI";
import { type ViewProps, type Person, type Invoice } from "../../types";

/** Tabelle der Projektrechnungen; bei `showOffen` mit Summenzeile bezahlt/offen. */
export function InvoicesCard({ projectInvoices, client, setPrintContent, showOffen, paidTotal, openTotal }: {
  projectInvoices: Invoice[];
  client: Person | undefined;
  setPrintContent: ViewProps["setPrintContent"];
  showOffen: boolean;
  paidTotal: number;
  openTotal: number;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>RECHNUNGEN</div>
      <table style={{ tableLayout: "fixed" }}>
        <thead><tr><th style={{ width: "18%" }}>Nr.</th><th style={{ width: "14%" }}>Datum</th><th>Art</th><th style={{ width: "14%" }}>Status</th><th style={{ width: "16%", textAlign: "right" }}>Betrag</th><th style={{ width: "7%" }}></th></tr></thead>
        <tbody>
          {projectInvoices.map(inv => (
            <tr key={inv.id}>
              <td><strong>{inv.number}</strong></td>
              <td>{formatDate(inv.date)}</td>
              <td style={{ fontSize: 11, color: "var(--text4)" }}>{inv.invoiceKind === "akonto" ? "Akonto" : inv.invoiceKind === "teilrechnung" ? "Teilrechnung" : inv.invoiceKind === "schluss" ? "Schluss" : "—"}</td>
              <td><StatusBadge status={inv.status} /></td>
              <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <ShareButton style={{ padding: "5px 10px", fontSize: 12 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "invoice", inv, client }) }]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showOffen && (paidTotal > 0 || openTotal > 0) && (
        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border2)", display: "flex", gap: 24, fontSize: 12 }}>
          <span style={{ color: "#4a7c59" }}>Bezahlt: <strong>{formatCHF(paidTotal)}</strong></span>
          {openTotal > 0 && (
            <span style={{ color: "var(--warning)" }}>Noch offen: <strong>{formatCHF(openTotal)}</strong></span>
          )}
          {openTotal === 0 && paidTotal > 0 && (
            <span style={{ color: "var(--text4)", fontSize: 11 }}>Alles bezahlt</span>
          )}
        </div>
      )}
    </div>
  );
}
