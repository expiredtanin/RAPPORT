// Tests der Rechnungs-Hilfen in utils.ts: kaufmännische Rappenrundung, Positionsbetrag, Vertrags-MWST, Mahnbrief.
// Erwartete Werte unabhängig mit Python (decimal, ROUND_HALF_UP) nachgerechnet.

import { describe, expect, it, vi, afterEach } from "vitest";
import { buildReminderLetter, contractAmounts, isValidIban, fillLetterTemplate, letterToTemplate, lineAmount, mahnKosten, roundCHF } from "./utils";
import type { Invoice, Person } from "./types";

describe("roundCHF kaufmännisch", () => {
  it("x.xx5 wird aufgerundet, auch bei Gleitkomma-Darstellung knapp darunter", () => {
    expect(roundCHF(1.005)).toBe(1.01);
    expect(roundCHF(105 * 0.077)).toBe(8.09);
    expect(roundCHF(2.675)).toBe(2.68);
  });
  it("negative Beträge spiegelbildlich, kein −0", () => {
    expect(roundCHF(-1.005)).toBe(-1.01);
    expect(roundCHF(-0.405)).toBe(-0.41);
    expect(Object.is(roundCHF(-0.001), 0)).toBe(true);
  });
});

describe("lineAmount", () => {
  it("Menge × Preis abzüglich Positionsrabatt, auf Rappen", () => {
    expect(lineAmount(2.5, 142.25)).toBe(355.63);
    expect(lineAmount(1, 1234.55, 7)).toBe(1148.13); // 1148.1315
    expect(lineAmount(undefined, 10)).toBe(0);
  });
});

describe("contractAmounts", () => {
  it("MWST auf Rappen gerundet (15 × 8.1 % = 1.215 → 1.22)", () => {
    expect(contractAmounts({ amount: 15 }, [], 8.1)).toEqual({ net: 15, rate: 8.1, tax: 1.22, gross: 16.22 });
  });
});

describe("buildReminderLetter", () => {
  afterEach(() => { vi.useRealTimers(); });
  const client = { id: "c1", name: "Bauherrschaft Muster", contacts: [] } as unknown as Person;
  const settings = { iban: "CH4431999123000889012", name: "Atelier" };
  const inv = {
    id: "i1", number: "2026-014", clientId: "c1", date: "2026-09-01", dueDate: "2026-10-01", total: 1081,
    reminders: [{ nr: 1, date: "2026-10-15", sentDate: "2026-10-15" }, { nr: 2, date: "2026-10-30", sentDate: "2026-10-30" }, { nr: 3, date: "2026-11-10", sentDate: "2026-11-10" }],
  } as unknown as Invoice;

  it("Verzugstage am Versanddatum (Nachdruck = gleicher Text), QR-Referenz statt Rechnungsnummer", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T10:00:00"));
    const { body } = buildReminderLetter(inv, 1, "2026-10-15", [client], settings);
    expect(body).toContain("seit 14 Tagen");
    expect(body).toContain("Referenz: 00 00000 00000 00000 00202 60147");
    expect(body).toContain("IBAN: CH44 3199 9123 0008 8901 2");
  });
  it("Anrede: Person namentlich, Firma mit Ansprechpartnern neutral", () => {
    expect(buildReminderLetter(inv, 1, "2026-10-15", [client], settings).body.startsWith("Sehr geehrte/r Bauherrschaft Muster")).toBe(true);
    const firma = { ...client, contacts: [{ id: "k", name: "Thomas Bühler" }] } as unknown as Person;
    expect(buildReminderLetter(inv, 1, "2026-10-15", [firma], settings).body.startsWith("Sehr geehrte Damen und Herren")).toBe(true);
  });

  it("Nachdruck der 3. Mahnung nennt nur die zwei früheren Schreiben", () => {
    const { body } = buildReminderLetter(inv, 3, "2026-11-10", [client], settings);
    expect(body).toContain("vom 15.10.2026 und 30.10.2026 ist");
  });
});

describe("mahnKosten (Verzugszins OR 104, Mahngebühren)", () => {
  const inv = { total: 10810, dueDate: "2026-10-01" };
  it("ausgeschaltet: nur der offene Betrag", () => {
    expect(mahnKosten(inv, 2, "2026-11-01", {})).toEqual({ offen: 10810, zinsTage: 0, zinsSatz: 0, zins: 0, gebuehr: 0, total: 10810 });
  });
  it("5 % ab dem Tag nach der Fälligkeit, tagesgenau /365", () => {
    // 2.10.–31.10. = 30 Tage; 10'810 × 0.05 × 30/365 = 44.4246… → 44.42
    const k = mahnKosten(inv, 1, "2026-10-31", { verzugszinsAktiv: true });
    expect(k.zinsTage).toBe(30);
    expect(k.zins).toBe(44.42);
    expect(k.total).toBe(10854.42);
  });
  it("Gebühren kumuliert bis zur Stufe, letzte Stufe gilt weiter", () => {
    const s = { mahngebuehrAktiv: true };
    expect(mahnKosten(inv, 1, "2026-10-15", s).gebuehr).toBe(0);
    expect(mahnKosten(inv, 2, "2026-10-15", s).gebuehr).toBe(20);
    expect(mahnKosten(inv, 4, "2026-10-15", s).gebuehr).toBe(80); // 0 + 20 + 30 + 30
    expect(mahnKosten(inv, 2, "2026-10-15", { mahngebuehrAktiv: true, mahngebuehren: [10, 25] }).gebuehr).toBe(35);
  });
  it("vor der Fälligkeit kein Zins", () => {
    expect(mahnKosten(inv, 1, "2026-09-20", { verzugszinsAktiv: true, verzugszinsSatz: 8 }).zins).toBe(0);
  });
  it("Brief weist Zins, Gebühr und Total aus", () => {
    const client = { id: "c1", name: "Bauherrschaft Muster", contacts: [] } as unknown as Person;
    const i = { id: "i1", number: "2026-014", clientId: "c1", date: "2026-09-01", dueDate: "2026-10-01", total: 10810, reminders: [{ nr: 1, date: "2026-10-15" }] } as unknown as Invoice;
    const { body, kosten } = buildReminderLetter(i, 2, "2026-10-31", [client], { iban: "CH4431999123000889012", name: "Atelier", verzugszinsAktiv: true, mahngebuehrAktiv: true });
    expect(kosten.total).toBe(10874.42);
    expect(body).toMatch(/Verzugszins 5 % ab 2\.10\.2026 bis 31\.10\.2026 \(30 Tage\): CHF.44\.42/);
    expect(body).toMatch(/Mahngebühren: CHF.20\.00/);
    expect(body).toMatch(/Total zu bezahlen: CHF.10.874\.42/);
  });
});

describe("Briefvorlagen: Platzhalter bleiben beim Speichern", () => {
  it("füllen und zurückwandeln ergibt die Vorlage", () => {
    const tpl = "<p>Sehr geehrte {{client}}</p><p>Projekt {{project}}: Kosten der Bauherrschaft.</p>";
    const names = { client: "Müller & Partner", project: "Haus am See" };
    const filled = fillLetterTemplate(tpl, names);
    expect(filled).toContain("Müller &amp; Partner");
    expect(letterToTemplate(filled, names)).toBe(tpl);
  });
  it("ohne Auswahl werden die Lückenfüller zurückgewandelt", () => {
    const tpl = "Guten Tag {{client}}, betreffend {{project}}";
    expect(letterToTemplate(fillLetterTemplate(tpl, {}), {})).toBe(tpl);
  });
  it("Tags und Attribute bleiben unberührt (Kunde «br», Projekt «left»)", () => {
    const html = '<p style="text-align: left">Guten Tag br<br>Projekt left</p>';
    expect(letterToTemplate(html, { client: "br", project: "left" })).toBe('<p style="text-align: left">Guten Tag {{client}}<br>Projekt {{project}}</p>');
  });
  it("nur ganze Wörter: «Bau» im Wort «Bauherr» bleibt", () => {
    expect(letterToTemplate("Bau AG, Bauherr", { client: "Bau AG" })).toBe("{{client}}, Bauherr");
    expect(letterToTemplate("Neubau, Bau", { project: "Bau" })).toBe("Neubau, {{project}}");
  });
});

describe("isValidIban", () => {
  it("prüft die Modulo-97-Prüfziffer und die Schweizer Länge", () => {
    expect(isValidIban("CH93 0076 2011 6238 5295 7")).toBe(true);
    expect(isValidIban("CH44 3199 9123 0008 8901 2")).toBe(true);   // QR-IBAN (SIX-Beispiel)
    expect(isValidIban("CH93 0076 2011 6238 5295 8")).toBe(false);  // Tippfehler
    expect(isValidIban("CH93 0076 2011 6238 529")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
});

describe("letterToTemplate und HTML-Entities", () => {
  it("Kunde «nbsp»/«amp» trifft keine Entities", () => {
    expect(letterToTemplate("Hallo&nbsp;nbsp &amp; amp", { client: "nbsp", project: "amp" })).toBe("Hallo&nbsp;{{client}} &amp; {{project}}");
  });
});
