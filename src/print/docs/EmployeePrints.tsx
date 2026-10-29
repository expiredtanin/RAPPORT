// Druckvorlagen Mitarbeitendenübersicht (`mitarbeiterOverview`) und Monatsrapport (`timeReport`).

import { formatCHF, formatDate, formatHours, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Employee, Project, Settings, TimeEntry } from "../../types";
import { HEADING } from "./shared";

export function MitarbeiterOverviewPrint({ employees, settings }: { employees: Employee[]; settings: Settings }) {
  const Row = ({ label, value }: { label: string; value?: string | null }) => value ? (
    <div style={{ display: "flex", gap: 8, fontSize: 10, borderBottom: "1px solid #f0ece6", padding: "3px 0" }}>
      <span style={{ color: "#888", minWidth: 120 }}>{label}</span>
      <span>{value}</span>
    </div>
  ) : null;

  const EmpCard = ({ emp }: { emp: Employee }) => (
    <div style={{ breakInside: "avoid", marginBottom: 16, padding: "12px 14px", border: "1px solid #e8e4de", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
          {emp.role && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{emp.role}</div>}
        </div>
        {emp.personalNr && <div style={{ fontSize: 10, color: "#aaa", letterSpacing: "0.08em" }}>#{emp.personalNr}</div>}
      </div>
      <Row label="Pensum" value={emp.pensum != null ? `${emp.pensum}%` : null} />
      <Row label="Wochenstunden" value={emp.wochenstunden ? `${emp.wochenstunden} h` : null} />
      <Row label="Ferien" value={emp.ferienWochen ? `${emp.ferienWochen} Wochen` : null} />
      <Row label="Eintrittsdatum" value={emp.eintrittsdatum ? formatDate(emp.eintrittsdatum) : null} />
      <Row label="Monatslohn" value={emp.monatslohn ? formatCHF(emp.monatslohn) : null} />
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 50 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div style={{ letterSpacing: "0.15em" }}>MITARBEITERÜBERSICHT</div>
          <div style={{ marginTop: 4 }}>{new Date().toLocaleDateString("de-CH")}</div>
        </div>
      </div>

      <div style={{ marginBottom: 30, paddingBottom: 20, borderBottom: "2px solid var(--doc-accent)" }}>
        <div className="doc-heading" style={{ ...HEADING, fontSize: 26, fontWeight: 400 }}>Mitarbeiter</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{employees.length} Mitarbeitende</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {employees.map(e => <EmpCard key={e.id} emp={e} />)}
      </div>
    </>
  );
}

export function TimeReportPrint({ employee, entries, month, data, settings }: { employee: Employee; entries: TimeEntry[]; month: string; data: AppData; settings: Settings }) {
  const monthEntries = entries.filter(e => e.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));

  const projects = data.projects || [];
  const getProj = (id?: string) => projects.find(p => p.id === id);

  const totalMins = monthEntries.reduce((s, e) => s + (e.minutes || 0), 0);

  const byProject: Record<string, { proj: Project | undefined; mins: number }> = {};
  monthEntries.forEach(e => {
    const k = e.projectId || "__none__";
    if (!byProject[k]) byProject[k] = { proj: getProj(e.projectId), mins: 0 };
    byProject[k].mins += e.minutes || 0;
  });

  const monthLabel = new Date(month + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 50 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div style={{ letterSpacing: "0.15em" }}>STUNDENRAPPORT</div>
          <div style={{ marginTop: 4 }}>{new Date().toLocaleDateString("de-CH")}</div>
        </div>
      </div>

      <div style={{ marginBottom: 30, paddingBottom: 20, borderBottom: "2px solid var(--doc-accent)" }}>
        <div className="doc-heading" style={{ ...HEADING, fontSize: 26, fontWeight: 400 }}>{employee?.name}</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{monthLabel} · {formatHours(totalMins)}</div>
      </div>

      {/* Zusammenfassung */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid #e0dbd4" }}>ZUSAMMENFASSUNG PRO PROJEKT</div>
        {Object.values(byProject).sort((a, b) => b.mins - a.mins).map(({ proj, mins }) => (
          <div key={proj?.id || "none"} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid #f4f0ea" }}>
            <span>{proj ? `${proj.number ? proj.number + " " : ""}${proj.name}` : "Kein Projekt"}</span>
            <strong>{formatHours(mins)}</strong>
          </div>
        ))}
        <div className="doc-heading" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, ...HEADING, padding: "8px 0 0", marginTop: 4, borderTop: "1.5px solid var(--doc-accent)" }}>
          <span>Total</span><strong>{formatHours(totalMins)}</strong>
        </div>
      </div>

      {/* Detailliste */}
      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid #e0dbd4" }}>EINZELEINTRÄGE</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--doc-ink)" }}>
            {["Datum", "Projekt", "Zeit", "Stunden", "Notiz"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600, letterSpacing: "0.06em", color: "#555" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthEntries.map(e => {
            const proj = getProj(e.projectId);
            return (
              <tr key={e.id} style={{ borderBottom: "1px solid #f0ece6" }}>
                <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                <td style={{ padding: "4px 6px" }}>{proj ? `${proj.number ? proj.number + " " : ""}${proj.name}` : "—"}</td>
                <td style={{ padding: "4px 6px", whiteSpace: "nowrap", color: "#888" }}>{e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 600 }}>{formatHours(e.minutes || 0)}</td>
                <td style={{ padding: "4px 6px", color: "#888" }}>{e.description || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {monthEntries.length === 0 && (
        <div style={{ textAlign: "center", color: "#aaa", padding: "32px 0", fontSize: 12 }}>Keine Einträge für diesen Monat</div>
      )}
    </>
  );
}
