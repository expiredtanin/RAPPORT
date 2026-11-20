// Reine Hilfen der Rechnungsansicht (views/invoices/): Formular-Typen, Summenberechnung, Rechnungsnummern
// und die Erzeugung der Akonto-Plan-Rechnungen. Keine React-Abhängigkeiten.

import { SIA_PHASES } from "../../constants";
import { deriveQuoteBudget, generateId, invoiceNet, invoicesForQuote, lineAmount, localISODate, migrateLinkedQuotes, projectFee, roundCHF } from "../../utils";
import type { AppData, Invoice, InvoiceBillingSummary, InvoiceItem, PrintContent, Project, Quote, Role, TimeEntry } from "../../types";

/**
 * Formularstand einer Rechnung: Id und Summen kommen erst beim Speichern dazu; die Positionsliste ist immer
 * vorhanden. `hoursFromEntries` (nur im Formular, wird nicht gespeichert): Zeile 1 ist «gewählte Stunden ×
 * Stundensatz» und folgt der Auswahl der Zeiteinträge.
 */
export type InvoiceForm = Partial<Invoice> & Pick<Invoice, "items"> & { hoursFromEntries?: boolean };

/** Zustand des Dialogs «Neue Rechnung» (Quelle: Projekt oder Offerte, Art der Rechnung). */
export type NewInvoiceState = { tab: string; projectId?: string; quoteId?: string; mode: string; pct: number; amt: number; phaseId?: string; [key: string]: unknown };
/**
 * Zustand des Akonto-Planers. `phase`: eine Rate je SIA-Phase (Leistungsstand); `phaseDates` = von Hand
 * gesetzte Daten je Phase, `phaseSkip` = abgewählte Phasen.
 */
export type AkontoPlan = { projectId: string; clientId: string; totalAmt: number; mode: "interval" | "manual" | "phase"; intervalMonths: number; count: number; startDate: string; manualRows: AkontoPlanRow[]; phaseDates?: Record<string, string>; phaseSkip?: string[] };
/** Eine Rate des Akonto-Plans; `desc` = Positionstext (Phasen-Raten), sonst «Akontorechnung – Projekt». */
export type AkontoPlanRow = { id: string; date: string; amt: number; desc?: string };
/** Zeiteintrags-Auswahl einer Rechnung (verrechnete Minuten je Eintrag). */
export type EntrySelections = NonNullable<Invoice["entrySelections"]>;

/**
 * Summen einer Rechnung: Zwischentotal, Gesamtrabatt, Netto nach Rabatt, MWST und Total. Alle Beträge auf
 * Rappen gerundet; das Total ist die Summe aus gerundetem Netto und gerundeter MWST, damit Netto + MWST auf
 * Rechnung, PDF und QR-Zahlteil genau das Total ergeben.
 */
export const calcTotal = (items: InvoiceItem[] | undefined, mwst: boolean | undefined, rate: number, discountType?: string, discountValue?: number) => {
  // Jede Position auf Rappen (wie gedruckt), das Zwischentotal ist ihre Summe
  const sub = roundCHF((items || []).reduce((s, i) => s + lineAmount(i.qty, i.price, i.discount), 0));
  const globalDisc = roundCHF(discountType === "percent" ? sub * ((discountValue || 0) / 100)
    : discountType === "amount" ? (discountValue || 0) : 0);
  const subAfterDisc = roundCHF(sub - globalDisc);
  const tax = mwst ? roundCHF(subAfterDisc * (rate / 100)) : 0;
  const total = roundCHF(subAfterDisc + tax);
  return { sub, globalDisc, subAfterDisc, tax, total };
};

/** Zeilentotal einer Position inklusive Zeilenrabatt, auf Rappen (`lineAmount`). */
export const calcLineTotal = (item: Pick<InvoiceItem, "qty" | "price" | "discount">) => lineAmount(item.qty, item.price, item.discount);

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
 * wird durch die tatsächliche Anzahl geteilt, die letzte Rate gleicht die Rappen aus, damit die Raten genau
 * den Planbetrag ergeben), je SIA-Phase (`akontoPhasePlan`, braucht `data`) oder die manuell erfassten Zeilen.
 */
export const akontoPlanRows = (ap: AkontoPlan, data?: Pick<AppData, "projects" | "quotes" | "invoices" | "settings">): AkontoPlanRow[] => {
  if (ap.mode === "phase") {
    const proj = data?.projects.find(p => p.id === ap.projectId);
    if (!data || !proj) return [];
    return akontoPhaseRowsToPlan(akontoPhasePlan(proj, data.quotes || [], data.settings.roles, data.invoices || [], ap).rows, proj.name);
  }
  if (ap.mode === "interval") {
    const start = ap.startDate || defaultStartDate();
    const count = Math.max(1, Math.min(Math.floor(ap.count) || 1, AKONTO_MAX_RATES));
    const perInv = roundCHF(ap.totalAmt / count);
    const last = roundCHF(ap.totalAmt - perInv * (count - 1));
    return Array.from({ length: count }, (_, i) => {
      return { id: String(i), date: addMonthsClamped(start, i * (ap.intervalMonths || 1)), amt: i === count - 1 ? last : perInv };
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

/**
 * Stand der Verrechnung eines Projekts für den Dialog «Neue Rechnung»: Honorar (`fee`), bisher gestellt
 * (ohne Entwürfe, netto nach Rabatt wie `billedNetForProject`) in CHF und %, Rest, offene Entwürfe und der
 * Stand nach der vorgeschlagenen Rechnung (`thisNet`, netto). `over`: der Vorschlag führt über 100 % des
 * Honorars; `overWithDrafts`: erst zusammen mit den offenen Entwürfen (z.B. aus dem Akonto-Planer).
 * Prozente sind 0, wenn kein Honorar erfasst ist.
 */
export const projectBillingStatus = (invoices: Invoice[], projectId: string, fee: number, thisNet: number) => {
  const billed = billedNetForProject(invoices, projectId);
  const drafts = roundCHF(invoices.filter(i => i.projectId === projectId && i.status === "entwurf").reduce((s, i) => s + roundCHF((i.sub || 0) - (i.globalDisc || 0)), 0));
  const pct = (x: number) => fee > 0 ? x / fee * 100 : 0;
  const after = roundCHF(billed + thisNet);
  return {
    fee, billed, billedPct: pct(billed), rest: roundCHF(fee - billed), drafts,
    after, afterPct: pct(after),
    over: fee > 0 && after > fee,
    overWithDrafts: fee > 0 && after <= fee && roundCHF(after + drafts) > fee,
  };
};

/** Baut aus den Raten des Akonto-Plans die Entwurfs-Rechnungen (Akonto, 30 Tage Zahlungsfrist). */
export const buildAkontoInvoices = (rows: AkontoPlanRow[], ap: AkontoPlan, data: AppData, invoices: Invoice[]) => {
  const proj = data.projects.find(p => p.id === ap.projectId);
  const numbers = generateSequentialNumbers(invoices, data.settings.invoiceNumberFormat, rows.map(r => r.date));
  return rows.map((row, i) => {
    const due = new Date(`${row.date}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30);
    const desc = row.desc || `Akontorechnung – ${proj?.name || ""}`;
    const { sub, tax, total, subAfterDisc, globalDisc } = calcTotal(
      [{ id: generateId(), desc, qty: 1, price: row.amt, discount: 0 }],
      true, data.settings.mwstRate, "none", 0
    );
    return {
      id: generateId(), number: numbers[i], date: row.date,
      dueDate: due.toISOString().slice(0, 10),
      clientId: ap.clientId || proj?.clientId || "",
      projectId: ap.projectId, invoiceKind: "akonto",
      items: [{ id: generateId(), desc, qty: 1, price: row.amt, discount: 0 }],
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
export { invoicesForQuote };

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

// ─── Abrechnungsblock (Akonto-/Teilrechnung) ────────────────────────────────

/** Reihenfolge zweier Rechnungen: nach Datum, bei gleichem Datum nach Nummer (numerisch). */
const compareInvoiceOrder = (a: Pick<Invoice, "date" | "number">, b: Pick<Invoice, "date" | "number">) =>
  (a.date || "").localeCompare(b.date || "") || (a.number || "").localeCompare(b.number || "", undefined, { numeric: true });

/**
 * Abrechnungsblock einer Akonto- oder Teilrechnung (Schweizer Praxis): Honorar total, bisher in Rechnung
 * gestellt, diese Rechnung und Rest nach dieser Rechnung, alles netto exkl. MWST.
 *
 * - Mit Offerte (`quoteId`): Honorar = Netto der Offerte (`Quote.sub`), Rechnungen = `invoicesForQuote`.
 * - Sonst mit Projekt: Honorar = `projectFee`, Rechnungen = alle des Projekts.
 * - «Bisher» = gestellte Rechnungen (ohne Entwürfe, ohne diese) mit früherem Datum bzw. bei gleichem Datum
 *   kleinerer Nummer — spätere Rechnungen ändern den Block einer älteren also nicht.
 *
 * `null` für andere Rechnungsarten (Schlussrechnungen ziehen die Akonti schon als Positionen ab), ohne
 * Projekt/Offerte oder ohne Honorar.
 */
export const invoiceBillingSummary = (
  inv: Pick<Invoice, "number" | "date" | "projectId" | "quoteId" | "invoiceKind" | "sub" | "globalDisc"> & { id?: string },
  data: { projects?: Project[]; quotes?: Quote[]; invoices?: Invoice[] },
): InvoiceBillingSummary | null => {
  if (inv.invoiceKind !== "akonto" && inv.invoiceKind !== "teilrechnung") return null;
  const invoices = data.invoices || [];
  const projects = data.projects || [];
  const q = inv.quoteId ? (data.quotes || []).find(x => x.id === inv.quoteId) : undefined;
  let fee = 0;
  let scope: Invoice[] = [];
  if (q) {
    fee = roundCHF(q.sub || 0);
    scope = invoicesForQuote(q, invoices, projects);
  } else if (inv.projectId) {
    const proj = projects.find(p => p.id === inv.projectId);
    if (!proj) return null;
    fee = roundCHF(projectFee(proj));
    scope = invoices.filter(i => i.projectId === proj.id);
  }
  if (!(fee > 0)) return null;
  const prior = scope
    .filter(i => i.id !== inv.id && i.status !== "entwurf" && compareInvoiceOrder(i, inv) < 0)
    .sort(compareInvoiceOrder);
  const priorNet = roundCHF(prior.reduce((s, i) => s + invoiceNet(i), 0));
  const thisNet = invoiceNet(inv);
  return {
    fee, ...(q ? { quoteNumber: q.number } : {}),
    prior: priorNet, priorNumbers: prior.map(i => i.number).filter(Boolean),
    thisNet, rest: roundCHF(fee - priorNet - thisNet),
  };
};

/**
 * Rechnung für Druck/PDF: Entwürfe (und ältere Rechnungen ohne festgehaltenen Block) zeigen den aktuell
 * berechneten Abrechnungsblock, gestellte Rechnungen den beim Speichern/Versand festgehaltenen.
 */
export const invoiceForPrint = (inv: Invoice, data: { projects?: Project[]; quotes?: Quote[]; invoices?: Invoice[] }): Invoice =>
  inv.status !== "entwurf" && inv.billingSummary ? inv : { ...inv, billingSummary: invoiceBillingSummary(inv, data) };

/** Druckauftrag mit Rechnung (`inv`): Abrechnungsblock wie in `invoiceForPrint` ergänzen; andere unverändert. */
export const withPrintSummary = (content: PrintContent, data: { projects?: Project[]; quotes?: Quote[]; invoices?: Invoice[] }): PrintContent =>
  content && content.inv ? { ...content, inv: invoiceForPrint(content.inv as Invoice, data) } : content;

/**
 * Rechnung beim Wechsel aus dem Entwurf (versendet, bezahlt …): Abrechnungsblock jetzt festhalten. Schon
 * gestellte Rechnungen behalten ihren Block.
 */
export const freezeOnStatus = (inv: Invoice, status: string, data: { projects?: Project[]; quotes?: Quote[]; invoices?: Invoice[] }): Invoice =>
  inv.status === "entwurf" && status !== "entwurf" ? { ...inv, status, billingSummary: invoiceBillingSummary(inv, data) } : { ...inv, status };

// ─── Akonto-Plan nach SIA-Phasen ────────────────────────────────────────────

/** Eine Phase im Akonto-Plan nach Leistungsstand. */
export type AkontoPhaseRow = {
  id: string; label: string;
  /** Anteil der Phase am Honorar */
  share: number;
  /** davon schon durch gestellte Rechnungen gedeckt */
  credited: number;
  /** noch zu planen = share − credited */
  amt: number;
  date: string;
  included: boolean;
};

/**
 * Raten des Akonto-Plans nach SIA-Phasen: je Phase mit budgetierten Stunden (`phasesBudget`, Reihenfolge
 * nach SIA) der Anteil am Honorar — Phasenbetrag (`phaseInvoiceAmount`) im Verhältnis zur Summe aller
 * Phasenbeträge, umgelegt auf `projectFee` (ohne Honorar die Phasenbeträge selbst); die letzte Phase gleicht
 * die Rappen aus. Bisher gestellte Rechnungen (ohne Entwürfe) werden den Phasen in ihrer Reihenfolge
 * angerechnet (Leistungsstand), damit nichts doppelt geplant wird. Datum: von Hand gesetzt (`phaseDates`)
 * oder ab `startDate` im Abstand `intervalMonths` je offene Phase.
 */
export const akontoPhasePlan = (
  proj: Project, quotes: Quote[], roles: Role[] | undefined, invoices: Invoice[],
  ap: Pick<AkontoPlan, "startDate" | "intervalMonths" | "phaseDates" | "phaseSkip">,
) => {
  const order = (id: string) => { const k = SIA_PHASES.findIndex(p => p.id === id); return k < 0 ? 999 : k; };
  const phases = (proj.phasesBudget || []).filter(p => p.hours > 0).slice().sort((a, b) => order(a.id) - order(b.id));
  const raw = phases.map(ph => Math.max(0, phaseInvoiceAmount(proj, ph.id, quotes, roles)));
  const sumRaw = raw.reduce((s, x) => s + x, 0);
  const fee = projectFee(proj) > 0 ? roundCHF(projectFee(proj)) : roundCHF(sumRaw);
  const billed = billedNetForProject(invoices, proj.id);
  if (!(sumRaw > 0) || !(fee > 0)) return { fee, billed, rows: [] as AkontoPhaseRow[] };
  let given = 0, cum = 0, open = 0;
  const rows = phases.map((ph, k) => {
    const share = k === phases.length - 1 ? roundCHF(fee - given) : roundCHF(fee * raw[k] / sumRaw);
    given = roundCHF(given + share);
    const credited = roundCHF(Math.min(share, Math.max(0, billed - cum)));
    cum = roundCHF(cum + share);
    const amt = roundCHF(share - credited);
    const included = amt > 0 && !(ap.phaseSkip || []).includes(ph.id);
    const label = SIA_PHASES.find(p => p.id === ph.id)?.label || (proj.customPhases || []).find(p => p.id === ph.id)?.label || ph.id;
    const date = ap.phaseDates?.[ph.id] || addMonthsClamped(ap.startDate || defaultStartDate(), open * (ap.intervalMonths || 1));
    if (amt > 0) open++;
    return { id: ph.id, label, share, credited, amt, date, included };
  });
  return { fee, billed, rows };
};

/** Zu erstellende Raten aus dem Phasenplan: nur gewählte Phasen mit offenem Betrag, Text mit der Phase. */
export const akontoPhaseRowsToPlan = (rows: AkontoPhaseRow[], projectName: string): AkontoPlanRow[] =>
  rows.filter(r => r.included).map(r => ({ id: r.id, date: r.date, amt: r.amt, desc: `Akontorechnung ${r.label} – ${projectName}` }));
