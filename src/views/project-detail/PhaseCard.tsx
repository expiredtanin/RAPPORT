// Karte «Aufwand pro Phase» der Projekt-Detailansicht: eigene Phasen, Hauptauftrag und Nachträge (einzeln/gesamt).

import { SIA_PHASES } from "../../constants";
import { calcSIAHours, migrateLinkedQuotes, formatHours } from "../../utils";
import { type ViewProps, type Project, type TimeEntry, type ProjectPosition } from "../../types";
import { notNull, type PhaseStat } from "./helpers";

/** Aufwand pro SIA-Phase, getrennt nach Hauptauftrag und Nachträgen oder als Gesamtbalken. */
export function PhaseCard({ project, data, entries, positions, phaseStats, customPhaseStats, customMinsTotal, unassignedMins, phaseChartView, setPhaseChartView }: {
  project: Project;
  data: ViewProps["data"];
  entries: TimeEntry[];
  positions: ProjectPosition[];
  phaseStats: PhaseStat[];
  customPhaseStats: { id: string; label: string; mins: number }[];
  customMinsTotal: number;
  unassignedMins: number;
  phaseChartView: string;
  setPhaseChartView: (v: string) => void;
}) {
  const linked = migrateLinkedQuotes(project);
  const hauptLq = linked.find(lq => lq.role === "Hauptofferte");
  const hauptQ = hauptLq ? (data.quotes || []).find(q => q.id === hauptLq.quoteId) : null;
  const hoMinsTotal = entries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
  const hasPositions = positions.some(pos => entries.some(e => e.positionId === pos.code));
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>AUFWAND PRO PHASE</div>
        {hasPositions && (project.enabledPhases || []).length > 0 && (
          <div style={{ display: "flex", gap: 1, background: "var(--surface3)", borderRadius: 20, padding: 2 }}>
            {[["einzeln", "Einzeln"], ["gesamt", "Gesamt"]].map(([v, l]) => (
              <button key={v} onClick={() => setPhaseChartView(v)} style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, border: "none", cursor: "pointer", background: phaseChartView === v ? "var(--surface)" : "transparent", color: phaseChartView === v ? "var(--text)" : "var(--text4)", fontWeight: phaseChartView === v ? 600 : 400 }}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {/* ─ Eigene Phasen (immer einzeln) ─ */}
      {customPhaseStats.length > 0 && (
        <div style={{ marginBottom: (project.enabledPhases || []).length > 0 || hasPositions ? 20 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, background: "var(--warning-bg)", color: "var(--warning)", padding: "2px 8px", borderRadius: 20 }}>EIGENE</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>{formatHours(customMinsTotal)}</span>
          </div>
          {customPhaseStats.map(cp => {
            const pct = customMinsTotal > 0 ? (cp.mins / customMinsTotal) * 100 : 0;
            return (
              <div key={cp.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{cp.label}</span>
                  <span style={{ color: cp.mins > 0 ? "var(--warning)" : "#bbb", fontWeight: 500 }}>{formatHours(cp.mins)}</span>
                </div>
                <div style={{ height: 6, background: "var(--warning-bg)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: cp.mins > 0 ? "var(--warning)" : "transparent" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {phaseChartView === "gesamt" && hasPositions && (project.enabledPhases || []).length > 0 ? (() => {
        const allPhaseIds = [...new Set([
          ...(project.enabledPhases || []),
          ...positions.flatMap(pos => pos.enabledPhases || []),
          ...entries.map(e => e.phaseId).filter(id => id && SIA_PHASES.some(p => p.id === id)),
        ])];

        const segments = [
          { code: null, label: "HO", color: "var(--positive)" },
          ...positions.map(pos => ({ code: pos.code, label: pos.code || "NT", color: "var(--info)" })),
        ];

        // Phasenbudgets der Nachträge vorberechnen
        const posPhasesBudget = positions.map(pos => {
          const linkedQ = pos.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
          if (!linkedQ) return { code: pos.code, phases: [] };
          const roles = linkedQ.quoteRoles || data.settings.roles || [];
          let phases: { id: string; hours: number }[] = [];
          if (linkedQ.mode === "sia") {
            const calc = calcSIAHours(linkedQ.sia?.baukosten, linkedQ.sia?.schwierigkeit, linkedQ.sia?.phases || []);
            phases = (calc.phases || []).filter(p => p.hours > 0).map(p => ({ id: p.id, hours: Math.round(p.hours * 10) / 10 }));
          } else if (linkedQ.mode === "manual") {
            phases = (linkedQ.manualPhases || []).filter(ph => ph.enabled).map(ph => {
              const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
              return { id: ph.id, hours: Math.round(h * 10) / 10 };
            }).filter(p => p.hours > 0);
          }
          return { code: pos.code, phases };
        });

        const phaseRows = allPhaseIds.map(phId => {
          const ph = SIA_PHASES.find(p => p.id === phId);
          if (!ph) return null;
          const phEntries = entries.filter(e => e.phaseId === phId);
          const segMins = segments.map(seg => ({
            ...seg,
            mins: seg.code === null
              ? phEntries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0)
              : phEntries.filter(e => e.positionId === seg.code).reduce((s, e) => s + (e.minutes || 0), 0),
          }));
          const totalMins = segMins.reduce((s, s2) => s + s2.mins, 0);
          const hoBudget = phaseStats.find(ps => ps.id === phId)?.phaseBudget || 0;
          const ntBudget = posPhasesBudget.reduce((s, p) => s + (p.phases.find(p2 => p2.id === phId)?.hours || 0), 0);
          const totalPhaseBudget = hoBudget + ntBudget;
          const remainingH = totalPhaseBudget > 0 ? Math.max(0, totalPhaseBudget - totalMins / 60) : 0;
          return { ph, segMins, totalMins, totalPhaseBudget, remainingH };
        }).filter(notNull).filter(r => r.totalPhaseBudget > 0 || r.totalMins > 0);

        const activeSeg = segments.filter(seg =>
          phaseRows.some(r => (r.segMins.find(s => s.code === seg.code)?.mins || 0) > 0)
        );

        return (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              {activeSeg.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
                  <span style={{ color: "var(--text4)" }}>{seg.label}</span>
                </div>
              ))}
              {phaseRows.some(r => r.remainingH > 0) && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "#d0ccc8" }} />
                  <span style={{ color: "var(--text4)" }}>Verfügbar</span>
                </div>
              )}
            </div>
            {phaseRows.map(({ ph, segMins, totalMins, totalPhaseBudget, remainingH }) => {
              const totalUsedH = totalMins / 60;
              const isOver = totalPhaseBudget > 0 && totalUsedH > totalPhaseBudget;
              const budgetPctPh = totalPhaseBudget > 0 ? (totalUsedH / totalPhaseBudget) * 100 : 0;
              const labelColor = isOver ? "var(--negative)" : budgetPctPh >= 80 ? "var(--warning)" : "#1a1a18";
              // Balken-Basis: bei Budget = Budget*60min, sonst = verwendete Minuten
              const barBaseMins = totalPhaseBudget > 0 ? totalPhaseBudget * 60 : totalMins;
              const remainingBarMins = totalPhaseBudget > 0 ? Math.max(0, totalPhaseBudget * 60 - totalMins) : 0;
              return (
                <div key={ph.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <span style={{ fontWeight: 500 }}>{ph.label}</span>
                    <span style={{ color: labelColor, fontWeight: 500 }}>
                      {formatHours(totalMins)}
                      {totalPhaseBudget > 0 && (
                        <span style={{ fontWeight: 400, color: "var(--text4)", marginLeft: 6 }}>
                          / {totalPhaseBudget}h
                          {remainingH > 0
                            ? <span style={{ color: "var(--positive)" }}> · {remainingH.toFixed(1)}h offen</span>
                            : isOver
                              ? <span style={{ color: "var(--negative)" }}> · überschritten</span>
                              : null}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ display: "flex", height: 8, borderRadius: 3, overflow: "hidden", background: "var(--surface3)" }}>
                    {barBaseMins > 0 && segMins.filter(s => s.mins > 0).map((seg, idx, arr) => (
                      <div key={seg.label} style={{ width: `${(seg.mins / barBaseMins) * 100}%`, height: "100%", background: isOver ? "var(--negative)" : seg.color, borderRight: idx < arr.length - 1 ? "1px solid rgba(255,255,255,0.4)" : "none", flexShrink: 0 }} />
                    ))}
                    {remainingBarMins > 0 && (
                      <div style={{ width: `${(remainingBarMins / barBaseMins) * 100}%`, height: "100%", background: "#d0ccc8", flexShrink: 0 }} />
                    )}
                  </div>
                </div>
              );
            })}
            {unassignedMins > 0 && <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> {formatHours(unassignedMins)} ohne Phasen-Zuordnung</div>}
          </div>
        );
      })() : (
        <>
          {/* ─ Einzeln: Hauptauftrag ─ */}
          {(project.enabledPhases || []).length > 0 && (
            <div style={{ marginBottom: hasPositions ? 20 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, background: "var(--positive-bg)", color: "var(--positive)", padding: "2px 8px", borderRadius: 20 }}>⬡ HO</span>
                {hauptQ?.number && <span style={{ fontWeight: 600, color: "#b07848", fontSize: 12 }}>{hauptQ.number}</span>}
                <span style={{ fontSize: 12, color: "var(--text3)" }}>Hauptauftrag</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>{formatHours(hoMinsTotal)}</span>
              </div>
              {phaseStats.map(ps => {
                const hoMins = ps.hoMins;
                const hoHours = hoMins / 60;
                const phasePct = ps.phaseBudget > 0 ? (hoHours / ps.phaseBudget) * 100 : (hoMinsTotal > 0 ? (hoMins / hoMinsTotal) * 100 : 0);
                const barColor = ps.phaseBudget > 0 ? (phasePct >= 100 ? "var(--negative)" : phasePct >= 80 ? "var(--warning)" : "var(--positive)") : "var(--positive)";
                return (
                  <div key={ps.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>{ps.label}</span>
                      <span style={{ color: barColor, fontWeight: 500 }}>
                        {formatHours(hoMins)}
                        {ps.phaseBudget > 0 && ` / ${ps.phaseBudget}h (${phasePct.toFixed(0)}%)`}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(phasePct, 100)}%`, height: "100%", background: barColor }} />
                    </div>
                  </div>
                );
              })}
              {unassignedMins > 0 && <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> {formatHours(unassignedMins)} ohne Phasen-Zuordnung</div>}
            </div>
          )}

          {/* ─ Einzeln: Nachträge / Positionen ─ */}
          {positions.map(pos => {
            const posEntries = entries.filter(e => e.positionId === pos.code);
            const posMins = posEntries.reduce((s, e) => s + (e.minutes || 0), 0);
            const enabledPhaseIds = pos.enabledPhases || [];
            const extraPhaseIds = [...new Set(posEntries.map(e => e.phaseId).filter((id): id is string => !!id).filter(id => !enabledPhaseIds.includes(id)))];
            const allPhaseIds = [...enabledPhaseIds, ...extraPhaseIds];
            if (allPhaseIds.length === 0 && posMins === 0) return null;
            const linkedQ = pos.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
            let nachtragPhasesBudget: { id: string; hours: number }[] = [];
            if (linkedQ) {
              const roles = linkedQ.quoteRoles || data.settings.roles || [];
              if (linkedQ.mode === "sia") {
                const calc = calcSIAHours(linkedQ.sia?.baukosten, linkedQ.sia?.schwierigkeit, linkedQ.sia?.phases || []);
                nachtragPhasesBudget = (calc.phases || []).filter(p => p.hours > 0).map(p => ({ id: p.id, hours: Math.round(p.hours * 10) / 10 }));
              } else if (linkedQ.mode === "manual") {
                nachtragPhasesBudget = (linkedQ.manualPhases || []).filter(ph => ph.enabled).map(ph => {
                  const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
                  return { id: ph.id, hours: Math.round(h * 10) / 10 };
                }).filter(p => p.hours > 0);
              }
            }
            return (
              <div key={pos.code} style={{ paddingTop: 20, borderTop: "1px solid var(--border2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, background: "var(--info-bg)", color: "var(--info)", padding: "2px 8px", borderRadius: 20 }}>↪ {pos.code}</span>
                  {linkedQ?.number && <span style={{ fontWeight: 600, color: "#b07848", fontSize: 12 }}>{linkedQ.number}</span>}
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>{pos.label || "Nachtrag"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--info)", fontWeight: 600 }}>{formatHours(posMins)}</span>
                </div>
                {allPhaseIds.length > 0 ? allPhaseIds.map(phId => {
                  const ph = SIA_PHASES.find(p => p.id === phId);
                  if (!ph) return null;
                  const phMins = posEntries.filter(e => e.phaseId === phId).reduce((s, e) => s + (e.minutes || 0), 0);
                  const phaseBudgetHours = nachtragPhasesBudget.find(p => p.id === phId)?.hours || 0;
                  const phHours = phMins / 60;
                  const phPct = phaseBudgetHours > 0 ? (phHours / phaseBudgetHours) * 100 : (posMins > 0 ? (phMins / posMins) * 100 : 0);
                  const barColor = phaseBudgetHours > 0 ? (phPct >= 100 ? "var(--negative)" : phPct >= 80 ? "var(--warning)" : "var(--info)") : (phMins > 0 ? "var(--info)" : "#ccc");
                  return (
                    <div key={phId} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 500 }}>{ph.label}</span>
                        <span style={{ color: barColor, fontWeight: 500 }}>
                          {formatHours(phMins)}
                          {phaseBudgetHours > 0 && ` / ${phaseBudgetHours}h (${phPct.toFixed(0)}%)`}
                        </span>
                      </div>
                      <div style={{ height: 6, background: "var(--info-bg)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(phPct, 100)}%`, height: "100%", background: barColor }} />
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ fontSize: 12, color: "var(--text5)" }}>Noch keine Stunden erfasst</div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
