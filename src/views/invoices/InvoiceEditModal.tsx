// Dialog «Rechnung bearbeiten / Neue Rechnung»: Kopfdaten, Zeiteinträge, Positionen (Beschreibung mehrzeilig),
// Rabatt (erst auf «+ Rabatt» eingeblendet), MWST und Bemerkungen. Summen stehen nur im Fuss und in der
// Live-Vorschau (mit dem Abrechnungsblock einer Akonto-/Teilrechnung, `invoiceBillingSummary`).

import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatCHF, formatHours } from "../../utils";
import { Modal, FormField, DateInput } from "../../components/UI";
import LivePreview from "../../components/LivePreview";
import type { AppData, Invoice, InvoiceItem, ModalState, Person, TimeEntry } from "../../types";
import { calcLineTotal, calcTotal, invoiceBillingSummary, nextInvoiceNumber } from "./invoiceHelpers";
import type { EntrySelections, InvoiceForm } from "./invoiceHelpers";
import { TimeEntriesPicker } from "./TimeEntriesPicker";

/** Spalten einer Positionszeile: Beschreibung wächst, Zahlenfelder fest und breit genug für 6-stellige Beträge. */
const ITEM_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 64px 112px 62px 104px 28px", gap: 8 };
/** Zahlenfeld: rechtsbündig, schmaler Innenabstand, damit Beträge wie 185550.50 ganz sichtbar bleiben. */
const NUM_INPUT: React.CSSProperties = { textAlign: "right", padding: "8px 6px 8px 8px" };

/** Mehrzeilige Beschreibung: wächst mit dem Text (lange Positionstexte bleiben ganz sichtbar). */
function GrowingTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} aria-label="Beschreibung" placeholder={placeholder} value={value || ""} onChange={e => onChange(e.target.value)}
      style={{ resize: "none", overflow: "hidden", minHeight: 36, padding: "8px 10px", lineHeight: 1.4 }} />
  );
}

/** Formular-Dialog einer Rechnung; der Zustand (`form`) und alle Änderungen liegen in Invoices.tsx. */
export function InvoiceEditModal({ modal, setModal, form, setForm, data, clients, editingId, save, openEntriesForProject, prefillFromProject, toggleEntrySelection, setSelections, updateBilledMinutes, addItem, removeItem, updateItem }: {
  modal: NonNullable<ModalState>;
  setModal: (modal: ModalState) => void;
  form: InvoiceForm;
  setForm: React.Dispatch<React.SetStateAction<InvoiceForm>>;
  data: AppData;
  clients: Person[];
  editingId: string | null;
  save: (statusOverride?: string) => void;
  openEntriesForProject: (projectId?: string) => TimeEntry[];
  prefillFromProject: (projectId: string) => void;
  toggleEntrySelection: (entryId: string, entry: TimeEntry) => void;
  setSelections: (entrySelections: EntrySelections) => void;
  updateBilledMinutes: (entryId: string, minutes: number) => void;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, key: keyof InvoiceItem, val: unknown) => void;
}) {
  const { sub, globalDisc, subAfterDisc, tax, total } = calcTotal(form.items, form.mwst, form.mwstRate ?? data.settings.mwstRate, form.discountType, form.discountValue);
  const rate = form.mwstRate ?? data.settings.mwstRate;
  const [discountOpen, setDiscountOpen] = useState(false);
  const showDiscount = discountOpen || (!!form.discountType && form.discountType !== "none");
  // Vorschau mit dem Abrechnungsblock, wie er beim Speichern festgehalten wird
  const previewInv = { ...form, id: editingId || undefined, sub, globalDisc, subAfterDisc, tax, total, mwstRate: rate } as Invoice;
  previewInv.billingSummary = invoiceBillingSummary(previewInv, data);

  // Summen nur im Fuss (und im PDF): Netto/MWST klein, Total gross
  const footer = (
    <div className="num" style={{ lineHeight: 1.3, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {globalDisc > 0 ? `Zwischentotal ${formatCHF(sub)} · ${form.discountLabel || "Rabatt"} −${formatCHF(globalDisc)} · ` : ""}Netto {formatCHF(subAfterDisc)}{form.mwst ? ` · MWST ${rate} % ${formatCHF(tax)}` : " · ohne MWST"}
      </div>
      <div style={{ fontSize: 13, color: "var(--text3)", whiteSpace: "nowrap" }}>Total <b style={{ color: "var(--text)", fontSize: 15 }}>{formatCHF(total)}</b></div>
    </div>
  );

  return (
    <Modal title={modal.id ? "Rechnung bearbeiten" : "Neue Rechnung"} onClose={() => setModal(null)} onSave={() => save()} wide
      footerStart={footer}
      preview={<LivePreview settings={data.settings} assets={data.docAssets} content={{ type: "invoice", inv: previewInv, client: clients.find(c => c.id === form.clientId) }} />}>
      <div className="form-row">
        <FormField label="Nr."><input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></FormField>
        <FormField label="Datum"><DateInput value={form.date} onChange={e => {
          // Neue Rechnung mit automatisch vergebener Nummer: Jahr/Monat der Nummer folgen dem Rechnungsdatum
          const fmt = data.settings.invoiceNumberFormat;
          const auto = !editingId && !!form.date && form.number === nextInvoiceNumber(data.invoices || [], fmt, form.date);
          setForm({ ...form, date: e.target.value, ...(auto && e.target.value ? { number: nextInvoiceNumber(data.invoices || [], fmt, e.target.value) } : {}) });
        }} /></FormField>
        <FormField label="Fällig am"><DateInput value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></FormField>
        {/* Zahlungseingang (MWST nach vereinnahmten Entgelten, Zahlungsmoral) — beim Statuswechsel heute, hier korrigierbar */}
        {form.status === "bezahlt" && <FormField label="Bezahlt am"><DateInput value={form.paidDate || ""} onChange={e => setForm({ ...form, paidDate: e.target.value || undefined })} /></FormField>}
      </div>
      <div className="form-row">
        <FormField label="Kunde *">
          <select value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value, contactId: "" })} style={!form.clientId ? { borderColor: "var(--warning)" } : {}}>
            <option value="">— Kunde wählen (Pflichtfeld) —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        {form.clientId && (() => {
          const cl = clients.find(c => c.id === form.clientId);
          const contacts = cl?.contacts || [];
          if (contacts.length === 0) return null;
          return (
            <FormField label="Adressiert an">
              <select value={form.contactId || ""} onChange={e => setForm({ ...form, contactId: e.target.value })}>
                <option value="">— Firma (kein Ansprechpartner) —</option>
                {contacts.map(ct => <option key={ct.id} value={ct.id}>{ct.name}{ct.position ? ` · ${ct.position}` : ""}</option>)}
              </select>
            </FormField>
          );
        })()}
        <FormField label="Projekt (Autofill)">
          <select value={form.projectId || ""} onChange={e => prefillFromProject(e.target.value)}>
            <option value="">— wählen —</option>
            {data.projects.map(p => {
              const bType = p.billingType || p.type;
              const openMins = bType === "stundensatz"
                ? data.timeEntries.filter(e => e.projectId === p.id && (!e.invoiceId || e.invoiceId === editingId)).reduce((s, e) => s + (e.minutes || 0), 0)
                : 0;
              const label = openMins > 0
                ? `${p.name} (${formatHours(openMins)} offen)`
                : p.name;
              return <option key={p.id} value={p.id}>{label}</option>;
            })}
          </select>
        </FormField>
      </div>

      {/* Offene Zeiteinträge des Projekts */}
      <TimeEntriesPicker form={form} data={data} openEntriesForProject={openEntriesForProject} toggleEntrySelection={toggleEntrySelection} setSelections={setSelections} updateBilledMinutes={updateBilledMinutes} />

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label>POSITIONEN</label>
          <button className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: 11 }} onClick={addItem}>+ Position</button>
        </div>
        <div style={{ ...ITEM_GRID, marginBottom: 4, fontSize: 10, color: "var(--text4)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          <div>Beschreibung</div>
          <div style={{ textAlign: "right" }}>Menge</div>
          <div style={{ textAlign: "right" }}>Preis</div>
          <div style={{ textAlign: "right" }}>Rabatt %</div>
          <div style={{ textAlign: "right" }}>Total</div>
          <div></div>
        </div>
        {form.items.map((item, idx) => {
          const lineTotal = calcLineTotal(item);
          const hasDiscount = (item.discount || 0) > 0;
          return (
            <div key={item.id} style={{ ...ITEM_GRID, marginBottom: 6, alignItems: "start" }}>
              <GrowingTextarea placeholder="Beschreibung" value={item.desc} onChange={v => updateItem(idx, "desc", v)} />
              <input type="number" step="0.25" placeholder="Menge" aria-label="Menge" value={item.qty} onChange={e => updateItem(idx, "qty", +e.target.value)} style={NUM_INPUT} />
              <input type="number" step="0.05" placeholder="CHF" aria-label="Preis" value={item.price} onChange={e => updateItem(idx, "price", +e.target.value)} style={NUM_INPUT} />
              <input type="number" step="1" min={0} max={100} placeholder="0" aria-label="Rabatt %" value={item.discount || 0} onChange={e => updateItem(idx, "discount", +e.target.value)} style={{ ...NUM_INPUT, background: hasDiscount ? "var(--warning-bg)" : undefined }} />
              <div className="num" style={{ fontSize: 12, textAlign: "right", paddingTop: hasDiscount ? 2 : 9, whiteSpace: "nowrap" }}>
                {hasDiscount && <div style={{ fontSize: 10, color: "var(--text5)", textDecoration: "line-through" }}>{formatCHF(item.qty * item.price)}</div>}
                <div style={{ color: hasDiscount ? "var(--warning)" : "var(--text3)" }}>{formatCHF(lineTotal)}</div>
              </div>
              <button className="btn-icon" title="Position entfernen" aria-label="Position entfernen" onClick={() => removeItem(idx)} style={{ marginTop: 3 }}><span className="msr" style={{ fontSize: 18 }}>close</span></button>
            </div>
          );
        })}
      </div>

      {/* Gesamtrabatt (selten: erst auf «+ Rabatt» eingeblendet, ein gesetzter Rabatt bleibt sichtbar) und MWST */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16, paddingTop: 8, borderTop: "1px solid var(--border2)" }}>
        {showDiscount ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 360px", minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>Rabatt</span>
            <select aria-label="Rabattart" value={form.discountType === "amount" ? "amount" : "percent"} onChange={e => setForm({ ...form, discountType: e.target.value })} style={{ width: 76, height: 30, padding: "0 8px", fontSize: 12 }}>
              <option value="percent">%</option>
              <option value="amount">CHF</option>
            </select>
            <input type="number" aria-label="Rabatt" step={form.discountType === "amount" ? "1" : "0.5"} min={0} value={form.discountValue || 0} onChange={e => setForm({ ...form, discountType: form.discountType === "amount" ? "amount" : "percent", discountValue: +e.target.value })} style={{ ...NUM_INPUT, width: 96, height: 30 }} />
            <input aria-label="Bezeichnung des Rabatts" placeholder="Bezeichnung (z.B. Stammkundenrabatt)" value={form.discountLabel || ""} onChange={e => setForm({ ...form, discountLabel: e.target.value })} style={{ flex: 1, minWidth: 120, height: 30, fontSize: 12 }} />
            {globalDisc > 0 && <span className="num" style={{ fontSize: 12, color: "var(--warning)", whiteSpace: "nowrap" }}>−{formatCHF(globalDisc)}</span>}
            <button className="btn-icon" title="Rabatt entfernen" aria-label="Rabatt entfernen" onClick={() => { setDiscountOpen(false); setForm({ ...form, discountType: "none", discountValue: 0 }); }}><span className="msr" style={{ fontSize: 18 }}>close</span></button>
          </div>
        ) : (
          <button className="btn btn-quiet btn-sm" onClick={() => { setDiscountOpen(true); setForm({ ...form, discountType: "percent", discountValue: form.discountValue || 0 }); }}>+ Rabatt auf Gesamtbetrag</button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0, fontSize: 13, color: "var(--text)", margin: 0 }}>
            <input type="checkbox" checked={form.mwst} onChange={e => setForm({ ...form, mwst: e.target.checked })} style={{ width: "auto" }} />
            MWST ausweisen
          </label>
          {form.mwst && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="number" aria-label="MWST-Satz" step="0.1" min={0} max={30} value={form.mwstRate ?? data.settings.mwstRate} onChange={e => setForm({ ...form, mwstRate: +e.target.value })} style={{ ...NUM_INPUT, width: 64, fontSize: 12, height: 30 }} />
              <span style={{ fontSize: 12, color: "var(--text4)" }}>%</span>
            </div>
          )}
        </div>
      </div>

      <FormField label="Bemerkungen"><textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: "vertical" }} /></FormField>
    </Modal>
  );
}
