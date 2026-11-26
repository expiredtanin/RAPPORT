// Tabelle der Rechnungsliste: gruppierte Zeilen mit Status und Mahnung; Klick auf die Zeile öffnet die Rechnung,
// PDF und Löschen liegen im Zeilenmenü (⋯).

import React, { useMemo } from "react";
import { formatCHF, formatDate } from "../../utils";
import { StatusSelect, SortTh, RowMenu } from "../../components/UI";
import type { SortState } from "../../components/UI";
import type { Invoice, Person, ViewProps } from "../../types";
import type { InvoiceGroup } from "./invoiceList";

/** Rechnungstabelle mit sortierbaren Spalten und Gruppenköpfen; Aktionen kommen als Callbacks von Invoices.tsx. */
export function InvoiceTable({ filtered, groupedInvoices, groupBy, sort, toggleSort, invoiceCount, clients, openMahnung, setStatus, openEdit, del, setPrintContent }: Pick<ViewProps, "setPrintContent"> & {
  filtered: Invoice[];
  groupedInvoices: InvoiceGroup[];
  groupBy: string;
  sort: SortState;
  toggleSort: (col: string) => void;
  invoiceCount: number;
  clients: Person[];
  openMahnung: (inv: Invoice) => void;
  setStatus: (id: string, status: string) => void;
  openEdit: (inv: Invoice) => void;
  del: (id: string) => void | Promise<void>;
}) {
  const clientById = useMemo(() => { const m = new Map<string, Person>(); for (const c of clients) if (!m.has(c.id)) m.set(c.id, c); return m; }, [clients]);
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead><tr><SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 100 }}>Nr.</SortTh><SortTh sort={sort} onSort={toggleSort} col="client">Kunde</SortTh><th className="hide-mid">Art</th><SortTh sort={sort} onSort={toggleSort} col="date">Datum</SortTh><SortTh sort={sort} onSort={toggleSort} col="dueDate" className="hide-narrow">Fällig</SortTh><SortTh sort={sort} onSort={toggleSort} col="total" style={{ textAlign: "right" }}>Betrag</SortTh><SortTh sort={sort} onSort={toggleSort} col="status">Status</SortTh><th></th></tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={9} className="empty-state">{invoiceCount === 0 ? "Noch keine Rechnungen" : "Keine Treffer"}</td></tr>}
          {groupedInvoices.map(group => (
            <React.Fragment key={group.key}>
              {groupBy !== "none" && group.label && (
                <tr>
                  <td colSpan={9} className="group-row">
                    {group.label}
                    <span className="group-sum">
                      {group.items.length} · {formatCHF(group.items.reduce((s, i) => s + (i.total || 0), 0))}
                    </span>
                  </td>
                </tr>
              )}
          {group.items.map(inv => {
            const client = clientById.get(inv.clientId);
            const kindLabel = inv.invoiceKind === "akonto" ? "Akonto" : inv.invoiceKind === "teilrechnung" ? "Teilrechnung" : inv.invoiceKind === "schluss" ? "Schluss" : inv.invoiceKind === "voll" ? "Vollrechnung" : "—";
            return (
              <tr key={inv.id} className="row-link" onClick={() => openEdit(inv)}>
                <td>
                  <strong style={{ whiteSpace: "nowrap" }}>{inv.number}</strong>
                  {(inv.reminders || []).length > 0 && (
                    <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 2 }}>
                      {(inv.reminders || []).length === 1 ? "Erinnerung" : `${(inv.reminders || []).length}× Mahnung`} · {formatDate((inv.reminders || []).at(-1)?.date)}
                    </div>
                  )}
                </td>
                <td>{client?.name || "—"}</td>
                <td className="hide-mid">
                  {inv.invoiceKind && inv.invoiceKind !== "voll"
                    ? <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{kindLabel}</span>
                    : <span style={{ fontSize: 12, color: "var(--text5)" }}>—</span>}
                </td>
                <td>{formatDate(inv.date)}</td>
                <td className="hide-narrow">{formatDate(inv.dueDate)}</td>
                <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
                <td>
                  <StatusSelect value={inv.status} options={["entwurf", "gesendet", "bezahlt", "überfällig"]} onChange={v => setStatus(inv.id, v)} />
                </td>
                <td className="row-actions" onClick={e => e.stopPropagation()}>
                  {inv.status === "überfällig" && (
                    <button className="btn btn-ghost btn-sm" style={{ marginRight: 4, borderColor: (inv.reminders||[]).length >= 2 ? "var(--negative)" : "var(--warning)", color: (inv.reminders||[]).length >= 2 ? "var(--negative)" : "var(--warning)" }}
                      onClick={() => openMahnung(inv)}>
                      {(inv.reminders||[]).length === 0 ? "Mahnen" : `${(inv.reminders||[]).length + 1}. Mahnung`}
                    </button>
                  )}
                  <RowMenu items={[
                    { label: "Bearbeiten", icon: "edit", onClick: () => openEdit(inv) },
                    { label: "PDF: Rechnung + QR", icon: "picture_as_pdf", onClick: () => setPrintContent({ type: "invoice+qr", inv, client }) },
                    { label: "PDF: nur Rechnung", icon: "description", onClick: () => setPrintContent({ type: "invoice", inv, client }) },
                    { label: "PDF: nur QR-Teil", icon: "qr_code_2", onClick: () => setPrintContent({ type: "qrbill", inv, client }) },
                    { label: "Löschen", icon: "delete", danger: true, onClick: () => del(inv.id) },
                  ]} />
                </td>
              </tr>
            );
          })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
