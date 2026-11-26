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
// `calcTotal` berechnet und mitgespeichert (Netto und MWST auf Rappen, Total = Summe);
// Listen und Druck zeigen nur die gespeicherten Werte. Der MWST-Satz wird pro Rechnung
// festgehalten (`mwstRate`). Nummern: konfigurierbar (`settings.invoiceNumberFormat`,
// Standard «YYYY-NNN»), Jahr aus dem Rechnungsdatum, laufende Nummer aus den bestehenden
// Rechnungen; doppelte Nummern werden beim Speichern abgewiesen.
// Zeiteinträge: nur Rechnungen nach Stunden (`form.hoursFromEntries`) zeigen die Auswahl;
// die verrechneten Minuten je Eintrag bleiben in `entrySelections` an der Rechnung.
// Status: entwurf → gesendet → bezahlt / überfällig. Die Zahlungsreferenz (QR) wird
// beim Drucken erzeugt (`generateQRReference` aus der Rechnungsnummer).
// Umwandlung aus Offerten: Quotes.tsx setzt `modal = { type: "newInvoice", quoteId }`.


import React, { useState, useEffect, useRef } from "react";
import { generateId, localISODate, projectFee } from "../utils";
import { Header } from "../components/UI";
import { changeWithUndo } from "../undo";
import { useConfirm } from "../hooks/useConfirm";
import { showToast } from "../toast";
import { applyEdit } from "../storage/merge";
import { MahnModal } from "../components/MahnModal";
import type { Invoice, InvoiceItem, PrintContent, TimeEntry, ViewProps } from "../types";
import { AkontoPlanModal } from "./invoices/AkontoPlanModal";
import { InvoiceEditModal } from "./invoices/InvoiceEditModal";
import { InvoiceFilterBars } from "./invoices/InvoiceFilterBars";
import { InvoiceKpiCards } from "./invoices/InvoiceKpiCards";
import { InvoiceSendModal } from "./invoices/InvoiceSendModal";
import { InvoiceTable } from "./invoices/InvoiceTable";
import { NewInvoiceModal } from "./invoices/NewInvoiceModal";
import { akontoPlanRows, applyEntryHours, buildAkontoInvoices, calcTotal, defaultInvoiceMode, defaultStartDate, entrySelectionsForEdit, freezeOnStatus, invoiceBillingSummary, isInvoiceNumberTaken, nextInvoiceNumber, selectAllEntries, selectedEntrySelections, withPrintSummary } from "./invoices/invoiceHelpers";
import type { AkontoPlan, EntrySelections, InvoiceForm, NewInvoiceState } from "./invoices/invoiceHelpers";
import { filterAndSortInvoices, groupInvoices, summarizeUnbilled } from "./invoices/invoiceList";
import { buildNewInvoiceForm } from "./invoices/newInvoiceForm";

export default
function Invoices({ data, update, saveAll, modal, setModal, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "setView">) {
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const invoices = data.invoices || [];
  const clients = (data.persons || []);
  const [form, setForm] = useState<InvoiceForm>({ number: "", clientId: "", contactId: "", projectId: "", date: localISODate(), dueDate: "", items: [{ id: generateId(), desc: "", qty: 1, price: 0 }], mwst: true, notes: "", status: "entwurf" });
  const [filter, setFilter] = useState(() => { const cid = window.__navClientId || ""; window.__navClientId = null; return { status: "", clientId: cid, year: "", search: "" }; });
  const [groupBy, setGroupBy] = useState<string>("none");
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
  // Neue Rechnung vom Server abgelehnt (z.B. dieselbe Nummer gleichzeitig auf einem anderen Gerät vergeben): die App
  // setzt sie zurück — Versanddialog nicht auf eine verschwundene Rechnung zeigen, sondern den Inhalt mit neuer Nummer
  // wieder zum Bearbeiten öffnen (vorher war er still weg; Cloud-Test Runde 21)
  useEffect(() => {
    if (!sendModal || invoices.some(i => i.id === sendModal.id)) return;
    const { id: _id, ...rest } = sendModal;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reaktion auf den vom Server zurückgesetzten Stand
    setSendModal(null);
    setForm({ ...(rest as unknown as InvoiceForm), number: nextNumber(), status: "entwurf" });
    setModal({ type: "invoice" });
    showToast("Die Rechnung wurde nicht gespeichert (Nummer inzwischen vergeben?). Inhalt mit neuer Nummer wieder geöffnet — bitte erneut speichern.", { timeout: 10000 });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf Daten/Versanddialog reagieren
  }, [sendModal, invoices]);
  const [newInvModal, setNewInvModal] = useState(false);
  const [ni, setNi] = useState<NewInvoiceState>({ tab: "projekt", projectId: "", quoteId: "", mode: "teilrechnung", pct: 30, amt: 0, phaseId: "" });

  // Übergaben über `modal`: aus Offerten (mit quoteId) oder aus der Befehlspalette (ohne Vorgabe)
  /* eslint-disable react-hooks/set-state-in-effect -- einmalige Übergabe, danach wird modal geleert */
  useEffect(() => {
    if (modal?.type === "newInvoice" && !modal.quoteId) {
      // Startmodus nach Abrechnungsart des vorgewählten Projekts (Pauschal → Akonto %, Stundensatz → Teilrechnung nach Stunden)
      const preProj = data.projects.find(p => p.id === modal.projectId);
      setNi({ tab: "projekt", projectId: (modal.projectId as string) || "", quoteId: "", mode: defaultInvoiceMode(preProj), pct: 30, amt: 0 });
      setNewInvModal(true);
      setModal(null);
      return;
    }
    if (modal?.type === "newInvoice" && modal.quoteId) {
      setNi({ tab: "offerte", quoteId: modal.quoteId as string, mode: "schluss", pct: 30, amt: 0 });
      setNewInvModal(true);
      setModal(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf neue Übergaben reagieren
  }, [modal?.type, modal?.quoteId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Akonto-Planer ──────────────────────────────────────────────
  const emptyAp: AkontoPlan = { projectId: "", clientId: "", totalAmt: 0, mode: "interval", intervalMonths: 4, count: 4, startDate: defaultStartDate(), manualRows: [] };
  const [akontoModal, setAkontoModal] = useState(false);
  const [ap, setAp] = useState<AkontoPlan>(emptyAp);

  const apRows = akontoPlanRows(ap, data);

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

  // Stand der Rechnung beim Öffnen des Fensters (Basis für applyEdit)
  const editOriginal = useRef<Invoice | null>(null);

  const save = (statusOverride?: string) => {
    if (!form.clientId) {
      showToast("Bitte einen Kunden auswählen.");
      return;
    }
    if (isInvoiceNumberTaken(invoices, form.number, editingId)) {
      showToast(`Die Rechnungsnummer ${(form.number || "").trim()} ist schon vergeben.`);
      return;
    }
    // Prüfungen wie bei der Offerte (Runde 34: leere Rechnung, Fälligkeit vor Datum, Rabatt über 100 % wurden gespeichert)
    if (!form.items.some(it => (it.desc || "").trim() || Number(it.price))) { showToast("Die Rechnung braucht mindestens eine Position."); return; }
    if (form.dueDate && form.date && form.dueDate < form.date) { showToast("Die Fälligkeit liegt vor dem Rechnungsdatum."); return; }
    if ((form.discountType === "percent" && !(Number(form.discountValue || 0) >= 0 && Number(form.discountValue || 0) <= 100))
      || form.items.some(it => !(Number(it.discount || 0) >= 0 && Number(it.discount || 0) <= 100))) { showToast("Rabatte zwischen 0 und 100 %."); return; }
    const { sub, globalDisc, subAfterDisc, tax, total } = calcTotal(form.items, form.mwst, form.mwstRate ?? data.settings.mwstRate, form.discountType, form.discountValue);
    const invoiceId = editingId || generateId();
    const status = statusOverride || form.status || "entwurf";
    // Verrechnete Minuten je Zeiteintrag bleiben an der Rechnung (entrySelections), damit beim Bearbeiten
    // gekürzte Einträge nicht still wieder auf die vollen Minuten springen.
    const { hoursFromEntries: _hoursFromEntries, ...formFields } = form;
    // Rabatt 0 = kein Rabatt (die Zeile im Editor bleibt dann beim nächsten Öffnen zu)
    const noDisc = !((form.discountValue || 0) > 0) ? { discountType: "none", discountValue: 0 } : {};
    const inv = { ...formFields, ...noDisc, number: (form.number || "").trim(), id: invoiceId, sub, globalDisc, subAfterDisc, tax, total, mwstRate: form.mwstRate ?? data.settings.mwstRate, status,
      entrySelections: selectedEntrySelections(form.entrySelections),
      // heute nur beim Wechsel auf «bezahlt»; eine schon bezahlte Rechnung ohne Datum bleibt ohne (sonst rutschte sie
      // beim Korrigieren eines Tippfehlers in die aktuelle MWST-Periode)
      paidDate: status !== "bezahlt" ? undefined
        : form.paidDate || (invoices.find(i => i.id === editingId)?.status === "bezahlt" ? undefined : localISODate()) } as Invoice;
    // Abrechnungsblock (Akonto/Teilrechnung) mit jedem Speichern festhalten — ein Nachdruck zeigt dieselben Zahlen
    inv.billingSummary = invoiceBillingSummary(inv, data);

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

    // Bearbeiten: nur die im Fenster geänderten Felder übernehmen (fremde Änderungen seit dem Öffnen bleiben),
    // dann Summen aus den zusammengeführten Positionen neu rechnen
    const current = editingId ? invoices.find(i => i.id === editingId) : undefined;
    if (editingId && !current) { showToast("Diese Rechnung wurde inzwischen gelöscht — die Änderungen sind nicht gespeichert."); return; }
    let saved: Invoice = inv;
    if (current) {
      const original = editOriginal.current?.id === editingId ? editOriginal.current : current;
      saved = applyEdit<Invoice>(original, { ...original, ...inv }, current);
      const t = calcTotal(saved.items, saved.mwst, saved.mwstRate ?? data.settings.mwstRate, saved.discountType, saved.discountValue);
      saved = { ...saved, sub: t.sub, globalDisc: t.globalDisc, subAfterDisc: t.subAfterDisc, tax: t.tax, total: t.total };
      saved.billingSummary = invoiceBillingSummary(saved, data);
    }
    const updatedInvoices = editingId
      ? invoices.map(i => i.id === editingId ? saved : i)
      : [...invoices, { ...inv, createdAt: new Date().toISOString() }];

    saveAll({ ...data, invoices: updatedInvoices, timeEntries: updatedEntries });
    setModal(null);
    if (!editingId && !statusOverride) setSendModal(inv);
  };

  const openEdit = (inv: Invoice) => {
    editOriginal.current = inv;
    const entrySelections = entrySelectionsForEdit(inv, data.timeEntries);
    // Zeile 1 folgt der Zeitauswahl nur bei Rechnungen nach Stunden; die gespeicherten Beträge bleiben,
    // bis die Auswahl geändert wird.
    setForm({
      discountType: "none", discountValue: 0, discountLabel: "Rabatt",
      ...inv,
      items: (inv.items || []).map(it => ({ discount: 0, ...it })),
      entrySelections,
      hoursFromEntries: Object.keys(entrySelections).length > 0,
    });
    setModal({ type: "invoice", id: inv.id });
  };

  // Befehlspalette (App.tsx): bestimmte Rechnung öffnen
  /* eslint-disable react-hooks/set-state-in-effect -- einmalige Übergabe aus der Befehlspalette */
  useEffect(() => {
    if (modal?.type !== "openInvoice") return;
    const inv = invoices.find(i => i.id === modal.id);
    setModal(null);
    if (inv) openEdit(inv);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf neue Aufträge reagieren
  }, [modal?.type, modal?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Löschen ohne Rückfrage, dafür mit «Rückgängig» (undo.ts); Zeiteinträge werden wieder offen.
  const del = (id: string) => {
    const inv = invoices.find(i => i.id === id);
    changeWithUndo(`Rechnung ${inv?.number || ""} gelöscht`.replace("  ", " "), prev => ({
      ...prev,
      invoices: (prev.invoices || []).filter(i => i.id !== id),
      timeEntries: (prev.timeEntries || []).map(e => e.invoiceId === id ? { ...e, invoiceId: null } : e),
    }));
  };
  // `paidDate` füttert die Zahlungsmoral-Auswertung (crm.ts): beim ersten Wechsel auf «bezahlt» heute setzen, bei Rückstufung entfernen.
  // Beim Wechsel aus dem Entwurf wird der Abrechnungsblock festgehalten (freezeOnStatus).
  // auf dem aktuellen Stand; Versanddatum wie im Versanddialog (Zahlungsmoral rechnete sonst ab Rechnungsdatum — Runde 34)
  const setStatus = (id: string, status: string) => update("invoices", prev => (prev || []).map(i => {
    if (i.id !== id) return i;
    return { ...freezeOnStatus(i, status, data), paidDate: status === "bezahlt" ? (i.paidDate || localISODate()) : undefined,
      ...(status === "gesendet" && !i.sentDate ? { sentDate: localISODate() } : {}) };
  }));
  // PDF einer Rechnung: mit dem Abrechnungsblock (Entwurf aktuell, sonst festgehalten)
  const printWithSummary = (content: PrintContent) => setPrintContent(withPrintSummary(content, data));

  const addItem = () => setForm({ ...form, items: [...form.items, { id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }] });
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItem = (idx: number, key: keyof InvoiceItem, val: unknown) => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, [key]: val } : it) });
  const [mahnModal, setMahnModal] = useState<{ inv: Invoice } | null>(null);
  const [mahnMode, setMahnMode] = useState<string>("new");
  const [mahnSentDate, setMahnSentDate] = useState(localISODate());

  const openMahnung = (inv: Invoice) => {
    setMahnMode((inv.reminders || []).length === 0 ? "new" : "reprint-0");
    setMahnSentDate(localISODate());
    setMahnModal({ inv });
  };

  // Neue Zeitauswahl übernehmen; bei Rechnungen nach Stunden folgt Zeile 1 (Stunden × Satz) der Auswahl.
  const setSelections = (entrySelections: EntrySelections) => setForm(f =>
    applyEntryHours({ ...f, entrySelections }, data.projects.find(p => p.id === f.projectId)));

  const toggleEntrySelection = (entryId: string, entry: TimeEntry) => {
    const current = form.entrySelections?.[entryId];
    const newSelections = { ...form.entrySelections };
    if (current?.selected) {
      newSelections[entryId] = { ...current, selected: false };
    } else {
      newSelections[entryId] = { selected: true, billedMinutes: current?.billedMinutes ?? entry.minutes };
    }
    setSelections(newSelections);
  };

  const updateBilledMinutes = (entryId: string, minutes: number) => {
    const newSelections = { ...form.entrySelections };
    newSelections[entryId] = { ...(newSelections[entryId] || { selected: true }), billedMinutes: Math.max(0, minutes) };
    setSelections(newSelections);
  };

  const prefillFromProject = async (projectId: string) => {
    if (!projectId) { setForm(f => ({ ...f, projectId: "", entrySelections: {}, hoursFromEntries: false })); return; }
    const proj = data.projects.find(p => p.id === projectId);
    if (!proj) return;
    const bType = proj.billingType || proj.type;
    const openEntries = openEntriesForProject(projectId);
    // Eigene Positionen nicht still überschreiben (Runde 34: freie Rechnung mit 3 Positionen wurde zum Pauschalhonorar,
    // der Kunde wechselte gleich mit) — nachfragen; «Abbrechen» verknüpft nur das Projekt
    const hasOwnItems = form.items.some(it => (it.desc || "").trim() || Number(it.price) || 0);
    if ((bType === "stundensatz" || bType === "pauschal") && hasOwnItems
      && !await askConfirm(<>Die Positionen durch die des Projekts «{proj.name}» ersetzen{proj.clientId && proj.clientId !== form.clientId ? " und den Kunden übernehmen" : ""}?</>, "Ersetzen")) {
      setForm(f => ({ ...f, projectId, entrySelections: {}, hoursFromEntries: false }));
      return;
    }
    if (bType === "stundensatz") {
      const entrySelections = selectAllEntries(openEntries);
      const totalMins = openEntries.reduce((s, e) => s + e.minutes, 0);
      const hours = Math.round(totalMins / 60 * 100) / 100;
      setForm(f => ({
        ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections, hoursFromEntries: true,
        items: hours > 0
          ? [{ id: generateId(), desc: `Architektur-/Grafikleistungen – ${proj.name}`, qty: hours, price: proj.hourlyRate as number, discount: 0 }]
          : [{ id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }]
      }));
    } else if (bType === "pauschal") {
      setForm(f => ({ ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections: {}, hoursFromEntries: false,
        items: [{ id: generateId(), desc: `Pauschalhonorar – ${proj.name}`, qty: 1, price: projectFee(proj), discount: 0 }] }));
    } else {
      setForm(f => ({ ...f, projectId, clientId: proj.clientId || f.clientId, entrySelections: {}, hoursFromEntries: false }));
    }
  };

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
          <button className="btn btn-primary" onClick={() => { setNi({ tab: "projekt", projectId: "", quoteId: "", mode: defaultInvoiceMode(null), pct: 30, amt: 0 }); setNewInvModal(true); }}>+ Neue Rechnung</button>
        </div>
      } />

      <InvoiceKpiCards filtered={filtered} filteredPaid={filteredPaid} filteredOpen={filteredOpen} filteredOverdue={filteredOverdue}
        unbilledProjects={unbilledProjects} totalUnbilledMins={totalUnbilledMins} totalUnbilledAmount={totalUnbilledAmount} />

      <InvoiceFilterBars filter={filter} setFilter={setFilter} clients={clients} availableYears={availableYears} groupBy={groupBy} setGroupBy={setGroupBy}
        filtered={filtered} filteredTotal={filteredTotal} filteredOpen={filteredOpen} />

      <InvoiceTable filtered={filtered} groupedInvoices={groupedInvoices} groupBy={groupBy} sort={sort} toggleSort={toggleSort} invoiceCount={invoices.length}
        clients={clients} openMahnung={openMahnung} setStatus={setStatus} openEdit={openEdit} del={del} setPrintContent={printWithSummary} />

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
          openEntriesForProject={openEntriesForProject} prefillFromProject={prefillFromProject} toggleEntrySelection={toggleEntrySelection} setSelections={setSelections}
          updateBilledMinutes={updateBilledMinutes} addItem={addItem} removeItem={removeItem} updateItem={updateItem} />
      )}

      {newInvModal && (
        <NewInvoiceModal ni={ni} setNi={setNi} data={data} invoices={invoices} openEntriesForProject={openEntriesForProject}
          onClose={() => setNewInvModal(false)} onConfirm={confirmNewInvoice} />
      )}

      {akontoModal && (
        <AkontoPlanModal ap={ap} setAp={setAp} apRows={apRows} data={data} clients={clients} onClose={() => setAkontoModal(false)} onCreate={createAkontoInvoices} />
      )}

      {sendModal && invoices.some(i => i.id === sendModal.id) && (
        <InvoiceSendModal invoice={sendModal} invoices={invoices} clients={clients} update={update} setPrintContent={printWithSummary} freeze={(i, status) => freezeOnStatus(i, status, data)} onClose={() => setSendModal(null)} />
      )}
    </div>
  );
}
