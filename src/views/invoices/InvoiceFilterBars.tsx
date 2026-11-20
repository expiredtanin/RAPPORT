// Filter- und Gruppierungsleiste der Rechnungsliste (Suche, Status, Kunde, Jahr, Gruppieren, Trefferzahl).

import { formatCHF } from "../../utils";
import { TableToolbar } from "../../components/UI";
import type { Invoice, Person } from "../../types";
import type { InvoiceFilter } from "./invoiceList";

/** Zwei Leisten über der Tabelle: Filter und Gruppierung samt Trefferzahl. */
export function InvoiceFilterBars({ filter, setFilter, clients, availableYears, groupBy, setGroupBy, filtered, filteredTotal, filteredOpen }: {
  filter: InvoiceFilter;
  setFilter: (f: InvoiceFilter) => void;
  clients: Person[];
  availableYears: string[];
  groupBy: string;
  setGroupBy: (g: string) => void;
  filtered: Invoice[];
  filteredTotal: number;
  filteredOpen: number;
}) {
  return (
    <>
      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Nr., Kunde, Beschreibung…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        <select className="pill" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Alle Status</option>
          {["entwurf", "gesendet", "bezahlt", "überfällig"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="pill" value={filter.clientId} onChange={e => setFilter({ ...filter, clientId: e.target.value })}>
          <option value="">Alle Kunden</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="pill" value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}>
          <option value="">Alle Jahre</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {(filter.status || filter.clientId || filter.year || filter.search) && (
          <button className="btn btn-ghost" onClick={() => setFilter({ status: "", clientId: "", year: "", search: "" })} style={{ fontSize: 12 }}>Zurücksetzen</button>
        )}
      </div>

      <TableToolbar detached
        summary={<><b className="num">{filtered.length}</b> {filtered.length === 1 ? "Rechnung" : "Rechnungen"} · <span className="num">{formatCHF(filteredTotal)}</span>{filteredOpen > 0 && <>, davon offen <span className="num" style={{ color: "var(--warning)" }}>{formatCHF(filteredOpen)}</span></>}</>}
        groups={[{ id: "none", label: "Keine" }, { id: "date", label: "Monat" }, { id: "client", label: "Kunde" }, { id: "status", label: "Status" }]}
        value={groupBy} onChange={setGroupBy} />
    </>
  );
}
