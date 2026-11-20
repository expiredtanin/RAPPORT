// Tests für die Feld-Heuristiken der Belegerkennung (parseReceiptFields, ohne OCR).

import { describe, expect, it } from "vitest";
import { parseReceiptFields } from "./ocr";

describe("parseReceiptFields", () => {
  it("Schweizer Quittung: Total mit Apostroph, MWST 8.10 %", () => {
    const f = parseReceiptFields("Papeterie Muster AG\n12.03.2026\nPlotpapier 1'100.00\nTotal CHF 1'234.50\nMWST 8.10% 92.52");
    expect(f.amount).toBe(1234.5);
    expect(f.mwstRate).toBe(8.1);
    expect(f.date).toBe("2026-03-12");
    expect(f.vendor).toBe("Papeterie Muster AG");
  });

  it("Dezimalkomma: 12,50 und 1.234,50 (früher 1250 bzw. 1.2345)", () => {
    expect(parseReceiptFields("Café\nTotal 12,50").amount).toBe(12.5);
    expect(parseReceiptFields("Hotel\nGesamtbetrag EUR 1.234,50").amount).toBe(1234.5);
  });

  it("MWST-Satz in verschiedenen Schreibweisen", () => {
    expect(parseReceiptFields("inkl. 8.1% MWST").mwstRate).toBe(8.1);
    expect(parseReceiptFields("MwSt. 2,6 %").mwstRate).toBe(2.6);
    expect(parseReceiptFields("TVA 8.1%").mwstRate).toBe(8.1);
    expect(parseReceiptFields("Total 20.00").mwstRate).toBeNull();
  });
});
