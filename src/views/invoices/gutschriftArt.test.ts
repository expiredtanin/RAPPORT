// Gutschrift-Art (Entscheid 28.11.2026): «korrektur» korrigiert eine gestellte Rechnung und zählt zum bisher
// Verrechneten (wie bisher); «minderung» = Honorarminderung verkleinert das Honorar — die Schlussrechnung zieht sie ab,
// statt sie wieder zu belasten, und der Abrechnungsblock rechnet mit dem geminderten Honorar.
import { describe, expect, it } from "vitest";
import { buildNewInvoiceForm } from "./newInvoiceForm";
import { invoiceBillingSummary, calcTotal } from "./invoiceHelpers";
import type { AppData, Invoice, Project } from "../../types";

const proj = { id: "p1", name: "Villa", clientId: "c1", billingType: "pauschal", status: "aktiv", budget: 100_000, hourlyRate: 150 } as Project;
const inv = (o: Partial<Invoice>): Invoice => ({ id: "x", number: "", clientId: "c1", projectId: "p1", date: "2026-02-01", items: [], mwst: true, mwstRate: 8.1, status: "bezahlt", sub: 0, tax: 0, total: 0, globalDisc: 0, ...o } as Invoice);
const akonto = inv({ id: "a1", number: "2026-001", invoiceKind: "akonto", sub: 50_000, total: 54_050 });
const data = (invoices: Invoice[]) => ({ projects: [proj], quotes: [], invoices, timeEntries: [], persons: [], settings: { mwstRate: 8.1 } } as unknown as AppData);
const schluss = (invoices: Invoice[]) => {
  const r = buildNewInvoiceForm({ tab: "projekt", projectId: "p1", quoteId: "", mode: "schluss", pct: 0, amt: 0 }, data(invoices), invoices, "2026-009", () => []);
  const items = r!.form!.items;
  return { items, net: calcTotal(items, false, 8.1).sub };
};

describe("Schlussrechnung mit Gutschrift", () => {
  it("Korrektur (Standard, auch ohne Angabe): korrigiertes Akonto zählt — Gesamt bleibt beim Honorar", () => {
    const g = inv({ id: "g1", number: "2026-002", date: "2026-03-01", sub: -10_000, total: -10_810 });
    // Honorar 100'000 − bisher (50'000 − 10'000) = 60'000 → Gesamt verrechnet 100'000
    expect(schluss([akonto, g]).net).toBe(60_000);
    expect(schluss([akonto, { ...g, creditKind: "korrektur" }]).net).toBe(60_000);
  });
  it("Honorarminderung: wird vom Honorar abgezogen, nicht wieder belastet", () => {
    const g = inv({ id: "g1", number: "2026-002", date: "2026-03-01", sub: -10_000, total: -10_810, creditKind: "minderung" });
    const s = schluss([akonto, g]);
    // Honorar 90'000 − bisher 40'000 = 50'000 → Gesamt verrechnet 90'000
    expect(s.net).toBe(50_000);
    expect(s.items.some(i => /Honorarminderung/.test(i.desc) && i.price === -10_000)).toBe(true);
  });
});

describe("Abrechnungsblock mit Honorarminderung", () => {
  it("Honorar total = Honorar − Minderung, Rest stimmt", () => {
    const g = inv({ id: "g1", number: "2026-002", date: "2026-03-01", sub: -10_000, total: -10_810, creditKind: "minderung" });
    const s = invoiceBillingSummary({ id: "n", number: "2026-005", date: "2026-05-01", projectId: "p1", invoiceKind: "akonto", sub: 20_000, globalDisc: 0 }, data([akonto, g]));
    // Honorar 90'000; bisher 50'000 − 10'000 = 40'000; diese 20'000 → Rest 30'000
    expect(s).toMatchObject({ fee: 90_000, prior: 40_000, thisNet: 20_000, rest: 30_000 });
  });
});
