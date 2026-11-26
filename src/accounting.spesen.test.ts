// Tests: Spesen in der Buchhaltung — nur genehmigte/ausbezahlte zählen, offene erscheinen separat, abgelehnte nie.
import { describe, expect, it } from "vitest";
import { accountingRows, accountingSummary, buildBuchhaltungCSV, spesenZaehlen } from "./accounting";
import type { AppData, Expense } from "./types";

const ex = (id: string, status: string | undefined, amount: number, o: Partial<Expense> = {}): Expense =>
  ({ id, date: "2026-03-10", category: "Reisen", description: id, amount, mwstRate: 8.1, inclMwst: true, status, ...o }) as Expense;

const data = {
  settings: { mwstRate: 8.1 },
  invoices: [], internalExpenses: [], lohnEntries: [], projects: [], persons: [],
  expenses: [
    ex("a", "genehmigt", 108.1), ex("b", "auf nächsten Lohn", 54.05), ex("c", "ausbezahlt", 216.2),
    ex("d", "offen", 1081), ex("e", undefined, 100), ex("f", "abgelehnt", 500),
    ex("g", "offen", 50, { lohnEntryId: "l1" }),   // in einer Lohnabrechnung = ausbezahlt
  ],
} as unknown as AppData;

describe("Spesen in der Buchhaltung", () => {
  it("spesenZaehlen: offen und abgelehnt nicht, über Lohn immer", () => {
    expect(["genehmigt", "auf nächsten Lohn", "ausbezahlt"].every(s => spesenZaehlen(ex("x", s, 1)))).toBe(true);
    expect(spesenZaehlen(ex("x", "offen", 1))).toBe(false);
    expect(spesenZaehlen(ex("x", undefined, 1))).toBe(false);
    expect(spesenZaehlen(ex("x", "abgelehnt", 1))).toBe(false);
    expect(spesenZaehlen(ex("x", "offen", 1, { lohnEntryId: "l1" }))).toBe(true);
  });

  it("Aufwand und Vorsteuer: nur genehmigte/ausbezahlte; offene separat; abgelehnte nirgends", () => {
    const s = accountingSummary(data, "2026");
    expect(s.expGross).toBeCloseTo(108.1 + 54.05 + 216.2 + 50, 2);
    expect(s.expCount).toBe(4);
    expect(s.expTax).toBeCloseTo(s.expGross - s.expNet, 2);
    expect(s.vorsteuer).toBe(s.expTax);
    expect(s.expPendingCount).toBe(2);
    expect(s.expPendingGross).toBe(1181);
    expect(accountingRows(data, "2026").expenses.map(e => e.id)).toEqual(["a", "b", "c", "g"]);
    expect(accountingRows(data, "2026").expensesPending.map(e => e.id)).toEqual(["d", "e"]);
  });

  it("CSV: offene Spesen als Hinweiszeile, nicht in den Summen", () => {
    const csv = buildBuchhaltungCSV(data, "2026");
    expect(csv).toContain("Noch nicht genehmigt");
    expect(csv).not.toContain(";f;");   // abgelehnte Spese nicht aufgeführt
  });
});
