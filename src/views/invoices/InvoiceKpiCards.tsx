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
    <div className="responsive-grid-4 kpi-band" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
      <KpiCard label="Bezahlt" value={formatCHF(filteredPaid)} color="var(--positive)"
        sub={`${filtered.filter(i => i.status === "bezahlt").length} ${filtered.filter(i => i.status === "bezahlt").length === 1 ? "Rechnung" : "Rechnungen"}`} />
      <KpiCard label="Ausstehend" value={formatCHF(filteredOpen)} color={filteredOverdue > 0 ? "var(--negative)" : "var(--warning)"}
        sub={filteredOverdue > 0 ? <span style={{ color: "var(--negative)" }}>davon {formatCHF(filteredOverdue)} überfällig</span> : `${filtered.filter(i => i.status === "gesendet" || i.status === "überfällig").length} gesendet`} />
      <KpiCard label="Unverrechnete Stunden" value={formatHours(totalUnbilledMins)} color={totalUnbilledMins > 0 ? "var(--warning)" : "var(--positive)"}
        sub={totalUnbilledAmount > 0 ? `≈ ${formatCHF(totalUnbilledAmount)}` : "alles verrechnet"} />
      <div className="card kpi exp-cats">
        <div className="kpi-label">Projekte mit offenen Stunden</div>
        {unbilledProjects.length === 0 && <div className="kpi-sub">Keine offenen Stunden</div>}
        {unbilledProjects.slice(0, 3).map(p => (
          <div key={p.id} className="exp-cat" title={`${p.name}: ${formatHours(p.mins)}`}>
            <span>{p.name}</span><i className="num">{formatHours(p.mins)}</i>
            <b style={{ width: `${Math.max(4, (p.mins / unbilledProjects[0].mins) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
