// Tests: Rechnungs-/Offert-Total auf 5 Rappen (Büro-Einstellung `rechnungRunden5`, Standard aus).
import { describe, expect, it } from "vitest";
import { quoteTotals, rundungsDifferenz } from "./utils";
import { calcTotal } from "./views/invoices/invoiceHelpers";

const item = (price: number) => [{ id: "a", desc: "x", qty: 1, price, discount: 0 }];

describe("calcTotal mit Rundung auf 5 Rappen", () => {
  it("Standard (aus): rappengenau, keine Rundung", () => {
    const t = calcTotal(item(1000.03), true, 8.1);
    expect(t.tax).toBe(81);
    expect(t.total).toBe(1081.03);
    expect(t.rundung).toBe(0);
  });
  it("an: Total nach MWST auf 5 Rappen, MWST bleibt rappengenau", () => {
    // 1000.01 + 81.00 (8.1 % = 81.00081) = 1081.01 → 1081.00
    const t = calcTotal(item(1000.01), true, 8.1, "none", 0, true);
    expect(t.tax).toBe(81);
    expect(t.total).toBe(1081);
    expect(t.rundung).toBe(-0.01);
    const u = calcTotal(item(1000.03), true, 8.1, "none", 0, true);
    expect(u.tax).toBe(81);
    expect(u.total).toBe(1081.05);   // 1081.03 → 1081.05 (aufwärts)
    expect(u.rundung).toBe(0.02);
    const v = calcTotal(item(1000.06), true, 8.1, "none", 0, true);
    expect(v.tax).toBe(81);          // 81.00486 → 81.00
    expect(v.total).toBe(1081.05);   // 1081.06 → 1081.05
    expect(v.rundung).toBe(-0.01);
  });
  it("ohne MWST, Gutschrift gespiegelt", () => {
    expect(calcTotal(item(100.02), false, 0, "none", 0, true).total).toBe(100);
    expect(calcTotal(item(-100.03), false, 0, "none", 0, true).total).toBe(-100.05);
    expect(calcTotal(item(-100.03), false, 0, "none", 0, true).rundung).toBe(-0.02);
  });
});

describe("rundungsDifferenz (aus gespeicherten Summen)", () => {
  it("Differenz Total − Netto − MWST", () => {
    expect(rundungsDifferenz(1081, 1000.01, 81)).toBe(-0.01);
    expect(rundungsDifferenz(1081.01, 1000.01, 81)).toBe(0);
  });
  it("Werte ausserhalb der möglichen Rundung (Import) zählen nicht", () => {
    expect(rundungsDifferenz(1200, 1000, 81)).toBe(0);
  });
});

describe("quoteTotals mit Rundung", () => {
  const q = { mode: "free" as const, mwst: true, mwstRate: 8.1, freeItems: [{ id: "a", desc: "", qty: 1, price: 1000.01 }] };
  it("aus: unverändert", () => {
    expect(quoteTotals(q, []).total).toBe(1081.01);
  });
  it("an: Total auf 5 Rappen, MWST unverändert", () => {
    const t = quoteTotals(q, [], undefined, true);
    expect(t.tax).toBe(81);
    expect(t.total).toBe(1081);
  });
});
