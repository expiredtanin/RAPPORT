// Tabelle der Rechnungsliste: gruppierte Zeilen mit Status, Mahnung, Teilen/Drucken, Bearbeiten und Löschen.

import React from "react";
import { formatCHF, formatDate } from "../../utils";
import { StatusSelect, ShareButton, SortTh } from "../../components/UI";
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
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead><tr><SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 100 }}>Nr.</SortTh><SortTh sort={sort} onSort={toggleSort} col="client">Kunde</SortTh><th>Art</th><SortTh sort={sort} onSort={toggleSort} col="date">Datum</SortTh><SortTh sort={sort} onSort={toggleSort} col="dueDate">Fällig</SortTh><SortTh sort={sort} onSort={toggleSort} col="total" style={{ textAlign: "right" }}>Betrag</SortTh><SortTh sort={sort} onSort={toggleSort} col="status">Status</SortTh><th></th></tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={9} className="empty-state">{invoiceCount === 0 ? "Noch keine Rechnungen" : "Keine Treffer"}</td></tr>}
          {groupedInvoices.map(group => (
            <React.Fragment key={group.key}>
              {groupBy !== "none" && group.label && (
                <tr>
                  <td colSpan={9} style={{ background: "var(--surface3)", padding: "6px 12px", fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", fontWeight: 600, textTransform: "uppercase", borderTop: "1px solid var(--border)" }}>
                    {group.label}
                    <span style={{ float: "right", fontWeight: 400, letterSpacing: 0, textTransform: "none", fontSize: 11, color: "var(--text5)" }}>
                      {group.items.length} · {formatCHF(group.items.reduce((s, i) => s + (i.total || 0), 0))}
                    </span>
                  </td>
                </tr>
              )}
          {group.items.map(inv => {
            const client = clients.find(c => c.id === inv.clientId);
            const kindLabel = inv.invoiceKind === "akonto" ? "Akonto" : inv.invoiceKind === "teilrechnung" ? "Teilrechnung" : inv.invoiceKind === "schluss" ? "Schluss" : inv.invoiceKind === "voll" ? "Vollrechnung" : "—";
            const kindColor = inv.invoiceKind === "akonto" ? "var(--pending)" : inv.invoiceKind === "teilrechnung" ? "#2d5a8e" : inv.invoiceKind === "schluss" ? "var(--info)" : "transparent";
            return (
              <tr key={inv.id}>
                <td>
                  <strong>{inv.number}</strong>
                  {(inv.reminders || []).length > 0 && (
                    <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 2 }}>
                      {(inv.reminders || []).length === 1 ? "Erinnerung" : `${(inv.reminders || []).length}× Mahnung`} · {formatDate((inv.reminders || []).at(-1)?.date)}
                    </div>
                  )}
                </td>
                <td>{client?.name || "—"}</td>
                <td>
                  {inv.invoiceKind && inv.invoiceKind !== "voll"
                    ? <span className="tag" style={{ background: kindColor, fontSize: 10 }}>{kindLabel}</span>
                    : <span style={{ fontSize: 11, color: "var(--text5)" }}>—</span>}
                </td>
                <td>{formatDate(inv.date)}</td>
                <td>{formatDate(inv.dueDate)}</td>
                <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
                <td>
                  <StatusSelect value={inv.status} options={["entwurf", "gesendet", "bezahlt", "überfällig"]} onChange={v => setStatus(inv.id, v)} />
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {inv.status === "überfällig" && (
                    <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12, borderColor: (inv.reminders||[]).length >= 2 ? "var(--negative)" : "var(--warning)", color: (inv.reminders||[]).length >= 2 ? "var(--negative)" : "var(--warning)" }}
                      onClick={() => openMahnung(inv)}>
                      ✉ {(inv.reminders||[]).length === 0 ? "Mahnung" : `${(inv.reminders||[]).length + 1}. Mahnung`}
                    </button>
                  )}
                  <ShareButton style={{ marginRight: 6, padding: "5px 10px", fontSize: 12 }} options={[
                    { label: "Rechnung + QR", onClick: () => setPrintContent({ type: "invoice+qr", inv, client }) },
                    { label: "Nur Rechnung", onClick: () => setPrintContent({ type: "invoice", inv, client }) },
                    { label: "Nur QR", onClick: () => setPrintContent({ type: "qrbill", inv, client }) },
                  ]} />
                  <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12 }} onClick={() => openEdit(inv)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                  <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(inv.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
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
