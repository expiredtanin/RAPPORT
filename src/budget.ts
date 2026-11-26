// Büro-Budget (views/StudioBudget.tsx): reine Rechenregeln, damit Ansicht, Tests und Nachrechnung
// dieselben Zahlen liefern.
//
// Regeln (Stand 26.11):
//   - Personalkosten = 12 Monatsabrechnungen des Jahres mit `calcLohn` (dieselbe Rechnung wie die
//     Lohnläufe): Bruttolohn inkl. 13. Monatslohn + alle Arbeitgeberbeiträge (AHV/IV/EO, ALV bis
//     Höchstlohn, PK laut Ausweis oder %-Satz, FAK, Verwaltungskosten, UVG-BU, KTG). Ein-/Austritt,
//     Rentner und BVG-Eintrittsschwelle wirken wie in der Lohnabrechnung. Vorher pauschal 20 %.
//   - Fixkosten = interne Ausgaben netto: wiederkehrende aufs Jahr hochgerechnet (monatlich × 12,
//     quartalsweise × 4, jährlich × 1); endet eine im Jahr (`recurringUntil`), zählen nur ihre
//     Buchungen in diesem Jahr, ist sie vorher beendet, gar nicht. Einmalige nur aus dem Jahr.
//   - Einnahmen: gestellte Rechnungen des Jahres netto (Entwürfe nur auf Wunsch); Offerten des Jahres
//     netto abzüglich dessen, was aus ihnen schon in Rechnung gestellt ist (sonst doppelt gezählt).

import { calcLohn, invoiceNet, invoicesForQuote, roundCHF, monatsAnteilNachEintritt, type LohnAGSaetze } from "./utils";
import { expandInternalExpenses, expenseNet, lohnAGBeitraege, lohnVorperioden } from "./accounting";
import type { AppData, Employee, InternalExpense, LohnEntry } from "./types";

/** Lohnkosten eines Jahres aus 12 Monatsabrechnungen. */
export interface JahresLohnkosten {
  /** Σ Bruttolohn Total (inkl. 13. Monatslohn) */
  brutto: number;
  /** Σ Arbeitgeberbeiträge */
  ag: number;
  /** brutto + ag */
  total: number;
  /** Monate mit Lohn (Ein-/Austritt) */
  monate: number;
}

/**
 * Lohnkosten von `emp` im Jahr `year` (alle 12 Monate, ohne Spesen und Boni), gerechnet wie die
 * Lohnläufe inkl. kumuliertem ALV-/UVG-Höchstlohn.
 */
export function jahresLohnkosten(emp: Employee, year: number, ag: LohnAGSaetze): JahresLohnkosten {
  const done: LohnEntry[] = [];
  let brutto = 0, agSum = 0, monate = 0;
  for (let m = 1; m <= 12; m++) {
    const monat = `${year}-${String(m).padStart(2, "0")}`;
    if (monatsAnteilNachEintritt(emp.eintrittsdatum, monat, emp.austrittsdatum) === 0) continue;
    const r = calcLohn(emp, monat, [], 0, lohnVorperioden(done, emp.id, monat), ag);
    done.push({ ...r, id: monat, employeeId: emp.id, monat });
    brutto += r.bruttoTotal;
    agSum += lohnAGBeitraege(r).total;
    monate++;
  }
  return { brutto: roundCHF(brutto), ag: roundCHF(agSum), total: roundCHF(brutto + agSum), monate };
}

/**
 * Zeilen einer geladenen Budgetversion auf die heutigen Zeilen abbilden: Werte der Version, wo sie die Zeile
 * kennt; Personen/Ausgaben, die nach dem Speichern der Version dazukamen, behalten ihre aktuelle Zeile. Ohne
 * Zeile im Stand liessen sich sonst Häkchen und Übersteuerung dieser Zeilen nicht mehr ändern (die
 * Änderung läuft über die Zeile mit gleicher id).
 */
export function mergeBudgetRows<T extends { id: string }>(current: T[], loaded: T[] | undefined): T[] {
  const byId = new Map((loaded || []).map(r => [r.id, r]));
  return current.map(r => byId.get(r.id) ?? r);
}

/** Eine Zeile der Fixkosten. */
export interface BudgetFixRow { id: string; label: string; cat: string; amount: number }

const PER_YEAR: Record<string, number> = { monatlich: 12, quartalsweise: 4, "jährlich": 1 };

/** Fixkosten des Jahres aus den internen Ausgaben (Regeln im Dateikopf). */
export function budgetFixkosten(list: InternalExpense[], year: number): BudgetFixRow[] {
  const y = String(year);
  const rows: BudgetFixRow[] = [];
  for (const e of list || []) {
    const label = e.description || e.category;
    if (!e.recurring) {
      if ((e.date || "").startsWith(y)) rows.push({ id: e.id, label, cat: e.category, amount: expenseNet(e) });
      continue;
    }
    if ((e.date || "") > `${y}-12-31`) continue;               // beginnt erst später
    const until = e.recurringUntil ? e.recurringUntil.slice(0, 7) : null;
    if (until && until < `${y}-01`) continue;                    // im Vorjahr beendet
    let amount: number;
    if (until && until <= `${y}-12`) {
      // endet in diesem Jahr: nur seine Buchungen im Jahr
      amount = expandInternalExpenses([e], `${y}-12-31`).filter(x => x.date.startsWith(y)).reduce((s, x) => s + expenseNet(x), 0);
    } else {
      amount = expenseNet(e) * (PER_YEAR[e.recurringInterval || "monatlich"] ?? 12);
    }
    rows.push({ id: e.id, label, cat: e.category, amount: roundCHF(amount) });
  }
  return rows;
}

/** Welche Einnahmen das Budget zählt. */
export interface BudgetEinnahmenOpts {
  rechnungen: boolean;
  rechnungsEntwuerfe: boolean;
  offerten: boolean;
  offertEntwuerfe: boolean;
}

/** Einnahmen des Jahres, aufgeschlüsselt. */
export interface BudgetEinnahmen {
  paid: number; sent: number; draft: number;
  /** Offerten netto abzüglich bereits daraus gestellter Rechnungen */
  quotesAccepted: number; quotesSent: number; quotesDraft: number;
  total: number;
}

/** Einnahmen des Jahres für das Budget (Regeln im Dateikopf). */
export function budgetEinnahmen(data: Pick<AppData, "invoices" | "quotes" | "projects">, year: number, o: BudgetEinnahmenOpts): BudgetEinnahmen {
  const y = String(year);
  const inv = (data.invoices || []).filter(i => (i.date || "").startsWith(y));
  const sum = (st: string[]) => roundCHF(inv.filter(i => st.includes(i.status)).reduce((s, i) => s + invoiceNet(i), 0));
  const paid = sum(["bezahlt"]), sent = sum(["gesendet", "überfällig"]), draft = sum(["entwurf"]);
  // Offertwert, der noch nicht als (gestellte) Rechnung gezählt ist
  const offen = (q: AppData["quotes"][number]) => {
    if (!o.rechnungen) return q.sub || 0;
    const billed = invoicesForQuote(q, data.invoices || [], data.projects || [])
      .filter(i => i.status !== "entwurf" || o.rechnungsEntwuerfe)
      .reduce((s, i) => s + invoiceNet(i), 0);
    return Math.max(0, (q.sub || 0) - billed);
  };
  const quotes = (data.quotes || []).filter(q => (q.date || "").startsWith(y));
  const qs = (st: string) => roundCHF(quotes.filter(q => q.status === st).reduce((s, q) => s + offen(q), 0));
  const quotesAccepted = qs("angenommen"), quotesSent = qs("gesendet"), quotesDraft = qs("entwurf");
  const total = (o.rechnungen ? paid + sent + (o.rechnungsEntwuerfe ? draft : 0) : 0)
    + (o.offerten ? quotesAccepted + quotesSent + (o.offertEntwuerfe ? quotesDraft : 0) : 0);
  return { paid, sent, draft, quotesAccepted, quotesSent, quotesDraft, total: roundCHF(total) };
}
