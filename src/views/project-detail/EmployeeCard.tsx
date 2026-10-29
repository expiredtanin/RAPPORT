// Karte «Mitarbeiter-Auswertung» der Projekt-Detailansicht: Stunden, Anteil, Betrag und Phasen je Mitarbeiter.

import { SIA_PHASES } from "../../constants";
import { formatCHF, formatHours } from "../../utils";
import { type ViewProps, type Project, type TimeEntry } from "../../types";

/** Auswertungstabelle der erfassten Stunden je Mitarbeiter (rendert nichts ohne Einträge). */
export function EmployeeCard({ project, data, entries, billingType }: {
  project: Project;
  data: ViewProps["data"];
  entries: TimeEntry[];
  billingType: string;
}) {
  const employees = data.employees || [];
  // Gruppe nach Mitarbeiter
  const byEmp: Record<string, { mins: number; entries: TimeEntry[] }> = {};
  entries.forEach(e => {
    const empId = e.employeeId || "__none__";
    if (!byEmp[empId]) byEmp[empId] = { mins: 0, entries: [] };
    byEmp[empId].mins += e.minutes || 0;
    byEmp[empId].entries.push(e);
  });
  const empRows = Object.entries(byEmp).map(([empId, d]) => {
    const emp = empId === "__none__" ? null : employees.find(e => e.id === empId);
    // Aufschlüsselung nach Phase
    const byPhase: Record<string, number> = {};
    d.entries.forEach(e => {
      const k = e.phaseId || "__none__";
      byPhase[k] = (byPhase[k] || 0) + (e.minutes || 0);
    });
    const amount = billingType === "stundensatz" ? (d.mins / 60) * (project.hourlyRate as number) : null;
    return { empId, emp, mins: d.mins, amount, byPhase, count: d.entries.length };
  }).sort((a, b) => b.mins - a.mins);

  if (empRows.length === 0) return null;

  const totalMins = empRows.reduce((s, r) => s + r.mins, 0);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>MITARBEITER-AUSWERTUNG</div>
      <table>
        <thead>
          <tr>
            <th>Mitarbeiter</th>
            <th style={{ textAlign: "right" }}>Stunden</th>
            <th style={{ textAlign: "right" }}>Anteil</th>
            {billingType === "stundensatz" && <th style={{ textAlign: "right" }}>Betrag</th>}
            <th>Einträge</th>
            <th>Phasen</th>
          </tr>
        </thead>
        <tbody>
          {empRows.map(row => {
            const pct = totalMins > 0 ? Math.round(row.mins / totalMins * 100) : 0;
            const phases = Object.entries(row.byPhase).map(([phId, mins]) => {
              const ph = SIA_PHASES.find(p => p.id === phId);
              return ph ? `${ph.id} (${formatHours(mins)})` : `— (${formatHours(mins)})`;
            }).join(", ");
            return (
              <tr key={row.empId}>
                <td>
                  <strong>{row.emp?.name || "Ohne Mitarbeiter"}</strong>
                  {row.emp?.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{row.emp.role}</div>}
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{formatHours(row.mins)}</td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                    <div style={{ width: 60, height: 6, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#b07848", borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text4)", minWidth: 32 }}>{pct}%</span>
                  </div>
                </td>
                {billingType === "stundensatz" && <td style={{ textAlign: "right" }}>{row.amount !== null ? formatCHF(row.amount) : "—"}</td>}
                <td style={{ color: "var(--text4)", fontSize: 12 }}>{row.count} Einträge</td>
                <td style={{ fontSize: 11, color: "var(--text4)" }}>{phases || "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1.5px solid var(--text)" }}>
            <td><strong>Total</strong></td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHours(totalMins)}</td>
            <td style={{ textAlign: "right", fontSize: 12, color: "var(--text4)" }}>100%</td>
            {billingType === "stundensatz" && <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(empRows.reduce((s, r) => s + (r.amount || 0), 0))}</td>}
            <td style={{ color: "var(--text4)", fontSize: 12 }}>{entries.length} Einträge</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
