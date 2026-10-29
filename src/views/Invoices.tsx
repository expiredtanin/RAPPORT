// Rechnungen: Liste (Filter, Gruppierung, Sortierung, KPI-Kacheln), Editor,
// Versand-/Mahnwesen und Akonto-Planer.
//
// Rechnungsarten:
//   - normal / Teilrechnung: Positionen (Menge × Preis, Rabatt pro Zeile und gesamt),
//     optional aus erfassten Zeiteinträgen des Projekts (`entrySelections`; diese
//     werden mit `invoiceId` markiert und sind danach gesperrt/«verrechnet»);
//   - Akonto (`invoiceKind: "akonto"`): Vorauszahlung, Betrag als Prozent des Budgets
//     oder fix; die MWST darauf ist erst bei der Schlussrechnung steuerrelevant
//     (siehe Accounting.tsx);
//   - Schlussrechnung aus einer Offerte oder einem Projekt (zieht bereits gestellte
//     Akonti ab).
// Der «Akonto-Planer» erzeugt mehrere Akonto-Rechnungen in Intervallen (Monatsende
// wird geklemmt: 31.1. + 1 Monat = 28./29.2.).
//
// Summen (sub/tax/total/subAfterDisc/globalDisc) werden beim Speichern EINMAL mit
// `calcTotal` berechnet und mitgespeichert (Total auf Rappen gerundet, `roundCHF`);
// Listen und Druck zeigen nur die gespeicherten Werte. Der MWST-Satz wird pro Rechnung
// festgehalten (`mwstRate`). Nummern: konfigurierbar (`settings.invoiceNumberFormat`,
// Standard «YYYY-NNN»), laufende Nummer aus den bestehenden Rechnungen.
// Status: entwurf → gesendet → bezahlt / überfällig. Die Zahlungsreferenz (QR) wird
// beim Drucken erzeugt (`generateQRReference` aus der Rechnungsnummer).
// Umwandlung aus Offerten: Quotes.tsx setzt `modal = { type: "newInvoice", quoteId }`.


import React, { useState, useEffect } from "react";
import { generateId, localISODate } from "../utils";
import { Header } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import { MahnModal } from "../components/MahnModal";
import type { Invoice, InvoiceItem, TimeEntry, ViewProps } from "../types";
import { AkontoPlanModal } from "./invoices/AkontoPlanModal";
import { InvoiceEditModal } from "./invoices/InvoiceEditModal";
import { InvoiceFilterBars } from "./invoices/InvoiceFilterBars";
import { InvoiceKpiCards } from "./invoices/InvoiceKpiCards";
import { InvoiceSendModal } from "./invoices/InvoiceSendModal";
import { InvoiceTable } from "./invoices/InvoiceTable";
import { NewInvoiceModal } from "./invoices/NewInvoiceModal";
import { akontoPlanRows, buildAkontoInvoices, calcTotal, defaultStartDate, nextInvoiceNumber } from "./invoices/invoiceHelpers";
import type { AkontoPlan, EntrySelections, InvoiceForm, NewInvoiceState } from "./invoices/invoiceHelpers";
import { filterAndSortInvoices, groupInvoices, summarizeUnbilled } from "./invoices/invoiceList";
import { buildNewInvoiceForm } from "./invoices/newInvoiceForm";

export default
function Invoices({ data, update, saveAll, modal, setModal, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "setView">) {
  const invoices = data.invoices || [];
  const clients = (data.persons || []);
  const [form, setForm] = useState<InvoiceForm>({ number: "", clientId: "", contactId: "", projectId: "", date: localISODate(), dueDate: "", items: [{ id: generateId(), desc: "", qty: 1, price: 0 }], mwst: true, notes: "", status: "entwurf" });
  const [filter, setFilter] = useState(() => { const cid = window.__navClientId || ""; window.__navClientId = null; return { status: "", clientId: cid, year: "", search: "" }; });
  const [groupBy, setGroupBy] = useState<string>("date");
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const nextNumber = () => nextInvoiceNumber(invoices, data.settings.invoiceNumberFormat);

  const editingId = (modal?.id as string | undefined) || null;

  // Offene Zeiteinträge + die bereits zu dieser Rechnung gehören (beim Bearbeiten)
  const openEntriesForProject = (projectId?: string): TimeEntry[] => {
    if (!projectId) return [];
    return data.timeEntries
      .filter(e => e.projectId === projectId && (!e.invoiceId || e.invoiceId === editingId))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  };

  const [sendModal, setSendModal] = useState<Invoice | null>(null);
  const [newInvModal, setNewInvModal] = useState(false);
  const [ni, setNi] = useState<NewInvoiceState>({ tab: "projekt", projectId: "", quoteId: "", mode: "teilrechnung", pct: 30, amt: 0, phaseId: "" });

  useEffect(() => {
    if (modal?.type === "newInvoice" && modal.quoteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Übergabe aus Offerten (modal), danach wird modal geleert
      setNi({ tab: "offerte", quoteId: modal.quoteId as string, mode: "schluss", pct: 30, amt: 0 });
      setNewInvModal(true);
      setModal(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf neue Übergaben reagieren
  }, [modal?.type, modal?.quoteId]);

  // ── Akonto-Planer ──────────────────────────────────────────────
  const emptyAp: AkontoPlan = { projectId: "", clientId: "", totalAmt: 0, mode: "interval", intervalMonths: 4, count: 4, startDate: defaultStartDate(), manualRows: [] };
  const [akontoModal, setAkontoModal] = useState(false);
  const [ap, setAp] = useState<AkontoPlan>(emptyAp);

  const apRows = akontoPlanRows(ap);

  const createAkontoInvoices = () => {
    const rows = apRows.filter(r => r.date && r.amt > 0);
    if (rows.length === 0) return;
    const newInvoices = buildAkontoInvoices(rows, ap, data, invoices);
    update("invoices", [...invoices, ...newInvoices]);
    setAkontoModal(false);
    setAp(emptyAp);
  };

  const confirmNewInvoice = () => {
    const result = buildNewInvoiceForm(ni, data, invoices, nextNumber(), openEntriesForProject);
    if (!result) return;
    if (result.form) setForm(result.form);
    setNewInvModal(false);
    setModal({ type: "invoice" });
  };

  const save = (statusOverride?: string) => {
    if (!form.clientId) {
      alert("Bitte einen Kunden auswählen.");
      return;
    }
    const { sub, globalDisc, subAfterDisc, tax, total } = calcTotal(form.items, form.mwst, form.mwstRate ?? data.settings.mwstRate, form.discountType, form.discountValue);
    const invoiceId = editingId || generateId();
    const status = statusOverride || form.status || "entwurf";
    const inv = { ...form, id: invoiceId, sub, globalDisc, subAfterDisc, tax, total, mwstRate: form.mwstRate ?? data.settings.mwstRate, status } as Invoice;
    delete inv.entrySelections;

    const selectedIds = Object.entries(form.entrySelections || {})
      .filter(([_, sel]) => sel.selected)
      .map(([id]) => id);

    const updatedEntries = data.timeEntries.map(e => {
      if (e.invoiceId === editingId) {
        return selectedIds.includes(e.id) ? { ...e, invoiceId } : { ...e, invoiceId: null };
      }
      if (selectedIds.includes(e.id)) return { ...e, invoiceId };
      return e;
    });

    const updatedInvoices = editingId
      ? invoices.map(i => i.id === editingId ? { ...i, ...inv } : i)
      : [...invoices, { ...inv, createdAt: new Date().toISOString() }];

    saveAll({ ...data, invoices: updatedInvoices, timeEntries: updatedEntries });
    setModal(null);
    if (!editingId && !statusOverride) setSendModal(inv);
  };

  const openEdit = (inv: Invoice) => {
    const linked = data.timeEntries.filter(e => e.invoiceId === inv.id);
    const entrySelections: EntrySelections = {};
    linked.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
    setForm({
      discountType: "none", discountValue: 0, discountLabel: "Rabatt",
      ...inv,
      items: (inv.items || []).map(it => ({ discount: 0, ...it })),
      entrySelections,
    });
    setModal({ type: "invoice", id: inv.id });
  };

  const del = async (id: string) => {
    if (!(await askConfirm("Rechnung löschen? Zugehörige Zeiteinträge werden wieder als offen markiert."))) return;
    const updatedEntries = data.timeEntries.map(e => e.invoiceId === id ? { ...e, invoiceId: null } : e);
    saveAll({ ...data, invoices: invoices.filter(i => i.id !== id), timeEntries: updatedEntries });
  };
  // `paidDate` füttert die Zahlungsmoral-Auswertung (crm.ts): beim ersten Wechsel auf «bezahlt» heute setzen, bei Rückstufung entfernen.
  const setStatus = (id: string, status: string) => update("invoices", invoices.map(i => {
    if (i.id !== id) return i;
    return { ...i, status, paidDate: status === "bezahlt" ? (i.paidDate || localISODate()) : undefined };
  }));

  const addItem = () => setForm({ ...form, items: [...form.items, { id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }] });
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItem = (idx: number, key: keyof InvoiceItem, val: unknown) => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, [key]: val } : it) });
  const [mahnModal, setMahnModal] = useState<{ inv: Invoice } | null>(null);
  const [mahnMode, setMahnMode] = useState<string>("new");
  const [mahnSentDate, setMahnSentDate] = useState(localISODate());
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const openMahnung = (inv: Invoice) => {
    setMahnMode((inv.reminders || []).length === 0 ? "new" : "reprint-0");
    setMahnSentDate(localISODate());
    setMahnModal({ inv });
  };

  const toggleEntrySelection = (entryId: string, entry: TimeEntry) => {
    const current = form.entrySelections?.[entryId];
    const newSelections = { ...form.entrySelections };
    if (current?.selected) {
      newSelections[entryId] = { ...current, selected: false };
    } else {
      newSelections[entryId] = { selected: true, billedMinutes: current?.billedMinutes ?? entry.minutes };
    }
    setForm(f => ({ ...f, entrySelections: newSelections }));
  };

  const updateBilledMinutes = (entryId: string, minutes: number) => {
    const newSelections = { ...form.entrySelections };
    newSelections[entryId] = { ...(newSelections[entryId] || { selected: true }), billedMinutes: Math.max(0, minutes) };
    setForm(f => ({ ...f, entrySelections: newSelections }));
  };

  const prefillFromProject = (projectId: string) => {
    if (!projectId) { setForm(f => ({ ...f, projectId: "", entrySelections: {} })); return; }
    const proj = data.projects.find(p => p.id === projectId);
    if (!proj) return;
    const bType = proj.billingType || proj.type;
    const openEntries = openEntriesForProject(projectId);
    if (bType === "stundensatz") {
      const entrySelections: EntrySelections = {};
      openEntries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
      const totalMins = openEntries.reduce((s, e) => s + e.minutes, 0);
      const hours = Math.round(totalMins / 60 * 100) / 100;
      setForm(f => ({
        ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections,
        items: hours > 0
          ? [{ id: generateId(), desc: `Architektur-/Grafikleistungen – ${proj.name}`, qty: hours, price: proj.hourlyRate as number, discount: 0 }]
          : [{ id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }]
      }));
    } else if (bType === "pauschal") {
      setForm(f => ({ ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections: {},
        items: [{ id: generateId(), desc: `Pauschalhonorar – ${proj.name}`, qty: 1, price: proj.budget as number, discount: 0 }] }));
    } else {
      setForm(f => ({ ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections: {} }));
    }
  };

  useEffect(() => {
    if (!form.projectId) return;
    const proj = data.projects.find(p => p.id === form.projectId);
    if (!proj || (proj.billingType || proj.type) !== "stundensatz") return;
    const totalBilledMins = Object.values(form.entrySelections || {})
      .filter(s => s.selected)
      .reduce((sum, s) => sum + (s.billedMinutes || 0), 0);
    const hours = Math.round(totalBilledMins / 60 * 100) / 100;
    // Invariante: Zeile 1 = gewählte Stunden × Stundensatz; entrySelections wird an vielen Stellen gesetzt
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hält die Invariante an einer Stelle
    setForm(f => {
      const existing = f.items[0] || {};
      if (existing.qty === hours && existing.price === proj.hourlyRate) return f;
      const newItems = [...f.items];
      newItems[0] = { id: existing.id || generateId(), desc: existing.desc || `Architektur-/Grafikleistungen – ${proj.name}`, qty: hours, price: proj.hourlyRate as number, discount: existing.discount || 0 };
      return { ...f, items: newItems };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.entrySelections, form.projectId]);

  // Verfügbare Jahre aus Rechnungen sammeln
  const availableYears = Array.from(new Set(invoices.map(i => (i.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();

  const filtered = filterAndSortInvoices(invoices, clients, filter, sort);
  const filteredTotal = filtered.reduce((s, i) => s + (i.total || 0), 0);
  const filteredOpen = filtered.filter(i => i.status === "gesendet" || i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
  const filteredOverdue = filtered.filter(i => i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
  const filteredPaid = filtered.filter(i => i.status === "bezahlt").reduce((s, i) => s + (i.total || 0), 0);

  // Unverrechnete Stunden über alle aktiven Stundensatz-Projekte (global)
  const { unbilledProjects, totalUnbilledMins, totalUnbilledAmount } = summarizeUnbilled(data);

  // Gruppieren
  const groupedInvoices = groupInvoices(filtered, groupBy, clients);

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Rechnungen" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { setAp({ ...emptyAp, startDate: defaultStartDate() }); setAkontoModal(true); }}>Akonto planen</button>
          <button className="btn btn-primary" onClick={() => { setNi({ tab: "projekt", projectId: "", quoteId: "", mode: "akonto-stunden", pct: 30, amt: 0 }); setNewInvModal(true); }}>+ Neue Rechnung</button>
        </div>
      } />

      <InvoiceKpiCards filtered={filtered} filteredPaid={filteredPaid} filteredOpen={filteredOpen} filteredOverdue={filteredOverdue}
        unbilledProjects={unbilledProjects} totalUnbilledMins={totalUnbilledMins} totalUnbilledAmount={totalUnbilledAmount} />

      <InvoiceFilterBars filter={filter} setFilter={setFilter} clients={clients} availableYears={availableYears} groupBy={groupBy} setGroupBy={setGroupBy}
        filtered={filtered} filteredTotal={filteredTotal} filteredOpen={filteredOpen} />

      <InvoiceTable filtered={filtered} groupedInvoices={groupedInvoices} groupBy={groupBy} sort={sort} toggleSort={toggleSort} invoiceCount={invoices.length}
        clients={clients} openMahnung={openMahnung} setStatus={setStatus} openEdit={openEdit} del={del} setPrintContent={setPrintContent} />

      {mahnModal && (
        <MahnModal
          inv={mahnModal.inv}
          data={data}
          update={update}
          setPrintContent={setPrintContent}
          onClose={() => setMahnModal(null)}
          mahnMode={mahnMode}
          setMahnMode={setMahnMode}
          mahnSentDate={mahnSentDate}
          setMahnSentDate={setMahnSentDate}
        />
      )}

      {modal?.type === "invoice" && (
        <InvoiceEditModal modal={modal} setModal={setModal} form={form} setForm={setForm} data={data} clients={clients} editingId={editingId} save={save}
          openEntriesForProject={openEntriesForProject} prefillFromProject={prefillFromProject} toggleEntrySelection={toggleEntrySelection}
          updateBilledMinutes={updateBilledMinutes} addItem={addItem} removeItem={removeItem} updateItem={updateItem} />
      )}

      {newInvModal && (
        <NewInvoiceModal ni={ni} setNi={setNi} data={data} invoices={invoices} openEntriesForProject={openEntriesForProject}
          onClose={() => setNewInvModal(false)} onConfirm={confirmNewInvoice} />
      )}

      {akontoModal && (
        <AkontoPlanModal ap={ap} setAp={setAp} apRows={apRows} data={data} clients={clients} onClose={() => setAkontoModal(false)} onCreate={createAkontoInvoices} />
      )}

      {sendModal && (
        <InvoiceSendModal invoice={sendModal} invoices={invoices} clients={clients} update={update} setPrintContent={setPrintContent} onClose={() => setSendModal(null)} />
      )}
    </div>
  );
}
