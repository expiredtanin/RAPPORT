// Druckvorlagen Projektdetail (`projectDetail`) und Projektübersicht (`projectsOverview`).

import { SIA_PHASES, PROJECT_TYPES } from "../../constants";
import { formatCHF, formatDate, formatHours, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Invoice, Project, Settings, TimeEntry } from "../../types";
import { HEADING, type Content, type Client } from "./shared";

export function ProjectDetailPrint({ content, settings }: { content: Content; settings: Settings }) {
  const { project, client, entries, phaseStats, unassignedMins, totalMinutes, totalAmount, billingType, invoices, data } = content as unknown as {
    project: Project; client: Client; entries: TimeEntry[]; phaseStats: { id: string; label: string; minutes: number; percent: number }[];
    unassignedMins: number; totalMinutes: number; totalAmount: number; billingType: string; invoices: Invoice[]; data: AppData;
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 50 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div style={{ letterSpacing: "0.15em" }}>PROJEKTREPORT</div>
          <div style={{ marginTop: 4 }}>{new Date().toLocaleDateString("de-CH")}</div>
        </div>
      </div>

      <div style={{ marginBottom: 30, paddingBottom: 20, borderBottom: "2px solid var(--doc-accent)" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#888", marginBottom: 6 }}>{(project.category || "PROJEKT").toUpperCase()}</div>
        <div className="doc-heading" style={{ ...HEADING, fontSize: 26, fontWeight: 400, letterSpacing: "-0.01em", marginBottom: 6 }}>{project.name}</div>
        {client && <div style={{ fontSize: 11, color: "#666" }}>{client.name}{client.company ? ` · ${client.company}` : ""}</div>}
        {project.description && <div style={{ fontSize: 10, color: "#555", marginTop: 12, lineHeight: 1.7 }}>{project.description}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 40 }}>
        <div><div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>STUNDEN TOTAL</div><div className="doc-heading" style={{ fontSize: 18, ...HEADING, fontWeight: 700 }}>{formatHours(totalMinutes)}</div></div>
        <div><div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>{billingType === "stundensatz" ? "AUFWAND" : "PAUSCHALE"}</div><div className="doc-heading" style={{ fontSize: 18, ...HEADING, fontWeight: 700 }}>{formatCHF(totalAmount)}</div></div>
        <div><div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>EINTRÄGE</div><div className="doc-heading" style={{ fontSize: 18, ...HEADING, fontWeight: 700 }}>{entries.length}</div></div>
      </div>

      {phaseStats.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--doc-ink)" }}>
            AUFWAND PRO SIA-PHASE · HAUPTAUFTRAG
          </div>
          {phaseStats.map(ps => (
            <div key={ps.id} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                <span>{ps.label}</span>
                <span style={{ color: "#666" }}>{formatHours(ps.minutes)} · {ps.percent.toFixed(1)}%</span>
              </div>
              <div style={{ height: 4, background: "#ece8e2", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${ps.percent}%`, height: "100%", background: "#2d6a4f" }}></div>
              </div>
            </div>
          ))}
          {unassignedMins > 0 && <div style={{ fontSize: 10, color: "#888", marginTop: 8 }}>Ohne Phasen-Zuordnung: {formatHours(unassignedMins)}</div>}
        </div>
      )}

      {(project.positions || []).filter(pos => {
        const posEntries = entries.filter(e => e.positionId === pos.code);
        return posEntries.length > 0 || (pos.enabledPhases || []).length > 0;
      }).map(pos => {
        const posEntries = entries.filter(e => e.positionId === pos.code);
        const posMins = posEntries.reduce((s, e) => s + (e.minutes || 0), 0);
        const allPhaseIds = [...new Set([...(pos.enabledPhases || []), ...posEntries.map(e => e.phaseId).filter(Boolean)])];
        const linkedQ = pos.quoteId ? (data?.quotes || []).find(q => q.id === pos.quoteId) : null;
        return (
          <div key={pos.code} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#1a4e8a", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #c8d8ee", display: "flex", justifyContent: "space-between" }}>
              <span>↪ {pos.code}{pos.label ? ` · ${pos.label}` : ""}{linkedQ ? ` · ${linkedQ.number}` : ""}</span>
              <span style={{ color: "#666" }}>{formatHours(posMins)}</span>
            </div>
            {allPhaseIds.length > 0 ? allPhaseIds.map(phId => {
              const ph = SIA_PHASES.find(p => p.id === phId);
              if (!ph) return null;
              const phMins = posEntries.filter(e => e.phaseId === phId).reduce((s, e) => s + (e.minutes || 0), 0);
              const pct = posMins > 0 ? (phMins / posMins) * 100 : 0;
              return (
                <div key={phId} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: "#444" }}>{ph.label}</span>
                    <span style={{ color: "#666" }}>{formatHours(phMins)} · {pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 4, background: "#e8f0fa", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "#1a4e8a" }} />
                  </div>
                </div>
              );
            }) : (
              posMins === 0 ? null : <div style={{ fontSize: 10, color: "#888" }}>Keine Phasen-Unterteilung · {formatHours(posMins)}</div>
            )}
          </div>
        );
      })}

      {entries.length > 0 && (
        <div style={{ marginBottom: 30, pageBreakInside: "avoid" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--doc-ink)" }}>ZEITEINTRÄGE</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500, width: 85 }}>DATUM</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500, width: 50 }}>PHASE</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>TÄTIGKEIT</th>
                <th className="align-right" style={{ textAlign: "right", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500, width: 55 }}>DAUER</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const phase = SIA_PHASES.find(p => p.id === e.phaseId);
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 0" }}>{formatDate(e.date)}</td>
                    <td style={{ padding: "6px 0", color: "#666" }}>{phase?.id || "—"}</td>
                    <td style={{ padding: "6px 0", color: "#555" }}>{e.description || "—"}</td>
                    <td className="align-right" style={{ textAlign: "right", padding: "6px 0" }}>{formatHours(e.minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--doc-ink)" }}>RECHNUNGEN</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 0" }}><strong>{inv.number}</strong></td>
                  <td style={{ padding: "6px 0", color: "#666" }}>{formatDate(inv.date)}</td>
                  <td style={{ padding: "6px 0", color: "#666" }}>{inv.status}</td>
                  <td className="align-right" style={{ textAlign: "right", padding: "6px 0" }}><strong>{formatCHF(inv.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ProjectsOverviewPrint({ projects, data, settings }: { projects: Project[]; data: AppData; settings: Settings }) {
  const projectMinutes = (id: string) => data.timeEntries.filter(e => e.projectId === id).reduce((s, e) => s + (e.minutes || 0), 0);
  const projectAmount = (p: Project) => {
    const bType = p.billingType || p.type;
    if (bType === "stundensatz") return (projectMinutes(p.id) / 60) * (p.hourlyRate as number);
    return p.budget || 0;
  };

  const grouped = PROJECT_TYPES.map(cat => ({
    category: cat,
    projects: projects.filter(p => (p.category || "Sonstiges") === cat),
  })).filter(g => g.projects.length > 0);

  const uncategorized = projects.filter(p => !p.category);
  if (uncategorized.length > 0) grouped.push({ category: "Ohne Kategorie", projects: uncategorized });

  const totalMins = projects.reduce((s, p) => s + projectMinutes(p.id), 0);
  const totalAmount = projects.reduce((s, p) => s + projectAmount(p), 0);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 50 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div style={{ letterSpacing: "0.15em" }}>PROJEKTÜBERSICHT</div>
          <div style={{ marginTop: 4 }}>{new Date().toLocaleDateString("de-CH")}</div>
        </div>
      </div>

      <div style={{ marginBottom: 30, paddingBottom: 20, borderBottom: "2px solid var(--doc-accent)" }}>
        <div className="doc-heading" style={{ ...HEADING, fontSize: 26, fontWeight: 400, letterSpacing: "-0.01em" }}>Alle Projekte</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{projects.length} Projekte · {formatHours(totalMins)} · {formatCHF(totalAmount)}</div>
      </div>

      {grouped.map(g => (
        <div key={g.category} style={{ marginBottom: 28, pageBreakInside: "avoid" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--doc-ink)" }}>{g.category.toUpperCase()} — {g.projects.length}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "40%" }} />
              <col style={{ width: "25%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>PROJEKT</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>KUNDE</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>STATUS</th>
                <th style={{ textAlign: "right", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>STUNDEN</th>
                <th style={{ textAlign: "right", padding: "6px 0", fontSize: 9, color: "#888", fontWeight: 500 }}>BETRAG</th>
              </tr>
            </thead>
            <tbody>
              {g.projects.map(p => {
                const client = ((data.persons||[])).find(c => c.id === p.clientId);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>{p.name}</strong></td>
                    <td style={{ padding: "6px 0", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client?.name || "—"}</td>
                    <td style={{ padding: "6px 0", color: "#666" }}>{p.status}</td>
                    <td style={{ textAlign: "right", padding: "6px 0", whiteSpace: "nowrap" }}>
                      {formatHours(projectMinutes(p.id))}
                      {(p.budgetHours || 0) > 0 && <span style={{ color: "#aaa" }}> / {p.budgetHours}h</span>}
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 0" }}>{formatCHF(projectAmount(p))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="doc-heading" style={{ marginTop: 30, paddingTop: 16, borderTop: "2px solid var(--doc-accent)", display: "flex", justifyContent: "space-between", fontSize: 12, ...HEADING, fontWeight: 700 }}>
        <span>Total</span>
        <span>{formatHours(totalMins)} · {formatCHF(totalAmount)}</span>
      </div>
    </>
  );
}
