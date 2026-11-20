// Tests: Abrechnungsblock auf Akonto-/Teilrechnungen (`invoiceBillingSummary`, `invoiceForPrint`) und
// Akonto-Plan nach SIA-Phasen (`akontoPhasePlan`, `akontoPlanRows` im Modus «phase»).
// Erwartete Werte von Hand nachgerechnet (Rechenweg jeweils im Kommentar).

import { describe, expect, it } from "vitest";
import { akontoPhasePlan, akontoPlanRows, buildAkontoInvoices, invoiceBillingSummary, invoiceForPrint } from "./invoiceHelpers";
import type { AkontoPlan } from "./invoiceHelpers";
import type { AppData, Invoice, Project, Quote } from "../../types";

const FEE = 185_550.5;

/** Pauschalprojekt ohne Offerte: Phasenbeträge = Phasenstunden × 100 → 30'000 / 50'000 / 20'000 (Summe 100'000). */
const proj: Project = {
  id: "p1", name: "Limmatfeld", clientId: "c1", billingType: "pauschal", status: "aktiv",
  budget: FEE, hourlyRate: 100,
  // absichtlich nicht in SIA-Reihenfolge: der Plan sortiert 31, 32, 33
  phasesBudget: [{ id: "33", hours: 200 }, { id: "31", hours: 300 }, { id: "32", hours: 500 }, { id: "41", hours: 0 }],
} as Project;

const inv = (o: Partial<Invoice>): Invoice => ({
  id: "x", number: "", clientId: "c1", date: "2026-01-01", items: [], mwst: true, mwstRate: 8.1,
  status: "bezahlt", sub: 0, tax: 0, total: 0, globalDisc: 0, ...o,
} as Invoice);

// 32.5 % von 185'550.50 = 60'303.9125 → 60'303.91; 34 % = 63'087.17 → bisher 123'391.08 (66.5 %)
const ak1 = inv({ id: "a1", projectId: "p1", number: "2026-003", date: "2026-03-31", invoiceKind: "akonto", sub: 60_303.91 });
const ak2 = inv({ id: "a2", projectId: "p1", number: "2026-007", date: "2026-07-31", invoiceKind: "akonto", sub: 63_087.17 });

describe("invoiceBillingSummary", () => {
  const data = { projects: [proj], quotes: [] as Quote[], invoices: [ak1, ak2] };

  it("Akonto 20 %: Honorar, bisher, diese Rechnung, Rest", () => {
    // 20 % von 185'550.50 = 37'110.10; Rest = 185'550.50 − 123'391.08 − 37'110.10 = 25'049.32 (13.5 %)
    const s = invoiceBillingSummary({ id: "new", number: "2026-012", date: "2026-11-20", projectId: "p1", invoiceKind: "akonto", sub: 37_110.1, globalDisc: 0 }, data);
    expect(s).toEqual({ fee: 185_550.5, prior: 123_391.08, priorNumbers: ["2026-003", "2026-007"], thisNet: 37_110.1, rest: 25_049.32 });
  });

  it("Gesamtrabatt zählt netto (sub − globalDisc), auch bei früheren Rechnungen", () => {
    const disc = inv({ id: "a3", projectId: "p1", number: "2026-002", date: "2026-02-01", invoiceKind: "teilrechnung", sub: 10_000, globalDisc: 500 });
    const s = invoiceBillingSummary({ id: "new", number: "2026-012", date: "2026-11-20", projectId: "p1", invoiceKind: "teilrechnung", sub: 2_000, globalDisc: 200 }, { ...data, invoices: [...data.invoices, disc] });
    // bisher 123'391.08 + 9'500 = 132'891.08; diese 1'800; Rest 185'550.50 − 132'891.08 − 1'800 = 50'859.42
    expect(s?.prior).toBe(132_891.08);
    expect(s?.thisNet).toBe(1_800);
    expect(s?.rest).toBe(50_859.42);
    expect(s?.priorNumbers).toEqual(["2026-002", "2026-003", "2026-007"]);
  });

  it("ohne Entwürfe, ohne diese Rechnung und ohne spätere Rechnungen", () => {
    const draft = inv({ id: "d", projectId: "p1", number: "2026-010", date: "2026-05-01", status: "entwurf", invoiceKind: "akonto", sub: 9_999 });
    const later = inv({ id: "l", projectId: "p1", number: "2026-020", date: "2026-12-01", invoiceKind: "akonto", sub: 5_000 });
    const self = inv({ id: "a2", projectId: "p1", number: "2026-007", date: "2026-07-31", invoiceKind: "akonto", sub: 63_087.17 });
    const s = invoiceBillingSummary(self, { ...data, invoices: [ak1, ak2, draft, later] });
    // nur ak1 liegt davor: Rest = 185'550.50 − 60'303.91 − 63'087.17 = 62'159.42
    expect(s).toMatchObject({ prior: 60_303.91, priorNumbers: ["2026-003"], thisNet: 63_087.17, rest: 62_159.42 });
  });

  it("gleiches Datum: kleinere Nummer zählt als früher (numerisch, 2026-9 vor 2026-10)", () => {
    const a = inv({ id: "a", projectId: "p1", number: "2026-9", date: "2026-08-01", invoiceKind: "akonto", sub: 1_000 });
    const s = invoiceBillingSummary({ id: "b", number: "2026-10", date: "2026-08-01", projectId: "p1", invoiceKind: "akonto", sub: 1, globalDisc: 0 }, { ...data, invoices: [a] });
    expect(s?.prior).toBe(1_000);
  });

  it("aus einer Offerte: Honorar = Netto der Offerte, nur Rechnungen dieser Offerte", () => {
    const q = { id: "q1", number: "O2026-004", projectId: "p1", sub: 80_000 } as Quote;
    const pq = { ...proj, linkedQuotes: [{ quoteId: "q1", role: "Hauptofferte" }, { quoteId: "q2", role: "Nachtrag" }] } as Project;
    const onQuote = inv({ id: "o1", number: "2026-004", date: "2026-04-01", quoteId: "q1", invoiceKind: "akonto", sub: 20_000 });
    const onNachtrag = inv({ id: "o2", number: "2026-005", date: "2026-04-02", quoteId: "q2", invoiceKind: "akonto", sub: 7_000 });
    const s = invoiceBillingSummary({ id: "n", number: "2026-030", date: "2026-11-20", projectId: "p1", quoteId: "q1", invoiceKind: "teilrechnung", sub: 30_000, globalDisc: 0 },
      { projects: [pq], quotes: [q], invoices: [onQuote, onNachtrag] });
    // Rest = 80'000 − 20'000 − 30'000 = 30'000
    expect(s).toEqual({ fee: 80_000, quoteNumber: "O2026-004", prior: 20_000, priorNumbers: ["2026-004"], thisNet: 30_000, rest: 30_000 });
  });

  it("nichts bei Schluss-/freien Rechnungen, ohne Projekt oder ohne Honorar", () => {
    const base = { id: "n", number: "1", date: "2026-11-20", sub: 100, globalDisc: 0 };
    expect(invoiceBillingSummary({ ...base, projectId: "p1", invoiceKind: "schluss" }, data)).toBeNull();
    expect(invoiceBillingSummary({ ...base, projectId: "p1", invoiceKind: "" }, data)).toBeNull();
    expect(invoiceBillingSummary({ ...base, invoiceKind: "akonto" }, data)).toBeNull();
    const noFee = { ...proj, budget: 0, budgetAmount: 0 } as Project;
    expect(invoiceBillingSummary({ ...base, projectId: "p1", invoiceKind: "akonto" }, { ...data, projects: [noFee] })).toBeNull();
  });
});

describe("invoiceForPrint", () => {
  const data = { projects: [proj], quotes: [] as Quote[], invoices: [ak1, ak2] };
  const frozen = { fee: 1, prior: 0, priorNumbers: [], thisNet: 1, rest: 0 };

  it("gestellte Rechnung: festgehaltener Block bleibt, auch wenn später andere dazukommen", () => {
    const sent = inv({ id: "s", number: "2026-012", date: "2026-11-20", projectId: "p1", status: "gesendet", invoiceKind: "akonto", sub: 37_110.1, billingSummary: frozen });
    expect(invoiceForPrint(sent, data).billingSummary).toBe(frozen);
  });

  it("Entwurf: immer aktuell berechnet", () => {
    const draft = inv({ id: "s", number: "2026-012", date: "2026-11-20", projectId: "p1", status: "entwurf", invoiceKind: "akonto", sub: 37_110.1, billingSummary: frozen });
    expect(invoiceForPrint(draft, data).billingSummary?.rest).toBe(25_049.32);
  });

  it("ältere gestellte Rechnung ohne Block: berechnet aus den früheren Rechnungen", () => {
    expect(invoiceForPrint({ ...ak2, projectId: "p1" }, data).billingSummary).toMatchObject({ prior: 60_303.91, rest: 62_159.42 });
  });
});

describe("akontoPhasePlan", () => {
  const ap = { startDate: "2027-01-31", intervalMonths: 1 };

  it("Anteile je Phase auf das Honorar umgelegt, Rappenausgleich in der letzten Phase", () => {
    const { fee, billed, rows } = akontoPhasePlan(proj, [], undefined, [], ap);
    // 185'550.50 × 0.3 = 55'665.15; × 0.5 = 92'775.25; Rest 185'550.50 − 148'440.40 = 37'110.10
    expect(fee).toBe(185_550.5);
    expect(billed).toBe(0);
    expect(rows.map(r => [r.id, r.share, r.amt])).toEqual([["31", 55_665.15, 55_665.15], ["32", 92_775.25, 92_775.25], ["33", 37_110.1, 37_110.1]]);
    // Daten: 31.1., dann Monatsende geklemmt 28.2., 31.3.
    expect(rows.map(r => r.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(rows.map(r => r.label)).toEqual(["31 Vorprojekt", "32 Bauprojekt", "33 Bewilligungsverfahren"]);
  });

  it("bisher Gestelltes wird den Phasen der Reihe nach angerechnet (nichts doppelt)", () => {
    const draft = inv({ id: "d", projectId: "p1", status: "entwurf", sub: 50_000 });
    const { billed, rows } = akontoPhasePlan(proj, [], undefined, [{ ...ak1, projectId: "p1" }, { ...ak2, projectId: "p1" }, draft], ap);
    // bisher 123'391.08: Phase 31 ganz (55'665.15), Phase 32 mit 67'725.93 → offen 92'775.25 − 67'725.93 = 25'049.32
    expect(billed).toBe(123_391.08);
    expect(rows.map(r => [r.id, r.credited, r.amt, r.included])).toEqual([
      ["31", 55_665.15, 0, false], ["32", 67_725.93, 25_049.32, true], ["33", 0, 37_110.1, true],
    ]);
    // Summe der offenen Raten = Honorar − bisher = 185'550.50 − 123'391.08 = 62'159.42
    expect(rows.reduce((s, r) => s + r.amt, 0)).toBeCloseTo(62_159.42, 2);
    // erste offene Phase bekommt das Startdatum
    expect(rows[1].date).toBe("2027-01-31");
    expect(rows[2].date).toBe("2027-02-28");
  });

  it("Datum von Hand und abgewählte Phasen", () => {
    const { rows } = akontoPhasePlan(proj, [], undefined, [], { ...ap, phaseDates: { "32": "2027-06-15" }, phaseSkip: ["33"] });
    expect(rows.find(r => r.id === "32")?.date).toBe("2027-06-15");
    expect(rows.find(r => r.id === "33")?.included).toBe(false);
  });

  it("ohne Honorar: die Phasenbeträge selbst", () => {
    const { fee, rows } = akontoPhasePlan({ ...proj, budget: 0 } as Project, [], undefined, [], ap);
    expect(fee).toBe(100_000);
    expect(rows.map(r => r.amt)).toEqual([30_000, 50_000, 20_000]);
  });

  it("ohne Phasenbudget: keine Raten", () => {
    expect(akontoPhasePlan({ ...proj, phasesBudget: [] } as Project, [], undefined, [], ap).rows).toEqual([]);
  });

  it("akontoPlanRows (Modus phase) → Entwürfe mit Phasentext", () => {
    const data = { projects: [proj], quotes: [], invoices: [], settings: { mwstRate: 8.1, invoiceNumberFormat: "YYYY-NNN" } } as unknown as AppData;
    const plan: AkontoPlan = { projectId: "p1", clientId: "c1", totalAmt: 0, mode: "phase", intervalMonths: 2, count: 1, startDate: "2027-01-15", manualRows: [], phaseSkip: ["31"] };
    const rows = akontoPlanRows(plan, data);
    expect(rows.map(r => [r.date, r.amt])).toEqual([["2027-03-15", 92_775.25], ["2027-05-15", 37_110.1]]);
    const created = buildAkontoInvoices(rows, plan, data, []);
    expect(created.map(i => i.items[0].desc)).toEqual(["Akontorechnung 32 Bauprojekt – Limmatfeld", "Akontorechnung 33 Bewilligungsverfahren – Limmatfeld"]);
    expect(created.map(i => i.number)).toEqual(["2027-001", "2027-002"]);
  });
});
