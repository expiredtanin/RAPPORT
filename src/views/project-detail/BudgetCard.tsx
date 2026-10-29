// Karte «Honorar- und Stundenbudget» der Projekt-Detailansicht: Verbrauch je verknüpfter Offerte (einzeln/gesamt).

import { calcSIAHours, calcManualHours, deriveQuoteBudget, migrateLinkedQuotes, formatCHF } from "../../utils";
import { type ViewProps, type Project, type Invoice, type TimeEntry, type ProjectPosition } from "../../types";
import { notNull } from "./helpers";

/** Budgetkarte mit Balken je Offerte (Hauptofferte/Nachträge) oder Gesamtbalken; ohne Budget ein Hinweis mit Verknüpfen-Button. */
export function BudgetCard({ project, data, entries, positions, projectInvoices, budget, totalHours, budgetPct, budgetColor, canSeeInvoices, budgetChartView, setBudgetChartView, onOpenBudget }: {
  project: Project;
  data: ViewProps["data"];
  entries: TimeEntry[];
  positions: ProjectPosition[];
  projectInvoices: Invoice[];
  budget: number;
  totalHours: number;
  budgetPct: number;
  budgetColor: string;
  canSeeInvoices: boolean;
  budgetChartView: string;
  setBudgetChartView: (v: string) => void;
  onOpenBudget: () => void;
}) {
  const linked = migrateLinkedQuotes(project);
  const derived = linked.length > 0 ? deriveQuoteBudget(linked, data.quotes || [], data.settings.roles || []) : null;
  const amountBudget = project.budgetAmount || derived?.budgetAmount || 0;
  // Entwürfe sind noch nicht ausgestellt und dürfen den Budgetverbrauch
  // nicht überzeichnen (analog Accounting.jsx totalTax-Fix).
  const invoicedAmount = projectInvoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + (i.sub || 0), 0);

  if (budget === 0 && amountBudget === 0) return (
    <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--border)", padding: "12px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text5)" }}>Kein Budget gesetzt</span>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }}
          onClick={onOpenBudget}>
          + Budget / Offerte verknüpfen
        </button>
      </div>
    </div>
  );

  // Pro Offerte einzeln berechnen
  const quoteRows = linked.map(lq => {
    const q = (data.quotes || []).find(x => x.id === lq.quoteId);
    if (!q) return null;
    const roles = q.quoteRoles || data.settings.roles || [];
    let qHours = 0, qAmount = 0;
    if (q.mode === "sia") {
      const calc = calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []);
      qHours = calc.total || 0;
      qAmount = qHours * (q.sia?.stundenansatz || 0);
    } else if (q.mode === "manual") {
      const calc = calcManualHours(q.manualPhases || [], roles);
      qHours = calc.totalHours || 0;
      qAmount = calc.totalAmount || 0;
    } else if (q.mode === "free") {
      qAmount = (q.freeItems || []).reduce((s, it) => s + (it.qty * it.price), 0);
    }
    return { lq, q, qHours: Math.round(qHours * 10) / 10, qAmount: Math.round(qAmount) };
  }).filter(notNull);

  const isNachtrag = (role: string) => role === "Nachtrag";
  const nachtragRows = quoteRows.filter(r => isNachtrag(r.lq.role));
  const sortedQuoteRows = [
    ...quoteRows.filter(r => !isNachtrag(r.lq.role)),
    ...nachtragRows,
  ];
  const hauptTotal = quoteRows.filter(r => !isNachtrag(r.lq.role)).reduce((s, r) => s + r.qHours, 0);
  const nachtragTotal = nachtragRows.reduce((s, r) => s + r.qHours, 0);

  // resolve per-row posCode from project.positions (custom codes)
  const rowsWithPos = sortedQuoteRows.map(({ lq, q, qHours, qAmount }) => {
    const isNT = isNachtrag(lq.role);
    const pos = isNT ? positions.find(p => p.quoteId === lq.quoteId) : null;
    const ntIdx = isNT ? nachtragRows.findIndex(r => r.lq.quoteId === lq.quoteId) : -1;
    const posCode = pos?.code || (isNT ? `N${ntIdx + 1}` : null);
    const usedMins = isNT
      ? entries.filter(e => posCode && e.positionId === posCode).reduce((s, e) => s + (e.minutes || 0), 0)
      : entries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
    return { lq, q, qHours, qAmount, isNT, posCode, usedH: usedMins / 60 };
  });
  const totalBudgetH = rowsWithPos.filter(r => r.qHours > 0).reduce((s, r) => s + r.qHours, 0);
  const remaining = Math.max(0, budget - totalHours);

  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: `4px solid ${budgetColor}`, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>HONORAR- UND STUNDENBUDGET</div>
          {quoteRows.length > 1 && (
            <div style={{ display: "flex", gap: 1, background: "var(--surface3)", borderRadius: 20, padding: 2 }}>
              {[["einzeln", "Einzeln"], ["gesamt", "Gesamt"]].map(([v, l]) => (
                <button key={v} onClick={() => setBudgetChartView(v)} style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, border: "none", cursor: "pointer", background: budgetChartView === v ? "var(--surface)" : "transparent", color: budgetChartView === v ? "var(--text)" : "var(--text4)", fontWeight: budgetChartView === v ? 600 : 400 }}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {canSeeInvoices && <div style={{ fontSize: 11, color: "var(--text4)" }}>
          Total verrechnet: <strong style={{ color: "var(--text)" }}>{formatCHF(invoicedAmount)}</strong>
          {amountBudget > 0 && <span> / {formatCHF(amountBudget)}</span>}
        </div>}
      </div>

      {budgetChartView === "gesamt" && quoteRows.length > 1 ? (
        <div>
          {/* Segmentierter Balken */}
          <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", marginBottom: 10, background: "var(--surface3)" }}>
            {rowsWithPos.filter(r => r.qHours > 0).map((r, idx, arr) => {
              const segW = (r.qHours / totalBudgetH) * 100;
              const fillW = Math.min((r.usedH / r.qHours) * 100, 100);
              const isOver = r.usedH > r.qHours;
              const segBg = r.isNT ? "#c8d8ee" : "#b8dcc8";
              const fillColor = isOver ? "var(--negative)" : (r.isNT ? "var(--info)" : "var(--positive)");
              const label = r.posCode || (r.isNT ? "NT" : "HO");
              return (
                <div key={r.lq.quoteId} style={{ width: `${segW}%`, position: "relative", background: segBg, borderRight: idx < arr.length - 1 ? "2px solid #fff" : "none", overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ width: `${fillW}%`, height: "100%", background: fillColor, transition: "width 0.4s" }} />
                  {segW > 6 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{label}</div>}
                </div>
              );
            })}
          </div>

          {/* Legende */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
            {rowsWithPos.map(r => {
              const color = r.isNT ? "var(--info)" : "var(--positive)";
              const label = r.posCode || (r.isNT ? "NT" : "HO");
              const isOver = r.usedH > r.qHours && r.qHours > 0;
              return (
                <div key={r.lq.quoteId} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: isOver ? "var(--negative)" : color, flexShrink: 0 }} />
                  <span style={{ color: "var(--text4)" }}>{label}:</span>
                  <span style={{ fontWeight: 600, color: isOver ? "var(--negative)" : color }}>{r.usedH.toFixed(1)}h</span>
                  {r.qHours > 0 && <span style={{ color: "var(--text5)", fontSize: 10 }}>/ {r.qHours}h</span>}
                  {r.qAmount > 0 && <span style={{ color: "var(--text5)", fontSize: 10 }}> · {formatCHF(r.qAmount)}</span>}
                </div>
              );
            })}
          </div>

          {/* Gesamt-Summe */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, paddingTop: 10, borderTop: "1px solid var(--border2)" }}>
            <div style={{ color: "var(--text4)", display: "flex", gap: 16 }}>
              <span>Verbraucht: <strong style={{ color: budgetColor }}>{totalHours.toFixed(1)}h</strong></span>
              {budget > 0 && <span>Verfügbar: <strong style={{ color: remaining === 0 ? "var(--negative)" : "var(--positive)" }}>{remaining.toFixed(1)}h</strong></span>}
            </div>
            <span style={{ fontWeight: 700, color: budgetColor }}>
              {budget > 0 ? `${totalHours.toFixed(1)}h / ${budget}h — ${budgetPct.toFixed(0)}%` : `${totalHours.toFixed(1)}h total`}
              {budgetPct >= 100 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--negative)" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> überschritten</span>}
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Einzeln-Ansicht */}
          {rowsWithPos.map(({ lq, q, qHours, qAmount, isNT, usedH }) => {
            const barPct = qHours > 0 ? Math.min((usedH / qHours) * 100, 100) : 0;
            const barColor = barPct >= 100 ? "var(--negative)" : barPct >= 80 ? "var(--warning)" : isNT ? "var(--info)" : "var(--positive)";
            return (
              <div key={lq.quoteId} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, letterSpacing: "0.04em", background: isNT ? "var(--info-bg)" : "#f0f8f4", color: isNT ? "var(--info)" : "var(--positive)", border: `1px solid ${isNT ? "#b0c8e8" : "#b8dcc8"}` }}>
                      {isNT ? "↪ " : "⬡ "}{lq.role}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      {q.number && <span style={{ color: "#b07848", marginRight: 6, fontWeight: 600 }}>{q.number}</span>}
                      {q.projectName || "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, textAlign: "right" }}>
                    {qHours > 0 && <span style={{ fontWeight: 600, color: barColor }}>{usedH.toFixed(1)}h / {qHours}h<span style={{ fontWeight: 400, color: "var(--text4)", marginLeft: 6 }}>({barPct.toFixed(0)}%)</span></span>}
                    {qAmount > 0 && <span style={{ color: "var(--text4)", fontSize: 11, marginLeft: 10 }}>{formatCHF(qAmount)}</span>}
                  </div>
                </div>
                {qHours > 0 && (
                  <>
                    <div style={{ height: 7, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${barPct}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width 0.4s" }} />
                    </div>
                    {barPct >= 80 && <div style={{ fontSize: 10, color: barColor, marginTop: 3 }}>{barPct >= 100 ? "⚠ Budget überschritten" : "⚠ Budget fast ausgeschöpft"}</div>}
                  </>
                )}
              </div>
            );
          })}

          {quoteRows.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingTop: 4 }}>
              <span style={{ color: "var(--text4)" }}>
                {hauptTotal > 0 && <span>Hauptofferte {hauptTotal.toFixed(1)}h</span>}
                {nachtragTotal > 0 && <span style={{ marginLeft: 8, color: "var(--info)" }}>+ Nachträge {nachtragTotal.toFixed(1)}h</span>}
              </span>
              <span style={{ fontWeight: 700, color: budgetColor }}>
                {totalHours.toFixed(1)}h / {budget}h — {budgetPct.toFixed(0)}%
                {budgetPct >= 100 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--negative)" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> überschritten</span>}
              </span>
            </div>
          )}
        </>
      )}

      {/* Fallback wenn kein linked quote aber manuelles Budget */}
      {quoteRows.length === 0 && budget > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: "var(--text4)" }}>Stunden</span>
            <span style={{ fontWeight: 700, color: budgetColor }}>{totalHours.toFixed(1)}h / {budget}h — {budgetPct.toFixed(0)}%</span>
          </div>
          <div style={{ height: 8, background: "var(--surface3)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(budgetPct, 100)}%`, height: "100%", background: budgetColor, borderRadius: 4 }} />
          </div>
        </div>
      )}
    </div>
  );
}
