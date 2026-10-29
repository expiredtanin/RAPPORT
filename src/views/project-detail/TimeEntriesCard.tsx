// Karte «Zeiteinträge» der Projekt-Detailansicht: Tabelle mit Phasen-/Positionszuordnung (Admin: änderbar).

import { SIA_PHASES } from "../../constants";
import { formatCHF, formatDate, formatHours } from "../../utils";
import { type ViewProps, type Project, type TimeEntry, type ProjectPosition } from "../../types";

/** Tabelle der Zeiteinträge des Projekts; Admins können die Phase/Position pro Eintrag ändern. */
export function TimeEntriesCard({ project, data, update, entries, positions, billingType, isAdmin, canSeeMitarbeiter, canSeeInvoices }: {
  project: Project;
  data: ViewProps["data"];
  update: ViewProps["update"];
  entries: TimeEntry[];
  positions: ProjectPosition[];
  billingType: string;
  isAdmin: boolean;
  canSeeMitarbeiter: boolean;
  canSeeInvoices: boolean;
}) {
  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>ZEITEINTRÄGE</div>
      <table style={{ tableLayout: "fixed" }}>
        <thead><tr>
          <th style={{ width: "12%" }}>Datum</th>
          {canSeeMitarbeiter && <th style={{ width: "14%" }}>Mitarbeiter</th>}
          <th style={{ width: "15%" }}>Phase / Position</th>
          <th>Tätigkeit</th>
          <th style={{ width: "10%" }}>Dauer</th>
          {canSeeInvoices && <th style={{ width: "11%" }}>Betrag</th>}
          {canSeeInvoices && <th style={{ width: "12%" }}>Rechnung</th>}
        </tr></thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={canSeeMitarbeiter && canSeeInvoices ? 7 : 4} style={{ textAlign: "center", color: "var(--text5)", padding: 24 }}>Noch keine Zeiteinträge</td></tr>}
          {entries.map(e => {
            const phase = SIA_PHASES.find(p => p.id === e.phaseId);
            const pos = positions.find(p => p.code === e.positionId);
            const emp = e.employeeId ? (data.employees || []).find(em => em.id === e.employeeId) : null;
            const amount = billingType === "stundensatz" ? (e.minutes / 60) * (project.hourlyRate as number) : null;
            const invoice = e.invoiceId ? data.invoices.find(i => i.id === e.invoiceId) : null;
            const posQuote = pos?.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
            const isStundensatzEntry = e.positionId
              ? posQuote?.mode === "manual"
              : billingType === "stundensatz";
            return (
              <tr key={e.id} style={{ opacity: invoice && canSeeInvoices ? 0.75 : 1 }}>
                <td>{formatDate(e.date)}</td>
                {canSeeMitarbeiter && <td style={{ fontSize: 11, color: "var(--text3)" }}>{emp?.name || <span style={{ color: "var(--text5)" }}>—</span>}</td>}
                <td style={{ fontSize: 12 }}>
                  {isAdmin ? (
                    <select
                      value={e.phaseId ? (e.positionId ? e.phaseId + "|" + e.positionId : e.phaseId) : ""}
                      onChange={ev => {
                        const val = ev.target.value;
                        if (!val) { update("timeEntries", data.timeEntries.map(te => te.id === e.id ? { ...te, phaseId: "", positionId: "" } : te)); return; }
                        const [ph, p] = val.split("|");
                        update("timeEntries", data.timeEntries.map(te => te.id === e.id ? { ...te, phaseId: ph, positionId: p || "" } : te));
                      }}
                      disabled={!!e.invoiceId}
                      style={{ border: "1px solid var(--border)", height: 26, fontSize: 11, maxWidth: "100%", opacity: e.invoiceId ? 0.6 : 1 }}
                    >
                      <option value="">—</option>
                      {(project.customPhases || []).map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                      {positions.length === 0 && (project.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id} value={ph.id}>{ph.id}</option> : null; }).filter(Boolean)}
                      {positions.length > 0 && (project.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id} value={ph.id}>{ph.id} HO</option> : null; }).filter(Boolean)}
                      {positions.flatMap(pos => (pos.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id + "|" + pos.code} value={ph.id + "|" + pos.code}>{pos.code}·{ph.id}</option> : null; }).filter(Boolean))}
                    </select>
                  ) : phase ? (
                    <span>
                      <span style={{ color: "var(--text3)" }}>{phase.label.split(" ")[0]}</span>
                      {pos && <span style={{ fontWeight: 600, color: "var(--pending)", background: "#fffbe8", padding: "1px 5px", borderRadius: 20, marginLeft: 5, fontSize: 11 }}>{pos.code}</span>}
                    </span>
                  ) : <span style={{ color: "var(--text5)" }}>—</span>}
                </td>
                <td style={{ color: "var(--text3)" }}>{e.description || "—"}</td>
                <td>{formatHours(e.minutes)}</td>
                {canSeeInvoices && <td>{amount !== null ? formatCHF(amount) : "—"}</td>}
                {canSeeInvoices && <td style={{ fontSize: 11 }}>
                  {invoice
                    ? <span className="tag" style={{ background: "var(--positive)", fontSize: 10 }}>{invoice.number}</span>
                    : isStundensatzEntry
                      ? <span style={{ color: "var(--text5)" }}>offen</span>
                      : null}
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
