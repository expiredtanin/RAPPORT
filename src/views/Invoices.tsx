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
import { SIA_PHASES } from "../constants";
import { generateId, formatCHF, formatDate, formatHours, roundCHF, localISODate } from "../utils";
import { Header, Modal, FormField, StatusSelect, DateInput, KpiCard, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import { MahnModal } from "../components/MahnModal";
import type { Invoice, InvoiceItem, TimeEntry, ViewProps } from "../types";

/** Formularstand einer Rechnung: Id und Summen kommen erst beim Speichern dazu; die Positionsliste ist immer vorhanden. */
type InvoiceForm = Partial<Invoice> & Pick<Invoice, "items">;

/** Zustand des Dialogs «Neue Rechnung» (Quelle: Projekt oder Offerte, Art der Rechnung). */
type NewInvoiceState = { tab: string; projectId?: string; quoteId?: string; mode: string; pct: number; amt: number; phaseId?: string; [key: string]: unknown };
/** Zustand des Akonto-Planers. */
type AkontoPlan = { projectId: string; clientId: string; totalAmt: number; mode: "interval" | "manual"; intervalMonths: number; count: number; startDate: string; manualRows: { id: string; date: string; amt: number }[] };
type EntrySelections = NonNullable<Invoice["entrySelections"]>;

export default
function Invoices({ data, update, saveAll, modal, setModal, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "setView">) {
  const invoices = data.invoices || [];
  const clients = (data.persons || []);
  const [form, setForm] = useState<InvoiceForm>({ number: "", clientId: "", contactId: "", projectId: "", date: localISODate(), dueDate: "", items: [{ id: generateId(), desc: "", qty: 1, price: 0 }], mwst: true, notes: "", status: "entwurf" });
  const [filter, setFilter] = useState(() => { const cid = window.__navClientId || ""; window.__navClientId = null; return { status: "", clientId: cid, year: "", search: "" }; });
  const [groupBy, setGroupBy] = useState<string>("date");
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const nextNumber = () => {
    const fmt = data.settings.invoiceNumberFormat || "YYYY-NNN";
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const yy = yyyy.slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    // Build regex to extract the sequence number from existing invoice numbers
    const pattern = fmt
      .replace(/[-/^$*+?.()|[\]{}]/g, "\\$&")
      .replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, "\\d{2}")
      .replace(/N+/, "(\\d+)");
    const rx = new RegExp("^" + pattern + "$");
    const nums = invoices.map(i => {
      const m = (i.number || "").match(rx);
      return m ? parseInt(m[1]) : null;
    }).filter(n => n !== null);
    const nextSeq = nums.length ? Math.max(...nums) + 1 : 1;
    const padLen = (fmt.match(/N+/) || ["NNN"])[0].length;
    return fmt
      .replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, mm)
      .replace(/N+/, String(nextSeq).padStart(padLen, "0"));
  };


  const editingId = (modal?.id as string | undefined) || null;

  const calcTotal = (items: InvoiceItem[] | undefined, mwst: boolean | undefined, rate: number, discountType?: string, discountValue?: number) => {
    const sub = (items || []).reduce((s, i) => {
      const line = i.qty * i.price;
      const disc = (i.discount || 0) > 0 ? line * ((i.discount || 0) / 100) : 0;
      return s + line - disc;
    }, 0);
    const globalDisc = discountType === "percent" ? sub * ((discountValue || 0) / 100)
      : discountType === "amount" ? (discountValue || 0) : 0;
    const subAfterDisc = sub - globalDisc;
    const tax = mwst ? subAfterDisc * (rate / 100) : 0;
    const total = roundCHF(subAfterDisc + tax);
    return { sub, globalDisc, subAfterDisc, tax, total };
  };

  const calcLineTotal = (item: Pick<InvoiceItem, "qty" | "price" | "discount">) => {
    const line = (item.qty || 0) * (item.price || 0);
    return line * (1 - ((item.discount || 0) / 100));
  };

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
  // Reine UTC-Monatsarithmetik MIT Tages-Klemmung: ein Zieltag, den es im
  // Zielmonat nicht gibt (z.B. 31. Januar + 1 Monat), landet auf dem letzten
  // Tag des Zielmonats statt in den übernächsten Monat überzulaufen (JS
  // Date-Overflow-Verhalten hätte sonst z.B. Februar komplett übersprungen).
  const addMonthsClamped = (dateStr: string, months: number) => {
    const [y, m, day] = dateStr.split("-").map(Number);
    const targetMonthLastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, targetMonthLastDay);
    return new Date(Date.UTC(y, m - 1 + months, clampedDay)).toISOString().slice(0, 10);
  };
  const defaultStartDate = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)).toISOString().slice(0, 10);
  };
  const emptyAp: AkontoPlan = { projectId: "", clientId: "", totalAmt: 0, mode: "interval", intervalMonths: 4, count: 4, startDate: defaultStartDate(), manualRows: [] };
  const [akontoModal, setAkontoModal] = useState(false);
  const [ap, setAp] = useState<AkontoPlan>(emptyAp);

  const apRows = (() => {
    if (ap.mode === "interval") {
      const start = ap.startDate || defaultStartDate();
      const perInv = ap.count > 0 ? Math.round((ap.totalAmt / ap.count) * 100) / 100 : 0;
      return Array.from({ length: Math.max(1, Math.min(ap.count, 24)) }, (_, i) => {
        return { id: String(i), date: addMonthsClamped(start, i * (ap.intervalMonths || 1)), amt: perInv };
      });
    }
    return ap.manualRows;
  })();

  const generateSequentialNumbers = (count: number) => {
    const fmt = data.settings.invoiceNumberFormat || "YYYY-NNN";
    const now = new Date();
    const yyyy = String(now.getFullYear()); const yy = yyyy.slice(2);
    const escaped = fmt.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&").replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/N+/, "(\\d+)");
    const rx = new RegExp("^" + escaped + "$");
    const nums = invoices.map(i => { const m = (i.number || "").match(rx); return m ? parseInt(m[1]) : null; }).filter(n => n !== null);
    let nextSeq = nums.length ? Math.max(...nums) + 1 : 1;
    const padLen = (fmt.match(/N+/) || ["NNN"])[0].length;
    return Array.from({ length: count }, () => {
      const n = fmt.replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/N+/, String(nextSeq).padStart(padLen, "0"));
      nextSeq++;
      return n;
    });
  };

  const createAkontoInvoices = () => {
    const rows = apRows.filter(r => r.date && r.amt > 0);
    if (rows.length === 0) return;
    const proj = data.projects.find(p => p.id === ap.projectId);
    const numbers = generateSequentialNumbers(rows.length);
    const newInvoices = rows.map((row, i) => {
      const due = new Date(`${row.date}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30);
      const { sub, tax, total, subAfterDisc, globalDisc } = calcTotal(
        [{ id: generateId(), desc: `Akontorechnung – ${proj?.name || ""}`, qty: 1, price: row.amt, discount: 0 }],
        true, data.settings.mwstRate, "none", 0
      );
      return {
        id: generateId(), number: numbers[i], date: row.date,
        dueDate: due.toISOString().slice(0, 10),
        clientId: ap.clientId || proj?.clientId || "",
        projectId: ap.projectId, invoiceKind: "akonto",
        items: [{ id: generateId(), desc: `Akontorechnung – ${proj?.name || ""}`, qty: 1, price: row.amt, discount: 0 }],
        mwst: true, mwstRate: data.settings.mwstRate,
        notes: "Zahlbar innert 30 Tagen netto.",
        status: "entwurf", discountType: "none", discountValue: 0,
        sub, tax, total, subAfterDisc, globalDisc,
        createdAt: new Date().toISOString(),
      };
    });
    update("invoices", [...invoices, ...newInvoices]);
    setAkontoModal(false);
    setAp(emptyAp);
  };

  const confirmNewInvoice = () => {
    const todayStr = localISODate();
    const due = new Date(); due.setDate(due.getDate() + 30);
    const base = {
      number: nextNumber(), date: todayStr, dueDate: localISODate(due),
      mwst: true, mwstRate: data.settings.mwstRate,
      notes: "Zahlbar innert 30 Tagen netto.", status: "entwurf",
      discountType: "none", discountValue: 0, discountLabel: "Rabatt",
    };

    if (ni.tab === "frei") {
      setForm({ ...base, clientId: "", projectId: "", entrySelections: {}, items: [{ id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }] });
    } else if (ni.tab === "projekt") {
      const proj = data.projects.find(p => p.id === ni.projectId);
      if (!proj) return;
      const bType = proj.billingType || proj.type;
      const projBudget = proj.budget || proj.budgetAmount || 0;
      if (ni.mode === "teilrechnung") {
        const entries = openEntriesForProject(proj.id);
        const entrySelections: EntrySelections = {};
        entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
        const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – Architektur-/Grafikleistungen – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
      } else if (ni.mode === "teilrechnung-percent") {
        const amt = projBudget * (ni.pct / 100);
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }] });
      } else if (ni.mode === "teilrechnung-amount") {
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – ${proj.name}`, qty: 1, price: ni.amt, discount: 0 }] });
      } else if (ni.mode === "akonto-percent") {
        const amt = projBudget * (ni.pct / 100);
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }] });
      } else if (ni.mode === "akonto-amount") {
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name}`, qty: 1, price: ni.amt, discount: 0 }] });
      } else if (ni.mode === "akonto-stunden") {
        const entries = openEntriesForProject(proj.id).filter(e => (e.date || "") <= todayStr);
        const entrySelections: EntrySelections = {};
        entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
        const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
      } else if (ni.mode === "phase") {
        const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
        const phInfo = SIA_PHASES.find(p => p.id === ni.phaseId);
        const amt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung ${phInfo?.label || ni.phaseId} – ${proj.name}`, qty: 1, price: amt, discount: 0 }] });
      } else if (ni.mode === "akonto-phase") {
        const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
        const phInfo = SIA_PHASES.find(p => p.id === ni.phaseId);
        const amt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
        setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung ${phInfo?.label || ni.phaseId} – ${proj.name}`, qty: 1, price: amt, discount: 0 }] });
      } else {
        // schluss
        if (bType === "stundensatz") {
          const entries = openEntriesForProject(proj.id).filter(e => (e.date || "") <= todayStr);
          const entrySelections: EntrySelections = {};
          entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
          const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
          setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "schluss",
            items: [{ id: generateId(), desc: `Schlussrechnung – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
        } else {
          // Pauschal-Schluss: Gesamthonorar ausweisen, alle bisherigen
          // Zahlungen abziehen. Denylist statt Allowlist auf invoiceKind:
          // eine über das Projekt-Autofill an eine "Freie Rechnung"
          // gehängte Teilzahlung hat invoiceKind==="" (nie klassifiziert)
          // und wurde von einer Akonto/Teilrechnung-Allowlist nicht erfasst
          // — reales Doppelverrechnungsrisiko (live nachgestellt: CHF 8'000
          // bereits gesendete "freie" Rechnung wurde bei der Schlussrechnung
          // nicht abgezogen). Nur eine vorherige Schlussrechnung selbst
          // ausschliessen.
          const akontoInvs = invoices.filter(i => i.projectId === proj.id && i.invoiceKind !== "schluss" && i.status !== "entwurf");
          const akontoTotal = akontoInvs.reduce((s, i) => s + (i.subAfterDisc ?? i.sub ?? 0), 0);
          const schlussItems = [
            { id: generateId(), desc: `Pauschalhonorar – ${proj.name}`, qty: 1, price: projBudget, discount: 0 },
            ...(akontoTotal > 0 ? [{ id: generateId(), desc: `Abzgl. bisherige Akonto-/Teilzahlungen (${akontoInvs.map(i => i.number).filter(Boolean).join(", ")})`, qty: 1, price: -akontoTotal, discount: 0 }] : []),
          ];
          const notes = akontoTotal > 0
            ? `Schlussrechnung gemäss Honorarvereinbarung.\nBisherige Akonto-/Teilzahlungen:\n${akontoInvs.map(i => `  – ${i.number}: CHF ${(i.subAfterDisc ?? i.sub ?? 0).toFixed(2)}`).join("\n")}\n\nZahlbar innert 30 Tagen netto.`
            : "Zahlbar innert 30 Tagen netto.";
          setForm({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "schluss", items: schlussItems, notes });
        }
      }
    } else if (ni.tab === "offerte") {
      const q = (data.quotes || []).find(x => x.id === ni.quoteId);
      if (!q) return;
      // Akonti/Teilrechnungen können auch über den Projekt-Tab entstanden sein
      // (setzen projectId statt quoteId) — sonst würde eine Schlussrechnung
      // über den Offerte-Tab sie nicht abziehen und den vollen Betrag statt
      // des Restbetrags in Rechnung stellen.
      const existing = (invoices).filter(i => i.quoteId === q.id || (q.projectId && i.projectId === q.projectId));
      let items: InvoiceItem[], invoiceKind = "akonto";
      if (ni.mode === "schluss") {
        invoiceKind = "schluss";
        // Denylist statt Allowlist: eine über das Projekt-Autofill
        // verknüpfte "freie" Rechnung hat invoiceKind==="" und würde von
        // einer Akonto/Teilrechnung-Allowlist nicht erfasst — reales
        // Doppelverrechnungsrisiko (live nachgestellt).
        const akontoInvs = existing.filter(i => i.invoiceKind !== "schluss" && i.status !== "entwurf");
        const akontoTotal = akontoInvs.reduce((s, i) => s + (i.subAfterDisc ?? i.sub ?? 0), 0);
        items = [
          { id: generateId(), desc: `Honorar gemäss Offerte ${q.number}`, qty: 1, price: q.sub || 0, discount: 0 },
          ...(akontoTotal > 0 ? [{ id: generateId(), desc: `Abzgl. bisherige Akonto-/Teilzahlungen (${akontoInvs.map(i => i.number).filter(Boolean).join(", ")})`, qty: 1, price: -akontoTotal, discount: 0 }] : []),
        ];
      } else if (ni.mode === "teilrechnung-percent") {
        invoiceKind = "teilrechnung";
        const amt = (q.sub || 0) * (ni.pct / 100);
        items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }];
      } else if (ni.mode === "teilrechnung-amount") {
        invoiceKind = "teilrechnung";
        items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
      } else if (ni.mode === "akonto-percent") {
        const amt = (q.sub || 0) * (ni.pct / 100);
        items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }];
      } else {
        items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
      }
      let notes = `Gemäss Offerte ${q.number}. Zahlbar innert 30 Tagen netto.`;
      if (invoiceKind === "schluss" && existing.filter(i => i.invoiceKind !== "schluss").length > 0) {
        const akontoInvs = existing.filter(i => i.invoiceKind !== "schluss" && i.status !== "entwurf");
        notes = `Schlussrechnung gemäss Offerte ${q.number}.\nBisherige Akonto-/Teilzahlungen:\n${akontoInvs.map(i => `  – ${i.number}: CHF ${(i.subAfterDisc ?? i.sub ?? 0).toFixed(2)}`).join("\n")}\n\nZahlbar innert 30 Tagen netto.`;
      }
      setForm({ ...base, clientId: q.clientId || "", projectId: q.projectId || "", quoteId: q.id, entrySelections: {}, invoiceKind, items, notes });
    }
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

  const { sub, globalDisc, subAfterDisc, tax, total } = calcTotal(form.items, form.mwst, form.mwstRate ?? data.settings.mwstRate, form.discountType, form.discountValue);

  // Verfügbare Jahre aus Rechnungen sammeln
  const availableYears = Array.from(new Set(invoices.map(i => (i.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();

  // Filter-Matching
  const matchesFilter = (inv: Invoice) => {
    if (filter.status && inv.status !== filter.status) return false;
    if (filter.clientId && inv.clientId !== filter.clientId) return false;
    if (filter.year && !(inv.date || "").startsWith(filter.year)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const client = clients.find(c => c.id === inv.clientId);
      const haystack = [
        inv.number,
        client?.name,
        client?.company,
        inv.notes,
        ...(inv.items || []).map(it => it.desc)
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  };

  const filtered = [...invoices].filter(matchesFilter).sort((a, b) => {
    let va, vb;
    if (sort.col === "number") { va = a.number || ""; vb = b.number || ""; }
    else if (sort.col === "date") { va = a.date || ""; vb = b.date || ""; }
    else if (sort.col === "dueDate") { va = a.dueDate || ""; vb = b.dueDate || ""; }
    else if (sort.col === "client") { va = clients.find(c => c.id === a.clientId)?.name || ""; vb = clients.find(c => c.id === b.clientId)?.name || ""; }
    else if (sort.col === "total") { va = a.total || 0; vb = b.total || 0; }
    else if (sort.col === "status") { va = a.status || ""; vb = b.status || ""; }
    else { va = a.date || ""; vb = b.date || ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });
  const filteredTotal = filtered.reduce((s, i) => s + (i.total || 0), 0);
  const filteredOpen = filtered.filter(i => i.status === "gesendet" || i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
  const filteredOverdue = filtered.filter(i => i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
  const filteredPaid = filtered.filter(i => i.status === "bezahlt").reduce((s, i) => s + (i.total || 0), 0);

  // Unverrechnete Stunden über alle aktiven Stundensatz-Projekte (global)
  const unbilledProjects = data.projects
    .filter(p => (p.billingType || p.type) === "stundensatz" && p.status === "aktiv")
    .map(p => {
      const mins = data.timeEntries.filter(e => e.projectId === p.id && !e.invoiceId).reduce((s, e) => s + (e.minutes || 0), 0);
      const amount = (mins / 60) * (p.hourlyRate || 0);
      return { ...p, mins, amount };
    })
    .filter(p => p.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const totalUnbilledMins = unbilledProjects.reduce((s, p) => s + p.mins, 0);
  const totalUnbilledAmount = unbilledProjects.reduce((s, p) => s + p.amount, 0);

  // Gruppieren
  const groupedInvoices: { key: string; label: string; items: Invoice[] }[] = (() => {
    if (groupBy === "date") {
      const months: Record<string, Invoice[]> = {};
      filtered.forEach(inv => {
        const key = (inv.date || "").slice(0, 7);
        if (!months[key]) months[key] = [];
        months[key].push(inv);
      });
      return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => ({
        key, label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum", items,
      }));
    }
    if (groupBy === "client") {
      const groups: Record<string, { label: string; items: Invoice[] }> = {};
      filtered.forEach(inv => {
        const cl = clients.find(c => c.id === inv.clientId);
        const key = inv.clientId || "__none__";
        const label = cl?.name || "Kein Kunde";
        if (!groups[key]) groups[key] = { label, items: [] };
        groups[key].items.push(inv);
      });
      return Object.entries(groups).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, val]) => ({ key, label: val.label, items: val.items }));
    }
    if (groupBy === "status") {
      const statuses: Record<string, Invoice[]> = {};
      filtered.forEach(inv => {
        const key = inv.status || "unbekannt";
        if (!statuses[key]) statuses[key] = [];
        statuses[key].push(inv);
      });
      return Object.entries(statuses).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), items }));
    }
    return [{ key: "all", label: "", items: filtered }];
  })();

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Rechnungen" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { setAp({ ...emptyAp, startDate: defaultStartDate() }); setAkontoModal(true); }}>Akonto planen</button>
          <button className="btn btn-primary" onClick={() => { setNi({ tab: "projekt", projectId: "", quoteId: "", mode: "akonto-stunden", pct: 30, amt: 0 }); setNewInvModal(true); }}>+ Neue Rechnung</button>
        </div>
      } />

      {/* KPI-Cards */}
      <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        <KpiCard label="BEZAHLT" value={formatCHF(filteredPaid)} color="var(--positive)"
          sub={`${filtered.filter(i => i.status === "bezahlt").length} Rechnung(en)`} />
        <KpiCard label="AUSSTEHEND" value={formatCHF(filteredOpen)} color={filteredOverdue > 0 ? "var(--negative)" : "var(--pending)"}
          sub={filteredOverdue > 0 ? <span style={{ color: "var(--negative)" }}>davon {formatCHF(filteredOverdue)} überfällig</span> : `${filtered.filter(i => i.status === "gesendet" || i.status === "überfällig").length} Rechnung(en)`} />
        <KpiCard label="UNVERRECHNETE STUNDEN" value={formatHours(totalUnbilledMins)} color={totalUnbilledMins > 0 ? "var(--warning)" : "#aaa"}
          sub={totalUnbilledAmount > 0 ? `≈ ${formatCHF(totalUnbilledAmount)}` : "Alle verrechnet ✓"} />
        <div className="card" style={{ borderTop: "3px solid var(--text2)", height: "100%", boxSizing: "border-box" }}>
          <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.12em", marginBottom: 8 }}>PROJEKTE MIT PENDENZEN</div>
          {unbilledProjects.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text5)", marginTop: 4 }}>Keine offenen Stunden</div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>{unbilledProjects.length} Projekt{unbilledProjects.length !== 1 ? "e" : ""}</div>
              {unbilledProjects.slice(0, 4).map(p => (
                <div key={p.id} style={{ marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text4)", marginBottom: 2 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{p.name}</span>
                    <span style={{ flexShrink: 0 }}>{formatHours(p.mins)}</span>
                  </div>
                  <div style={{ height: 3, background: "var(--border2)", borderRadius: 2 }}>
                    <div style={{ width: `${(p.mins / unbilledProjects[0].mins) * 100}%`, height: "100%", background: "var(--warning)", borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Nr., Kunde, Beschreibung…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 220 }} />
        <select className="pill" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Alle Status</option>
          {["entwurf", "gesendet", "bezahlt", "überfällig"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="pill" value={filter.clientId} onChange={e => setFilter({ ...filter, clientId: e.target.value })}>
          <option value="">Alle Kunden</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="pill" value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}>
          <option value="">Alle Jahre</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {(filter.status || filter.clientId || filter.year || filter.search) && (
          <button className="btn btn-ghost" onClick={() => setFilter({ status: "", clientId: "", year: "", search: "" })} style={{ fontSize: 12 }}>Zurücksetzen</button>
        )}
      </div>

      <div className="filter-bar">
        <span className="filter-label">GRUPPIEREN:</span>
        {[{ id: "none", label: "Keine" }, { id: "date", label: "Monat" }, { id: "client", label: "Kunde" }, { id: "status", label: "Status" }].map(g => (
          <button key={g.id} className={`pill${groupBy === g.id ? " active" : ""}`} onClick={() => setGroupBy(g.id)}>{g.label}</button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)", textAlign: "right" }}>
          <div><strong style={{ color: "var(--text)" }}>{filtered.length}</strong> {filtered.length === 1 ? "Rechnung" : "Rechnungen"} · {formatCHF(filteredTotal)}</div>
          {filteredOpen > 0 && <div style={{ color: "var(--warning)" }}>davon offen: {formatCHF(filteredOpen)}</div>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 100 }}>Nr.</SortTh><SortTh sort={sort} onSort={toggleSort} col="client">Kunde</SortTh><th>Art</th><SortTh sort={sort} onSort={toggleSort} col="date">Datum</SortTh><SortTh sort={sort} onSort={toggleSort} col="dueDate">Fällig</SortTh><SortTh sort={sort} onSort={toggleSort} col="total" style={{ textAlign: "right" }}>Betrag</SortTh><SortTh sort={sort} onSort={toggleSort} col="status">Status</SortTh><th></th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} className="empty-state">{invoices.length === 0 ? "Noch keine Rechnungen" : "Keine Treffer"}</td></tr>}
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
          {(() => {
            if (!form.projectId) return null;
            const proj = data.projects.find(p => p.id === form.projectId);
            if (!proj) return null;
            const bType = proj.billingType || proj.type;
            if (bType !== "stundensatz") return null;
            const openEntries = openEntriesForProject(form.projectId);
            if (openEntries.length === 0) return (
              <div style={{ padding: 14, background: "var(--surface2)", borderRadius: 6, marginBottom: 14, fontSize: 12, color: "var(--text4)" }}>
                Keine offenen Zeiteinträge für dieses Projekt.
              </div>
            );
            const totalErfasst = openEntries.reduce((s, e) => s + e.minutes, 0);
            const totalVerrechnet = Object.entries(form.entrySelections || {})
              .filter(([id, s]) => s.selected && openEntries.some(e => e.id === id))
              .reduce((s, [_, sel]) => s + (sel.billedMinutes || 0), 0);
            const diff = totalErfasst - totalVerrechnet;
            const allSelected = openEntries.every(e => form.entrySelections?.[e.id]?.selected);
            const toggleAll = () => {
              const newSel = { ...form.entrySelections };
              if (allSelected) {
                openEntries.forEach(e => { newSel[e.id] = { ...newSel[e.id], selected: false }; });
              } else {
                openEntries.forEach(e => { newSel[e.id] = { selected: true, billedMinutes: newSel[e.id]?.billedMinutes ?? e.minutes }; });
              }
              setForm(f => ({ ...f, entrySelections: newSel }));
            };
            return (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label>ZEITEINTRÄGE</label>
                  <div style={{ fontSize: 11, color: "var(--text4)" }}>
                    Erfasst {formatHours(totalErfasst)} · Verrechnet {formatHours(totalVerrechnet)}
                    {diff > 0 && <span style={{ color: "var(--warning)", marginLeft: 8 }}>Nicht verrechnet: {formatHours(diff)}</span>}
                  </div>
                </div>
                <div style={{ background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", maxHeight: 280, overflowY: "auto" }}>
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f0ebe3" }}>
                        <th style={{ width: 36, padding: "6px 8px" }}>
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: "auto", cursor: "pointer" }} />
                        </th>
                        <th style={{ width: 90, padding: "6px 8px" }}>Datum</th>
                        <th style={{ width: 60, padding: "6px 8px" }}>Phase</th>
                        <th style={{ padding: "6px 8px" }}>Tätigkeit</th>
                        <th style={{ width: 70, padding: "6px 8px", textAlign: "right" }}>Erfasst</th>
                        <th style={{ width: 100, padding: "6px 8px", textAlign: "right" }}>Verrechnet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openEntries.map(e => {
                        const sel = form.entrySelections?.[e.id];
                        const selected = sel?.selected;
                        const billedMinutes = selected ? (sel?.billedMinutes ?? e.minutes) : 0;
                        const hoursBilled = Math.round((billedMinutes / 60) * 100) / 100;
                        const phase = SIA_PHASES.find(p => p.id === e.phaseId);
                        const pos = (proj?.positions || []).find(p => p.code === e.positionId);
                        return (
                          <tr key={e.id} style={{ opacity: selected ? 1 : 0.5 }}>
                            <td style={{ padding: "5px 8px" }}>
                              <input type="checkbox" checked={!!selected} onChange={() => toggleEntrySelection(e.id, e)} style={{ width: "auto", cursor: "pointer" }} />
                            </td>
                            <td style={{ padding: "5px 8px" }}>{formatDate(e.date)}</td>
                            <td style={{ padding: "5px 8px", color: "var(--text4)" }}>
                              {phase?.id || "—"}
                              {pos && <span style={{ marginLeft: 4, fontWeight: 600, color: "var(--pending)", fontSize: 10, background: "#fffbe8", padding: "0 4px", borderRadius: 20 }}>{pos.code}</span>}
                            </td>
                            <td style={{ padding: "5px 8px", color: "var(--text3)" }}>{e.description || "—"}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--text4)" }}>{formatHours(e.minutes)}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right" }}>
                              {selected ? (
                                <input type="number" step="0.25" min={0}
                                  value={hoursBilled}
                                  onChange={ev => updateBilledMinutes(e.id, Math.round(+ev.target.value * 60))}
                                  style={{ width: 70, height: 26, fontSize: 11, textAlign: "right", padding: "2px 6px" }} />
                              ) : <span style={{ color: "var(--text5)" }}>—</span>}
                              {selected && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 3 }}>h</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

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
      )}

      {newInvModal && (() => {
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
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setNewInvModal(false)}>
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
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", display: "block", marginBottom: 5 }}>PROJEKT</label>
                    <select value={ni.projectId} onChange={e => {
                      const selProj = (data.projects || []).find(p => p.id === e.target.value);
                      const selBType = selProj ? (selProj.billingType || selProj.type) : "";
                      setNi(n => ({ ...n, projectId: e.target.value, mode: selBType === "stundensatz" ? "teilrechnung" : selBType === "pauschal" ? "akonto-percent" : n.mode }));
                    }} style={!ni.projectId ? { borderColor: "var(--warning)" } : {}}>
                      <option value="">— Projekt wählen —</option>
                      {(data.projects || []).filter(p => p.status !== "archiviert").map(p => {
                        const bt = p.billingType || p.type;
                        const openMins = bt === "stundensatz" ? data.timeEntries.filter(e => e.projectId === p.id && !e.invoiceId).reduce((s, e) => s + e.minutes, 0) : 0;
                        return <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}{openMins > 0 ? ` (${formatHours(openMins)} offen)` : ""}</option>;
                      })}
                    </select>
                  </div>
                  {proj && (() => {
                    const projBudget = proj.budget || proj.budgetAmount || 0;
                    const hasPhaseBudget = (proj.phasesBudget || []).filter(p => p.hours > 0).length > 0;
                    const kind = ni.mode === "schluss" ? "schluss"
                      : (ni.mode === "akonto-percent" || ni.mode === "akonto-amount" || ni.mode === "akonto-phase" || ni.mode === "akonto-stunden") ? "akonto"
                      : "teilrechnung";
                    const subMode = ni.mode === "akonto-percent" || ni.mode === "teilrechnung-percent" ? "percent"
                      : ni.mode === "akonto-amount" || ni.mode === "teilrechnung-amount" ? "amount"
                      : ni.mode === "akonto-phase" || ni.mode === "phase" ? "phase"
                      : "stunden";

                    const KindBtn = ({ id, label, color }: { id: string; label: string; color: string }) => {
                      const active = kind === id;
                      return (
                        <button onClick={() => {
                          if (id === "schluss") return setNi(n => ({ ...n, mode: "schluss" }));
                          if (id === "akonto") return setNi(n => ({ ...n, mode: bType === "stundensatz" ? "akonto-stunden" : "akonto-percent" }));
                          setNi(n => ({ ...n, mode: bType === "stundensatz" ? "teilrechnung" : "teilrechnung-percent" }));
                        }} style={{
                          flex: 1, padding: "10px 8px", border: `2px solid ${active ? color : "#ddd8d0"}`,
                          borderRadius: 8, background: active ? color : "transparent",
                          color: active ? "#fff" : "var(--text3)", fontFamily: "inherit", fontSize: 12,
                          fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em",
                        }}>{label}</button>
                      );
                    };

                    const SubBtn = ({ id, label }: { id: string; label: string }) => {
                      const active = subMode === id;
                      return (
                        <button onClick={() => setNi(n => ({ ...n, mode: kind === "akonto"
                          ? (id === "percent" ? "akonto-percent" : id === "amount" ? "akonto-amount" : id === "phase" ? "akonto-phase" : "akonto-stunden")
                          : (id === "percent" ? "teilrechnung-percent" : id === "amount" ? "teilrechnung-amount" : id === "phase" ? "phase" : "teilrechnung")
                        }))} style={{
                          padding: "5px 12px", border: `1.5px solid ${active ? "#1a1a18" : "#ddd8d0"}`,
                          borderRadius: 20, background: active ? "#1a1a18" : "transparent",
                          color: active ? "#f0ede8" : "var(--text3)", fontFamily: "inherit",
                          fontSize: 11, cursor: "pointer",
                        }}>{label}</button>
                      );
                    };

                    const PhaseList = () => {
                      // Eine Phase gilt als "schon verrechnet", sobald sie in
                      // irgendeiner nicht-Schluss-Rechnung auftaucht — Denylist
                      // statt Allowlist auf invoiceKind, sonst liesse sich eine
                      // manuell verknüpfte Rechnung (invoiceKind==="") oder ein
                      // Moduswechsel zur doppelten Fakturierung derselben Phase
                      // missbrauchen (Runde-4/6-Fund zum selben Muster).
                      const billedInvs = invoices.filter(i => i.projectId === proj.id && i.invoiceKind !== "schluss" && i.status !== "entwurf");
                      return (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
                          {(proj.phasesBudget || []).filter(p => p.hours > 0).map(ph => {
                            const phInfo = SIA_PHASES.find(p => p.id === ph.id);
                            const amt = Math.round(ph.hours * (proj.hourlyRate || 0) * 100) / 100;
                            const alreadyBilled = billedInvs.some(i => (i.items || []).some(it => (it.desc || "").includes(phInfo?.label || ph.id)));
                            const isSelected = ni.phaseId === ph.id;
                            return (
                              <div key={ph.id} onClick={() => !alreadyBilled && setNi(n => ({ ...n, phaseId: ph.id }))} style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "7px 4px",
                                borderBottom: "1px solid var(--border2)", cursor: alreadyBilled ? "not-allowed" : "pointer",
                                opacity: alreadyBilled ? 0.4 : 1,
                              }}>
                                <div style={{ width: 13, height: 13, borderRadius: "50%", flexShrink: 0, border: isSelected ? `4px solid ${kind === "akonto" ? "#b07848" : "#2d5a8e"}` : "2px solid #ccc" }} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500 }}>{phInfo?.label || ph.id}</div>
                                  <div style={{ fontSize: 10, color: "var(--text4)" }}>{ph.hours}h × {formatCHF(proj.hourlyRate || 0)}/h = <strong>{formatCHF(amt)}</strong></div>
                                </div>
                                {alreadyBilled && <span style={{ fontSize: 10, color: "var(--positive)", background: "var(--positive-bg)", padding: "2px 6px", borderRadius: 20 }}>✓ verrechnet</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    };

                    return (
                      <>
                        {/* Ebene 1: Art der Rechnung */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                          <KindBtn id="akonto" label="Akonto" color="#b07848" />
                          <KindBtn id="teilrechnung" label="Teilrechnung" color="#2d5a8e" />
                          <KindBtn id="schluss" label="Schlussrechnung" color="#1a1a18" />
                        </div>

                        {/* Ebene 2: Sub-Optionen */}
                        {kind !== "schluss" && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                            {bType === "stundensatz" && <SubBtn id="stunden" label="Stunden" />}
                            <SubBtn id="percent" label="% vom Budget" />
                            <SubBtn id="amount" label="Fixer Betrag" />
                            {hasPhaseBudget && <SubBtn id="phase" label="Nach SIA-Phase" />}
                          </div>
                        )}

                        {/* Inputs */}
                        {kind !== "schluss" && subMode === "percent" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${kind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                            <input type="number" min={1} max={100} step="1" value={ni.pct} onChange={e => setNi(n => ({ ...n, pct: Math.max(0, Math.min(100, +e.target.value || 0)) }))} style={{ width: 80, textAlign: "right", background: "var(--surface)" }} />
                            <span style={{ fontSize: 13, color: "var(--text3)" }}>% von {formatCHF(projBudget)} = <strong>{formatCHF(projBudget * ni.pct / 100)}</strong></span>
                          </div>
                        )}
                        {kind !== "schluss" && subMode === "amount" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${kind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                            <span style={{ fontSize: 13, color: "var(--text3)" }}>CHF</span>
                            <input type="number" min={0} step="50" value={ni.amt} onChange={e => setNi(n => ({ ...n, amt: Math.max(0, +e.target.value || 0) }))} style={{ width: 140, textAlign: "right", background: "var(--surface)" }} />
                          </div>
                        )}
                        {kind !== "schluss" && subMode === "phase" && hasPhaseBudget && (
                          <PhaseList />
                        )}

                        {/* Schluss-Info */}
                        {kind === "schluss" && (
                          <div style={{ padding: "10px 14px", background: "var(--surface3)", borderRadius: 6, fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                            {bType === "stundensatz"
                              ? "Alle restlichen offenen Stunden bis heute."
                              : `Gesamthonorar ${formatCHF(projBudget)} abzgl. bisherige Akonto- und Teilrechnungen.`}
                          </div>
                        )}

                        {/* Stunden-Info */}
                        {bType === "stundensatz" && kind !== "schluss" && subMode === "stunden" && (
                          <div style={{ padding: "8px 14px", background: kind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, fontSize: 11, color: kind === "akonto" ? "#b07848" : "#2d5a8e", marginBottom: 10 }}>
                            Alle offenen Stunden bis heute vorausgewählt — im nächsten Schritt einzeln ab-/anwählbar.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}

              {ni.tab === "offerte" && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", display: "block", marginBottom: 5 }}>OFFERTE</label>
                    <select value={ni.quoteId} onChange={e => setNi(n => ({ ...n, quoteId: e.target.value }))} style={!ni.quoteId ? { borderColor: "var(--warning)" } : {}}>
                      <option value="">— Offerte wählen —</option>
                      {(data.quotes || []).map(x => {
                        const alrInv = (invoices).filter(i => i.quoteId === x.id || (x.projectId && i.projectId === x.projectId)).reduce((s, i) => s + (i.sub || 0), 0);
                        const rem = Math.max(0, (x.sub || 0) - alrInv);
                        return <option key={x.id} value={x.id}>{x.number}{x.projectName ? ` · ${x.projectName}` : ""} — {formatCHF(x.total)}{alrInv > 0 ? ` (offen: ${formatCHF(rem)})` : ""}</option>;
                      })}
                    </select>
                  </div>
                  {q && (() => {
                    const alrInv = (invoices).filter(i => i.quoteId === q.id || (q.projectId && i.projectId === q.projectId)).reduce((s, i) => s + (i.sub || 0), 0);
                    const rem = Math.max(0, (q.sub || 0) - alrInv);
                    const qKind = ni.mode === "schluss" ? "schluss"
                      : (ni.mode === "akonto-percent" || ni.mode === "akonto-amount") ? "akonto"
                      : "teilrechnung";
                    const qSubMode = (ni.mode === "akonto-percent" || ni.mode === "teilrechnung-percent") ? "percent" : "amount";

                    const QKindBtn = ({ id, label, color }: { id: string; label: string; color: string }) => {
                      const active = qKind === id;
                      return (
                        <button onClick={() => {
                          if (id === "schluss") return setNi(n => ({ ...n, mode: "schluss" }));
                          if (id === "akonto") return setNi(n => ({ ...n, mode: "akonto-percent" }));
                          setNi(n => ({ ...n, mode: "teilrechnung-percent" }));
                        }} style={{
                          flex: 1, padding: "10px 8px", border: `2px solid ${active ? color : "#ddd8d0"}`,
                          borderRadius: 8, background: active ? color : "transparent",
                          color: active ? "#fff" : "var(--text3)", fontFamily: "inherit", fontSize: 12,
                          fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em",
                        }}>{label}</button>
                      );
                    };

                    const QSubBtn = ({ id, label }: { id: string; label: string }) => {
                      const active = qSubMode === id;
                      return (
                        <button onClick={() => setNi(n => ({ ...n, mode: qKind === "akonto"
                          ? (id === "percent" ? "akonto-percent" : "akonto-amount")
                          : (id === "percent" ? "teilrechnung-percent" : "teilrechnung-amount")
                        }))} style={{
                          padding: "5px 12px", border: `1.5px solid ${active ? "#1a1a18" : "#ddd8d0"}`,
                          borderRadius: 20, background: active ? "#1a1a18" : "transparent",
                          color: active ? "#f0ede8" : "var(--text3)", fontFamily: "inherit",
                          fontSize: 11, cursor: "pointer",
                        }}>{label}</button>
                      );
                    };

                    return (
                      <>
                        {alrInv > 0 && (
                          <div style={{ marginBottom: 14, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text3)" }}><span>Total Offerte</span><span>{formatCHF(q.sub)}</span></div>
                            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--positive)" }}><span>Bereits verrechnet</span><span>{formatCHF(alrInv)}</span></div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--warning)", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border2)" }}><span>Restbetrag</span><span>{formatCHF(rem)}</span></div>
                          </div>
                        )}

                        {/* Ebene 1: Art der Rechnung */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                          <QKindBtn id="akonto" label="Akonto" color="#b07848" />
                          <QKindBtn id="teilrechnung" label="Teilrechnung" color="#2d5a8e" />
                          <QKindBtn id="schluss" label="Schlussrechnung" color="#1a1a18" />
                        </div>

                        {/* Ebene 2: Sub-Optionen */}
                        {qKind !== "schluss" && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                            <QSubBtn id="percent" label="% vom Gesamthonorar" />
                            <QSubBtn id="amount" label="Fixer Betrag" />
                          </div>
                        )}

                        {/* Inputs */}
                        {qKind !== "schluss" && qSubMode === "percent" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: qKind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${qKind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                            <input type="number" min={1} max={100} step="1" value={ni.pct} onChange={e => setNi(n => ({ ...n, pct: Math.max(0, Math.min(100, +e.target.value || 0)) }))} style={{ width: 80, textAlign: "right", background: "var(--surface)" }} />
                            <span style={{ fontSize: 13, color: "var(--text3)" }}>% von {formatCHF(q.sub || 0)} = <strong>{formatCHF((q.sub || 0) * ni.pct / 100)}</strong></span>
                          </div>
                        )}
                        {qKind !== "schluss" && qSubMode === "amount" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: qKind === "akonto" ? "#fff8ed" : "#edf2fa", borderRadius: 6, border: `1px solid ${qKind === "akonto" ? "#f0e4c4" : "#c4d4ea"}`, marginBottom: 10 }}>
                            <span style={{ fontSize: 13, color: "var(--text3)" }}>CHF</span>
                            <input type="number" min={0} step="50" value={ni.amt} onChange={e => setNi(n => ({ ...n, amt: Math.max(0, +e.target.value || 0) }))} style={{ width: 140, textAlign: "right", background: "var(--surface)" }} />
                          </div>
                        )}

                        {/* Schluss-Info */}
                        {qKind === "schluss" && (
                          <div style={{ padding: "10px 14px", background: "var(--surface3)", borderRadius: 6, fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                            {`Gesamthonorar ${formatCHF(q.sub || 0)} abzgl. bisherige Akonto- und Teilrechnungen.`}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
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
                <button className="btn btn-ghost" onClick={() => setNewInvModal(false)}>Abbrechen</button>
                <button className="btn btn-primary" onClick={confirmNewInvoice} disabled={!canConfirm} style={{ opacity: canConfirm ? 1 : 0.4 }}>
                  {ni.tab === "frei" ? "Leere Rechnung erstellen" : "Weiter →"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Akonto-Planer Modal ── */}
      {akontoModal && (() => {
        const apProj = data.projects.find(p => p.id === ap.projectId);
        const apBudget = apProj ? (apProj.budget || apProj.budgetAmount || 0) : 0;
        const apTotal = apRows.reduce((s, r) => s + (r.amt || 0), 0);
        const canCreate = apRows.length > 0 && apRows.every(r => r.date && r.amt > 0) && (ap.projectId || ap.clientId);
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAkontoModal(false)}>
            <div className="modal" style={{ maxWidth: 540 }}>
              <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 22, marginBottom: 20 }}>Akonto-Plan erstellen</h2>

              {/* Projekt */}
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <label>Projekt</label>
                  <select value={ap.projectId} onChange={e => {
                    const p = data.projects.find(x => x.id === e.target.value);
                    setAp(a => ({ ...a, projectId: e.target.value, clientId: p?.clientId || a.clientId, totalAmt: p ? (p.budget || p.budgetAmount || 0) : a.totalAmt }));
                  }}>
                    <option value="">— Projekt wählen —</option>
                    {data.projects.filter(p => p.status !== "archiviert").map(p => (
                      <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Kunde</label>
                  <select value={ap.clientId} onChange={e => setAp(a => ({ ...a, clientId: e.target.value }))}>
                    <option value="">— Kunde —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Gesamtbetrag */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Gesamthonorar (Netto, exkl. MWST)
                  {apBudget > 0 && <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text5)", marginLeft: 6 }}>Budget: {formatCHF(apBudget)}</span>}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="number" step="500" min={0} value={ap.totalAmt} onChange={e => setAp(a => ({ ...a, totalAmt: +e.target.value }))}
                    style={{ width: 180, textAlign: "right" }} />
                  {apBudget > 0 && ap.totalAmt !== apBudget && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                      onClick={() => setAp(a => ({ ...a, totalAmt: apBudget }))}>= Budget übernehmen</button>
                  )}
                </div>
              </div>

              {/* Verteilung */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>VERTEILUNG</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {[{ id: "interval", label: "Gleichmässig" }, { id: "manual", label: "Manuell" }].map(m => (
                    <button key={m.id} onClick={() => setAp(a => ({
                      ...a, mode: m.id as AkontoPlan["mode"],
                      manualRows: m.id === "manual" && a.mode === "interval"
                        ? apRows.map(r => ({ ...r, id: generateId() }))
                        : a.manualRows,
                    }))} style={{
                      padding: "6px 14px", fontSize: 12, borderRadius: 20, border: "1.5px solid",
                      borderColor: ap.mode === m.id ? "var(--text)" : "#c8c0b8",
                      background: ap.mode === m.id ? "#1a1a18" : "transparent",
                      color: ap.mode === m.id ? "#f0ede8" : "var(--text3)",
                      cursor: "pointer", fontFamily: "inherit",
                    }}>{m.label}</button>
                  ))}
                </div>

                {ap.mode === "interval" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Erste Rechnung</div>
                      <DateInput value={ap.startDate} onChange={e => setAp(a => ({ ...a, startDate: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Intervall (Monate)</div>
                      <input type="number" min={1} max={24} step={1} value={ap.intervalMonths}
                        onChange={e => setAp(a => ({ ...a, intervalMonths: Math.max(1, +e.target.value) }))} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Anzahl Raten</div>
                      <input type="number" min={1} max={24} step={1} value={ap.count}
                        onChange={e => setAp(a => ({ ...a, count: Math.max(1, +e.target.value) }))} />
                    </div>
                  </div>
                )}
              </div>

              {/* Vorschau / Manuell-Tabelle */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>VORSCHAU — {apRows.length} ENTWÜRFE</div>
                  {ap.mode === "manual" && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                      onClick={() => setAp(a => ({ ...a, manualRows: [...a.manualRows, { id: generateId(), date: "", amt: 0 }] }))}>
                      + Zeile
                    </button>
                  )}
                </div>
                <div style={{ border: "1px solid var(--border2)", borderRadius: 6, overflow: "hidden" }}>
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--surface3)" }}>
                        <th style={{ width: 28, padding: "6px 8px", textAlign: "center", color: "var(--text4)", fontWeight: 500 }}>#</th>
                        <th style={{ padding: "6px 8px", color: "var(--text4)", fontWeight: 500 }}>Datum</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)", fontWeight: 500 }}>Betrag netto</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)", fontWeight: 500 }}>Total inkl. MWST</th>
                        {ap.mode === "manual" && <th style={{ width: 28 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {apRows.map((row, i) => {
                        const mwstAmt = row.amt * (data.settings.mwstRate / 100);
                        return (
                          <tr key={row.id} style={{ borderTop: "1px solid var(--border2)" }}>
                            <td style={{ padding: "6px 8px", textAlign: "center", color: "var(--text4)" }}>{i + 1}</td>
                            <td style={{ padding: "6px 8px" }}>
                              {ap.mode === "manual"
                                ? <DateInput value={row.date} onChange={e => setAp(a => ({ ...a, manualRows: a.manualRows.map(r => r.id === row.id ? { ...r, date: e.target.value } : r) }))} style={{ height: 28, fontSize: 12 }} />
                                : <span style={{ color: row.date ? "var(--text)" : "var(--text5)" }}>{row.date ? formatDate(row.date) : "—"}</span>}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>
                              {ap.mode === "manual"
                                ? <input type="number" step="100" min={0} value={row.amt} onChange={e => setAp(a => ({ ...a, manualRows: a.manualRows.map(r => r.id === row.id ? { ...r, amt: +e.target.value } : r) }))} style={{ width: 110, height: 28, fontSize: 12, textAlign: "right" }} />
                                : <strong>{formatCHF(row.amt)}</strong>}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)" }}>
                              {formatCHF(roundCHF(row.amt + mwstAmt))}
                            </td>
                            {ap.mode === "manual" && (
                              <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                <button onClick={() => setAp(a => ({ ...a, manualRows: a.manualRows.filter(r => r.id !== row.id) }))}
                                  style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "1.5px solid var(--border3)", background: "var(--surface2)" }}>
                        <td colSpan={2} style={{ padding: "7px 8px", fontSize: 11, color: "var(--text4)" }}>Total</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700 }}>{formatCHF(apTotal)}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700 }}>{formatCHF(roundCHF(apTotal * (1 + (data.settings.mwstRate || 0) / 100)))}</td>
                        {ap.mode === "manual" && <td></td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 6 }}>Werden als Entwurf gespeichert — Nummern, Beschreibungen und Beträge danach noch editierbar.</div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
                <button className="btn btn-ghost" onClick={() => setAkontoModal(false)}>Abbrechen</button>
                <button className="btn btn-primary" onClick={createAkontoInvoices} disabled={!canCreate} style={{ opacity: canCreate ? 1 : 0.4 }}>
                  {apRows.length} Entwürfe erstellen →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {sendModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSendModal(null)}>
          <div className="modal" style={{ maxWidth: 360 }}>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 18, marginBottom: 16 }}>Rechnung {sendModal.number}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => {
                update("invoices", invoices.map(i => i.id === sendModal.id ? { ...i, status: "gesendet", sentDate: localISODate() } : i));
                setSendModal(null);
              }}>Als versendet markieren</button>
              <button className="btn btn-ghost" onClick={() => {
                update("invoices", invoices.map(i => i.id === sendModal.id ? { ...i, status: "gesendet", sentDate: localISODate() } : i));
                setSendModal(null);
                setPrintContent({ type: "invoice+qr", inv: sendModal, client: clients.find(c => c.id === sendModal.clientId) });
              }}>Versendet + PDF drucken</button>
              <button className="btn btn-ghost" onClick={() => {
                update("invoices", invoices.map(i => i.id === sendModal.id ? { ...i, status: "entwurf" } : i));
                setSendModal(null);
              }}>Als Entwurf speichern</button>
              <button className="btn btn-ghost" style={{ border: "none", boxShadow: "none" }} onClick={() => setSendModal(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
