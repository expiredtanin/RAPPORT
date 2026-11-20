// Tests der Rechnungs-Hilfen in utils.ts: kaufmännische Rappenrundung, Positionsbetrag, Vertrags-MWST, Mahnbrief.
// Erwartete Werte unabhängig mit Python (decimal, ROUND_HALF_UP) nachgerechnet.

import { describe, expect, it, vi, afterEach } from "vitest";
import { buildReminderLetter, contractAmounts, lineAmount, roundCHF } from "./utils";
import type { Invoice, Person } from "./types";

describe("roundCHF kaufmännisch", () => {
  it("x.xx5 wird aufgerundet, auch bei Gleitkomma-Darstellung knapp darunter", () => {
    expect(roundCHF(1.005)).toBe(1.01);
    expect(roundCHF(105 * 0.077)).toBe(8.09);
    expect(roundCHF(2.675)).toBe(2.68);
  });
  it("negative Beträge spiegelbildlich, kein −0", () => {
    expect(roundCHF(-1.005)).toBe(-1.01);
    expect(roundCHF(-0.405)).toBe(-0.41);
    expect(Object.is(roundCHF(-0.001), 0)).toBe(true);
  });
});

describe("lineAmount", () => {
  it("Menge × Preis abzüglich Positionsrabatt, auf Rappen", () => {
    expect(lineAmount(2.5, 142.25)).toBe(355.63);
    expect(lineAmount(1, 1234.55, 7)).toBe(1148.13); // 1148.1315
    expect(lineAmount(undefined, 10)).toBe(0);
  });
});

describe("contractAmounts", () => {
  it("MWST auf Rappen gerundet (15 × 8.1 % = 1.215 → 1.22)", () => {
    expect(contractAmounts({ amount: 15 }, [], 8.1)).toEqual({ net: 15, rate: 8.1, tax: 1.22, gross: 16.22 });
  });
});

describe("buildReminderLetter", () => {
  afterEach(() => { vi.useRealTimers(); });
  const client = { id: "c1", name: "Bauherrschaft Muster", contacts: [] } as unknown as Person;
  const settings = { iban: "CH4431999123000889012", name: "Atelier" };
  const inv = {
    id: "i1", number: "2026-014", clientId: "c1", date: "2026-09-01", dueDate: "2026-10-01", total: 1081,
    reminders: [{ nr: 1, date: "2026-10-15", sentDate: "2026-10-15" }, { nr: 2, date: "2026-10-30", sentDate: "2026-10-30" }, { nr: 3, date: "2026-11-10", sentDate: "2026-11-10" }],
  } as unknown as Invoice;

  it("Verzugstage am Versanddatum (Nachdruck = gleicher Text), QR-Referenz statt Rechnungsnummer", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T10:00:00"));
    const { body } = buildReminderLetter(inv, 1, "2026-10-15", [client], settings);
    expect(body).toContain("seit 14 Tagen");
    expect(body).toContain("Referenz: 00 00000 00000 00000 00202 60147");
    expect(body).toContain("IBAN: CH44 3199 9123 0008 8901 2");
  });

  it("Nachdruck der 3. Mahnung nennt nur die zwei früheren Schreiben", () => {
    const { body } = buildReminderLetter(inv, 3, "2026-11-10", [client], settings);
    expect(body).toContain("vom 15.10.2026 und 30.10.2026 ist");
  });
});
