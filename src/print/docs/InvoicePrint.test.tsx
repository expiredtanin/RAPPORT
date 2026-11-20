// Test der Druckvorlage Rechnung: die gedruckten Summen müssen zu den gespeicherten Werten passen.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoicePrint } from "./InvoicePrint";
import { calcTotal } from "../../views/invoices/invoiceHelpers";
import type { Invoice, Settings } from "../../types";

const settings = { name: "Atelier", mwstRate: 8.1, iban: "CH93 0076 2011 6238 5295 7", mwst: "CHE-123.456.789 MWST" } as unknown as Settings;

/** Rechnung mit 10 % Gesamtrabatt auf 10'000: Netto nach Rabatt 9'000, MWST 729, Total 9'729. */
function discounted(): Invoice {
  const items = [{ id: "1", desc: "Honorar Vorprojekt", qty: 1, price: 10_000, discount: 0 }];
  const t = calcTotal(items, true, 8.1, "percent", 10);
  return { id: "i1", number: "2026-005", clientId: "c1", date: "2026-11-19", items, mwst: true, mwstRate: 8.1, status: "entwurf",
    discountType: "percent", discountValue: 10, discountLabel: "Rabatt", ...t } as Invoice;
}

/** Text der Summenzeile mit Beschriftung `label` (erstes Vorkommen). */
const row = (html: string, label: string) => {
  const m = html.match(new RegExp(`<span[^>]*>${label}[^<]*</span><span>([^<]*)</span>`));
  return m ? m[1].replace(/\u00a0/g, " ") : null;
};

describe("InvoicePrint Summenblock", () => {
  it("Total und MWST stimmen mit den gespeicherten Werten überein", () => {
    const html = renderToStaticMarkup(<InvoicePrint inv={discounted()} client={undefined} settings={settings} />);
    expect(row(html, "MWST")).toMatch(/729\.00/);
    expect(html).toMatch(/9’729\.00|9'729\.00/);
  });

  // «Netto» ist der Betrag nach Gesamtrabatt (früher inv.sub = Zwischentotal vor Rabatt, Netto + MWST ≠ Total).
  it("Netto nach Gesamtrabatt = 9'000 (Zwischentotal 10'000, Rabatt −1'000)", () => {
    const html = renderToStaticMarkup(<InvoicePrint inv={discounted()} client={undefined} settings={settings} />);
    expect(row(html, "Netto")).toMatch(/9.000\.00/);
  });
});
