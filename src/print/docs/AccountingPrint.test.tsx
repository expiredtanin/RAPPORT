// Test der Druckvorlage Buchhaltung: bei vereinnahmten Entgelten die Zahlungseingänge als MWST-Basis, Brutto = Σ Totale.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuchhaltungPrint } from "./AccountingPrint";
import type { AppData, Settings } from "../../types";

const data = (settings: Record<string, unknown>) => ({
  settings, persons: [{ id: "k", name: "Bauherr AG" }], projects: [], expenses: [], internalExpenses: [], lohnEntries: [],
  invoices: [
    { id: "a", number: "2026-012", clientId: "k", date: "2026-12-31", paidDate: "2027-01-04", status: "bezahlt", sub: 10000, tax: 810, total: 10810, mwst: true, mwstRate: 8.1, items: [] },
    { id: "b", number: "2027-001", clientId: "k", date: "2027-02-01", status: "gesendet", sub: 100.02, tax: 8.1, total: 108.1, mwst: true, mwstRate: 8.1, items: [] },
  ],
}) as unknown as AppData;
const html = (settings: Record<string, unknown>) =>
  renderToStaticMarkup(<BuchhaltungPrint data={data(settings)} filterYear="2027-Q1" settings={{ name: "Atelier", ...settings } as unknown as Settings} />);

describe("BuchhaltungPrint", () => {
  it("vereinnahmt: Zahlungseingänge mit der im Dezember gestellten Rechnung", () => {
    const out = html({ mwstAbrechnungsart: "vereinnahmt" });
    expect(out).toContain("ZAHLUNGSEINGÄNGE · MWST-BASIS (1)");
    expect(out).toContain("2026-012");
  });
  it("vereinbart: kein Abschnitt Zahlungseingänge; Brutto = Total der Rechnung (5-Rappen-Rundung)", () => {
    const out = html({});
    expect(out).not.toContain("ZAHLUNGSEINGÄNGE");
    expect(out).toContain("108.10");
    expect(out).not.toContain("108.12");
  });
});
