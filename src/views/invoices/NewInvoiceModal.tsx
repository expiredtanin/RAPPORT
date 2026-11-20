// Dialog «Neue Rechnung»: Reiter Projekt / Offerte / Freie Rechnung mit Betragsvorschau.

import type React from "react";
import { formatCHF } from "../../utils";
import type { AppData, Invoice, TimeEntry } from "../../types";
import { calcTotal, defaultInvoiceMode } from "./invoiceHelpers";
import type { NewInvoiceState } from "./invoiceHelpers";
import { buildNewInvoiceForm } from "./newInvoiceForm";
import { NewInvoiceProjectPane } from "./NewInvoiceProjectPane";
import { NewInvoiceQuotePane } from "./NewInvoiceQuotePane";

/** Auswahldialog für eine neue Rechnung; «Weiter» ruft `onConfirm`, das das Formular vorbefüllt. */
export function NewInvoiceModal({ ni, setNi, data, invoices, openEntriesForProject, onClose, onConfirm }: {
  ni: NewInvoiceState;
  setNi: React.Dispatch<React.SetStateAction<NewInvoiceState>>;
  data: AppData;
  invoices: Invoice[];
  openEntriesForProject: (projectId?: string) => TimeEntry[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const proj = ni.tab === "projekt" ? (data.projects || []).find(p => p.id === ni.projectId) : null;
  const bType = proj ? (proj.billingType || proj.type) : "";
  const q = ni.tab === "offerte" ? (data.quotes || []).find(x => x.id === ni.quoteId) : null;
  // Vorschau aus genau dem Formular, das «Weiter» erzeugt (gleiche Positionen, Abzüge und MWST)
  const previewForm = ni.tab !== "frei" && (proj || q) ? buildNewInvoiceForm(ni, data, invoices, "", openEntriesForProject)?.form : null;
  const preview = previewForm ? calcTotal(previewForm.items, previewForm.mwst, previewForm.mwstRate ?? data.settings.mwstRate, previewForm.discountType, previewForm.discountValue) : null;
  const previewKind = previewForm?.invoiceKind || "";
  const previewRate = previewForm?.mwstRate ?? data.settings.mwstRate;
  const canConfirm = ni.tab === "frei" || (ni.tab === "projekt" && ni.projectId) || (ni.tab === "offerte" && ni.quoteId);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2 style={{ fontFamily: "var(--font-ui)", fontWeight: 400, marginBottom: 16, fontSize: 22 }}>Neue Rechnung</h2>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 18, borderBottom: "1.5px solid var(--border)" }}>
          {[{ id: "projekt", label: "Projekt" }, { id: "offerte", label: "Offerte" }, { id: "frei", label: "Freie Rechnung" }].map(tab => (
            <button key={tab.id} onClick={() => setNi(n => ({ ...n, tab: tab.id, mode: tab.id === "offerte" ? "schluss" : defaultInvoiceMode((data.projects || []).find(p => p.id === n.projectId)) }))} style={{
              padding: "9px 18px", background: "transparent", border: "none", fontFamily: "inherit",
              borderBottom: ni.tab === tab.id ? "2px solid var(--text)" : "2px solid transparent",
              marginBottom: -1.5, color: ni.tab === tab.id ? "var(--text)" : "var(--text4)",
              fontSize: 12, fontWeight: 500, cursor: "pointer",
            }}>{tab.label}</button>
          ))}
        </div>

        {ni.tab === "frei" && (
          <p style={{ fontSize: 12, color: "var(--text4)", marginBottom: 16 }}>Leeres Formular — Positionen manuell erfassen.</p>
        )}

        {ni.tab === "projekt" && (
          <NewInvoiceProjectPane ni={ni} setNi={setNi} data={data} invoices={invoices} proj={proj} bType={bType} />
        )}

        {ni.tab === "offerte" && (
          <NewInvoiceQuotePane ni={ni} setNi={setNi} data={data} invoices={invoices} q={q} />
        )}

        {/* Preview */}
        {ni.tab !== "frei" && (proj || q) && (
          <div style={{ padding: "12px 14px", background: "var(--surface3)", borderRadius: 6, marginTop: 14, marginBottom: 6 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 8 }}>VORSCHAU</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}><span>Netto</span><span>{formatCHF(preview?.subAfterDisc)}</span></div>
            {previewForm?.mwst !== false && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}><span>MWST {previewRate}%</span><span>{formatCHF(preview?.tax)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 6, borderTop: "1px solid #d8d0c4", fontSize: 14, fontWeight: 700 }}><span>Total</span><span>{formatCHF(preview?.total)}</span></div>
            <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 6 }}>{previewKind === "schluss" ? "Schlussrechnung" : previewKind === "teilrechnung" ? "Teilrechnung" : "Akontorechnung"} · Entwurf — im nächsten Schritt editierbar</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={() => onClose()}>Abbrechen</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={!canConfirm} style={{ opacity: canConfirm ? 1 : 0.4 }}>
            {ni.tab === "frei" ? "Leere Rechnung erstellen" : "Weiter →"}
          </button>
        </div>
      </div>
    </div>
  );
}
