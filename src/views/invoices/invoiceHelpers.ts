// Reine Hilfen der Rechnungsansicht (views/invoices/): Formular-Typen, Summenberechnung, Rechnungsnummern
// und die Erzeugung der Akonto-Plan-Rechnungen. Keine React-Abhängigkeiten.

import { deriveQuoteBudget, generateId, localISODate, migrateLinkedQuotes, roundCHF } from "../../utils";
import type { AppData, Invoice, InvoiceItem, Project, Quote, Role, TimeEntry } from "../../types";

/**
 * Formularstand einer Rechnung: Id und Summen kommen erst beim Speichern dazu; die Positionsliste ist immer
 * vorhanden. `hoursFromEntries` (nur im Formular, wird nicht gespeichert): Zeile 1 ist «gewählte Stunden ×
 * Stundensatz» und folgt der Auswahl der Zeiteinträge.
 */
export type InvoiceForm = Partial<Invoice> & Pick<Invoice, "items"> & { hoursFromEntries?: boolean };

/** Zustand des Dialogs «Neue Rechnung» (Quelle: Projekt oder Offerte, Art der Rechnung). */
export type NewInvoiceState = { tab: string; projectId?: string; quoteId?: string; mode: string; pct: number; amt: number; phaseId?: string; [key: string]: unknown };
/** Zustand des Akonto-Planers. */
export type AkontoPlan = { projectId: string; clientId: string; totalAmt: number; mode: "interval" | "manual"; intervalMonths: number; count: number; startDate: string; manualRows: { id: string; date: string; amt: number }[] };
/** Zeiteintrags-Auswahl einer Rechnung (verrechnete Minuten je Eintrag). */
export type EntrySelections = NonNullable<Invoice["entrySelections"]>;

/**
 * Summen einer Rechnung: Zwischentotal, Gesamtrabatt, Netto nach Rabatt, MWST und Total. Alle Beträge auf
 * Rappen gerundet; das Total ist die Summe aus gerundetem Netto und gerundeter MWST, damit Netto + MWST auf
 * Rechnung, PDF und QR-Zahlteil genau das Total ergeben.
 */
export const calcTotal = (items: InvoiceItem[] | undefined, mwst: boolean | undefined, rate: number, discountType?: string, discountValue?: number) => {
  const sub = roundCHF((items || []).reduce((s, i) => {
    const line = i.qty * i.price;
    const disc = (i.discount || 0) > 0 ? line * ((i.discount || 0) / 100) : 0;
    return s + line - disc;
  }, 0));
  const globalDisc = roundCHF(discountType === "percent" ? sub * ((discountValue || 0) / 100)
    : discountType === "amount" ? (discountValue || 0) : 0);
  const subAfterDisc = roundCHF(sub - globalDisc);
  const tax = mwst ? roundCHF(subAfterDisc * (rate / 100)) : 0;
  const total = roundCHF(subAfterDisc + tax);
  return { sub, globalDisc, subAfterDisc, tax, total };
};

/** Zeilentotal einer Position inklusive Zeilenrabatt. */
export const calcLineTotal = (item: Pick<InvoiceItem, "qty" | "price" | "discount">) => {
  const line = (item.qty || 0) * (item.price || 0);
  return line * (1 - ((item.discount || 0) / 100));
};

/**
 * Nächste Rechnungsnummer nach dem konfigurierten Format. Jahr und Monat (YYYY/YY/MM) kommen aus dem
 * Rechnungsdatum `date` (Standard: heute); die laufende Nummer zählt pro Jahr bzw. pro Präfix weiter.
 */
export const nextInvoiceNumber = (invoices: Pick<Invoice, "number">[], format: string | undefined, date: string = localISODate()) => {
  const fmt = format || "YYYY-NNN";
  const yyyy = date.slice(0, 4);
  const yy = yyyy.slice(2);
  const mm = date.slice(5, 7);
  // Suchmuster aus dem Format: Jahr fest, Monat beliebig (laufende Nummer gilt fürs ganze Jahr)
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

/** true, wenn eine andere Rechnung (Id ≠ `ownId`) schon die Nummer `number` trägt (ohne Leerzeichen am Rand). */
export const isInvoiceNumberTaken = (invoices: Pick<Invoice, "id" | "number">[], number: string | undefined, ownId?: string | null) => {
  const n = (number || "").trim();
  return !!n && invoices.some(i => i.id !== ownId && (i.number || "").trim() === n);
};

// Reine UTC-Monatsarithmetik MIT Tages-Klemmung: ein Zieltag, den es im
// Zielmonat nicht gibt (z.B. 31. Januar + 1 Monat), landet auf dem letzten
// Tag des Zielmonats statt in den übernächsten Monat überzulaufen (JS
// Date-Overflow-Verhalten hätte sonst z.B. Februar komplett übersprungen).
/** Addiert Monate zu einem ISO-Datum und klemmt den Tag auf den letzten Tag des Zielmonats. */
export const addMonthsClamped = (dateStr: string, months: number) => {
  const [y, m, day] = dateStr.split("-").map(Number);
  const targetMonthLastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, targetMonthLastDay);
  return new Date(Date.UTC(y, m - 1 + months, clampedDay)).toISOString().slice(0, 10);
};

/** Standard-Startdatum des Akonto-Planers: der Erste des nächsten Monats. */
export const defaultStartDate = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

/** Höchstzahl Raten im Akonto-Planer (Intervall-Modus). */
export const AKONTO_MAX_RATES = 24;

/**
 * Raten des Akonto-Plans: gleichmässig aus Intervall/Anzahl berechnet (Anzahl auf 1–24 begrenzt, der Betrag
 * wird durch die tatsächliche Anzahl geteilt) oder die manuell erfassten Zeilen.
 */
export const akontoPlanRows = (ap: AkontoPlan) => {
  if (ap.mode === "interval") {
    const start = ap.startDate || defaultStartDate();
    const count = Math.max(1, Math.min(Math.floor(ap.count) || 1, AKONTO_MAX_RATES));
    const perInv = Math.round((ap.totalAmt / count) * 100) / 100;
    return Array.from({ length: count }, (_, i) => {
      return { id: String(i), date: addMonthsClamped(start, i * (ap.intervalMonths || 1)), amt: perInv };
    });
  }
  return ap.manualRows;
};

/**
 * Fortlaufende Rechnungsnummern für neue Rechnungen mit den Rechnungsdaten `dates` (gleiche Regeln wie
 * `nextInvoiceNumber`, jede vergebene Nummer zählt für die nächste mit).
 */
export const generateSequentialNumbers = (invoices: Pick<Invoice, "number">[], format: string | undefined, dates: string[]) => {
  const taken: Pick<Invoice, "number">[] = [...invoices];
  return dates.map(date => {
    const n = nextInvoiceNumber(taken, format, date);
    taken.push({ number: n });
    return n;
  });
};

/** Bereits gestellte Rechnungen eines Projekts (ohne Entwürfe), netto — für den Restbetrag im Akonto-Planer. */
export const billedNetForProject = (invoices: Invoice[], projectId: string) =>
  roundCHF(invoices.filter(i => i.projectId === projectId && i.status !== "entwurf").reduce((s, i) => s + roundCHF((i.sub || 0) - (i.globalDisc || 0)), 0));

/** Baut aus den Raten des Akonto-Plans die Entwurfs-Rechnungen (Akonto, 30 Tage Zahlungsfrist). */
export const buildAkontoInvoices = (rows: { id: string; date: string; amt: number }[], ap: AkontoPlan, data: AppData, invoices: Invoice[]) => {
  const proj = data.projects.find(p => p.id === ap.projectId);
  const numbers = generateSequentialNumbers(invoices, data.settings.invoiceNumberFormat, rows.map(r => r.date));
  return rows.map((row, i) => {
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
};

/** Startmodus des Dialogs «Neue Rechnung» nach Abrechnungsart: Stundensatz → Teilrechnung nach Stunden, sonst Akonto % vom Budget. */
export const defaultInvoiceMode = (project: Pick<Project, "billingType" | "type"> | null | undefined) =>
  project && (project.billingType || project.type) === "stundensatz" ? "teilrechnung" : "akonto-percent";

/** Auswahl der Zeiteinträge für ein neues Formular: alle Einträge mit ihren vollen Minuten. */
export const selectAllEntries = (entries: TimeEntry[]): EntrySelections =>
  Object.fromEntries(entries.map(e => [e.id, { selected: true, billedMinutes: e.minutes }]));

/**
 * Auswahl der Zeiteinträge beim Bearbeiten einer gespeicherten Rechnung: alle mit ihr verknüpften Einträge,
 * mit den gespeicherten verrechneten Minuten (`inv.entrySelections`); ältere Rechnungen ohne gespeicherte
 * Auswahl fallen auf die vollen Minuten zurück.
 */
export const entrySelectionsForEdit = (inv: Pick<Invoice, "id" | "entrySelections">, timeEntries: TimeEntry[]): EntrySelections => {
  const saved = inv.entrySelections || {};
  return Object.fromEntries(timeEntries.filter(e => e.invoiceId === inv.id)
    .map(e => [e.id, { selected: true, billedMinutes: saved[e.id]?.billedMinutes ?? e.minutes }]));
};

/** Zu speichernde Auswahl: nur die gewählten Einträge mit ihren verrechneten Minuten. */
export const selectedEntrySelections = (sel: EntrySelections | undefined): EntrySelections =>
  Object.fromEntries(Object.entries(sel || {}).filter(([, s]) => s.selected).map(([id, s]) => [id, { selected: true, billedMinutes: s.billedMinutes ?? 0 }]));

/**
 * Hält Zeile 1 eines Stunden-Formulars (`hoursFromEntries`) auf «gewählte Stunden × Stundensatz». Andere
 * Formulare (Akonto/Teilrechnung als Betrag, %, Phase; Pauschal) bleiben unverändert.
 */
export const applyEntryHours = (form: InvoiceForm, project: Pick<Project, "name" | "hourlyRate"> | undefined): InvoiceForm => {
  if (!form.hoursFromEntries || !project) return form;
  const mins = Object.values(form.entrySelections || {}).filter(s => s.selected).reduce((sum, s) => sum + (s.billedMinutes || 0), 0);
  const hours = Math.round(mins / 60 * 100) / 100;
  const rate = project.hourlyRate || 0;
  const first: Partial<InvoiceItem> = form.items[0] || {};
  if (first.qty === hours && first.price === rate) return form;
  const items = [...form.items];
  items[0] = { id: first.id || generateId(), desc: first.desc || `Architektur-/Grafikleistungen – ${project.name}`, qty: hours, price: rate, discount: first.discount || 0 };
  return { ...form, items };
};

/** Rechnungen einer Offerte — liegt in utils.ts (auch vom Budget genutzt), hier weiter exportiert. */
export { invoicesForQuote } from "../../utils";

/**
 * Betrag einer Teil-/Akontorechnung «Nach SIA-Phase»: der offerierte Phasenbetrag aus den verknüpften
 * Offerten (Aufwand-Offerten mit den Sätzen der Rollen); ohne Offerte Phasenstunden × Stundensatz.
 */
export const phaseInvoiceAmount = (project: Project, phaseId: string, quotes: Quote[], roles?: Role[]) => {
  const fromQuotes = deriveQuoteBudget(migrateLinkedQuotes(project), quotes, roles).phasesAmount.find(p => p.id === phaseId);
  if (fromQuotes) return fromQuotes.amount;
  const ph = (project.phasesBudget || []).find(p => p.id === phaseId);
  return roundCHF((ph?.hours || 0) * (project.hourlyRate || 0));
};
