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

describe("Rechenprüfung 25.11.2026", () => {
  const base: Employee = { id: "q", name: "Q", role: "", pensum: 100, wochenstunden: 42, ferienWochen: 5, monatslohn: 10000, eintrittsdatum: "2020-01-01", geburtsdatum: "1985-05-05" };
  it("Pensum 0 % im Verlauf (unbezahlter Urlaub) gilt als 0, nicht als 100", () => {
    const e = { ...base, pensumVerlauf: [{ ab: "2026-03-01", pensum: 0 }] };
    expect(arbeitszeitAm(e, "2026-03-15").pensum).toBe(0);
    expect(calcLohn(e, "2026-03").brutto).toBe(0);
    expect(calcLohn(e, "2026-02").brutto).toBe(10000);
  });
  it("Quellensteuer auf Lohn samt Familienzulagen", () => {
    const e = { ...base, quellensteuerPflichtig: true, quellensteuerSatz: 10, familienzulagen: 430 };
    expect(calcLohn(e, "2026-03").qst).toBe(1043);
  });
  it("Unter 8 Stunden pro Woche keine NBU", () => {
    expect(calcLohn({ ...base, pensum: 15 }, "2026-03").nbu).toBe(0);
    expect(calcLohn({ ...base, pensum: 20 }, "2026-03").nbu).toBeGreaterThan(0);
  });
  it("Überstunden-Auszahlung: AHV-/ALV-pflichtig, nicht in der PK-Basis", () => {
    const ohne = calcLohn(base, "2026-03"), mit = calcLohn(base, "2026-03", [], 0, undefined, undefined, 3500);
    expect(mit.ueberstundenBetrag).toBe(3500);
    expect(mit.bruttoTotal).toBe(ohne.bruttoTotal + 3500);
    expect(Math.round((mit.ahv - ohne.ahv) * 100) / 100).toBe(185.5);
    expect(Math.round((mit.alv - ohne.alv) * 100) / 100).toBe(38.5);
    expect(mit.bvg).toBe(ohne.bvg);
  });
});
