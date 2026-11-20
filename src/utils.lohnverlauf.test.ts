// Lohn über die Zeit, Familienzulagen im Austrittsmonat und Vortag vor Feiertagen.
// Referenzwerte von Hand: Σ(Lohn × Pensum × Tage) ÷ Kalendertage des Monats.
import { describe, expect, it } from "vitest";
import { calcLohn, lohnAGSaetze, lohnImMonat, monatslohnAm, monatslohnImMonat } from "./utils";
import { overtimeHourlyRate, resolveHolidays } from "./worktime";
import type { Employee } from "./types";

const emp: Employee = { id: "e", name: "Test", role: "", pensum: 100, wochenstunden: 41, ferienWochen: 5, monatslohn: 7600, eintrittsdatum: "2020-01-01",
  lohnVerlauf: [{ ab: "2026-07-15", monatslohn: 8000 }] };

describe("Lohnänderung", () => {
  it("Monatslohn am Datum, unsortiert, ungültige Einträge übergangen", () => {
    const e = { ...emp, lohnVerlauf: [{ ab: "2026-10-01", monatslohn: 8400 }, { ab: "", monatslohn: 1 }, { ab: "2026-07-15", monatslohn: 8000 }] };
    expect(monatslohnAm(e, "2026-07-14")).toBe(7600);
    expect(monatslohnAm(e, "2026-07-15")).toBe(8000);
    expect(monatslohnAm(e, "2026-12-31")).toBe(8400);
    expect(monatslohnImMonat(e, "2026-07")).toBe(8000);
  });
  it("im Wechselmonat tagesgenau: 14 × 7'600 + 17 × 8'000 über 31 Tage", () => {
    expect(calcLohn(emp, "2026-06").brutto).toBe(7600);
    expect(calcLohn(emp, "2026-07").brutto).toBe(7819.35); // 242'400 / 31 = 7'819.354…
    expect(calcLohn(emp, "2026-08").brutto).toBe(8000);
  });
  it("Lohn- und Pensumwechsel am selben Tag", () => {
    const e = { ...emp, pensumVerlauf: [{ ab: "2026-07-15", pensum: 80 }] };
    expect(lohnImMonat(e, "2026-07")).toBeCloseTo(215200 / 31, 9); // 14 × 7'600 + 17 × 8'000 × 0.8
    expect(calcLohn(e, "2026-07").brutto).toBe(6941.94);
    expect(calcLohn(e, "2026-08").brutto).toBe(6400);
  });
  it("Lohnänderung mit Austritt im Monat: Anteil nur über die angestellten Tage", () => {
    const e = { ...emp, austrittsdatum: "2026-07-20" };
    // Tage 1.–20.: 14 × 7'600 + 6 × 8'000 = 154'400 → Ø 7'720 × 20/31
    expect(calcLohn(e, "2026-07").brutto).toBe(Math.round(7720 * 20 / 31 * 100) / 100);
  });
  it("Überstunden-Stundenlohn mit dem Lohn am Auszahlungsdatum", () => {
    expect(overtimeHourlyRate(emp, "2026-06-30")).toBe(Math.round(7600 * 12 / (41 * 52) * 100) / 100);
    expect(overtimeHourlyRate(emp, "2026-08-31")).toBe(45.03); // 8'000 × 12 / 2'132
  });
});

describe("Familienzulagen im Austrittsmonat", () => {
  const sara = { ...emp, lohnVerlauf: [], familienzulagen: 215, austrittsdatum: "2026-11-15" };
  it("Standard voll, wahlweise anteilig nach Kalendertagen", () => {
    expect(calcLohn(sara, "2026-11", [], 0, undefined, lohnAGSaetze({})).familienzulagen).toBe(215);
    expect(calcLohn(sara, "2026-11", [], 0, undefined, lohnAGSaetze({ familienzulagenAnteilig: true })).familienzulagen).toBe(107.5);
    expect(calcLohn(sara, "2026-10", [], 0, undefined, lohnAGSaetze({ familienzulagenAnteilig: true })).familienzulagen).toBe(215);
  });
});

describe("Vortag vor ganzem Feiertag", () => {
  const ft = [{ id: "b", date: "2026-08-01", label: "Nationalfeiertag", stundenDelta: 0 }]; // Samstag
  it("Freitag vor dem Samstag-Feiertag, Stunden einstellbar, 0 = aus", () => {
    expect(resolveHolidays(ft, 2026).find(f => f.id === "vortag-2026-07-31")?.stundenDelta).toBe(-1);
    expect(resolveHolidays(ft, 2026, 2).find(f => f.id === "vortag-2026-07-31")?.stundenDelta).toBe(-2);
    expect(resolveHolidays(ft, 2026, 0).some(f => String(f.id).startsWith("vortag"))).toBe(false);
  });
});
