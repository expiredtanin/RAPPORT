// Tests: Betragsänderung wiederkehrender interner Ausgaben «gültig ab» (Verlauf am Eintrag).
import { describe, expect, it } from "vitest";
import { changeRecurringAmount, earliestAmountChangeMonth, expandInternalExpenses, recurringAmountFor } from "./accounting";
import type { InternalExpense } from "./types";

const miete = (o: Partial<InternalExpense> = {}): InternalExpense =>
  ({ id: "m", date: "2026-01-15", category: "Miete", description: "Miete", amount: 1000, mwstRate: 0, inclMwst: false, recurring: true, recurringInterval: "monatlich", ...o }) as InternalExpense;

const amounts = (e: InternalExpense, today: string) => expandInternalExpenses([e], today).map(x => [x.date.slice(0, 7), x.amount]);

describe("Betragsänderung ab Monat", () => {
  it("frühere Monate behalten den alten Betrag, ab dem Monat gilt der neue", () => {
    const e = changeRecurringAmount(miete(), 1100, "2026-04");
    expect(e.amount).toBe(1100);
    expect(e.amountHistory).toEqual([{ before: "2026-04", amount: 1000 }]);
    expect(amounts(e, "2026-06-30")).toEqual([["2026-01", 1000], ["2026-02", 1000], ["2026-03", 1000], ["2026-04", 1100], ["2026-05", 1100], ["2026-06", 1100]]);
  });
  it("zweite Änderung später: Verlauf wächst, erste bleibt", () => {
    const a = changeRecurringAmount(miete(), 1100, "2026-04");
    const b = changeRecurringAmount(a, 1200, "2026-08");
    expect(b.amountHistory).toEqual([{ before: "2026-04", amount: 1000 }, { before: "2026-08", amount: 1100 }]);
    expect([recurringAmountFor(b, "2026-03"), recurringAmountFor(b, "2026-04"), recurringAmountFor(b, "2026-07"), recurringAmountFor(b, "2026-08")]).toEqual([1000, 1100, 1100, 1200]);
  });
  it("Änderung zwischen zwei früheren Stufen: Zeitleiste bleibt lückenlos", () => {
    const a = changeRecurringAmount(changeRecurringAmount(miete(), 1100, "2026-04"), 1200, "2026-08");
    const b = changeRecurringAmount(a, 1150, "2026-06");   // ab Juni 1150, damit auch ab August (alles ab Juni überschrieben)
    expect([recurringAmountFor(b, "2026-03"), recurringAmountFor(b, "2026-05"), recurringAmountFor(b, "2026-06"), recurringAmountFor(b, "2026-09")]).toEqual([1000, 1100, 1150, 1150]);
  });
  it("Änderung ab Beginn der Serie ersetzt den Betrag ohne Verlauf", () => {
    const e = changeRecurringAmount(miete(), 900, "2026-01");
    expect(e.amount).toBe(900);
    expect(e.amountHistory).toBeUndefined();
  });
  it("gleicher Betrag ändert nichts", () => {
    const e = miete();
    expect(changeRecurringAmount(e, 1000, "2026-05")).toBe(e);
  });
  it("erste Buchung vor der Änderung behält den alten Betrag", () => {
    const e = changeRecurringAmount(miete(), 1100, "2026-02");
    const list = expandInternalExpenses([e], "2026-02-28");
    expect(list[0].amount).toBe(1000);
    expect(list[0].id).toBe("m");
    expect(list[0].occurrenceOf).toBe("m");   // Bearbeiten öffnet die Serie, nicht die Kopie mit altem Betrag
    expect(list[1].amount).toBe(1100);
  });
});

describe("frühestes Änderungsdatum (abgeschlossene MWST-Perioden bleiben unberührt)", () => {
  it("effektiv: Beginn des laufenden Quartals", () => {
    expect(earliestAmountChangeMonth("2026-11-26", "effektiv")).toBe("2026-10");
    expect(earliestAmountChangeMonth("2026-03-02", "effektiv")).toBe("2026-01");
  });
  it("Saldosteuersatz: Beginn des laufenden Halbjahres", () => {
    expect(earliestAmountChangeMonth("2026-11-26", "saldo")).toBe("2026-07");
  });
});
