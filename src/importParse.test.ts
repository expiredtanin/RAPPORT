// Tests für das Lesen von Import-Dateien (importParse.ts): Kodierung, Trennzeichen, Zahlen, Daten, Excel-Zellen.
import { describe, expect, it } from "vitest";
import { decodeText, excelCellText, parseCSV, parseFlexibleDate, parseNumber } from "./importParse";

const latin1 = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0)));

describe("decodeText", () => {
  it("UTF-8 mit BOM, Windows-1252 und UTF-16 ergeben dieselben Umlaute", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Müller;Zürich")]);
    expect(decodeText(utf8)).toBe("Müller;Zürich");
    expect(decodeText(latin1("Müller;Zürich;Grösse"))).toBe("Müller;Zürich;Grösse");
    const u16 = new Uint8Array([0xff, 0xfe, ...[..."Bär"].flatMap(c => [c.charCodeAt(0), 0])]);
    expect(decodeText(u16)).toBe("Bär");
  });
});

describe("parseCSV", () => {
  it("Semikolon, Anführungszeichen mit Trennzeichen/Zeilenumbruch, Dezimalkomma", () => {
    const rows = parseCSV("﻿Name;Betrag;Notiz\r\n\"Meier; Söhne AG\";1'234,50;\"Zeile 1\nZeile 2\"\r\n\r\nGrün & Co;-12,5;\"sagt \"\"hallo\"\"\"\r\n");
    expect(rows).toEqual([
      ["Name", "Betrag", "Notiz"],
      ["Meier; Söhne AG", "1'234,50", "Zeile 1\nZeile 2"],
      ["Grün & Co", "-12,5", 'sagt "hallo"'],
    ]);
  });
  it("Komma und Tabulator werden erkannt; Kommas in Anführungszeichen zählen nicht", () => {
    expect(parseCSV('"Name, Vorname",Ort\n"Muster, Hans",Bern')).toEqual([["Name, Vorname", "Ort"], ["Muster, Hans", "Bern"]]);
    expect(parseCSV("Name\tBetrag\nA\t1,5")).toEqual([["Name", "Betrag"], ["A", "1,5"]]);
  });
});

describe("parseNumber", () => {
  it("Schweizer, deutsche und englische Schreibweisen", () => {
    expect(parseNumber("1'234.50")).toBe(1234.5);
    expect(parseNumber("1e3")).toBe(1000);
    expect(parseNumber("1.5E-2")).toBe(0.015);
    expect(parseNumber("1’234.50")).toBe(1234.5);
    expect(parseNumber("1.234,50")).toBe(1234.5);
    expect(parseNumber("1,234.50")).toBe(1234.5);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("CHF 1 234.–")).toBe(1234);
    expect(parseNumber("8.1 %")).toBe(8.1);
    expect(parseNumber("7.5")).toBe(7.5);
  });
  it("negative Beträge und Unsinn", () => {
    expect(parseNumber("-12,50")).toBe(-12.5);
    expect(parseNumber("CHF -40")).toBe(-40);
    expect(parseNumber("(40.00)")).toBe(-40);
    expect(parseNumber("40.00-")).toBe(-40);
    expect(parseNumber("1234.-")).toBe(1234);
    expect(Number.isNaN(parseNumber("k.A."))).toBe(true);
    expect(Number.isNaN(parseNumber(""))).toBe(true);
  });
});

describe("parseFlexibleDate", () => {
  it("ISO, Schweizer Format, zweistellige Jahre, mit Uhrzeit", () => {
    expect(parseFlexibleDate("2026-10-01")).toBe("2026-10-01");
    expect(parseFlexibleDate("2026-10-01T08:00:00Z")).toBe("2026-10-01");
    expect(parseFlexibleDate("1.2.2026")).toBe("2026-02-01");
    expect(parseFlexibleDate("31.12.26")).toBe("2026-12-31");
    expect(parseFlexibleDate("31.12.2026 14:30")).toBe("2026-12-31");
    expect(parseFlexibleDate("05/03/2026")).toBe("2026-03-05");
  });
  it("ungültige Daten werden nicht still verschoben", () => {
    expect(parseFlexibleDate("31.02.2026")).toBe("");
    expect(parseFlexibleDate("13.13.2026")).toBe("");
    expect(parseFlexibleDate("morgen")).toBe("");
  });
});

describe("excelCellText", () => {
  it("formatierter Text, Formel, Link, Datum und Uhrzeit", () => {
    expect(excelCellText({ richText: [{ text: "Müller " }, { text: "AG" }] })).toBe("Müller AG");
    expect(excelCellText({ formula: "A1*2", result: 84 })).toBe("84");
    expect(excelCellText({ text: "Website", hyperlink: "https://x.ch" })).toBe("Website");
    expect(excelCellText(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-10-01");
    expect(excelCellText(new Date(Date.UTC(1899, 11, 30, 8, 15)))).toBe("08:15");
    expect(excelCellText({ error: "#DIV/0!" })).toBe("");
    expect(excelCellText(null)).toBe("");
  });
});

describe("parseCSV: offenes Anführungszeichen", () => {
  it("meldet die Zeile statt den Rest der Datei zu verschlucken", () => {
    expect(() => parseCSV('Name;Strasse\n"Offen AG;Str\nNaechste;x\n')).toThrow(/Zeile 2/);
  });
});

describe("parseNumber: Stunden als H:MM", () => {
  it("«7:30» ist 7.5 (nicht 730)", () => {
    expect(parseNumber("7:30")).toBe(7.5);
    expect(parseNumber("12:45")).toBe(12.75);
    expect(parseNumber("-2:30")).toBe(-2.5);
    expect(parseNumber("(1:30)")).toBe(-1.5);
    expect(parseNumber("7:30:00")).toBe(7.5);
    expect(parseNumber("2:30 h")).toBe(2.5);
  });
});
