// Listenlogik der Rechnungsansicht (views/invoices/): Filtern, Sortieren, unverrechnete Stunden und Gruppierung.

import type { AppData, Invoice, Person, Project } from "../../types";

/** Filter der Rechnungsliste (leer = kein Filter). */
export type InvoiceFilter = { status: string; clientId: string; year: string; search: string };
/** Gruppe der Rechnungsliste (Monat, Kunde oder Status). */
export type InvoiceGroup = { key: string; label: string; items: Invoice[] };
/** Stundensatz-Projekt mit unverrechneten Minuten und dem entsprechenden Betrag. */
export type UnbilledProject = Project & { mins: number; amount: number };

/** Index id → Eintrag; bei doppelten IDs gewinnt wie bei `find` der erste. */
const indexById = <T extends { id: string }>(list: T[]) => {
  const m = new Map<string, T>();
  for (const x of list) if (!m.has(x.id)) m.set(x.id, x);
  return m;
};

/** Filtert die Rechnungen nach `filter` und sortiert sie nach `sort`. */
export const filterAndSortInvoices = (invoices: Invoice[], clients: Person[], filter: InvoiceFilter, sort: { col: string; dir: number }) => {
  // Kontakt-Index (der erste Treffer gilt wie bei find): bei 3000 Rechnungen × 5000 Kontakten sonst Millionen Vergleiche je Tastendruck
  const clientById = indexById(clients);
  const matchesFilter = (inv: Invoice) => {
    if (filter.status && inv.status !== filter.status) return false;
    if (filter.clientId && inv.clientId !== filter.clientId) return false;
    if (filter.year && !(inv.date || "").startsWith(filter.year)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const client = clientById.get(inv.clientId);
      const haystack = [
        inv.number,
        client?.name,
        client?.company,
        inv.notes,
        ...(inv.items || []).map(it => it.desc)
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  };

  const filtered = [...invoices].filter(matchesFilter).sort((a, b) => {
    let va, vb;
    if (sort.col === "number") { va = a.number || ""; vb = b.number || ""; }
    else if (sort.col === "date") { va = a.date || ""; vb = b.date || ""; }
    else if (sort.col === "dueDate") { va = a.dueDate || ""; vb = b.dueDate || ""; }
    else if (sort.col === "client") { va = clientById.get(a.clientId)?.name || ""; vb = clientById.get(b.clientId)?.name || ""; }
    else if (sort.col === "total") { va = a.total || 0; vb = b.total || 0; }
    else if (sort.col === "status") { va = a.status || ""; vb = b.status || ""; }
    else { va = a.date || ""; vb = b.date || ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });
  return filtered;
};

/** Unverrechnete Stunden über alle aktiven Stundensatz-Projekte (global), absteigend nach Minuten. */
export const summarizeUnbilled = (data: AppData) => {
  const unbilled = new Map<string, number>();   // ein Durchlauf statt einer je Projekt
  for (const e of data.timeEntries) if (e.projectId && !e.invoiceId) unbilled.set(e.projectId, (unbilled.get(e.projectId) || 0) + (e.minutes || 0));
  const unbilledProjects = data.projects
    .filter(p => (p.billingType || p.type) === "stundensatz" && p.status === "aktiv")
    .map(p => {
      const mins = unbilled.get(p.id) || 0;
      const amount = (mins / 60) * (p.hourlyRate || 0);
      return { ...p, mins, amount };
    })
    .filter(p => p.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const totalUnbilledMins = unbilledProjects.reduce((s, p) => s + p.mins, 0);
  const totalUnbilledAmount = unbilledProjects.reduce((s, p) => s + p.amount, 0);
  return { unbilledProjects, totalUnbilledMins, totalUnbilledAmount };
};

/** Gruppiert die gefilterten Rechnungen nach Monat, Kunde oder Status (`none` = eine Gruppe). */
export const groupInvoices = (filtered: Invoice[], groupBy: string, clients: Person[]): InvoiceGroup[] => {
  if (groupBy === "date") {
    const months: Record<string, Invoice[]> = Object.create(null);
    filtered.forEach(inv => {
      const key = (inv.date || "").slice(0, 7);
      if (!months[key]) months[key] = [];
      months[key].push(inv);
    });
    return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => ({
      key, label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum", items,
    }));
  }
  if (groupBy === "client") {
    const groups: Record<string, { label: string; items: Invoice[] }> = Object.create(null);
    const clientById = indexById(clients);
    filtered.forEach(inv => {
      const cl = clientById.get(inv.clientId);
      const key = inv.clientId || "__none__";
      const label = cl?.name || "Kein Kunde";
      if (!groups[key]) groups[key] = { label, items: [] };
      groups[key].items.push(inv);
    });
    return Object.entries(groups).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, val]) => ({ key, label: val.label, items: val.items }));
  }
  if (groupBy === "status") {
    const statuses: Record<string, Invoice[]> = Object.create(null);
    filtered.forEach(inv => {
      const key = inv.status || "unbekannt";
      if (!statuses[key]) statuses[key] = [];
      statuses[key].push(inv);
    });
    return Object.entries(statuses).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), items }));
  }
  return [{ key: "all", label: "", items: filtered }];
};
