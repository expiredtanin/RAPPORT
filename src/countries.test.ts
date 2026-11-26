// Tests für Ländercodes (countries.ts): Kontakt-Feld «Land» → ISO-Code für den QR-Zahlteil.
import { describe, expect, it } from "vitest";
import { COUNTRIES, countryCode } from "./countries";

describe("countryCode", () => {
  it("ISO-Code bleibt, gross geschrieben", () => {
    expect(countryCode("de")).toBe("DE");
    expect(countryCode(" LI ")).toBe("LI");
    expect(countryCode("HU")).toBe("HU");   // gültiger Code, auch wenn nicht in der Liste
  });
  it("ausgeschriebene Länder und Kennzeichen → Code (vorher still CH)", () => {
    expect(countryCode("Deutschland")).toBe("DE");
    expect(countryCode("Österreich")).toBe("AT");
    expect(countryCode("Schweiz")).toBe("CH");
    expect(countryCode("FL")).toBe("LI");
    expect(countryCode("UK")).toBe("GB");
    expect(countryCode("Niederlande")).toBe("NL");
  });
  it("leer oder unbekannt → CH bzw. Vorgabe", () => {
    expect(countryCode("")).toBe("CH");
    expect(countryCode(undefined)).toBe("CH");
    expect(countryCode("Atlantis")).toBe("CH");
    expect(countryCode("Atlantis", "")).toBe("");
  });
  it("Liste: eindeutige Codes, Schweiz zuerst", () => {
    expect(COUNTRIES[0].code).toBe("CH");
    expect(new Set(COUNTRIES.map(c => c.code)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.every(c => /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });
});
