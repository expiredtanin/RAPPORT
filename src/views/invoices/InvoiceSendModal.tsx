// Kleiner Dialog nach dem Speichern einer neuen Rechnung: als versendet markieren, drucken oder Entwurf lassen.

import { localISODate } from "../../utils";
import type { Invoice, Person, ViewProps } from "../../types";

/** Versand-Dialog einer Rechnung (setzt Status «gesendet» + `sentDate` oder lässt sie als Entwurf). */
export function InvoiceSendModal({ invoice, invoices, clients, update, setPrintContent, freeze, onClose }: Pick<ViewProps, "update" | "setPrintContent"> & {
  invoice: Invoice;
  invoices: Invoice[];
  clients: Person[];
  /** neuer Status; hält beim Versand den Abrechnungsblock fest (`freezeOnStatus`) */
  freeze: (inv: Invoice, status: string) => Invoice;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 360 }}>
        <h2 style={{ fontFamily: "var(--font-ui)", fontWeight: 400, fontSize: 18, marginBottom: 16 }}>Rechnung {invoice.number}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => {
            update("invoices", invoices.map(i => i.id === invoice.id ? { ...freeze(i, "gesendet"), sentDate: localISODate() } : i));
            onClose();
          }}>Als versendet markieren</button>
          <button className="btn btn-ghost" onClick={() => {
            update("invoices", invoices.map(i => i.id === invoice.id ? { ...freeze(i, "gesendet"), sentDate: localISODate() } : i));
            onClose();
            setPrintContent({ type: "invoice+qr", inv: invoice, client: clients.find(c => c.id === invoice.clientId) });
          }}>Versendet + PDF drucken</button>
          <button className="btn btn-ghost" onClick={() => {
            update("invoices", invoices.map(i => i.id === invoice.id ? { ...i, status: "entwurf" } : i));
            onClose();
          }}>Als Entwurf speichern</button>
          <button className="btn btn-ghost" style={{ border: "none", boxShadow: "none" }} onClick={() => onClose()}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
