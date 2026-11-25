// Tests für die Zerlegung von Freitext im Druck (printLines.ts).
import { describe, expect, it } from "vitest";
import { printLines } from "./printLines";

describe("printLines", () => {
  it("Zeilen bleiben Zeilen (auch CRLF), Leerzeilen bleiben", () => {
    expect(printLines("a\r\n\r\nb")).toEqual(["a", "", "b"]);
  });
  it("lange Absätze an Satzenden — Zahlen, Abkürzungen, URLs bleiben ganz, kein Zeichen geht verloren", () => {
    const para = ("Der Preis beträgt CHF 1'200.50 für 1.5 m, siehe https://example.com/a.b und z.B. Art. 5. ").repeat(8).trim();
    const lines = printLines(para);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(para);
    expect(lines.some(l => /1\.$|https:\/\/example\.$/.test(l))).toBe(false);
  });
  it("ohne Satzzeichen an Leerzeichen um 500 Zeichen", () => {
    const lines = printLines("wort ".repeat(300).trim());
    expect(lines.every(l => l.length <= 600)).toBe(true);
    expect(lines.join(" ")).toBe("wort ".repeat(300).trim());
  });
});
