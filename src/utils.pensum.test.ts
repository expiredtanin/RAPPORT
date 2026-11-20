// Pensum über die Zeit: gültiges Pensum je Datum und tagesgenau anteiliger Monatslohn bei einem Pensumwechsel.
// Referenzwerte von Hand: Monatslohn × Σ(Pensum × Tage) ÷ Kalendertage des Monats.
import { describe, expect, it } from "vitest";
import { arbeitszeitAm, calcLohn, pensumImMonat } from "./utils";
import type { Employee } from "./types";

const emp: Employee = { id: "e", name: "Test", role: "", pensum: 80, wochenstunden: 42, ferienWochen: 5, monatslohn: 9000, eintrittsdatum: "2020-01-01", pensumVerlauf: [{ ab: "2026-06-16", pensum: 100 }] };

describe("Pensum am Datum", () => {
  it("Grundwerte vor dem ersten Wechsel, danach der Verlauf (unsortiert, ungültige Einträge übergangen)", () => {
    const e = { ...emp, pensumVerlauf: [{ ab: "2026-09-01", pensum: 60 }, { ab: "", pensum: 10 }, { ab: "2026-06-16", pensum: 100, wochenstunden: 40 }, { ab: "2026-07-01", pensum: 0 }] };
    expect(arbeitszeitAm(e, "2026-06-15")).toEqual({ pensum: 80, wochenstunden: 42 });
    expect(arbeitszeitAm(e, "2026-06-16")).toEqual({ pensum: 100, wochenstunden: 40 });
    expect(arbeitszeitAm(e, "2026-09-30")).toEqual({ pensum: 60, wochenstunden: 40 });
    expect(arbeitszeitAm({ pensum: 0 }, "2026-01-01")).toEqual({ pensum: 100, wochenstunden: 35 });
  });
  it("Monatspensum tagesgenau gewichtet", () => {
    expect(pensumImMonat(emp, "2026-05")).toBe(80);
    expect(pensumImMonat(emp, "2026-06")).toBe(90); // 15 × 80 + 15 × 100
    expect(pensumImMonat(emp, "2026-07")).toBe(100);
  });
});

describe("Lohn bei Pensumwechsel", () => {
  it("Monatslohn tagesgenau anteilig", () => {
    expect(calcLohn(emp, "2026-05").brutto).toBe(7200);
    expect(calcLohn(emp, "2026-06").brutto).toBe(8100);
    expect(calcLohn(emp, "2026-07").brutto).toBe(9000);
  });
  it("Eintritt und Wechsel im selben Monat", () => {
    // 11.–15.6. 80 %, 16.–30.6. 100 %: 9000 × (5 × 0.8 + 15 × 1) ÷ 30
    expect(calcLohn({ ...emp, eintrittsdatum: "2026-06-11" }, "2026-06").brutto).toBe(5700);
  });
  it("Übersteuertes Pensum (Lohnlauf) ohne Verlauf gilt für den ganzen Monat", () => {
    expect(calcLohn({ ...emp, pensum: 50, pensumVerlauf: undefined }, "2026-06").brutto).toBe(4500);
  });
});
