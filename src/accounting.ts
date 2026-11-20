// Buchhaltung: reine Rechenregeln für Jahresergebnis, MWST-Abrechnung, Personalaufwand und den
// CSV-Export. Eine Quelle für Accounting.tsx, die Druckvorlage (print/docs/AccountingPrint.tsx)
// und `exportBuchhaltungCSV` — die drei rechneten früher je eigene, auseinanderlaufende Summen.
//
// Regeln (Stand 26.11):
//   - Einnahmen = Umsatz netto nach Rabatt (`invoiceNet`) der gestellten Rechnungen (ohne Entwürfe)
//     nach Rechnungsdatum — dieselbe Regel wie `yearRevenue` (Übersicht, «Heute»).
//   - MWST auf Einnahmen nur aus gestellten Rechnungen; Akonto-MWST getrennt als «ausstehend»
//     (Entscheid Karim offen, bewusst unverändert).
//   - Spesen: ALLE Spesen der Periode mit Netto und Vorsteuer, auch die über den Lohn ausbezahlten.
//     Der Personalaufwand enthält deshalb KEINE Spesen (vorher steckten sie brutto in
//     `lohn.auszahlung`, ihre Vorsteuer ging verloren).
//   - Personalaufwand = Bruttolohn Total + Arbeitgeberbeiträge (AHV/IV/EO und ALV paritätisch
//     = AN-Abzug, PK-AG-Anteil `bvgAG`). Vorher Auszahlung + PK-AG: die AN-Abzüge (rund 16 % des
//     Bruttos), die das Büro an AHV-Kasse/PK überweist, fehlten im Aufwand.
//   - Interne Ausgaben: jeder Eintrag einmal an seinem Datum (wiederkehrende werden hier NICHT
//     hochgerechnet; das macht nur das Budget).

import { invoiceNet, roundCHF, type LohnVorperioden } from "./utils";
import type { AppData, Expense, InternalExpense, Invoice, LohnEntry, LohnResult } from "./types";

/**
 * Liegt ein Datum in der Periode? `""` = alle, `YYYY` = Jahr, `YYYY-MM` = Monat,
 * `YYYY-Qn` = Quartal (MWST-Abrechnung).
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
  return d.startsWith(period);
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Anzeige einer Periode: «2026», «3. Quartal 2026», «November 2026», «Alle Jahre». */
export function periodLabel(period: string): string {
  if (!period) return "Alle Jahre";
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `${q[2]}. Quartal ${q[1]}`;
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

/** Netto einer Spese/Ausgabe (ungerundet): bei `inclMwst` der Betrag ohne den enthaltenen MWST-Anteil. */
export function expenseNet(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">): number {
  const amount = e.amount || 0;
  return e.inclMwst ? amount / (1 + (e.mwstRate || 0) / 100) : amount;
}

/** Vorsteuer (enthaltener MWST-Anteil) einer Spese/Ausgabe, ungerundet; 0 ohne `inclMwst`. */
export function expenseTax(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">): number {
  return (e.amount || 0) - expenseNet(e);
}

/** Arbeitgeberbeiträge einer Lohnabrechnung. */
export interface LohnAGBeitraege {
  /** AHV/IV/EO AG-Anteil (paritätisch = AN-Abzug) */
  ahvAG: number;
  /** ALV AG-Anteil (paritätisch = AN-Abzug, gleicher Höchstlohn) */
  alvAG: number;
  /** Pensionskasse AG-Anteil */
  bvgAG: number;
  total: number;
}

/**
 * Arbeitgeberbeiträge aus einer Abrechnung: AHV/IV/EO und ALV paritätisch (AG = AN-Abzug, gesetzlich),
 * PK aus `bvgAG`. FAK, Verwaltungskosten und UVG-BU sind (noch) nicht erfasst.
 */
export function lohnAGBeitraege(l: Pick<LohnResult, "ahv" | "alv" | "bvgAG">): LohnAGBeitraege {
  const ahvAG = l.ahv || 0;
  const alvAG = l.alv || 0;
  const bvgAG = l.bvgAG || 0;
  return { ahvAG, alvAG, bvgAG, total: roundCHF(ahvAG + alvAG + bvgAG) };
}

/** Personalaufwand einer Abrechnung = Bruttolohn Total + Arbeitgeberbeiträge (ohne Spesen). */
export function lohnPersonalaufwand(l: Pick<LohnResult, "bruttoTotal" | "ahv" | "alv" | "bvgAG">): number {
  return roundCHF((l.bruttoTotal || 0) + lohnAGBeitraege(l).total);
}

/**
 * Frühere Abrechnungen desselben Mitarbeiters im selben Jahr vor `monat` (für den kumulierten
 * ALV-/UVG-Höchstlohn in `calcLohn`). Ältere Abrechnungen ohne `alvBasis` zählen voll.
 */
export function lohnVorperioden(lohnEntries: Pick<LohnEntry, "employeeId" | "monat" | "bruttoTotal" | "alvBasis">[], employeeId: string, monat: string): LohnVorperioden {
  const year = monat.slice(0, 4);
  return lohnEntries
    .filter(l => l.employeeId === employeeId && l.monat.startsWith(year) && l.monat < monat)
    .reduce((s, l) => ({
      bruttoBisher: s.bruttoBisher + (l.bruttoTotal || 0),
      alvBasisBisher: s.alvBasisBisher + (l.alvBasis ?? l.bruttoTotal ?? 0),
    }), { bruttoBisher: 0, alvBasisBisher: 0 });
}

/**
 * Spesen, die mit der Lohnabrechnung `monat` ausbezahlt werden: noch keiner Abrechnung zugeordnet,
 * nicht schon (bar) «ausbezahlt», und entweder aus diesem Monat oder aus einem früheren Monat mit
 * Status «auf nächsten Lohn» (z.B. nach einem Storno oder nach Monatsabschluss nachgereicht).
 */
export function spesenFuerLohn(expenses: Expense[], employeeId: string, monat: string): Expense[] {
  return expenses.filter(e => {
    if (e.employeeId !== employeeId || e.lohnEntryId) return false;
    if (e.status === "ausbezahlt") return false;
    const m = (e.date || "").slice(0, 7);
    if (m === monat) return true;
    return m < monat && e.status === "auf nächsten Lohn";
  });
}

/** Zahlen der Buchhaltung für eine Periode (alle Beträge auf Rappen gerundet). */
export interface AccountingSummary {
  /** Umsatz netto der gestellten Rechnungen */
  revenueNet: number;
  /** Netto der Entwürfe (nur informativ, nicht im Ergebnis) */
  draftNet: number;
  issuedCount: number;
  /** MWST aller gestellten Rechnungen */
  taxTotal: number;
  /** davon Akonto-MWST (getrennt ausgewiesen) */
  akontoTax: number;
  taxWithoutAkonto: number;
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
  /** Σ Arbeitgeberbeiträge (AHV/ALV paritätisch + PK) */
  lohnAG: number;
  lohnAGParts: { ahvAG: number; alvAG: number; bvgAG: number };
  /** Bruttolohn + AG-Beiträge */
  personalaufwand: number;
  lohnCount: number;
  /** Vorsteuer aus Spesen und internen Ausgaben */
  vorsteuer: number;
  /** MWST-Schuld ohne Akonto-MWST */
  mwstSchuld: number;
  ausgabenTotal: number;
  ergebnis: number;
}

type SummaryData = Pick<AppData, "invoices" | "expenses" | "internalExpenses" | "lohnEntries">;

/** Gefilterte Datensätze einer Periode (gleiche Filter für Ansicht, PDF und CSV). */
export function accountingRows(data: SummaryData, period: string): {
  invoices: Invoice[]; issued: Invoice[]; expenses: Expense[]; internalExpenses: InternalExpense[]; lohnEntries: LohnEntry[];
} {
  const byDate = <T extends { date?: string }>(a: T, b: T) => (a.date || "").localeCompare(b.date || "");
  const invoices = (data.invoices || []).filter(i => inPeriod(i.date, period)).sort(byDate);
  return {
    invoices,
    issued: invoices.filter(i => i.status !== "entwurf"),
    expenses: (data.expenses || []).filter(e => inPeriod(e.date, period)).sort(byDate),
    internalExpenses: (data.internalExpenses || []).filter(e => inPeriod(e.date, period)).sort(byDate),
    lohnEntries: (data.lohnEntries || []).filter(l => inPeriod(`${l.monat}-01`, period)).sort((a, b) => a.monat.localeCompare(b.monat)),
  };
}

/**
 * Jahresergebnis und MWST-Abrechnung einer Periode (`inPeriod`: "", Jahr, Monat oder Quartal).
 * Regeln im Dateikopf.
 */
export function accountingSummary(data: SummaryData, period: string): AccountingSummary {
  const rows = accountingRows(data, period);
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const { invoices, issued, expenses, internalExpenses, lohnEntries } = rows;

  const revenueNet = roundCHF(sum(issued, invoiceNet));
  const taxTotal = roundCHF(sum(issued, i => i.tax || 0));
  const akontoTax = roundCHF(sum(issued.filter(i => i.invoiceKind === "akonto"), i => i.tax || 0));
  const taxWithoutAkonto = roundCHF(taxTotal - akontoTax);

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
  };
  const lohnBrutto = roundCHF(sum(lohnEntries, l => l.bruttoTotal || 0));
  const lohnAG = roundCHF(sum(ag, a => a.total));
  const personalaufwand = roundCHF(lohnBrutto + lohnAG);

  const vorsteuer = roundCHF(expTax + intTax);
  const ausgabenTotal = roundCHF(expNet + intNet + personalaufwand);
  return {
    revenueNet,
    draftNet: roundCHF(sum(invoices.filter(i => i.status === "entwurf"), invoiceNet)),
    issuedCount: issued.length,
    taxTotal, akontoTax, taxWithoutAkonto,
    paidTotal: roundCHF(sum(invoices.filter(i => i.status === "bezahlt"), i => i.total || 0)),
    openTotal: roundCHF(sum(invoices.filter(i => i.status === "gesendet"), i => i.total || 0)),
    overdueTotal: roundCHF(sum(invoices.filter(i => i.status === "überfällig"), i => i.total || 0)),
    expNet, expTax, expGross, expCount: expenses.length, expViaLohnCount: expenses.filter(e => e.lohnEntryId).length,
    intNet, intTax, intGross,
    lohnBrutto, lohnAG, lohnAGParts, personalaufwand, lohnCount: lohnEntries.length,
    vorsteuer,
    mwstSchuld: roundCHF(taxWithoutAkonto - vorsteuer),
    ausgabenTotal,
    ergebnis: roundCHF(revenueNet - ausgabenTotal),
  };
}

/**
 * CSV-Text des Buchhaltungs-Exports (`;`-getrennt, ohne BOM): Einnahmen, Spesen, interne Ausgaben,
 * Löhne und Zusammenfassung. Summenzeilen gehen auf die sichtbaren Zeilen auf; die Zusammenfassung
 * entspricht `accountingSummary` (gleiche Zahlen wie Ansicht und PDF).
 * @param period `inPeriod`-Periode; leer = alle
 */
export function buildBuchhaltungCSV(data: AppData, period = ""): string {
  const sep = ";";
  // s ?? "" statt s || "" — sonst wird ein echter Zahlenwert 0 zu einer leeren Zelle statt "0".
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
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
    rows.push(line(["Monat", "Mitarbeiter", "Bruttolohn", "Abzüge AN", "Netto", "Spesen", "Auszahlung AN", "AG AHV/IV/EO", "AG ALV", "AG PK", "AG total", "Personalaufwand"]));
    lohnEntries.forEach(l => {
      const ag = lohnAGBeitraege(l);
      rows.push(line([l.monat, l.empSnapshot?.name || "", f(l.bruttoTotal || 0), f(l.totalAbzuege || 0), f(l.netto || 0), f(l.spesenTotal || 0), f(l.auszahlung || 0), f(ag.ahvAG), f(ag.alvAG), f(ag.bvgAG), f(ag.total), f(lohnPersonalaufwand(l))]));
    });
    rows.push(line(["", "", f(s.lohnBrutto), "", "", "", "", f(s.lohnAGParts.ahvAG), f(s.lohnAGParts.alvAG), f(s.lohnAGParts.bvgAG), f(s.lohnAG), f(s.personalaufwand)]));
    rows.push("");
  }

  rows.push(line(["ZUSAMMENFASSUNG", "", "", "", "", "", "", ""]));
  rows.push(line(["", "", "", "Einnahmen (Netto)", f(s.revenueNet), "", "", ""]));
  rows.push(line(["", "", "", "Spesen (Netto, inkl. über Lohn ausbezahlte)", f(s.expNet), "", "", ""]));
  rows.push(line(["", "", "", "Interne Ausgaben (Netto)", f(s.intNet), "", "", ""]));
  rows.push(line(["", "", "", "Personalaufwand (Bruttolohn + AG-Beiträge)", f(s.personalaufwand), "", "", ""]));
  rows.push(line(["", "", "", "Ergebnis (Netto)", f(s.ergebnis), "", "", ""]));
  rows.push(line(["", "", "", "MWST auf Einnahmen (excl. Akonto)", "", "", f(s.taxWithoutAkonto), ""]));
  if (s.akontoTax > 0) rows.push(line(["", "", "", "↳ Akonto-MWST ausstehend (bei Schlussrechnung)", "", "", f(s.akontoTax), ""]));
  rows.push(line(["", "", "", "Vorsteuer (Spesen + Ausgaben)", "", "", f(s.vorsteuer), ""]));
  rows.push(line(["", "", "", "MWST-Schuld (excl. Akonto)", "", "", f(s.mwstSchuld), ""]));
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
