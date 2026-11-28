// Buchhaltungsregeln (Entscheid 28.11.2026): Gutschrift bei «vereinnahmt», Akonto als Vorauszahlung, Vorsteuer auf
// Spesen nach Zahlung, Spesen ohne Beleg, Beleg mit mehreren MWST-Sätzen.
import { describe, expect, it } from "vitest";
import { accountingRows, accountingSummary, expenseTax, steuerDatum, spesenZahlungsDatum } from "./accounting";
import type { AppData, Expense, Invoice, LohnEntry } from "./types";

const inv = (p: Partial<Invoice>): Invoice => ({
  id: "i", number: "R", clientId: "c", date: "2026-03-10", items: [], mwst: true, mwstRate: 8.1, status: "gesendet",
  sub: 1000, tax: 81, total: 1081, ...p,
} as Invoice);
const data = (p: Partial<AppData>, settings: Record<string, unknown> = {}) =>
  ({ invoices: [], expenses: [], internalExpenses: [], lohnEntries: [], settings, ...p } as unknown as AppData);

describe("Steuerdatum einer Rechnung", () => {
  it("vereinbart: Rechnungsdatum; Entwurf nie", () => {
    expect(steuerDatum(inv({}), "vereinbart")).toBe("2026-03-10");
    expect(steuerDatum(inv({ status: "entwurf" }), "vereinbart")).toBe("");
  });
  it("vereinnahmt: erst mit der Zahlung", () => {
    expect(steuerDatum(inv({}), "vereinnahmt")).toBe("");
    expect(steuerDatum(inv({ status: "bezahlt", paidDate: "2026-04-02" }), "vereinnahmt")).toBe("2026-04-02");
  });
  it("Gutschrift bei vereinnahmt: mit dem Ausstellungsdatum (sie wird verrechnet, nicht «bezahlt»), ausser es gibt ein Zahlungsdatum", () => {
    const g = inv({ sub: -200, tax: -16.2, total: -216.2, date: "2026-06-30" });
    expect(steuerDatum(g, "vereinnahmt")).toBe("2026-06-30");
    expect(steuerDatum({ ...g, status: "bezahlt", paidDate: "2026-07-05" }, "vereinnahmt")).toBe("2026-07-05");
  });
  it("Akonto als Vorauszahlung: auch bei vereinbart erst mit der Zahlung", () => {
    const a = inv({ invoiceKind: "akonto", vorauszahlung: true });
    expect(steuerDatum(a, "vereinbart")).toBe("");
    expect(steuerDatum({ ...a, status: "bezahlt", paidDate: "2026-05-20" }, "vereinbart")).toBe("2026-05-20");
    // Akonto nach Leistungsstand: Rechnungsdatum
    expect(steuerDatum(inv({ invoiceKind: "akonto" }), "vereinbart")).toBe("2026-03-10");
  });
});

describe("MWST-Basis in der Abrechnung", () => {
  it("vereinbart: Vorauszahlungs-Akonto zählt im Quartal der Zahlung, nicht im Quartal der Rechnung", () => {
    const d = data({ invoices: [inv({ id: "a", invoiceKind: "akonto", vorauszahlung: true, status: "bezahlt", paidDate: "2026-04-15" })] });
    expect(accountingSummary(d, "2026-Q1").umsatzsteuer).toBe(0);
    expect(accountingSummary(d, "2026-Q2").umsatzsteuer).toBe(81);
    // Umsatz (Erfolgsrechnung) bleibt beim Rechnungsdatum
    expect(accountingSummary(d, "2026-Q1").revenueNet).toBe(1000);
    // die Liste der MWST-Basis zeigt genau die versteuerte Rechnung
    expect(accountingRows(d, "2026-Q2").taxInvoices.map(i => i.id)).toEqual(["a"]);
  });
  it("vereinnahmt: unbezahlte Gutschrift mindert die Umsatzsteuer im Quartal ihrer Ausstellung", () => {
    const d = data({ invoices: [
      inv({ id: "r", status: "bezahlt", paidDate: "2026-02-01" }),
      inv({ id: "g", sub: -200, tax: -16.2, total: -216.2, date: "2026-03-15" }),
    ] }, { mwstAbrechnungsart: "vereinnahmt" });
    expect(accountingSummary(d, "2026-Q1").umsatzsteuer).toBe(64.8);
  });
});

describe("Vorsteuer auf Spesen", () => {
  const lohn = { id: "L1", employeeId: "e", monat: "2026-04" } as LohnEntry;
  const sp = (p: Partial<Expense>): Expense => ({ id: "s", date: "2026-03-20", category: "", description: "", amount: 108.1, mwstRate: 8.1, inclMwst: true, status: "genehmigt", receiptData: "data:x", ...p } as Expense);
  it("Zahlungsdatum: über den Lohn = letzter Tag des Lohnmonats; «ausbezahlt» ohne Lohn = Belegdatum; sonst noch nicht bezahlt", () => {
    expect(spesenZahlungsDatum(sp({ lohnEntryId: "L1", status: "ausbezahlt" }), [lohn])).toBe("2026-04-30");
    expect(spesenZahlungsDatum(sp({ status: "ausbezahlt" }), [])).toBe("2026-03-20");
    expect(spesenZahlungsDatum(sp({ status: "genehmigt" }), [])).toBe("");
  });
  it("vereinnahmt: Vorsteuer im Quartal der Zahlung; vereinbart: Belegdatum (wie bisher)", () => {
    const e = sp({ lohnEntryId: "L1", status: "ausbezahlt" });
    const vn = data({ expenses: [e], lohnEntries: [lohn] }, { mwstAbrechnungsart: "vereinnahmt" });
    expect(accountingSummary(vn, "2026-Q1").vorsteuer).toBe(0);
    expect(accountingSummary(vn, "2026-Q2").vorsteuer).toBe(8.1);
    // Aufwand bleibt im Monat des Belegs
    expect(accountingSummary(vn, "2026-Q1").expNet).toBe(100);
    const vb = data({ expenses: [e], lohnEntries: [lohn] });
    expect(accountingSummary(vb, "2026-Q1").vorsteuer).toBe(8.1);
  });
  it("Spesen ohne Beleg: gezählt und mit Vorsteuer ausgewiesen (Hinweis)", () => {
    const d = data({ expenses: [sp({ receiptData: null }), sp({ id: "t" })] });
    const s = accountingSummary(d, "2026");
    expect(s.expOhneBelegCount).toBe(1);
    expect(s.expOhneBelegTax).toBe(8.1);
  });
});

describe("Beleg mit mehreren MWST-Sätzen", () => {
  it("Vorsteuer je Teilbetrag", () => {
    // Hotel 200 inkl. 3.8 % + Frühstück 30 inkl. 8.1 % = 230
    const e = { amount: 230, inclMwst: true, mwstRate: 3.8, mwstAufteilung: [{ betrag: 200, satz: 3.8 }, { betrag: 30, satz: 8.1 }] };
    expect(expenseTax(e)).toBe(9.57);   // 7.32 + 2.25
  });
  it("ohne Aufteilung wie bisher; Aufteilung, die nicht aufgeht, rechnet mit dem Hauptsatz", () => {
    expect(expenseTax({ amount: 108.1, inclMwst: true, mwstRate: 8.1 })).toBe(8.1);
    expect(expenseTax({ amount: 230, inclMwst: true, mwstRate: 8.1, mwstAufteilung: [{ betrag: 100, satz: 3.8 }] })).toBe(17.23);
  });
});

describe("Prüfung der Aufteilung beim Speichern", () => {
  it("Summe muss aufgehen, Sätze 0–30 %, Teilbeträge > 0", async () => {
    const { mwstAufteilungFehler } = await import("./accounting");
    const f = { amount: 230, mwstRate: 3.8, inclMwst: true };
    expect(mwstAufteilungFehler({ ...f, mwstAufteilung: [{ betrag: 200, satz: 3.8 }, { betrag: 30, satz: 8.1 }] })).toBeNull();
    expect(mwstAufteilungFehler({ ...f, mwstAufteilung: [{ betrag: 200, satz: 3.8 }, { betrag: 20, satz: 8.1 }] })).toMatch(/ergeben CHF 220.00/);
    expect(mwstAufteilungFehler({ ...f, mwstAufteilung: [{ betrag: 230, satz: 40 }] })).toMatch(/0 und 30/);
    expect(mwstAufteilungFehler({ ...f, mwstAufteilung: [{ betrag: 230, satz: 8.1 }, { betrag: 0, satz: 8.1 }] })).toMatch(/grösser als 0/);
    // ohne «inkl. MWST» gilt keine Aufteilung
    expect(mwstAufteilungFehler({ ...f, inclMwst: false, mwstAufteilung: [{ betrag: 1, satz: 99 }] })).toBeNull();
  });
});
