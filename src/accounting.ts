// Buchhaltung: reine Rechenregeln für Jahresergebnis, MWST-Abrechnung, Personalaufwand und den
// CSV-Export. Eine Quelle für Accounting.tsx, die Druckvorlage (print/docs/AccountingPrint.tsx)
// und `exportBuchhaltungCSV` — die drei rechneten früher je eigene, auseinanderlaufende Summen.
//
// Regeln (Stand 26.11):
//   - Einnahmen = Umsatz netto nach Rabatt (`invoiceNet`) der gestellten Rechnungen (ohne Entwürfe)
//     nach Rechnungsdatum — dieselbe Regel wie `yearRevenue` (Übersicht, «Heute»).
//   - MWST (Art. 36–40 MWSTG): Methode `settings.mwstMethode` — effektiv (Umsatzsteuer der Rechnungen
//     minus Vorsteuer aus Spesen/Ausgaben, vierteljährlich) oder Saldosteuersatz (Bruttoentgelt ×
//     Satz, ohne Vorsteuer, halbjährlich). Abrechnungsart `mwstAbrechnungsart`: vereinbart (nach
//     Rechnungsdatum, Standard) oder vereinnahmt (bezahlte Rechnungen nach Zahlungsdatum).
//     Akonto-Rechnungen sind Vorauszahlungen: ihre MWST wird mit der Akontorechnung abgerechnet
//     (Art. 40 Abs. 1 MWSTG); die Schlussrechnung belastet MWST nur auf dem Rest.
//   - Spesen: ALLE Spesen der Periode mit Netto und Vorsteuer, auch die über den Lohn ausbezahlten.
//     Der Personalaufwand enthält deshalb KEINE Spesen (vorher steckten sie brutto in
//     `lohn.auszahlung`, ihre Vorsteuer ging verloren).
//   - Personalaufwand = Bruttolohn Total + Arbeitgeberbeiträge (AHV/IV/EO und ALV paritätisch
//     = AN-Abzug, PK-AG-Anteil `bvgAG`). Vorher Auszahlung + PK-AG: die AN-Abzüge (rund 16 % des
//     Bruttos), die das Büro an AHV-Kasse/PK überweist, fehlten im Aufwand.
//   - Interne Ausgaben: wiederkehrende werden als einzelne Buchungen bis heute (bzw. bis
//     `recurringUntil`) aufgelöst (`expandInternalExpenses`) — jede Zahlung zählt in ihrem Monat.
//   - Spesen im Lohn: nur genehmigte («genehmigt», «auf nächsten Lohn»), nie «offen».

import { csvCell, invoiceNet, roundCHF, type LohnVorperioden } from "./utils";
import type { AppData, Expense, InternalExpense, Invoice, LohnEntry, LohnResult } from "./types";

/**
 * Liegt ein Datum in der Periode? `""` = alle, `YYYY` = Jahr, `YYYY-MM` = Monat,
 * `YYYY-Qn` = Quartal, `YYYY-Hn` = Halbjahr (MWST-Abrechnung).
 */
export function inPeriod(date: string | undefined | null, period: string): boolean {
  if (!period) return true;
  const d = date || "";
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    if (!d.startsWith(q[1])) return false;
    const m = parseInt(d.slice(5, 7), 10);
    return Math.ceil(m / 3) === Number(q[2]);
  }
  const h = /^(\d{4})-H([12])$/.exec(period);
  if (h) {
    if (!d.startsWith(h[1])) return false;
    const m = parseInt(d.slice(5, 7), 10);
    return (m <= 6 ? 1 : 2) === Number(h[2]);
  }
  return d.startsWith(period);
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Anzeige einer Periode: «2026», «3. Quartal 2026», «November 2026», «Alle Jahre». */
export function periodLabel(period: string): string {
  if (!period) return "Alle Jahre";
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `${q[2]}. Quartal ${q[1]}`;
  const h = /^(\d{4})-H([12])$/.exec(period);
  if (h) return `${h[2]}. Halbjahr ${h[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
  return period;
}

/**
 * Frist der MWST-Abrechnung eines Quartals (effektive Methode, vierteljährlich): 60 Tage nach
 * Quartalsende (Art. 71 MWSTG). Liefert `YYYY-MM-DD`.
 */
export function mwstDueDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  const end = new Date(Date.UTC(year, quarter * 3, 0)); // letzter Tag des Quartals
  end.setUTCDate(end.getUTCDate() + 60);
  return end.toISOString().slice(0, 10);
}

/** Abrechnungsperioden der MWST eines Jahres: effektiv vierteljährlich, Saldosteuersatz halbjährlich (Art. 35 MWSTG). */
export function mwstPerioden(year: number, methode: "effektiv" | "saldo" | undefined): { period: string; label: string; start: string; end: string; due: string }[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const len = methode === "saldo" ? 6 : 3;
  return Array.from({ length: 12 / len }, (_, i) => {
    const endMonth = (i + 1) * len;
    const endDate = new Date(Date.UTC(year, endMonth, 0));
    const due = new Date(endDate); due.setUTCDate(due.getUTCDate() + 60);
    return {
      period: methode === "saldo" ? `${year}-H${i + 1}` : `${year}-Q${i + 1}`,
      label: methode === "saldo" ? `H${i + 1}` : `Q${i + 1}`,
      start: `${year}-${pad(i * len + 1)}`,
      end: `${year}-${pad(endMonth)}`,
      due: due.toISOString().slice(0, 10),
    };
  });
}

const INTERVAL_MONTHS: Record<string, number> = { monatlich: 1, quartalsweise: 3, "jährlich": 12 };

/**
 * Wiederkehrende interne Ausgaben als einzelne Buchungen: vom ersten Datum im Intervall bis heute
 * (keine künftigen Buchungen) bzw. bis zum Monat `recurringUntil`. Einmalige bleiben, wie sie sind.
 * Aufgelöste Buchungen bekommen die id `<id>@<YYYY-MM-DD>` und `occurrenceOf`.
 */
export function expandInternalExpenses(list: InternalExpense[], today: string): (InternalExpense & { occurrenceOf?: string })[] {
  const out: (InternalExpense & { occurrenceOf?: string })[] = [];
  for (const e of list || []) {
    const step = e.recurring ? INTERVAL_MONTHS[e.recurringInterval || "monatlich"] || 1 : 0;
    if (!step || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) { out.push(e); continue; }
    const y0 = Number(e.date.slice(0, 4)), m0 = Number(e.date.slice(5, 7)) - 1, d0 = Number(e.date.slice(8, 10));
    const untilMonth = e.recurringUntil ? e.recurringUntil.slice(0, 7) : null;
    for (let k = 0; k < 1200; k++) {
      const first = new Date(Date.UTC(y0, m0 + k * step, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d0, last))).toISOString().slice(0, 10);
      if (d > today || (untilMonth && d.slice(0, 7) > untilMonth)) break;
      out.push(k === 0 ? e : { ...e, id: `${e.id}@${d}`, date: d, occurrenceOf: e.id, receiptData: null, receiptName: null });
    }
  }
  return out;
}

/**
 * Vorsteuer (enthaltener MWST-Anteil) einer Spese/Ausgabe, pro Beleg auf Rappen gerundet — wie sie
 * auf der Quittung steht; Summen sind die Summe dieser Beträge (vorher wurde erst die Summe gerundet,
 * Zeilen und Total wichen um Rappen ab). 0 ohne `inclMwst`.
 */
export function expenseTax(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">): number {
  const amount = e.amount || 0;
  if (!e.inclMwst || !e.mwstRate) return 0;
  return roundCHF(amount - amount / (1 + e.mwstRate / 100));
}

/** Netto einer Spese/Ausgabe = Betrag minus Vorsteuer (pro Beleg auf Rappen). */
export function expenseNet(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">): number {
  return roundCHF((e.amount || 0) - expenseTax(e));
}

/** Arbeitgeberbeiträge einer Lohnabrechnung. */
export interface LohnAGBeitraege {
  /** AHV/IV/EO AG-Anteil (paritätisch = AN-Abzug) */
  ahvAG: number;
  /** ALV AG-Anteil (paritätisch = AN-Abzug, gleicher Höchstlohn) */
  alvAG: number;
  /** Pensionskasse AG-Anteil */
  bvgAG: number;
  /** FAK, AHV-Verwaltungskosten, UVG-BU, KTG-AG (Abrechnungen ab 26.11) */
  weitere: number;
  total: number;
}

type LohnAGFelder = Pick<LohnResult, "ahv" | "alv" | "bvgAG"> & Partial<Pick<LohnResult, "agFak" | "agVk" | "agBu" | "agKtg">>;

/**
 * Arbeitgeberbeiträge aus einer Abrechnung: AHV/IV/EO und ALV paritätisch (AG = AN-Abzug, gesetzlich),
 * PK aus `bvgAG`, dazu FAK, Verwaltungskosten, UVG-BU und KTG-AG aus der Abrechnung (`calcLohn` mit Sätzen).
 */
export function lohnAGBeitraege(l: LohnAGFelder): LohnAGBeitraege {
  const ahvAG = l.ahv || 0;
  const alvAG = l.alv || 0;
  const bvgAG = l.bvgAG || 0;
  const weitere = roundCHF((l.agFak || 0) + (l.agVk || 0) + (l.agBu || 0) + (l.agKtg || 0));
  return { ahvAG, alvAG, bvgAG, weitere, total: roundCHF(ahvAG + alvAG + bvgAG + weitere) };
}

/** Personalaufwand einer Abrechnung = Bruttolohn Total + Arbeitgeberbeiträge (ohne Spesen und Familienzulagen). */
export function lohnPersonalaufwand(l: LohnAGFelder & Pick<LohnResult, "bruttoTotal">): number {
  return roundCHF((l.bruttoTotal || 0) + lohnAGBeitraege(l).total);
}

/**
 * Frühere Abrechnungen desselben Mitarbeiters im selben Jahr vor `monat` (für den kumulierten
 * ALV-/UVG-Höchstlohn in `calcLohn`). Ältere Abrechnungen ohne `alvBasis` zählen voll.
 */
export function lohnVorperioden(lohnEntries: Pick<LohnEntry, "employeeId" | "monat" | "bruttoTotal" | "alvBasis" | "brutto" | "dreizehnter">[], employeeId: string, monat: string): LohnVorperioden {
  const year = monat.slice(0, 4);
  return lohnEntries
    .filter(l => l.employeeId === employeeId && l.monat.startsWith(year) && l.monat < monat)
    .reduce((s, l) => ({
      bruttoBisher: s.bruttoBisher + (l.bruttoTotal || 0),
      alvBasisBisher: s.alvBasisBisher + (l.alvBasis ?? l.bruttoTotal ?? 0),
      // nur Monate mit 13. Monatslohn (wurde er erst im Lauf des Jahres vereinbart, kein Nachzahlen im Dezember)
      dreizehnterBasisBisher: s.dreizehnterBasisBisher + ((l.dreizehnter || 0) > 0 ? l.brutto || 0 : 0),
      dreizehnterBisher: s.dreizehnterBisher + (l.dreizehnter || 0),
    }), { bruttoBisher: 0, alvBasisBisher: 0, dreizehnterBasisBisher: 0, dreizehnterBisher: 0 });
}

/**
 * Spesen, die mit der Lohnabrechnung `monat` ausbezahlt werden: genehmigt («genehmigt» oder «auf
 * nächsten Lohn»), noch keiner Abrechnung zugeordnet, aus diesem oder einem früheren Monat.
 * «offen» (nicht genehmigt) und «ausbezahlt» (z.B. bar) gehen nicht in den Lohn.
 */
export function spesenFuerLohn(expenses: Expense[], employeeId: string, monat: string): Expense[] {
  return expenses.filter(e => {
    if (e.employeeId !== employeeId || e.lohnEntryId) return false;
    if (e.status !== "genehmigt" && e.status !== "auf nächsten Lohn") return false;
    return (e.date || "").slice(0, 7) <= monat;
  });
}

/** Noch nicht genehmigte Spesen einer Person bis und mit `monat` (Hinweis im Lohnlauf). */
export function spesenWartend(expenses: Expense[], employeeId: string, monat: string): Expense[] {
  return expenses.filter(e => e.employeeId === employeeId && !e.lohnEntryId && (e.status || "offen") === "offen" && (e.date || "").slice(0, 7) <= monat);
}

/** Zahlen der Buchhaltung für eine Periode (alle Beträge auf Rappen gerundet). */
export interface AccountingSummary {
  /** Umsatz netto der gestellten Rechnungen */
  revenueNet: number;
  /** Netto der Entwürfe (nur informativ, nicht im Ergebnis) */
  draftNet: number;
  issuedCount: number;
  /** MWST aller gestellten Rechnungen der Periode (nach Rechnungsdatum) */
  taxTotal: number;
  /** davon auf Akontorechnungen (Vorauszahlungen, mit der Akontorechnung abgerechnet) */
  akontoTax: number;
  /** MWST-Methode und Abrechnungsart, mit denen gerechnet wurde */
  mwstMethode: "effektiv" | "saldo";
  mwstArt: "vereinbart" | "vereinnahmt";
  /** steuerbares Entgelt der Periode inkl. MWST (Basis beim Saldosteuersatz) */
  mwstEntgeltBrutto: number;
  /** geschuldete Steuer auf dem Umsatz (effektiv: MWST der Rechnungen; Saldo: Entgelt × Satz) */
  umsatzsteuer: number;
  /** Brutto-Totale nach Status */
  paidTotal: number;
  openTotal: number;
  overdueTotal: number;
  /** Spesen (alle, auch über Lohn ausbezahlte) */
  expNet: number;
  expTax: number;
  expGross: number;
  expCount: number;
  /** davon über eine Lohnabrechnung ausbezahlt */
  expViaLohnCount: number;
  intNet: number;
  intTax: number;
  intGross: number;
  /** Σ Bruttolohn Total */
  lohnBrutto: number;
  /** Σ Arbeitgeberbeiträge (AHV/ALV paritätisch, PK, FAK/VK/BU/KTG) */
  lohnAG: number;
  lohnAGParts: { ahvAG: number; alvAG: number; bvgAG: number; weitere: number };
  /** Bruttolohn + AG-Beiträge */
  personalaufwand: number;
  lohnCount: number;
  /** abziehbare Vorsteuer aus Spesen und internen Ausgaben (0 beim Saldosteuersatz) */
  vorsteuer: number;
  /** MWST-Schuld der Periode (negativ = Guthaben) */
  mwstSchuld: number;
  ausgabenTotal: number;
  ergebnis: number;
}

type SummaryData = Pick<AppData, "invoices" | "expenses" | "internalExpenses" | "lohnEntries"> & {
  settings?: Partial<Pick<AppData["settings"], "mwstMethode" | "mwstSaldoSatz" | "mwstAbrechnungsart">>;
};

/** Heute als `YYYY-MM-DD` (lokal). */
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Gefilterte Datensätze einer Periode (gleiche Filter für Ansicht, PDF und CSV). */
export function accountingRows(data: SummaryData, period: string, today = todayISO()): {
  invoices: Invoice[]; issued: Invoice[]; expenses: Expense[]; internalExpenses: InternalExpense[]; lohnEntries: LohnEntry[];
} {
  const byDate = <T extends { date?: string }>(a: T, b: T) => (a.date || "").localeCompare(b.date || "");
  const invoices = (data.invoices || []).filter(i => inPeriod(i.date, period)).sort(byDate);
  return {
    invoices,
    issued: invoices.filter(i => i.status !== "entwurf"),
    expenses: (data.expenses || []).filter(e => inPeriod(e.date, period)).sort(byDate),
    internalExpenses: expandInternalExpenses(data.internalExpenses || [], today).filter(e => inPeriod(e.date, period)).sort(byDate),
    lohnEntries: (data.lohnEntries || []).filter(l => inPeriod(`${l.monat}-01`, period)).sort((a, b) => a.monat.localeCompare(b.monat)),
  };
}

/**
 * Jahresergebnis und MWST-Abrechnung einer Periode (`inPeriod`: "", Jahr, Monat oder Quartal).
 * Regeln im Dateikopf.
 */
export function accountingSummary(data: SummaryData, period: string, today = todayISO()): AccountingSummary {
  const rows = accountingRows(data, period, today);
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const { invoices, issued, expenses, internalExpenses, lohnEntries } = rows;

  const revenueNet = roundCHF(sum(issued, invoiceNet));
  const taxTotal = roundCHF(sum(issued, i => i.tax || 0));
  const akontoTax = roundCHF(sum(issued.filter(i => i.invoiceKind === "akonto"), i => i.tax || 0));
  // MWST-Basis: vereinbart = gestellte Rechnungen nach Rechnungsdatum; vereinnahmt = bezahlte nach Zahlungsdatum
  const mwstMethode = data.settings?.mwstMethode === "saldo" ? "saldo" : "effektiv";
  const mwstArt = data.settings?.mwstAbrechnungsart === "vereinnahmt" ? "vereinnahmt" : "vereinbart";
  const taxInvoices = mwstArt === "vereinnahmt"
    ? (data.invoices || []).filter(i => i.status === "bezahlt" && inPeriod(i.paidDate || i.date, period))
    : issued;
  const mwstEntgeltBrutto = roundCHF(sum(taxInvoices, i => i.total || 0));
  const umsatzsteuer = mwstMethode === "saldo"
    ? roundCHF(mwstEntgeltBrutto * (data.settings?.mwstSaldoSatz || 0) / 100)
    : roundCHF(sum(taxInvoices, i => i.tax || 0));

  const expGross = roundCHF(sum(expenses, e => e.amount || 0));
  const expNet = roundCHF(sum(expenses, expenseNet));
  const expTax = roundCHF(expGross - expNet);
  const intGross = roundCHF(sum(internalExpenses, e => e.amount || 0));
  const intNet = roundCHF(sum(internalExpenses, expenseNet));
  const intTax = roundCHF(intGross - intNet);

  const ag = lohnEntries.map(lohnAGBeitraege);
  const lohnAGParts = {
    ahvAG: roundCHF(sum(ag, a => a.ahvAG)),
    alvAG: roundCHF(sum(ag, a => a.alvAG)),
    bvgAG: roundCHF(sum(ag, a => a.bvgAG)),
    weitere: roundCHF(sum(ag, a => a.weitere)),
  };
  const lohnBrutto = roundCHF(sum(lohnEntries, l => l.bruttoTotal || 0));
  const lohnAG = roundCHF(sum(ag, a => a.total));
  const personalaufwand = roundCHF(lohnBrutto + lohnAG);

  // Saldosteuersatz: kein Vorsteuerabzug (Art. 37 Abs. 1 MWSTG)
  const vorsteuer = mwstMethode === "saldo" ? 0 : roundCHF(expTax + intTax);
  const ausgabenTotal = roundCHF(expNet + intNet + personalaufwand);
  return {
    revenueNet,
    draftNet: roundCHF(sum(invoices.filter(i => i.status === "entwurf"), invoiceNet)),
    issuedCount: issued.length,
    taxTotal, akontoTax, mwstMethode, mwstArt, mwstEntgeltBrutto, umsatzsteuer,
    paidTotal: roundCHF(sum(invoices.filter(i => i.status === "bezahlt"), i => i.total || 0)),
    openTotal: roundCHF(sum(invoices.filter(i => i.status === "gesendet"), i => i.total || 0)),
    overdueTotal: roundCHF(sum(invoices.filter(i => i.status === "überfällig"), i => i.total || 0)),
    expNet, expTax, expGross, expCount: expenses.length, expViaLohnCount: expenses.filter(e => e.lohnEntryId).length,
    intNet, intTax, intGross,
    lohnBrutto, lohnAG, lohnAGParts, personalaufwand, lohnCount: lohnEntries.length,
    vorsteuer,
    mwstSchuld: roundCHF(umsatzsteuer - vorsteuer),
    ausgabenTotal,
    ergebnis: roundCHF(revenueNet - ausgabenTotal),
  };
}

/**
 * CSV-Text des Buchhaltungs-Exports (`;`-getrennt; das BOM für Excel hängt `exportBuchhaltungCSV` an): Einnahmen, Spesen, interne Ausgaben,
 * Löhne und Zusammenfassung. Summenzeilen gehen auf die sichtbaren Zeilen auf; die Zusammenfassung
 * entspricht `accountingSummary` (gleiche Zahlen wie Ansicht und PDF).
 * @param period `inPeriod`-Periode; leer = alle
 */
export function buildBuchhaltungCSV(data: AppData, period = ""): string {
  const sep = ";";
  // s ?? "" statt s || "" — sonst wird ein echter Zahlenwert 0 zu einer leeren Zelle statt "0".
  const q = csvCell;   // maskiert auch Formel-Anfänge (CSV-Injection)
  const line = (cells: unknown[]) => cells.map(q).join(sep);
  const f = (n: number) => roundCHF(n).toFixed(2);
  const mwstRate = data.settings?.mwstRate ?? 8.1;
  const rows: string[] = [];
  const { issued, expenses, internalExpenses, lohnEntries } = accountingRows(data, period);
  const s = accountingSummary(data, period);

  rows.push(line(["EINNAHMEN", "", "", "", "", "", "", ""]));
  rows.push(line(["Datum", "Rechnungs-Nr.", "Kunde", "Beschreibung", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"]));
  issued.forEach(inv => {
    const client = (data.persons || []).find(c => c.id === inv.clientId);
    const desc = (inv.items || []).map(it => it.desc).filter(Boolean).join(", ");
    // Satz der Rechnung selbst, nicht der aktuelle Studio-Satz (sonst falsch nach einer Satzänderung)
    const taxRate = inv.mwst ? (inv.mwstRate ?? mwstRate) : 0;
    rows.push(line([inv.date, inv.number, client?.name || "", desc, f(invoiceNet(inv)), taxRate, f(inv.tax || 0), f(inv.total || 0)]));
  });
  rows.push(line(["", "", "", "TOTAL", f(s.revenueNet), "", f(s.taxTotal), f(issued.reduce((a, i) => a + (i.total || 0), 0))]));
  rows.push("");

  rows.push(line(["SPESEN (MITARBEITERBEZOGEN)", "", "", "", "", "", "", "", ""]));
  rows.push(line(["Datum", "Kategorie", "Projekt", "Beschreibung", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF", "Ausbezahlt über Lohn"]));
  expenses.forEach(exp => {
    const proj = (data.projects || []).find(p => p.id === exp.projectId);
    const lohn = exp.lohnEntryId ? (data.lohnEntries || []).find(l => l.id === exp.lohnEntryId) : undefined;
    rows.push(line([exp.date, exp.category, proj?.name || "", exp.description, f(expenseNet(exp)), exp.inclMwst ? (exp.mwstRate || 0) : 0, f(expenseTax(exp)), f(exp.amount || 0), lohn ? lohn.monat : exp.lohnEntryId ? "ja" : ""]));
  });
  rows.push(line(["", "", "", "TOTAL", f(s.expNet), "", f(s.expTax), f(s.expGross), ""]));
  rows.push("");

  rows.push(line(["INTERNE AUSGABEN", "", "", "", "", "", "", ""]));
  rows.push(line(["Datum", "Kategorie", "Beschreibung", "Wiederkehrend", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"]));
  internalExpenses.forEach(exp => {
    rows.push(line([exp.date, exp.category, exp.description, exp.recurring ? (exp.recurringInterval || "monatlich") : "", f(expenseNet(exp)), exp.inclMwst ? (exp.mwstRate || 0) : 0, f(expenseTax(exp)), f(exp.amount || 0)]));
  });
  rows.push(line(["", "", "", "TOTAL", f(s.intNet), "", f(s.intTax), f(s.intGross)]));
  rows.push("");

  if (lohnEntries.length > 0) {
    rows.push(line(["PERSONALAUFWAND / LÖHNE", "", "", "", "", "", "", "", "", "", "", ""]));
    rows.push(line(["Monat", "Mitarbeiter", "Bruttolohn", "Abzüge AN", "Netto", "Familienzulagen", "Spesen", "Auszahlung AN", "AG AHV/IV/EO", "AG ALV", "AG PK", "AG FAK/VK/BU/KTG", "AG total", "Personalaufwand"]));
    lohnEntries.forEach(l => {
      const ag = lohnAGBeitraege(l);
      rows.push(line([l.monat, l.empSnapshot?.name || "", f(l.bruttoTotal || 0), f(l.totalAbzuege || 0), f(l.netto || 0), f(l.familienzulagen || 0), f(l.spesenTotal || 0), f(l.auszahlung || 0), f(ag.ahvAG), f(ag.alvAG), f(ag.bvgAG), f(ag.weitere), f(ag.total), f(lohnPersonalaufwand(l))]));
    });
    rows.push(line(["", "", f(s.lohnBrutto), "", "", "", "", "", f(s.lohnAGParts.ahvAG), f(s.lohnAGParts.alvAG), f(s.lohnAGParts.bvgAG), f(s.lohnAGParts.weitere), f(s.lohnAG), f(s.personalaufwand)]));
    rows.push("");
  }

  rows.push(line(["ZUSAMMENFASSUNG", "", "", "", "", "", "", ""]));
  rows.push(line(["", "", "", "Einnahmen (Netto)", f(s.revenueNet), "", "", ""]));
  rows.push(line(["", "", "", "Spesen (Netto, inkl. über Lohn ausbezahlte)", f(s.expNet), "", "", ""]));
  rows.push(line(["", "", "", "Interne Ausgaben (Netto)", f(s.intNet), "", "", ""]));
  rows.push(line(["", "", "", "Personalaufwand (Bruttolohn + AG-Beiträge)", f(s.personalaufwand), "", "", ""]));
  rows.push(line(["", "", "", "Ergebnis (Netto)", f(s.ergebnis), "", "", ""]));
  const methode = s.mwstMethode === "saldo" ? `Saldosteuersatz ${data.settings?.mwstSaldoSatz ?? 0} %` : "effektive Methode";
  rows.push(line(["", "", "", `MWST (${methode}, ${s.mwstArt === "vereinnahmt" ? "vereinnahmte" : "vereinbarte"} Entgelte)`, "", "", "", ""]));
  if (s.mwstMethode === "saldo") rows.push(line(["", "", "", "Steuerbares Entgelt inkl. MWST", "", "", f(s.mwstEntgeltBrutto), ""]));
  rows.push(line(["", "", "", "Umsatzsteuer", "", "", f(s.umsatzsteuer), ""]));
  if (s.akontoTax > 0 && s.mwstMethode !== "saldo") rows.push(line(["", "", "", "davon auf Akontorechnungen", "", "", f(s.akontoTax), ""]));
  if (s.mwstMethode !== "saldo") rows.push(line(["", "", "", "Vorsteuer (Spesen + Ausgaben)", "", "", f(s.vorsteuer), ""]));
  rows.push(line(["", "", "", s.mwstSchuld < 0 ? "MWST-Guthaben" : "MWST-Schuld", "", "", f(Math.abs(s.mwstSchuld)), ""]));
  return rows.join("\n");
}

/**
 * Löst den Download des Buchhaltungs-Exports aus (UTF-8 mit BOM für Excel), Inhalt aus
 * `buildBuchhaltungCSV`. Seiteneffekt: erzeugt ein `<a download>` im DOM.
 * @param period `YYYY` (oder Quartal/Monat) zum Filtern; leer = alle Jahre
 */
export function exportBuchhaltungCSV(data: AppData, period = ""): void {
  const blob = new Blob(["﻿" + buildBuchhaltungCSV(data, period)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `buchhaltung-${period || "gesamt"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
