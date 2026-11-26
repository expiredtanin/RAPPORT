import { describe, expect, it } from "vitest";
import { budgetEinnahmen, budgetFixkosten, jahresLohnkosten, mergeBudgetRows } from "./budget";
import { lohnAGSaetze } from "./utils";
import type { AppData, Employee, InternalExpense, Invoice, Quote } from "./types";

const ag = lohnAGSaetze(undefined);
const emp = (o: Partial<Employee>): Employee => ({ id: "e", name: "E", role: "", pensum: 100, wochenstunden: 42, ferienWochen: 5, monatslohn: 7500, eintrittsdatum: "2020-01-01", ...o }) as Employee;

describe("Budget: Lohnkosten wie die Lohnläufe", () => {
  it("Austritt am 15. November: 10.5 Monatslöhne, 11 Monate", () => {
    const r = jahresLohnkosten(emp({ austrittsdatum: "2026-11-15" }), 2026, ag);
    expect(r.monate).toBe(11);
    expect(r.brutto).toBe(7500 * 10 + 3750);
  });
  it("Rentner: AG-Beiträge viel tiefer als 20 % (Freibetrag, keine ALV/BVG)", () => {
    const r = jahresLohnkosten(emp({ geburtsdatum: "1958-01-01", monatslohn: 3600 }), 2026, ag);
    expect(r.ag / r.brutto).toBeLessThan(0.06);
  });
});

describe("Budget: Fixkosten", () => {
  const x = (o: Partial<InternalExpense>): InternalExpense => ({ id: "x", date: "2025-03-01", category: "Miete", description: "Miete", amount: 1000, mwstRate: 0, inclMwst: true, recurring: true, recurringInterval: "monatlich", ...o }) as InternalExpense;
  it("monatlich × 12, beendet im Jahr nur bis zum Ende, im Vorjahr beendet gar nicht", () => {
    expect(budgetFixkosten([x({})], 2026)[0].amount).toBe(12000);
    expect(budgetFixkosten([x({ recurringUntil: "2026-06-01" })], 2026)[0].amount).toBe(6000);
    expect(budgetFixkosten([x({ recurringUntil: "2025-12-01" })], 2026)).toEqual([]);
    expect(budgetFixkosten([x({ recurring: false, date: "2025-05-01" })], 2026)).toEqual([]);
  });
});

describe("Budget: Einnahmen ohne Doppelzählung", () => {
  const data = {
    projects: [],
    quotes: [{ id: "q", projectId: "", date: "2026-02-01", status: "angenommen", sub: 50000 } as Quote],
    invoices: [
      { id: "i1", quoteId: "q", date: "2026-03-01", status: "bezahlt", sub: 20000, globalDisc: 0 } as Invoice,
      { id: "i2", quoteId: "q", date: "2026-04-01", status: "entwurf", sub: 5000, globalDisc: 0 } as Invoice,
    ],
  } as unknown as AppData;
  it("Offerte zählt nur den noch nicht verrechneten Rest; Entwürfe standardmässig nicht", () => {
    const e = budgetEinnahmen(data, 2026, { rechnungen: true, rechnungsEntwuerfe: false, offerten: true, offertEntwuerfe: false });
    expect(e.quotesAccepted).toBe(30000);
    expect(e.total).toBe(50000); // vorher 70'000 (Rechnung + ganze Offerte)
  });
});

describe("Budget: Version laden", () => {
  it("Zeilen neuer Personen/Ausgaben bleiben, bekannte übernehmen die Werte der Version", () => {
    const now = [{ id: "a", aktiv: true }, { id: "neu", aktiv: true }];
    const alt = [{ id: "a", aktiv: false }, { id: "geloescht", aktiv: true }];
    expect(mergeBudgetRows(now, alt)).toEqual([{ id: "a", aktiv: false }, { id: "neu", aktiv: true }]);
    expect(mergeBudgetRows(now, undefined)).toEqual(now);
  });
});
