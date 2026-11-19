// Kopfzeile der Rechnungsliste: vier Kennzahlen-Kacheln (bezahlt, ausstehend, unverrechnete Stunden, Projekte mit Pendenzen).

import { formatCHF, formatHours } from "../../utils";
import { KpiCard } from "../../components/UI";
import type { Invoice } from "../../types";
import type { UnbilledProject } from "./invoiceList";

/** KPI-Kacheln über der Rechnungsliste (Summen der gefilterten Rechnungen und unverrechnete Stunden). */
export function InvoiceKpiCards({ filtered, filteredPaid, filteredOpen, filteredOverdue, unbilledProjects, totalUnbilledMins, totalUnbilledAmount }: {
  filtered: Invoice[];
  filteredPaid: number;
  filteredOpen: number;
  filteredOverdue: number;
  unbilledProjects: UnbilledProject[];
  totalUnbilledMins: number;
  totalUnbilledAmount: number;
}) {
  return (
    <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
      <KpiCard label="Bezahlt" value={formatCHF(filteredPaid)} color="var(--positive)"
        sub={`${filtered.filter(i => i.status === "bezahlt").length} Rechnung(en)`} />
      <KpiCard label="Ausstehend" value={formatCHF(filteredOpen)} color={filteredOverdue > 0 ? "var(--negative)" : "var(--warning)"}
        sub={filteredOverdue > 0 ? <span style={{ color: "var(--negative)" }}>davon {formatCHF(filteredOverdue)} überfällig</span> : `${filtered.filter(i => i.status === "gesendet" || i.status === "überfällig").length} Rechnung(en)`} />
      <KpiCard label="Unverrechnete Stunden" value={formatHours(totalUnbilledMins)} color={totalUnbilledMins > 0 ? "var(--warning)" : "var(--positive)"}
        sub={totalUnbilledAmount > 0 ? `≈ ${formatCHF(totalUnbilledAmount)}` : "Alle verrechnet ✓"} />
      <div className="card kpi">
        <div className="kpi-label">Projekte mit offenen Stunden</div>
        {unbilledProjects.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text5)", marginTop: 4 }}>Keine offenen Stunden</div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>{unbilledProjects.length} Projekt{unbilledProjects.length !== 1 ? "e" : ""}</div>
            {unbilledProjects.slice(0, 4).map(p => (
              <div key={p.id} style={{ marginBottom: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text4)", marginBottom: 2 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{p.name}</span>
                  <span style={{ flexShrink: 0 }}>{formatHours(p.mins)}</span>
                </div>
                <div style={{ height: 3, background: "var(--border2)", borderRadius: 2 }}>
                  <div style={{ width: `${(p.mins / unbilledProjects[0].mins) * 100}%`, height: "100%", background: "var(--warning)", borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
