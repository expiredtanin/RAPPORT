// Dialog «Neue Rechnung»: Reiter Projekt / Offerte / Freie Rechnung, rechts die Live-PDF-Vorschau der Rechnung,
// die «Weiter» erzeugt (gleiches Layout wie der Rechnungseditor: fester Kopf/Fuss, Vorschau ein-/ausblendbar).

import type React from "react";
import { formatCHF } from "../../utils";
import { Modal } from "../../components/UI";
import LivePreview from "../../components/LivePreview";
import type { AppData, Invoice, TimeEntry } from "../../types";
import { calcTotal, defaultInvoiceMode, invoiceBillingSummary, nextInvoiceNumber } from "./invoiceHelpers";
import type { NewInvoiceState } from "./invoiceHelpers";
import { buildNewInvoiceForm } from "./newInvoiceForm";
import { NewInvoiceProjectPane } from "./NewInvoiceProjectPane";
import { NewInvoiceQuotePane } from "./NewInvoiceQuotePane";

const KIND_LABEL: Record<string, string> = { akonto: "Akontorechnung", teilrechnung: "Teilrechnung", schluss: "Schlussrechnung" };

/** Platzhalter in der Vorschau-Spalte, solange es nichts zu zeigen gibt. */
const PreviewHint = ({ text }: { text: string }) => (
  <div style={{ alignSelf: "center", maxWidth: 280, textAlign: "center", fontSize: 12.5, color: "var(--text4)", lineHeight: 1.5 }}>
    <span className="msr" style={{ fontSize: 32, display: "block", marginBottom: 8, color: "var(--text5)" }}>description</span>
    {text}
  </div>
);

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
  // Vorschau aus genau dem Formular, das «Weiter» erzeugt (gleiche Nummer, Positionen, Abzüge und MWST)
  const number = nextInvoiceNumber(invoices, data.settings.invoiceNumberFormat);
  const previewForm = ni.tab !== "frei" && (proj || q) ? buildNewInvoiceForm(ni, data, invoices, number, openEntriesForProject)?.form : null;
  const previewRate = previewForm?.mwstRate ?? data.settings.mwstRate;
  const preview = previewForm ? calcTotal(previewForm.items, previewForm.mwst, previewRate, previewForm.discountType, previewForm.discountValue, !!data.settings.rechnungRunden5) : null;
  // Teil-/Akontorechnung nach SIA-Phase braucht eine gewählte Phase, sonst entstünde eine Rechnung über 0
  const needsPhase = ni.tab === "projekt" && (ni.mode === "phase" || ni.mode === "akonto-phase") && !ni.phaseId;
  const canConfirm = ni.tab === "frei" || (ni.tab === "projekt" && !!ni.projectId && !needsPhase) || (ni.tab === "offerte" && !!ni.quoteId);

  // Abrechnungsblock (Akonto/Teilrechnung) wie im Editor und im Druck
  const withSummary = (inv: Invoice): Invoice => ({ ...inv, billingSummary: invoiceBillingSummary(inv, { ...data, invoices }) });
  const previewPane = previewForm && preview
    ? <LivePreview settings={data.settings} assets={data.docAssets} content={{ type: "invoice", inv: withSummary({ ...previewForm, ...preview, mwstRate: previewRate } as Invoice), client: (data.persons || []).find(c => c.id === previewForm.clientId) }} />
    : <PreviewHint text={ni.tab === "frei" ? "Leeres Formular — Positionen und Vorschau im nächsten Schritt." : ni.tab === "offerte" ? "Offerte wählen — hier erscheint die Rechnung, wie sie gedruckt wird." : "Projekt wählen — hier erscheint die Rechnung, wie sie gedruckt wird."} />;

  // Summen im Fuss (wie im Editor): auch bei ausgeblendeter Vorschau sichtbar, ohne die Zahlen des PDFs zu doppeln
  const footerStart = previewForm && preview ? (
    <div className="num" style={{ lineHeight: 1.3, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {KIND_LABEL[previewForm.invoiceKind || ""] || "Rechnung"} · Netto {formatCHF(preview.subAfterDisc)}{previewForm.mwst !== false ? ` · MWST ${previewRate} %` : " · ohne MWST"}
      </div>
      <div style={{ fontSize: 13, color: "var(--text3)", whiteSpace: "nowrap" }}>Total <b style={{ color: "var(--text)", fontSize: 15 }}>{formatCHF(preview.total)}</b></div>
    </div>
  ) : null;

  return (
    <Modal title="Neue Rechnung" wide confirmClose={false} onClose={onClose} onSave={onConfirm} saveDisabled={!canConfirm}
      saveLabel={ni.tab === "frei" ? "Leere Rechnung erstellen" : "Weiter →"} preview={previewPane} footerStart={footerStart}>
      {/* Reiter */}
      <div role="tablist" style={{ display: "flex", gap: 0, marginBottom: 18, borderBottom: "1.5px solid var(--border)" }}>
        {[{ id: "projekt", label: "Projekt" }, { id: "offerte", label: "Offerte" }, { id: "frei", label: "Freie Rechnung" }].map(tab => (
          <button key={tab.id} role="tab" aria-selected={ni.tab === tab.id} onClick={() => setNi(n => ({ ...n, tab: tab.id, mode: tab.id === "offerte" ? "schluss" : defaultInvoiceMode((data.projects || []).find(p => p.id === n.projectId)) }))} style={{
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
        <NewInvoiceProjectPane ni={ni} setNi={setNi} data={data} invoices={invoices} proj={proj} bType={bType} thisNet={preview?.subAfterDisc ?? 0} />
      )}

      {ni.tab === "offerte" && (
        <NewInvoiceQuotePane ni={ni} setNi={setNi} data={data} invoices={invoices} q={q} />
      )}

      {needsPhase && proj && (
        <div style={{ fontSize: 11.5, color: "var(--text4)", marginTop: 4 }}>Phase wählen, um fortzufahren.</div>
      )}
      {previewForm && (
        <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 14 }}>Entwurf Nr. {number} — Positionen, Kunde und Texte im nächsten Schritt editierbar.</div>
      )}
    </Modal>
  );
}
