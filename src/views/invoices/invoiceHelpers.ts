// Reine Hilfen der Rechnungsansicht (views/invoices/): Formular-Typen, Summenberechnung, Rechnungsnummern
// und die Erzeugung der Akonto-Plan-Rechnungen. Keine React-Abhängigkeiten.

import { generateId, roundCHF } from "../../utils";
import type { AppData, Invoice, InvoiceItem } from "../../types";

/** Formularstand einer Rechnung: Id und Summen kommen erst beim Speichern dazu; die Positionsliste ist immer vorhanden. */
export type InvoiceForm = Partial<Invoice> & Pick<Invoice, "items">;

/** Zustand des Dialogs «Neue Rechnung» (Quelle: Projekt oder Offerte, Art der Rechnung). */
export type NewInvoiceState = { tab: string; projectId?: string; quoteId?: string; mode: string; pct: number; amt: number; phaseId?: string; [key: string]: unknown };
/** Zustand des Akonto-Planers. */
export type AkontoPlan = { projectId: string; clientId: string; totalAmt: number; mode: "interval" | "manual"; intervalMonths: number; count: number; startDate: string; manualRows: { id: string; date: string; amt: number }[] };
/** Zeiteintrags-Auswahl einer Rechnung (verrechnete Minuten je Eintrag). */
export type EntrySelections = NonNullable<Invoice["entrySelections"]>;

/** Summen einer Rechnung (Zwischentotal, Gesamtrabatt, MWST, auf Rappen gerundetes Total). */
export const calcTotal = (items: InvoiceItem[] | undefined, mwst: boolean | undefined, rate: number, discountType?: string, discountValue?: number) => {
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

/** Zeilentotal einer Position inklusive Zeilenrabatt. */
export const calcLineTotal = (item: Pick<InvoiceItem, "qty" | "price" | "discount">) => {
  const line = (item.qty || 0) * (item.price || 0);
  return line * (1 - ((item.discount || 0) / 100));
};

/** Nächste Rechnungsnummer nach dem konfigurierten Format (laufende Nummer aus den bestehenden Rechnungen). */
export const nextInvoiceNumber = (invoices: Invoice[], format: string | undefined) => {
  const fmt = format || "YYYY-NNN";
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

/** Raten des Akonto-Plans: gleichmässig aus Intervall/Anzahl berechnet oder die manuell erfassten Zeilen. */
export const akontoPlanRows = (ap: AkontoPlan) => {
  if (ap.mode === "interval") {
    const start = ap.startDate || defaultStartDate();
    const perInv = ap.count > 0 ? Math.round((ap.totalAmt / ap.count) * 100) / 100 : 0;
    return Array.from({ length: Math.max(1, Math.min(ap.count, 24)) }, (_, i) => {
      return { id: String(i), date: addMonthsClamped(start, i * (ap.intervalMonths || 1)), amt: perInv };
    });
  }
  return ap.manualRows;
};

/** Fortlaufende Rechnungsnummern für `count` neue Rechnungen. */
export const generateSequentialNumbers = (invoices: Invoice[], format: string | undefined, count: number) => {
  const fmt = format || "YYYY-NNN";
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

/** Baut aus den Raten des Akonto-Plans die Entwurfs-Rechnungen (Akonto, 30 Tage Zahlungsfrist). */
export const buildAkontoInvoices = (rows: { id: string; date: string; amt: number }[], ap: AkontoPlan, data: AppData, invoices: Invoice[]) => {
  const proj = data.projects.find(p => p.id === ap.projectId);
  const numbers = generateSequentialNumbers(invoices, data.settings.invoiceNumberFormat, rows.length);
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
