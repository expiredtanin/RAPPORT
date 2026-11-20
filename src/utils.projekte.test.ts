// Tests für Projekt- und Protokoll-Hilfen in utils.ts: Kalenderwoche (ISO 8601, auch westlich von UTC),
// laufende Protokoll- und Projektnummern, Verweise vor dem Löschen.
import { afterEach, describe, expect, it } from "vitest";
import { formatKW, getKW, getWeekNumber, nextProjectSeq, nextProtoSeq, personReferences, projectReferences, protoSeqOf, applyProtoNumberFormat } from "./utils";
import type { AppData } from "./types";

describe("Kalenderwoche (ISO 8601)", () => {
  const tz = process.env.TZ;
  afterEach(() => { process.env.TZ = tz; });
  it("Jahreswechsel und Sonntage", () => {
    expect(getWeekNumber("2019-12-30")).toBe(1);
    expect(getWeekNumber("2021-01-03")).toBe(53);
    expect(getWeekNumber("2026-11-22")).toBe(47); // Sonntag gehört zur Woche davor
    expect(getKW("2026-11-23")).toBe("KW 48");
  });
  it("formatKW nennt das ISO-Wochenjahr, nicht das Kalenderjahr", () => {
    expect(formatKW("2019-12-30")).toBe("KW 1 / 2020");
    expect(formatKW("2021-01-01")).toBe("KW 53 / 2020");
    expect(formatKW("2026-06-15")).toBe("KW 25 / 2026");
  });
  it("«YYYY-MM-DD» zählt als lokaler Tag, auch westlich von UTC", () => {
    process.env.TZ = "America/New_York";
    expect(getWeekNumber("2020-01-06")).toBe(2); // vorher 1 (als Vortag gelesen)
    expect(formatKW("2019-12-30")).toBe("KW 1 / 2020");
  });
});

describe("Protokollnummern", () => {
  it("zählt nur die NN-Stelle des Formats, nicht Ziffern der Projektnummer", () => {
    const fmt = "PP-TT-NN";
    const n1 = applyProtoNumberFormat(fmt, { projectNumber: "2026/07", seq: 1, typKuerzel: "BS" });
    expect(n1).toBe("07-BS-01");
    expect(protoSeqOf(n1, fmt)).toBe(1);
    expect(nextProtoSeq([{ nummer: n1 }], fmt)).toBe(2); // vorher 8
  });
  it("Monat/Tag im Format zählen nicht", () => {
    expect(nextProtoSeq([{ nummer: "2026-11-20-03" }], "YYYY-MM-DD-NN")).toBe(4);
  });
  it("Standardformat und Rückfall bei fremdem Format", () => {
    expect(nextProtoSeq([{ nummer: "2026-BS-03" }, { nummer: "2026-SO-11" }], "YYYY-TT-NN")).toBe(12);
    expect(protoSeqOf("P04", "YYYY-TT-NN")).toBe(4); // altes Schema: letzte Zahl
    expect(protoSeqOf("2026", "YYYY-TT-NN")).toBeNull();
    expect(nextProtoSeq([], "YYYY-TT-NN")).toBe(1);
    expect(nextProtoSeq([{ nummer: "2026-BS-03" }])).toBe(4); // ohne Format
  });
});

describe("nächste Projektnummer", () => {
  const year = new Date().getFullYear();
  it("berücksichtigt bestehende Nummern (Import, von Hand, aus Offerte)", () => {
    const s = { projectNumberFormat: "YYYY/NN", lastProjectSeq: 3, lastProjectYear: year };
    expect(nextProjectSeq(s, [{ number: `${year}/02` }, { number: `${year}/09` }, { number: `${year - 1}/40` }])).toBe(10);
    expect(nextProjectSeq(s, [])).toBe(4);
  });
  it("neues Jahr beginnt bei 1", () => {
    expect(nextProjectSeq({ projectNumberFormat: "YYYY/NN", lastProjectSeq: 17, lastProjectYear: year - 1 }, [{ number: `${year - 1}/17` }])).toBe(1);
  });
});

describe("Verweise vor dem Löschen", () => {
  const data = {
    timeEntries: [{ projectId: "p1" }, { projectId: "p1" }, { projectId: "p2" }],
    invoices: [{ projectId: "p1", clientId: "c1" }],
    quotes: [{ clientId: "c1" }], protocols: [{ projectId: "p1" }], contracts: [], deliveryNotes: [], expenses: [],
    leads: [{ projectId: "p1", clientId: "c2", referrerId: "c1" }],
    projects: [{ id: "p1", clientId: "c1" }, { id: "p2", clientId: "c3", projectContacts: [{ contactId: "c1" }] }],
  } as unknown as AppData;
  it("Projekt", () => {
    expect(projectReferences(data, "p1")).toEqual(["2 Zeiteinträge", "1 Rechnung", "1 Protokoll", "1 Lead"]);
    expect(projectReferences(data, "p9")).toEqual([]);
  });
  it("Kontakt (Auftraggeber, Beteiligter, Empfehler)", () => {
    expect(personReferences(data, "c1")).toEqual(["2 Projekte", "1 Rechnung", "1 Offerte", "1 Lead"]);
    expect(personReferences(data, "c9")).toEqual([]);
  });
});
