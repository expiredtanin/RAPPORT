// Dialog «Rechnung bearbeiten / Neue Rechnung»: Kopfdaten, Zeiteinträge, Positionen, Rabatt, MWST und Bemerkungen.

import type React from "react";
import { formatCHF, formatHours } from "../../utils";
import { Modal, FormField, DateInput } from "../../components/UI";
import type { AppData, InvoiceItem, ModalState, Person, TimeEntry } from "../../types";
import { calcLineTotal, calcTotal } from "./invoiceHelpers";
import type { InvoiceForm } from "./invoiceHelpers";
import { TimeEntriesPicker } from "./TimeEntriesPicker";

/** Formular-Dialog einer Rechnung; der Zustand (`form`) und alle Änderungen liegen in Invoices.tsx. */
export function InvoiceEditModal({ modal, setModal, form, setForm, data, clients, editingId, save, openEntriesForProject, prefillFromProject, toggleEntrySelection, updateBilledMinutes, addItem, removeItem, updateItem }: {
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
  updateBilledMinutes: (entryId: string, minutes: number) => void;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, key: keyof InvoiceItem, val: unknown) => void;
}) {
  const { sub, globalDisc, subAfterDisc, tax, total } = calcTotal(form.items, form.mwst, form.mwstRate ?? data.settings.mwstRate, form.discountType, form.discountValue);

  return (
    <Modal title={modal.id ? "Rechnung bearbeiten" : "Neue Rechnung"} onClose={() => setModal(null)} onSave={() => save()} wide>
      <div className="form-row">
        <FormField label="Nr."><input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></FormField>
        <FormField label="Datum"><DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormField>
        <FormField label="Fällig am"><DateInput value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></FormField>
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
      <TimeEntriesPicker form={form} setForm={setForm} data={data} openEntriesForProject={openEntriesForProject} toggleEntrySelection={toggleEntrySelection} updateBilledMinutes={updateBilledMinutes} />

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label>POSITIONEN</label>
          <button className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: 11 }} onClick={addItem}>+ Position</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 10, color: "var(--text4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          <div style={{ flex: 3 }}>Beschreibung</div>
          <div style={{ width: 70, textAlign: "right" }}>Menge</div>
          <div style={{ width: 90, textAlign: "right" }}>Preis</div>
          <div style={{ width: 60, textAlign: "right" }}>Rabatt %</div>
          <div style={{ width: 100, textAlign: "right" }}>Total</div>
          <div style={{ width: 32 }}></div>
        </div>
        {form.items.map((item, idx) => {
          const lineTotal = calcLineTotal(item);
          const hasDiscount = (item.discount || 0) > 0;
          return (
            <div key={item.id} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
              <input placeholder="Beschreibung" value={item.desc} onChange={e => updateItem(idx, "desc", e.target.value)} style={{ flex: 3 }} />
              <input type="number" step="0.25" placeholder="Menge" value={item.qty} onChange={e => updateItem(idx, "qty", +e.target.value)} style={{ width: 70, textAlign: "right" }} />
              <input type="number" step="0.05" placeholder="CHF" value={item.price} onChange={e => updateItem(idx, "price", +e.target.value)} style={{ width: 90, textAlign: "right" }} />
              <input type="number" step="1" min={0} max={100} placeholder="0" value={item.discount || 0} onChange={e => updateItem(idx, "discount", +e.target.value)} style={{ width: 60, textAlign: "right", background: hasDiscount ? "#fff8ed" : undefined }} />
              <div style={{ width: 100, fontSize: 12, textAlign: "right" }}>
                {hasDiscount && <div style={{ fontSize: 10, color: "var(--text5)", textDecoration: "line-through" }}>{formatCHF(item.qty * item.price)}</div>}
                <div style={{ color: hasDiscount ? "var(--warning)" : "var(--text4)" }}>{formatCHF(lineTotal)}</div>
              </div>
              <button className="btn btn-danger" style={{ width: 32, padding: 0, fontSize: 12 }} onClick={() => removeItem(idx)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          );
        })}
      </div>

      {/* Gesamt-Rabatt */}
      <div style={{ marginBottom: 14, padding: "12px 14px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--text4)", fontWeight: 500, textTransform: "uppercase" }}>Rabatt auf Gesamtbetrag</label>
          <select value={form.discountType || "none"} onChange={e => setForm({ ...form, discountType: e.target.value, discountValue: e.target.value === "none" ? 0 : form.discountValue })} style={{ width: 140 }}>
            <option value="none">Kein Rabatt</option>
            <option value="percent">Prozent (%)</option>
            <option value="amount">Pauschal (CHF)</option>
          </select>
          {form.discountType && form.discountType !== "none" && (
            <>
              <input type="number" step={form.discountType === "percent" ? "0.5" : "1"} min={0} value={form.discountValue || 0} onChange={e => setForm({ ...form, discountValue: +e.target.value })} style={{ width: 90, textAlign: "right" }} />
              <input placeholder="Bezeichnung (z.B. Stammkundenrabatt)" value={form.discountLabel || ""} onChange={e => setForm({ ...form, discountLabel: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, padding: "12px 14px", background: "var(--surface2)", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", fontSize: 13, color: "var(--text)" }}>
            <input type="checkbox" checked={form.mwst} onChange={e => setForm({ ...form, mwst: e.target.checked })} style={{ width: "auto" }} />
            MWST ausweisen
          </label>
          {form.mwst && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="number" step="0.1" min={0} max={30} value={form.mwstRate ?? data.settings.mwstRate} onChange={e => setForm({ ...form, mwstRate: +e.target.value })} style={{ width: 60, fontSize: 12, height: 28 }} />
              <span style={{ fontSize: 12, color: "var(--text4)" }}>%</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div style={{ color: "var(--text4)" }}>Zwischentotal {formatCHF(sub)}</div>
          {globalDisc > 0 && <div style={{ color: "var(--warning)" }}>{form.discountLabel || "Rabatt"} −{formatCHF(globalDisc)}</div>}
          {globalDisc > 0 && <div style={{ color: "var(--text4)" }}>Nach Rabatt {formatCHF(subAfterDisc)}</div>}
          {form.mwst && <div style={{ color: "var(--text4)" }}>MWST {formatCHF(tax)}</div>}
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 3 }}>Total {formatCHF(total)}</div>
        </div>
      </div>

      <FormField label="Bemerkungen"><textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: "vertical" }} /></FormField>
    </Modal>
  );
}
