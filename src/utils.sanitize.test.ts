// @vitest-environment jsdom
// Tests für die Rich-Text-Bereinigung: Link-Prüfung (isSafeUrl) und sanitizeHtml (braucht ein DOM → jsdom).
import { describe, expect, it } from "vitest";
import { csvCell, isSafeUrl, sanitizeHtml } from "./utils";

describe("isSafeUrl", () => {
  it("lässt normale Links zu", () => {
    for (const u of ["https://rapport.ch", "mailto:a@b.ch", "tel:+41441234567", "/relativ", "#anker"]) expect(isSafeUrl(u)).toBe(true);
  });
  it("blockiert Skript- und Daten-Schemas, auch mit Leer- und Steuerzeichen verschleiert", () => {
    for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd"]) {
      expect(isSafeUrl(u)).toBe(false);
    }
  });
});

describe("sanitizeHtml: Inhalt entfernter Elemente wird mitgeprüft", () => {
  it.each([
    ['<form><img src=x onerror="alert(1)"></form>', /onerror|<img/i],
    ['<x-foo><script>alert(1)</script></x-foo>', /<script/i],
    ['<table><tr><td><a href="javascript:alert(1)">x</a></td></tr></table>', /javascript:/i],
    ['<section><svg onload="alert(1)"></svg></section>', /onload|<svg/i],
    ['<main><iframe src="https://evil.example"></iframe></main>', /<iframe/i],
  ])("%s", (input, bad) => {
    expect(sanitizeHtml(input)).not.toMatch(bad);
  });
  it("Text aus entfernten Hüllen bleibt, Skript- und Stilinhalt nicht", () => {
    expect(sanitizeHtml("<section><b>fett</b> Text</section>")).toBe("<b>fett</b> Text");
    expect(sanitizeHtml("<p>a<script>alert(1)</script>b</p>")).toBe("<p>ab</p>");
    expect(sanitizeHtml("<p>a<style>p{color:red}</style>b</p>")).toBe("<p>ab</p>");
  });
  it("Kommentare werden entfernt", () => {
    expect(sanitizeHtml("<p>a<!-- x --></p>")).toBe("<p>a</p>");
  });
});

describe("sanitizeHtml: erlaubtes Format bleibt", () => {
  it("Absätze, Fett, Listen, Links und Ausrichtung", () => {
    const html = '<p style="text-align: center">Hallo <b>Welt</b></p><ul><li>a</li></ul><a href="https://rapport.ch" target="_blank">x</a>';
    const out = sanitizeHtml(html);
    expect(out).toContain('<p style="text-align: center">Hallo <b>Welt</b></p>');
    expect(out).toContain("<ul><li>a</li></ul>");
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it("SVG samt Inhalt weg", () => {
    expect(sanitizeHtml('<p>a<svg><text>t</text></svg>b</p>')).toBe("<p>ab</p>");
  });
});

describe("csvCell: keine Formeln aus Benutzertext", () => {
  it("maskiert Formel-Anfänge, lässt Zahlen und normalen Text", () => {
    expect(csvCell('=HYPERLINK("https://x","y")')).toBe(`"'=HYPERLINK(""https://x"",""y"")"`);
    expect(csvCell("+41 44 123")).toBe(`"'+41 44 123"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-12.50")).toBe('"-12.50"');
    expect(csvCell("Müller AG")).toBe('"Müller AG"');
    expect(csvCell(0)).toBe('"0"');
  });
});
