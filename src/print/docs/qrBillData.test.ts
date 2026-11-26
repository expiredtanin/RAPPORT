// Tests des QR-Zahlteils: Referenz je Konto, Zeichensatz/Feldlängen, Adressen Typ S, Gutschrift ohne Zahlteil.
// Erwartete Referenzen unabhängig nachgerechnet (Python, Modulo 10 rekursiv bzw. ISO 11649 mod 97).

import { describe, expect, it } from "vitest";
import { SwissQRBill } from "swissqrbill/svg";
import { buildQrBillData, qrDebtor, qrText } from "./qrBillData";
import { creditorReference, paymentReference } from "../../utils";
import type { Person, Settings } from "../../types";

const QR_IBAN = "CH44 3199 9123 0008 8901 2";
const IBAN = "CH93 0076 2011 6238 5295 7";
const settings = { name: "Amrein Partner Architektur AG", street: "Konradstrasse 12", zip: "8005", city: "Zürich", country: "CH", iban: QR_IBAN } as Settings;
const client = { id: "c1", name: "Müller & Söhne AG", street: "Bahnhofstrasse 22", zip: "8001", city: "Zürich", country: "CH", contacts: [] } as unknown as Person;

describe("Zahlungsreferenz", () => {
  it("ISO-11649-Beispiel RF18539007547034 und Rechnungsnummern", () => {
    expect(creditorReference("539007547034")).toBe("RF18539007547034");
    expect(creditorReference("2026-001")).toBe("RF602026001");
    expect(creditorReference("RE-2026-11-007")).toBe("RF71RE202611007");
    expect(creditorReference("--")).toBe("");
  });

  it("QR-IBAN → QRR mit Prüfziffer, sonst SCOR, ohne Nummer NON", () => {
    expect(paymentReference("2026-001", QR_IBAN)).toEqual({ type: "QRR", reference: "000000000000000000020260010", display: "00 00000 00000 00000 00202 60010" });
    expect(paymentReference("2026-001", IBAN)).toEqual({ type: "SCOR", reference: "RF602026001", display: "RF60 2026 001" });
    expect(paymentReference("", IBAN).type).toBe("NON");
  });
});

describe("qrText", () => {
  it("ersetzt typografische Zeichen, entfernt unzulässige, kürzt", () => {
    expect(qrText("Studio «Nord» – Bürogemeinschaft’s …", 70)).toBe("Studio «Nord» - Bürogemeinschaft's ...");
    expect(qrText("Zeile 1\nZeile 2 😀", 70)).toBe("Zeile 1 Zeile 2");
    expect(qrText("Ștefan Țară €", 70)).toBe("Ștefan Țară €");
    expect(qrText("x".repeat(80), 70)).toHaveLength(70);
  });
});

describe("buildQrBillData", () => {
  it("Absender nur mit Freitext-Adresse (Ersteinrichtung): Strasse/PLZ/Ort daraus", () => {
    const res = buildQrBillData({ number: "2026-014", total: 100 }, client, { ...settings, street: "", zip: "", city: "", address: "Teststr 1\n8000 Zürich" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.creditor).toMatchObject({ address: "Teststr 1", zip: "8000", city: "Zürich" });
  });
  it("QR-IBAN: Betrag = Total, QRR aus der Nummer, Schuldner Typ S", () => {
    const res = buildQrBillData({ number: "2026-014", total: 12_345.6 }, client, settings);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.amount).toBe(12_345.6);
    expect(res.data.reference).toBe(paymentReference("2026-014", QR_IBAN).reference);
    expect(res.data.debtor).toEqual({ name: "Müller & Söhne AG", address: "Bahnhofstrasse 22", zip: "8001", city: "Zürich", country: "CH" });
    expect(res.data.message).toBe("Rechnung 2026-014");
    expect(() => new SwissQRBill(res.data)).not.toThrow();
  });

  it("normale IBAN: Creditor Reference (SCOR), von swissqrbill akzeptiert", () => {
    const res = buildQrBillData({ number: "2026-014", total: 100 }, client, { ...settings, iban: IBAN });
    expect(res.ok && res.data.reference).toBe("RF972026014");
    if (res.ok) expect(() => new SwissQRBill(res.data)).not.toThrow();
  });

  it("Gutschrift oder Betrag 0: kein Zahlteil (kein negativer Betrag im QR-Code)", () => {
    expect(buildQrBillData({ number: "2026-015", total: -540.5 }, client, settings)).toMatchObject({ ok: false });
    expect(buildQrBillData({ number: "2026-015", total: 0 }, client, settings)).toMatchObject({ ok: false });
  });

  it("Kunde ohne PLZ/Ort: Zahlteil ohne Schuldner statt ungültiger Adresse", () => {
    const res = buildQrBillData({ number: "2026-016", total: 50 }, { ...client, zip: "", city: "" } as Person, settings);
    expect(res.ok && res.data.debtor).toBeUndefined();
  });

  it("Absender ohne PLZ/Ort: Fehlermeldung statt ungültigem QR-Code", () => {
    expect(buildQrBillData({ number: "2026-016", total: 50 }, client, { ...settings, zip: "" })).toMatchObject({ ok: false, error: true });
  });
});

describe("qrDebtor", () => {
  it("liest das alte Freitextfeld «Strasse⏎PLZ Ort», Land als ISO-Code", () => {
    const old = { id: "c2", name: "Familie Keller", address: "Seestrasse 118\n8700 Küsnacht", country: "Schweiz", contacts: [] } as unknown as Person;
    expect(qrDebtor(old)).toEqual({ name: "Familie Keller", address: "Seestrasse 118", zip: "8700", city: "Küsnacht", country: "CH" });
  });
});

describe("QR-Zahlteil: Land des Zahlungspflichtigen aus dem Feld «Land» (Regel 26.11.2026)", () => {
  const base = { id: "c9", name: "Muster GmbH", street: "Hauptstrasse 1", zip: "80331", city: "München", contacts: [] };
  it("ISO-Code des Kontakts", () => {
    expect(qrDebtor({ ...base, country: "DE" } as unknown as Person)?.country).toBe("DE");
    expect(qrDebtor({ ...base, country: "li" } as unknown as Person)?.country).toBe("LI");
  });
  it("ausgeschriebenes Land wird zum Code statt still CH", () => {
    expect(qrDebtor({ ...base, country: "Deutschland" } as unknown as Person)?.country).toBe("DE");
  });
  it("ohne Land → CH; die Freitext-Adresse bestimmt das Land nicht", () => {
    expect(qrDebtor({ ...base } as unknown as Person)?.country).toBe("CH");
    const old = { id: "c3", name: "Hans", address: "Hauptstrasse 1\nD-80331 München", contacts: [] } as unknown as Person;
    expect(qrDebtor(old)?.country).toBe("CH");
  });
});
