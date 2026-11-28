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
//   - Spesen: nur genehmigte («genehmigt», «auf nächsten Lohn») und ausbezahlte (auch über den Lohn) zählen als
//     Aufwand und Vorsteuer (`spesenZaehlen`); offene erscheinen separat als «noch nicht genehmigt», abgelehnte nie.
//     Die gezählten mit Netto und Vorsteuer, auch die über den Lohn ausbezahlten.
//     Der Personalaufwand enthält deshalb KEINE Spesen (vorher steckten sie brutto in
//     `lohn.auszahlung`, ihre Vorsteuer ging verloren).
//   - Personalaufwand = Bruttolohn Total + Arbeitgeberbeiträge (AHV/IV/EO und ALV paritätisch
//     = AN-Abzug, PK-AG-Anteil `bvgAG`). Vorher Auszahlung + PK-AG: die AN-Abzüge (rund 16 % des
//     Bruttos), die das Büro an AHV-Kasse/PK überweist, fehlten im Aufwand.
//   - Interne Ausgaben: wiederkehrende werden als einzelne Buchungen bis heute (bzw. bis
//     `recurringUntil`) aufgelöst (`expandInternalExpenses`) — jede Zahlung zählt in ihrem Monat.
//   - Spesen im Lohn: nur genehmigte («genehmigt», «auf nächsten Lohn»), nie «offen».

import { csvCell, hoechstlohnKumuliert, invoiceNet, lohnImMonat, monatsAnteilNachEintritt, roundCHF, type LohnVorperioden } from "./utils";
import type { AppData, DreizehnterModus, Employee, Expense, MwstTeil, InternalExpense, Invoice, LohnEntry, LohnResult, LohnVorsystem, NachzahlungMonat, OvertimeClosing } from "./types";

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

/** Gültige Einträge des Betragsverlaufs, nach Monat aufsteigend. */
function amountHistorySorted(e: Pick<InternalExpense, "amountHistory">): { before: string; amount: number }[] {
  return (e.amountHistory || []).filter(h => h && /^\d{4}-\d{2}$/.test(h.before) && Number.isFinite(h.amount)).sort((a, b) => a.before.localeCompare(b.before));
}

/** Betrag einer wiederkehrenden Ausgabe im Monat `ym` («YYYY-MM»): der Verlauf bis zur letzten Änderung, danach `amount`. */
export function recurringAmountFor(e: Pick<InternalExpense, "amount" | "amountHistory">, ym: string): number {
  const hit = amountHistorySorted(e).find(h => ym < h.before);
  return hit ? hit.amount : e.amount;
}

/**
 * Betragsänderung einer wiederkehrenden Ausgabe ab dem Monat `fromMonth` («YYYY-MM»): frühere Monate behalten den
 * alten Betrag (Eintrag im Verlauf), ab dem Monat gilt der neue. Spätere Änderungen werden dabei überschrieben.
 * Ohne Änderung des Betrags kommt dieselbe Ausgabe zurück.
 */
export function changeRecurringAmount(e: InternalExpense, amount: number, fromMonth: string): InternalExpense {
  if (amount === e.amount) return e;
  const start = (e.date || "").slice(0, 7);
  const hist = amountHistorySorted(e);
  const next = hist.filter(h => h.before <= fromMonth);
  if (!next.some(h => h.before === fromMonth)) {
    // Monate bis fromMonth: Betrag der Stufe, die sie bisher abdeckte (bzw. der bisherige aktuelle Betrag)
    const covering = hist.find(h => h.before > fromMonth);
    next.push({ before: fromMonth, amount: covering ? covering.amount : e.amount });
  }
  const amountHistory = next.filter(h => h.before > start);   // Stufen vor dem Beginn der Serie sind wirkungslos
  const { amountHistory: _old, ...rest } = e;
  return { ...rest, amount, ...(amountHistory.length ? { amountHistory } : {}) };
}

/**
 * Frühester Monat («YYYY-MM»), ab dem eine Betragsänderung gelten darf: Beginn der laufenden MWST-Periode
 * (Quartal bzw. bei Saldosteuersatz Halbjahr). Abgeschlossene Perioden und ihre Buchungen bleiben unverändert.
 */
export function earliestAmountChangeMonth(today: string, methode: "effektiv" | "saldo" | undefined): string {
  const ym = today.slice(0, 7);
  const per = mwstPerioden(Number(today.slice(0, 4)), methode).find(p => p.start <= ym && ym <= p.end);
  return per ? per.start : ym;
}

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
      // erste Buchung immer (wie eine einmalige Ausgabe mit Datum in der Zukunft) — sonst war eine Serie mit
      // Startdatum nach heute in der Liste unsichtbar und liess sich weder bearbeiten noch löschen
      if (k > 0 && (d > today || (untilMonth && d.slice(0, 7) > untilMonth))) break;
      // Betrag des Monats aus dem Verlauf (Betragsänderung «gültig ab»); die erste Buchung behält die id der Serie
      const amount = recurringAmountFor(e, d.slice(0, 7));
      if (k === 0) out.push(amount === e.amount ? e : { ...e, amount, occurrenceOf: e.id });
      else out.push({ ...e, id: `${e.id}@${d}`, date: d, amount, occurrenceOf: e.id, receiptData: null, receiptName: null });
    }
  }
  return out;
}

/**
 * Vorsteuer (enthaltener MWST-Anteil) einer Spese/Ausgabe, pro Beleg auf Rappen gerundet — wie sie
 * auf der Quittung steht; Summen sind die Summe dieser Beträge (vorher wurde erst die Summe gerundet,
 * Zeilen und Total wichen um Rappen ab). 0 ohne `inclMwst`.
 */
export function expenseTax(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate"> & { mwstAufteilung?: Expense["mwstAufteilung"] }): number {
  const amount = e.amount || 0;
  // Beleg mit mehreren Sätzen (Hotel 3.8 % + Frühstück 8.1 %): Vorsteuer je Teilbetrag, wie auf der Quittung. Geht die
  // Aufteilung nicht auf den Betrag auf (Σ ≠ amount), gilt sie nicht — dann rechnet der Hauptsatz wie bisher.
  const teile = Array.isArray(e.mwstAufteilung) ? e.mwstAufteilung : [];
  if (e.inclMwst && teile.length > 0 && Math.abs(teile.reduce((t, x) => t + (Number(x.betrag) || 0), 0) - amount) < 0.005) {
    return roundCHF(teile.reduce((t, x) => {
      const b = Number(x.betrag) || 0, r = Number(x.satz);
      return t + (r > 0 && r <= 100 ? roundCHF(b - b / (1 + r / 100)) : 0);
    }, 0));
  }
  // unsinniger Satz (≤ 0, über 100 %, keine Zahl) rechnet ohne Vorsteuer — −100 % ergab sonst ∞ in der ganzen Buchhaltung
  const rate = Number(e.mwstRate);
  if (!e.inclMwst || !(rate > 0 && rate <= 100)) return 0;
  return roundCHF(amount - amount / (1 + rate / 100));
}

const fmtCHF = (n: number) => `CHF ${roundCHF(n).toFixed(2)}`;

export type MwstFelder = { amount: number; mwstRate: number; inclMwst: boolean; mwstAufteilung?: MwstTeil[] | null };

/** Fehlermeldung für eine ungültige Aufteilung (Summe ≠ Betrag, Satz ausserhalb 0–30 %), sonst null. */
export function mwstAufteilungFehler(f: MwstFelder): string | null {
  const t = f.inclMwst ? f.mwstAufteilung || [] : [];
  if (t.length === 0) return null;
  if (t.some(x => !(Number(x.satz) >= 0 && Number(x.satz) <= 30))) return "MWST-Sätze der Aufteilung zwischen 0 und 30 %.";
  if (t.some(x => !(Number(x.betrag) > 0))) return "Jeder Teilbetrag der Aufteilung muss grösser als 0 sein.";
  const summe = roundCHF(t.reduce((s, x) => s + Number(x.betrag), 0));
  if (Math.abs(summe - roundCHF(Number(f.amount) || 0)) >= 0.005) return `Die Teilbeträge ergeben ${fmtCHF(summe)}, der Beleg ${fmtCHF(Number(f.amount) || 0)}.`;
  return null;
}

/** Netto einer Spese/Ausgabe = Betrag minus Vorsteuer (pro Beleg auf Rappen). */
export function expenseNet(e: Pick<Expense, "amount" | "inclMwst" | "mwstRate"> & { mwstAufteilung?: Expense["mwstAufteilung"] }): number {
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
 *
 * Umstieg mitten im Jahr: `vorsystem` (Summen aus dem alten System) gilt für Abrechnungen nach `bisMonat` und ersetzt
 * die Monate bis und mit `bisMonat` (eigene Abrechnungen davor zählen dann nicht zusätzlich). Fehlt die ALV-Basis,
 * gilt der AHV-Lohn, höchstens der anteilige Höchstlohn bis `bisMonat`.
 */
export function lohnVorperioden(lohnEntries: Pick<LohnEntry, "employeeId" | "monat" | "bruttoTotal" | "alvBasis" | "brutto" | "dreizehnter" | "nachzahlungBasis">[], employeeId: string, monat: string, vorsystem?: LohnVorsystem[]): LohnVorperioden {
  const year = monat.slice(0, 4);
  const vs = (vorsystem || []).find(v => String(v.jahr) === year && /^\d{4}-\d{2}$/.test(v.bisMonat || "") && v.bisMonat.slice(0, 4) === year && monat > v.bisMonat);
  const start: LohnVorperioden = { bruttoBisher: 0, alvBasisBisher: 0, dreizehnterBasisBisher: 0, dreizehnterBisher: 0, bruttoMonatslohnBisher: 0 };
  if (vs) {
    const brutto = roundCHF(vs.brutto || 0);
    const dz = roundCHF(vs.dreizehnter || 0);
    const alv = vs.alvBasis != null ? roundCHF(vs.alvBasis) : Math.min(brutto, hoechstlohnKumuliert(undefined, vs.bisMonat));
    const monatslohn = vs.monatslohnSumme != null ? roundCHF(vs.monatslohnSumme) : roundCHF(Math.max(0, brutto - dz));
    start.bruttoBisher = brutto; start.alvBasisBisher = alv; start.dreizehnterBisher = dz;
    start.dreizehnterBasisBisher = dz > 0 ? monatslohn : 0;
    start.bruttoMonatslohnBisher = monatslohn;
    start.vorsystem = { bisMonat: vs.bisMonat, brutto, alvBasis: alv };
  }
  return lohnEntries
    .filter(l => l.employeeId === employeeId && l.monat.startsWith(year) && l.monat < monat && !(vs && l.monat <= vs.bisMonat))
    .reduce((s, l) => ({
      ...s,
      bruttoBisher: s.bruttoBisher + (l.bruttoTotal || 0),
      alvBasisBisher: s.alvBasisBisher + (l.alvBasis ?? l.bruttoTotal ?? 0),
      // nur Monate mit 13. Monatslohn (wurde er erst im Lauf des Jahres vereinbart, kein Nachzahlen im Dezember)
      dreizehnterBasisBisher: s.dreizehnterBasisBisher! + ((l.dreizehnter || 0) > 0 ? l.brutto || 0 : 0),
      dreizehnterBisher: s.dreizehnterBisher! + (l.dreizehnter || 0),
      bruttoMonatslohnBisher: s.bruttoMonatslohnBisher! + (l.brutto || 0) + (l.nachzahlungBasis || 0),
    }), start);
}

/** Ergebnis von `lohnNachzahlungOffen`. */
export interface LohnNachzahlung {
  /** Differenz je Monat (neuer Monatslohn − abgerechnet − schon nachbezahlt), älteste zuerst */
  monate: NachzahlungMonat[];
  /** Betrag der Zeile «Nachzahlung Lohn …» (Differenzen samt 13.-Anteil); negativ = Rückforderung */
  betrag: number;
  /** Differenz der Monatslöhne, die erst den 13. (Auszahlung November/Dezember, gleiches Jahr) erhöht */
  basis: number;
  /** «Nachzahlung Lohn 03.2026–05.2026» */
  beschrieb: string;
}

/**
 * Rückwirkende Lohnänderung: Differenz zwischen dem heutigen Monatslohn laut Stammdaten (`lohnImMonat` × Anteil) und
 * dem abgerechneten Bruttolohn jedes früheren, abgeschlossenen Monats. Gespeicherte Abrechnungen bleiben
 * unverändert; was schon mit einer früheren Abrechnung nachbezahlt wurde (`nachzahlungMonate`), zählt nicht
 * nochmals. Abrechnungen mit im Lauf übersteuertem Lohn oder Pensum werden nicht verglichen.
 *
 * 13. Monatslohn: Wird er monatlich bezahlt (oder liegt der Monat in einem früheren Jahr), kommt 1/12 der Differenz
 * in die Zeile; bei Auszahlung im November/Dezember im gleichen Jahr erhöht die Differenz erst den 13. (`basis`).
 * @param monat Monat des Lohnlaufs (`YYYY-MM`); verglichen werden nur frühere Monate
 */
export function lohnNachzahlungOffen(emp: Employee, lohnEntries: LohnEntry[], monat: string, modus: DreizehnterModus): LohnNachzahlung | null {
  const eigene = lohnEntries.filter(l => l.employeeId === emp.id);
  const bezahlt = new Map<string, number>();
  for (const l of eigene) for (const n of l.nachzahlungMonate || []) bezahlt.set(n.monat, roundCHF((bezahlt.get(n.monat) || 0) + n.betrag));
  const jahr = monat.slice(0, 4);
  // Klare Regel: nur datierte Änderungen («Lohn ab …», «Pensum ab …») lösen eine Nachzahlung aus, und nur für Monate ab
  // der frühesten solchen Änderung — wer den Grundlohn direkt ändert, bekam sonst für alle früheren Monate (auch
  // Vorjahre) eine Nachzahlung vorgeschlagen (Review 27.11.2026)
  const abs = [...(emp.lohnVerlauf || []), ...(emp.pensumVerlauf || [])].map(v => String(v?.ab || "")).filter(a => /^\d{4}-\d{2}/.test(a)).sort();
  if (abs.length === 0) return null;
  const ersterMonat = abs[0].slice(0, 7);
  const monate: NachzahlungMonat[] = [];
  let basis = 0;
  for (const e of eigene.filter(l => l.monat < monat && l.monat >= ersterMonat && !l.bruttoWasOverridden && !l.pensumWasOverridden).sort((a, b) => a.monat.localeCompare(b.monat))) {
    const soll = roundCHF(lohnImMonat(emp, e.monat) * monatsAnteilNachEintritt(emp.eintrittsdatum, e.monat, emp.austrittsdatum));
    const diff = roundCHF(soll - (e.brutto || 0) - (bezahlt.get(e.monat) || 0));
    if (Math.abs(diff) < 0.005) continue;
    const gleichesJahr = e.monat.slice(0, 4) === jahr;
    let dz = 0;
    if (gleichesJahr && modus !== "monatlich") basis = roundCHF(basis + diff);
    else if (gleichesJahr ? (e.dreizehnter || 0) > 0 : !!(e.saetzeSnapshot?.dreizehnterLohn ?? (e.dreizehnter || 0) > 0)) dz = roundCHF(diff / 12);
    monate.push({ monat: e.monat, betrag: diff, ...(dz ? { dreizehnter: dz } : {}) });
  }
  if (monate.length === 0) return null;
  const label = (m: string) => `${m.slice(5)}.${m.slice(0, 4)}`;
  const von = monate[0].monat, bis = monate[monate.length - 1].monat;
  return {
    monate,
    betrag: roundCHF(monate.reduce((t, m) => t + m.betrag + (m.dreizehnter || 0), 0)),
    basis,
    beschrieb: von === bis ? `Nachzahlung Lohn ${label(von)}` : `Nachzahlung Lohn ${label(von)}–${label(bis)}`,
  };
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

/**
 * Bis zu welchem Monat Spesen und Überstunden-Auszahlungen in den Lohnlauf `monat` gehören: sonst bis und mit
 * `monat`; im Austrittsmonat (letzter Lohnlauf) auch alle später datierten — z.B. Überstunden, die erst nach dem
 * Austritt im Jahresabschluss erfasst wurden. Vorher blieben sie in keiner Abrechnung hängen.
 */
export function lohnlaufBisMonat(monat: string, austrittsdatum?: string | null): string {
  return (austrittsdatum || "").slice(0, 7) === monat ? "9999-12" : monat;
}

/**
 * Überstunden-Auszahlungen (Jahresabschluss, Kennzeichen `imLohn`) einer Person bis und mit `bisMonat`, die noch in
 * keiner Lohnabrechnung stecken. Ältere ohne `imLohn` wurden separat ausbezahlt und kommen nicht nochmals.
 */
export function ueberstundenFuerLohn(abschluesse: OvertimeClosing[], lohnEntries: Pick<LohnEntry, "ueberstundenIds">[], empId: string, bisMonat: string): OvertimeClosing[] {
  const verrechnet = new Set(lohnEntries.flatMap(l => l.ueberstundenIds || []));
  return abschluesse.filter(a => a.empId === empId && a.type === "payout" && (a.auszahlungBetrag || 0) > 0
    && !verrechnet.has(a.id) && !!a.imLohn && (a.date || "").slice(0, 7) <= bisMonat);
}

/**
 * Zählt eine Spese in der Buchhaltung (Aufwand und Vorsteuer)? Genehmigte und ausbezahlte, ebenso jede, die schon in
 * einer Lohnabrechnung steckt. «offen» (auch ohne Status) wartet noch auf die Genehmigung, «abgelehnt» zählt nie.
 */
export function spesenZaehlen(e: Pick<Expense, "status" | "lohnEntryId">): boolean {
  if (e.status === "abgelehnt") return false;
  return !!e.lohnEntryId || (e.status || "offen") !== "offen";
}

/** Noch nicht genehmigte Spesen einer Person bis und mit `monat` (Hinweis im Lohnlauf). */
export function spesenWartend(expenses: Expense[], employeeId: string, monat: string): Expense[] {
  return expenses.filter(e => e.employeeId === employeeId && !e.lohnEntryId && (e.status || "offen") === "offen" && (e.date || "").slice(0, 7) <= monat);
}

/** Zahlen der Buchhaltung für eine Periode (alle Beträge auf Rappen gerundet). */
export interface AccountingSummary {
  /** Umsatz netto der gestellten Rechnungen */
  revenueNet: number;
  /** Σ Total der gestellten Rechnungen (inkl. MWST und allfälliger 5-Rappen-Rundung, wie die Rechnungszeilen) */
  revenueGross: number;
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
  /** Spesen der Periode, die noch nicht genehmigt sind: zählen nicht in Aufwand und Vorsteuer (abgelehnte nie) */
  expPendingCount: number;
  expPendingGross: number;
  /** gezählte Spesen ohne erfassten Beleg (Hinweis) und ihre Vorsteuer */
  expOhneBelegCount: number;
  expOhneBelegTax: number;
  /** Vorsteuer aus Spesen in der MWST-Abrechnung (vereinnahmt: nach Zahlungsdatum, sonst = expTax) */
  expTaxVorsteuer: number;
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
  /** Ertrag im Ergebnis: effektiv = Umsatz netto; Saldosteuersatz = Entgelt inkl. MWST − Saldosteuer */
  ertrag: number;
  /** Spesen und Büroausgaben, wie sie ins Ergebnis eingehen (effektiv netto, Saldosteuersatz brutto) */
  expImErgebnis: number;
  intImErgebnis: number;
  ergebnis: number;
}

type SummaryData = Pick<AppData, "invoices" | "expenses" | "internalExpenses" | "lohnEntries"> & {
  settings?: Partial<Pick<AppData["settings"], "mwstMethode" | "mwstSaldoSatz" | "mwstAbrechnungsart">>;
};

/** Zahlungsdatum einer bezahlten Rechnung für die MWST nach vereinnahmten Entgelten (ältere ohne Datum: Rechnungsdatum). */
export const zahlungsDatum = (i: Pick<Invoice, "paidDate" | "date">): string => i.paidDate || i.date || "";

/**
 * Datum, an dem die Umsatzsteuer einer Rechnung entsteht («» = noch nicht bzw. nie). Klare Regeln (28.11.2026):
 * - Entwurf: nie.
 * - Gutschrift (Total < 0): Rechnungsdatum — bei «vereinnahmt» auch, denn eine Gutschrift wird verrechnet statt bezahlt
 *   (vorher zählte sie erst, wenn jemand sie auf «bezahlt» setzte); ein erfasstes Zahlungsdatum (Rückzahlung) gilt.
 * - «vereinnahmt»: erst mit der Zahlung (Status «bezahlt», Zahlungsdatum).
 * - Akonto als reine Vorauszahlung (`vorauszahlung`): auch bei «vereinbart» erst mit der Zahlung (Art. 40 Abs. 1 lit. c).
 * - sonst (vereinbart): Rechnungsdatum.
 */
export function steuerDatum(i: Pick<Invoice, "status" | "date" | "paidDate" | "total" | "invoiceKind" | "vorauszahlung">, art: "vereinbart" | "vereinnahmt"): string {
  if (i.status === "entwurf") return "";
  if ((i.total || 0) < 0) return (art === "vereinnahmt" && i.paidDate) || i.date || "";
  const beiZahlung = art === "vereinnahmt" || (i.invoiceKind === "akonto" && !!i.vorauszahlung);
  if (!beiZahlung) return i.date || "";
  return i.status === "bezahlt" ? zahlungsDatum(i) : "";
}

/**
 * Rechnungen, auf denen die Umsatzsteuer der Periode beruht (`steuerDatum` in der Periode), sortiert nach diesem Datum.
 * Ohne vereinnahmte Entgelte und ohne Vorauszahlungs-Akonti ist das genau `issued`. Ansicht, PDF und CSV listen diese
 * Rechnungen, damit die Umsatzsteuer auf sichtbaren Zeilen beruht.
 */
function mwstBasisRechnungen(data: SummaryData, period: string, issued: Invoice[]): Invoice[] {
  const art = data.settings?.mwstAbrechnungsart === "vereinnahmt" ? "vereinnahmt" : "vereinbart";
  const all = data.invoices || [];
  if (art === "vereinbart" && !all.some(i => i.invoiceKind === "akonto" && i.vorauszahlung)) return issued;
  return all.map(i => ({ i, d: steuerDatum(i, art) })).filter(x => x.d && inPeriod(x.d, period))
    .sort((a, b) => a.d.localeCompare(b.d)).map(x => x.i);
}

/**
 * Zahlungsdatum einer Spese für die Vorsteuer nach vereinnahmten Entgelten («» = noch nicht bezahlt): über eine
 * Lohnabrechnung = letzter Tag des Lohnmonats; «ausbezahlt» ohne Lohn (bar, direkt) = Belegdatum; genehmigt, aber noch
 * nicht ausbezahlt = noch keine Vorsteuer (Art. 40 Abs. 2 MWSTG: Vorsteuer bei «vereinnahmt» im Zeitpunkt der Zahlung).
 */
export function spesenZahlungsDatum(e: Pick<Expense, "date" | "status" | "lohnEntryId">, lohnEntries: Pick<LohnEntry, "id" | "monat">[]): string {
  if (e.lohnEntryId) {
    const l = lohnEntries.find(x => x.id === e.lohnEntryId);
    if (!l || !/^\d{4}-\d{2}$/.test(l.monat)) return e.date || "";
    const [y, m] = l.monat.split("-").map(Number);
    return `${l.monat}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  }
  return e.status === "ausbezahlt" ? e.date || "" : "";
}

/** Muss die MWST-Basis eigens gelistet werden (weicht von den gestellten Rechnungen der Periode ab)? */
export function mwstBasisAbweichend(s: Pick<AccountingSummary, "mwstArt">, issued: Invoice[], taxInvoices: Invoice[]): boolean {
  if (s.mwstArt === "vereinnahmt") return true;
  return issued.length !== taxInvoices.length || issued.some((i, k) => taxInvoices[k] !== i);
}

/** MWST-Satz einer Spese/Ausgabe als Text: «8.1» bzw. bei Aufteilung «3.8/8.1»; ohne MWST 0. */
export function mwstSatzText(e: Pick<Expense, "inclMwst" | "mwstRate" | "mwstAufteilung" | "amount">): string | number {
  if (!e.inclMwst) return 0;
  const t = Array.isArray(e.mwstAufteilung) && e.mwstAufteilung.length && Math.abs(e.mwstAufteilung.reduce((a, x) => a + (Number(x.betrag) || 0), 0) - (e.amount || 0)) < 0.005
    ? e.mwstAufteilung : null;
  return t ? [...new Set(t.map(x => Number(x.satz)))].join("/") : (e.mwstRate || 0);
}

/** Heute als `YYYY-MM-DD` (lokal). */
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Gefilterte Datensätze einer Periode (gleiche Filter für Ansicht, PDF und CSV). */
export function accountingRows(data: SummaryData, period: string, today = todayISO()): {
  invoices: Invoice[]; issued: Invoice[]; taxInvoices: Invoice[]; expenses: Expense[]; expensesPending: Expense[]; internalExpenses: InternalExpense[]; lohnEntries: LohnEntry[];
} {
  const byDate = <T extends { date?: string }>(a: T, b: T) => (a.date || "").localeCompare(b.date || "");
  const invoices = (data.invoices || []).filter(i => inPeriod(i.date, period)).sort(byDate);
  const expensesInPeriod = (data.expenses || []).filter(e => inPeriod(e.date, period)).sort(byDate);
  const issued = invoices.filter(i => i.status !== "entwurf");
  return {
    invoices,
    issued,
    taxInvoices: mwstBasisRechnungen(data, period, issued),
    expenses: expensesInPeriod.filter(spesenZaehlen),
    expensesPending: expensesInPeriod.filter(e => !spesenZaehlen(e) && e.status !== "abgelehnt"),
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
  const { invoices, issued, taxInvoices, expenses, expensesPending, internalExpenses, lohnEntries } = rows;

  const revenueNet = roundCHF(sum(issued, invoiceNet));
  const revenueGross = roundCHF(sum(issued, i => i.total || 0));
  const taxTotal = roundCHF(sum(issued, i => i.tax || 0));
  const akontoTax = roundCHF(sum(issued.filter(i => i.invoiceKind === "akonto"), i => i.tax || 0));
  // MWST-Basis: vereinbart = gestellte Rechnungen nach Rechnungsdatum; vereinnahmt = bezahlte nach Zahlungsdatum
  const mwstMethode = data.settings?.mwstMethode === "saldo" ? "saldo" : "effektiv";
  const mwstArt = data.settings?.mwstAbrechnungsart === "vereinnahmt" ? "vereinnahmt" : "vereinbart";
  // Saldosteuersatz nur auf steuerbare Entgelte (Rechnungen ohne MWST, z.B. ins Ausland, zählen nicht)
  const mwstEntgeltBrutto = roundCHF(sum(taxInvoices.filter(i => i.mwst !== false), i => i.total || 0));
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

  // Saldosteuersatz: kein Vorsteuerabzug (Art. 37 Abs. 1 MWSTG). «vereinnahmt»: Spesen-Vorsteuer im Zeitpunkt der
  // Zahlung (spesenZahlungsDatum), Büroausgaben gelten mit dem Belegdatum als bezahlt; Aufwand bleibt beim Belegdatum.
  const expTaxVorsteuer = mwstArt === "vereinnahmt"
    ? roundCHF(sum((data.expenses || []).filter(e => spesenZaehlen(e) && inPeriod(spesenZahlungsDatum(e, data.lohnEntries || []), period)), expenseTax))
    : expTax;
  const vorsteuer = mwstMethode === "saldo" ? 0 : roundCHF(expTaxVorsteuer + intTax);
  // Spesen ohne Beleg: zählen (der Beleg kann auf Papier vorliegen), aber Hinweis — ohne Beleg ist die Vorsteuer nicht belegt
  const ohneBeleg = expenses.filter(e => !e.receiptData);
  // Ergebnis: effektiv netto/netto; mit Saldosteuersatz ist die Vorsteuer Aufwand (Ausgaben brutto) und der Ertrag
  // = Entgelt inkl. MWST − Saldosteuer (vorher netto wie effektiv: Ergebnis um Vorsteuer und Satzdifferenz falsch)
  const saldo = mwstMethode === "saldo";
  const ausgabenTotal = roundCHF((saldo ? expGross + intGross : expNet + intNet) + personalaufwand);
  const ertrag = saldo
    ? roundCHF(revenueGross - roundCHF(sum(issued.filter(i => i.mwst !== false), i => i.total || 0) * (data.settings?.mwstSaldoSatz || 0) / 100))
    : revenueNet;
  return {
    revenueNet, revenueGross,
    draftNet: roundCHF(sum(invoices.filter(i => i.status === "entwurf"), invoiceNet)),
    issuedCount: issued.length,
    taxTotal, akontoTax, mwstMethode, mwstArt, mwstEntgeltBrutto, umsatzsteuer,
    paidTotal: roundCHF(sum(invoices.filter(i => i.status === "bezahlt"), i => i.total || 0)),
    openTotal: roundCHF(sum(invoices.filter(i => i.status === "gesendet"), i => i.total || 0)),
    overdueTotal: roundCHF(sum(invoices.filter(i => i.status === "überfällig"), i => i.total || 0)),
    expNet, expTax, expGross, expCount: expenses.length, expViaLohnCount: expenses.filter(e => e.lohnEntryId).length,
    expPendingCount: expensesPending.length, expPendingGross: roundCHF(sum(expensesPending, e => e.amount || 0)),
    expOhneBelegCount: ohneBeleg.length, expOhneBelegTax: roundCHF(sum(ohneBeleg, expenseTax)), expTaxVorsteuer,
    intNet, intTax, intGross,
    lohnBrutto, lohnAG, lohnAGParts, personalaufwand, lohnCount: lohnEntries.length,
    vorsteuer,
    mwstSchuld: roundCHF(umsatzsteuer - vorsteuer),
    ausgabenTotal,
    ertrag, expImErgebnis: saldo ? expGross : expNet, intImErgebnis: saldo ? intGross : intNet,
    ergebnis: roundCHF(ertrag - ausgabenTotal),
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
  const { issued, taxInvoices, expenses, internalExpenses, lohnEntries } = accountingRows(data, period);
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
  rows.push(line(["", "", "", "TOTAL", f(s.revenueNet), "", f(s.taxTotal), f(s.revenueGross)]));
  rows.push("");

  // Vereinnahmte Entgelte: die Umsatzsteuer beruht auf den in der Periode bezahlten Rechnungen (auch früher gestellten) —
  // sie werden hier gelistet, sonst liess sich die Umsatzsteuer der Zusammenfassung aus keiner Zeile nachvollziehen
  // Ebenso bei «vereinbart», sobald ein Akonto als Vorauszahlung erst mit der Zahlung versteuert wird
  if (mwstBasisAbweichend(s, issued, taxInvoices)) {
    rows.push(line([s.mwstArt === "vereinnahmt" ? "ZAHLUNGSEINGÄNGE (MWST-BASIS, VEREINNAHMTE ENTGELTE)" : "MWST-BASIS (VORAUSZAHLUNGEN MIT DER ZAHLUNG)", "", "", "", "", "", "", "", ""]));
    rows.push(line(["Steuerdatum", "Rechnungs-Nr.", "Kunde", "Rechnungsdatum", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF", "Steuerbar"]));
    taxInvoices.forEach(inv => {
      const client = (data.persons || []).find(c => c.id === inv.clientId);
      const taxRate = inv.mwst ? (inv.mwstRate ?? mwstRate) : 0;
      rows.push(line([steuerDatum(inv, s.mwstArt), inv.number, client?.name || "", inv.date, f(invoiceNet(inv)), taxRate, f(inv.tax || 0), f(inv.total || 0), inv.mwst !== false ? "ja" : "nein"]));
    });
    const taxSum = taxInvoices.reduce((a, i) => a + (i.tax || 0), 0);
    rows.push(line(["", "", "", "TOTAL", f(taxInvoices.reduce((a, i) => a + invoiceNet(i), 0)), "", f(taxSum), f(taxInvoices.reduce((a, i) => a + (i.total || 0), 0)), ""]));
    rows.push("");
  }

  rows.push(line(["SPESEN (MITARBEITERBEZOGEN)", "", "", "", "", "", "", "", ""]));
  rows.push(line(["Datum", "Kategorie", "Projekt", "Beschreibung", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF", "Ausbezahlt über Lohn", "Beleg"]));
  expenses.forEach(exp => {
    const proj = (data.projects || []).find(p => p.id === exp.projectId);
    const lohn = exp.lohnEntryId ? (data.lohnEntries || []).find(l => l.id === exp.lohnEntryId) : undefined;
    rows.push(line([exp.date, exp.category, proj?.name || "", exp.description, f(expenseNet(exp)), mwstSatzText(exp), f(expenseTax(exp)), f(exp.amount || 0), lohn ? lohn.monat : exp.lohnEntryId ? "ja" : "", exp.receiptData ? "ja" : "fehlt"]));
  });
  rows.push(line(["", "", "", "TOTAL", f(s.expNet), "", f(s.expTax), f(s.expGross), ""]));
  if (s.expOhneBelegCount > 0) rows.push(line(["", "", "", `Ohne Beleg (${s.expOhneBelegCount}), Vorsteuer darauf`, "", "", f(s.expOhneBelegTax), "", "", ""]));
  if (s.mwstArt === "vereinnahmt" && s.mwstMethode !== "saldo" && s.expTaxVorsteuer !== s.expTax) rows.push(line(["", "", "", "Vorsteuer nach Zahlung (vereinnahmt), in der MWST-Abrechnung", "", "", f(s.expTaxVorsteuer), "", "", ""]));
  if (s.expPendingCount > 0) rows.push(line(["", "", "", `Noch nicht genehmigt (${s.expPendingCount}), nicht im Total`, "", "", "", f(s.expPendingGross), ""]));
  rows.push("");

  rows.push(line(["INTERNE AUSGABEN", "", "", "", "", "", "", ""]));
  rows.push(line(["Datum", "Kategorie", "Beschreibung", "Wiederkehrend", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"]));
  internalExpenses.forEach(exp => {
    rows.push(line([exp.date, exp.category, exp.description, exp.recurring ? (exp.recurringInterval || "monatlich") : "", f(expenseNet(exp)), mwstSatzText(exp), f(expenseTax(exp)), f(exp.amount || 0)]));
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
  // Saldosteuersatz: Ertrag = Entgelt inkl. MWST − Saldosteuer, Ausgaben brutto (Zeilen gehen aufs Ergebnis auf)
  const sal = s.mwstMethode === "saldo";
  rows.push(line(["", "", "", sal ? "Ertrag (Entgelt inkl. MWST − Saldosteuer)" : "Einnahmen (Netto)", f(s.ertrag), "", "", ""]));
  rows.push(line(["", "", "", `Spesen (${sal ? "Brutto" : "Netto"}, inkl. über Lohn ausbezahlte)`, f(s.expImErgebnis), "", "", ""]));
  rows.push(line(["", "", "", `Interne Ausgaben (${sal ? "Brutto" : "Netto"})`, f(s.intImErgebnis), "", "", ""]));
  rows.push(line(["", "", "", "Personalaufwand (Bruttolohn + AG-Beiträge)", f(s.personalaufwand), "", "", ""]));
  rows.push(line(["", "", "", "Ergebnis vor MWST", f(s.ergebnis), "", "", ""]));
  const methode = s.mwstMethode === "saldo" ? `Saldosteuersatz ${data.settings?.mwstSaldoSatz ?? 0} %` : "effektive Methode";
  rows.push(line(["", "", "", `MWST (${methode}, ${s.mwstArt === "vereinnahmt" ? "vereinnahmte" : "vereinbarte"} Entgelte)`, "", "", "", ""]));
  if (s.mwstMethode === "saldo") rows.push(line(["", "", "", "Steuerbares Entgelt inkl. MWST", "", "", f(s.mwstEntgeltBrutto), ""]));
  rows.push(line(["", "", "", "Umsatzsteuer", "", "", f(s.umsatzsteuer), ""]));
  // «davon Akonto» bezieht sich auf die gestellten Rechnungen — bei vereinnahmten Entgelten passt es nicht zur
  // Umsatzsteuer darüber (konnte grösser sein als sie), deshalb wie in der Ansicht nur bei «vereinbart»
  if (s.akontoTax > 0 && s.mwstMethode !== "saldo" && s.mwstArt === "vereinbart") rows.push(line(["", "", "", "davon auf Akontorechnungen", "", "", f(s.akontoTax), ""]));
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
