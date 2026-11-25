// Test der Druckvorlage Rechnung: die gedruckten Summen müssen zu den gespeicherten Werten passen.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoicePrint } from "./InvoicePrint";
import { calcTotal } from "../../views/invoices/invoiceHelpers";
import type { Invoice, Settings } from "../../types";

// Tausendertrenner je nach ICU-Version «’» oder «'» — React maskiert «'» als «&#x27;» (in GitHub Actions rot)
const markup = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");

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
    const html = markup(<InvoicePrint inv={discounted()} client={undefined} settings={settings} />);
    expect(row(html, "MWST")).toMatch(/729\.00/);
    expect(html).toMatch(/9’729\.00|9'729\.00/);
  });

  // «Netto» ist der Betrag nach Gesamtrabatt (früher inv.sub = Zwischentotal vor Rabatt, Netto + MWST ≠ Total).
  it("Netto nach Gesamtrabatt = 9'000 (Zwischentotal 10'000, Rabatt −1'000)", () => {
    const html = markup(<InvoicePrint inv={discounted()} client={undefined} settings={settings} />);
    expect(row(html, "Netto")).toMatch(/9.000\.00/);
  });
});

describe("InvoicePrint Abrechnungsblock", () => {
  // Limmatfeld: Honorar 185'550.50, bisher 123'391.08 (66.5 %), diese 37'110.10 (20.0 %), Rest 25'049.32 (13.5 %)
  const summary = { fee: 185_550.5, prior: 123_391.08, priorNumbers: ["2026-003", "2026-007"], thisNet: 37_110.1, rest: 25_049.32 };

  it("zeigt Honorar, bisher (mit Nummern), diese Rechnung und Rest mit Anteilen", () => {
    const html = markup(<InvoicePrint inv={{ ...discounted(), invoiceKind: "akonto", billingSummary: summary }} client={undefined} settings={settings} />).replace(/\u00a0/g, " ");
    expect(html).toContain("STAND DER ABRECHNUNG");
    expect(html).toContain("Bisher in Rechnung gestellt (2026-003, 2026-007)");
    expect(html).toMatch(/185.550\.50/);
    expect(html).toMatch(/123.391\.08.*66\.5 %/);
    expect(html).toMatch(/Diese Rechnung.*37.110\.10.*20\.0 %/);
    expect(html).toMatch(/Rest nach dieser Rechnung.*25.049\.32.*13\.5 %/);
  });

  it("ohne Block nichts davon", () => {
    const html = markup(<InvoicePrint inv={discounted()} client={undefined} settings={settings} />);
    expect(html).not.toContain("STAND DER ABRECHNUNG");
  });
});

describe("InvoicePrint Abrechnungsblock über dem Honorar", () => {
  it("zeigt den Überschuss positiv mit eigener Beschriftung (10'000 − 8'000 − 3'000 = −1'000)", () => {
    const s = { fee: 10_000, prior: 8_000, priorNumbers: ["1"], thisNet: 3_000, rest: -1_000 };
    const html = markup(<InvoicePrint inv={{ ...discounted(), billingSummary: s }} client={undefined} settings={settings} />).replace(/\u00a0/g, " ");
    expect(html).toMatch(/Über dem Honorar nach dieser Rechnung.*1.000\.00.*10\.0 %/);
    expect(html).not.toMatch(/CHF\s?-/);
  });
});
