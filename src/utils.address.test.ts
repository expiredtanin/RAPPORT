// Datei: utils.address.test.ts — Freitext-Adresse zerlegen (Ersteinrichtung, QR-Rechnung)
import { describe, it, expect } from "vitest";
import { splitAddress } from "./utils";

describe("splitAddress", () => {
  it("Strasse und PLZ Ort", () => {
    expect(splitAddress("Teststr 1\n8000 Zürich")).toEqual({ street: "Teststr 1", zip: "8000", city: "Zürich" });
  });
  it("mit Ländervorsatz und Leerzeilen", () => {
    expect(splitAddress("Büro\n\nWeg 3\r\nCH-3011 Bern ")).toEqual({ street: "Weg 3", zip: "3011", city: "Bern" });
  });
  it("ohne Zeile PLZ Ort leer", () => {
    expect(splitAddress("irgendwo")).toEqual({ street: "", zip: "", city: "" });
    expect(splitAddress(undefined)).toEqual({ street: "", zip: "", city: "" });
  });
  it("nur PLZ Ort", () => {
    expect(splitAddress("8000 Zürich")).toEqual({ street: "", zip: "8000", city: "Zürich" });
  });
});
