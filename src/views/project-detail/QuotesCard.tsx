// Karte «Offerten» der Projekt-Detailansicht: Offerten des Projekts mit PDF-Export.

import { formatCHF, formatDate } from "../../utils";
import { StatusBadge, ShareButton } from "../../components/UI";
import { type ViewProps, type Person } from "../../types";

/** Tabelle der Offerten des Projekts (rendert nichts, wenn es keine gibt). */
export function QuotesCard({ data, projectId, client, setPrintContent }: {
  data: ViewProps["data"];
  projectId: string;
  client: Person | undefined;
  setPrintContent: ViewProps["setPrintContent"];
}) {
  const projectQuotes = (data.quotes || []).filter(q => q.projectId === projectId);
  if (projectQuotes.length === 0) return null;
  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>OFFERTEN</div>
      <table style={{ tableLayout: "fixed" }}>
        <thead><tr><th style={{ width: "18%" }}>Nr.</th><th style={{ width: "14%" }}>Datum</th><th>Modus</th><th style={{ width: "14%" }}>Status</th><th style={{ width: "16%", textAlign: "right" }}>Honorar</th><th style={{ width: "7%" }}></th></tr></thead>
        <tbody>
          {projectQuotes.map(q => (
            <tr key={q.id}>
              <td><strong>{q.number}</strong></td>
              <td>{formatDate(q.date)}</td>
              <td style={{ fontSize: 11, color: "var(--text4)" }}>{q.mode === "sia" ? "SIA 102" : "Aufwand"}</td>
              <td><StatusBadge status={q.status} /></td>
              <td style={{ textAlign: "right" }}><strong>{formatCHF(q.total)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <ShareButton style={{ padding: "5px 10px", fontSize: 12 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "quote", quote: q, client, settings: data.settings }) }]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
