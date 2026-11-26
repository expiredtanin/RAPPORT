// Tests: Einstellung «Vortag vor Feiertagen» (vortagModus): direkt (Standard), nur Werktag-Feiertage, letzter Arbeitstag.
import { describe, expect, it } from "vitest";
import { createWorktime, resolveHolidays } from "./worktime";
import type { Feiertag } from "./types";

const ft = (date: string, label = "Feiertag", stundenDelta = 0): Feiertag => ({ id: `f${date}`, date, label, stundenDelta });
const vortage = (list: Feiertag[], mode?: "direkt" | "werktag" | "letzter") =>
  resolveHolidays(list, 2026, 1, mode).filter(f => String(f.id).startsWith("vortag")).map(f => f.date);

describe("Vortag-Modus", () => {
  const dienstag = ft("2026-09-01");        // Di → Montag davor
  const montag = ft("2026-05-25");          // Mo → Freitag davor nur im Modus «letzter»
  const samstag = ft("2026-08-01");         // Sa → Freitag davor nur in «direkt» und «letzter»
  const sonntag = ft("2026-08-09");         // So → Samstag fällt weg; «letzter»: Freitag

  it("Standard (direkt) = bisheriges Verhalten: ohne Angabe wie «direkt»", () => {
    expect(vortage([dienstag])).toEqual(["2026-08-31"]);
    expect(vortage([montag])).toEqual([]);                    // Freitag vor Montagsfeiertag nicht gekürzt
    expect(vortage([samstag])).toEqual(["2026-07-31"]);       // Freitag vor Samstagsfeiertag gekürzt
    expect(vortage([sonntag])).toEqual([]);
    expect(vortage([dienstag, montag, samstag, sonntag], "direkt")).toEqual(vortage([dienstag, montag, samstag, sonntag]));
  });
  it("werktag: nur wenn der Feiertag auf einen Werktag (Mo–Fr) fällt", () => {
    expect(vortage([dienstag], "werktag")).toEqual(["2026-08-31"]);
    expect(vortage([montag], "werktag")).toEqual([]);
    expect(vortage([samstag], "werktag")).toEqual([]);
    expect(vortage([sonntag], "werktag")).toEqual([]);
  });
  it("letzter: letzter Arbeitstag vor dem Feiertag, auch Freitag vor Montag/Wochenende", () => {
    expect(vortage([dienstag], "letzter")).toEqual(["2026-08-31"]);
    expect(vortage([montag], "letzter")).toEqual(["2026-05-22"]);
    expect(vortage([samstag], "letzter")).toEqual(["2026-07-31"]);
    expect(vortage([sonntag], "letzter")).toEqual(["2026-08-07"]);
  });
  it("letzter: überspringt einen ganzen Feiertag davor (Karfreitag + Ostermontag → Donnerstag, nur einmal)", () => {
    const ostern = [ft("2026-04-03", "Karfreitag"), ft("2026-04-06", "Ostermontag")];
    expect(vortage(ostern, "letzter")).toEqual(["2026-04-02"]);
    expect(vortage(ostern, "direkt")).toEqual(["2026-04-02"]);
  });
  it("Halbtag davor bleibt allein (kein zusätzlicher Vortag)", () => {
    const list = [ft("2026-12-24", "Heiligabend", -3.5), ft("2026-12-25", "Weihnachten")];
    expect(vortage(list, "letzter")).toEqual([]);
    expect(vortage(list, "direkt")).toEqual([]);
  });
  it("Stunden 0 = aus, in jedem Modus", () => {
    expect(resolveHolidays([montag], 2026, 0, "letzter").some(f => String(f.id).startsWith("vortag"))).toBe(false);
  });
  it("createWorktime liest die Einstellung: Soll am Freitag vor dem Montagsfeiertag", () => {
    const base = { feiertage: [montag], ferienEntries: [], absences: [], timeEntries: [] };
    const emp = { id: "e", name: "A", pensum: 100, wochenstunden: 42 };
    const wt = (vortagModus?: "direkt" | "letzter") => createWorktime({ ...base, settings: { vortagStunden: 1, vortagModus } } as never, "2026-12-01");
    expect(wt().sollForDay(emp as never, "2026-05-22")).toBe(wt("direkt").sollForDay(emp as never, "2026-05-22"));
    expect(wt("letzter").sollForDay(emp as never, "2026-05-22")).toBeLessThan(wt("direkt").sollForDay(emp as never, "2026-05-22"));
  });
});
