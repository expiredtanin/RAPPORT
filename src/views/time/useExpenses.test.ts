// Tests für die Sperre von Spesen in der Zeiterfassung (useExpenses.ts, `expenseLock`).
import { describe, expect, it } from "vitest";
import { expenseLock } from "./useExpenses";
import type { Expense } from "../../types";

const exp = (x: Partial<Expense>) => ({ id: "e1", date: "2026-11-02", amount: 10, ...x }) as Expense;

describe("expenseLock", () => {
  it("über Lohn ausbezahlt: immer gesperrt, auch für Admins", () => {
    expect(expenseLock(exp({ lohnEntryId: "l1", status: "ausbezahlt" }), false)).toMatch(/Lohnabrechnung/);
  });
  it("eigene ohne Recht: nur «offen» änderbar", () => {
    expect(expenseLock(exp({ status: "offen" }), true)).toBeNull();
    expect(expenseLock(exp({}), true)).toBeNull();
    expect(expenseLock(exp({ status: "genehmigt" }), true)).toMatch(/Buchhaltung/);
    expect(expenseLock(exp({ status: "genehmigt" }), false)).toBeNull();
  });
});
