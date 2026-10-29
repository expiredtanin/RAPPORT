// Dialog «Neue Rechnung»: Reiter Projekt / Offerte / Freie Rechnung mit Betragsvorschau.

import type React from "react";
import { formatCHF, localISODate, roundCHF } from "../../utils";
import type { AppData, Invoice, TimeEntry } from "../../types";
import type { NewInvoiceState } from "./invoiceHelpers";
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
  const todayStr = localISODate();
  const proj = ni.tab === "projekt" ? (data.projects || []).find(p => p.id === ni.projectId) : null;
  const bType = proj ? (proj.billingType || proj.type) : "";
  const q = ni.tab === "offerte" ? (data.quotes || []).find(x => x.id === ni.quoteId) : null;

  // Preview amount
  let previewAmt = 0;
  let previewKind = "";
  if (ni.tab === "projekt" && proj) {
    const projBudget = proj.budget || proj.budgetAmount || 0;
    if (ni.mode === "teilrechnung") {
      previewAmt = openEntriesForProject(proj.id).reduce((s, e) => s + e.minutes, 0) / 60 * (proj.hourlyRate || 0);
      previewKind = "teilrechnung";
    } else if (ni.mode === "teilrechnung-percent") {
      previewAmt = projBudget * (ni.pct / 100);
      previewKind = "teilrechnung";
    } else if (ni.mode === "teilrechnung-amount") {
      previewAmt = ni.amt;
      previewKind = "teilrechnung";
    } else if (ni.mode === "akonto-percent") {
      previewAmt = projBudget * (ni.pct / 100);
      previewKind = "akonto";
    } else if (ni.mode === "akonto-amount") {
      previewAmt = ni.amt;
      previewKind = "akonto";
    } else if (ni.mode === "akonto-stunden") {
      previewAmt = openEntriesForProject(proj.id).filter(e => (e.date || "") <= todayStr).reduce((s, e) => s + e.minutes, 0) / 60 * (proj.hourlyRate || 0);
      previewKind = "akonto";
    } else if (ni.mode === "phase") {
      const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
      previewAmt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
      previewKind = "teilrechnung";
    } else if (ni.mode === "akonto-phase") {
      const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
      previewAmt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
      previewKind = "akonto";
    } else {
      if (bType === "stundensatz") {
        previewAmt = data.timeEntries.filter(e => e.projectId === proj.id && !e.invoiceId && (e.date || "") <= todayStr).reduce((s, e) => s + e.minutes, 0) / 60 * (proj.hourlyRate || 0);
      } else {
        const akontoInvs = invoices.filter(i => i.projectId === proj.id && i.invoiceKind !== "schluss" && i.status !== "entwurf");
        const akontoTotal = akontoInvs.reduce((s, i) => s + (i.subAfterDisc ?? i.sub ?? 0), 0);
        previewAmt = Math.max(0, projBudget - akontoTotal);
      }
      previewKind = "schluss";
    }
  } else if (ni.tab === "offerte" && q) {
    const alreadyInv = (invoices).filter(i => i.quoteId === q.id || (q.projectId && i.projectId === q.projectId)).reduce((s, i) => s + (i.sub || 0), 0);
    const rem = Math.max(0, (q.sub || 0) - alreadyInv);
    if (ni.mode === "schluss") { previewAmt = rem; previewKind = "schluss"; }
    else if (ni.mode === "teilrechnung-percent") { previewAmt = (q.sub || 0) * (ni.pct / 100); previewKind = "teilrechnung"; }
    else if (ni.mode === "teilrechnung-amount") { previewAmt = ni.amt; previewKind = "teilrechnung"; }
    else if (ni.mode === "akonto-percent") { previewAmt = (q.sub || 0) * (ni.pct / 100); previewKind = "akonto"; }
    else { previewAmt = ni.amt; previewKind = "akonto"; }
  }
  const previewTax = data.settings.mwstRate ? previewAmt * (data.settings.mwstRate / 100) : 0;
  const previewTotal = roundCHF(previewAmt + previewTax);

  const canConfirm = ni.tab === "frei" || (ni.tab === "projekt" && ni.projectId) || (ni.tab === "offerte" && ni.quoteId);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, marginBottom: 16, fontSize: 22 }}>Neue Rechnung</h2>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 18, borderBottom: "1.5px solid var(--border)" }}>
          {[{ id: "projekt", label: "Projekt" }, { id: "offerte", label: "Offerte" }, { id: "frei", label: "Freie Rechnung" }].map(tab => (
            <button key={tab.id} onClick={() => setNi(n => ({ ...n, tab: tab.id, mode: tab.id === "offerte" ? "schluss" : "teilrechnung" }))} style={{
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}><span>Netto</span><span>{formatCHF(previewAmt)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}><span>MWST {data.settings.mwstRate}%</span><span>{formatCHF(previewTax)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 6, borderTop: "1px solid #d8d0c4", fontSize: 14, fontWeight: 700 }}><span>Total</span><span>{formatCHF(previewTotal)}</span></div>
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
