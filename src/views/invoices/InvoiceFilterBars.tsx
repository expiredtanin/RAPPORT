// Filter- und Gruppierungsleiste der Rechnungsliste (Suche, Status, Kunde, Jahr, Gruppieren, Trefferzahl).

import { formatCHF } from "../../utils";
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
        <input className="pill" placeholder="Suche (Nr., Kunde, Beschreibung…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 220 }} />
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

      <div className="filter-bar">
        <span className="filter-label">GRUPPIEREN:</span>
        {[{ id: "none", label: "Keine" }, { id: "date", label: "Monat" }, { id: "client", label: "Kunde" }, { id: "status", label: "Status" }].map(g => (
          <button key={g.id} className={`pill${groupBy === g.id ? " active" : ""}`} onClick={() => setGroupBy(g.id)}>{g.label}</button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)", textAlign: "right" }}>
          <div><strong style={{ color: "var(--text)" }}>{filtered.length}</strong> {filtered.length === 1 ? "Rechnung" : "Rechnungen"} · {formatCHF(filteredTotal)}</div>
          {filteredOpen > 0 && <div style={{ color: "var(--warning)" }}>davon offen: {formatCHF(filteredOpen)}</div>}
        </div>
      </div>
    </>
  );
}
