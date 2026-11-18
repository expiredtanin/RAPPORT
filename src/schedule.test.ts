// Tests für das Terminprogramm (schedule.ts): Mitrutschen, Kreise, kritischer Weg, Vorlagen, Soll/Ist.

import { describe, expect, it } from "vitest";
import {
  addDays, constructionTemplate, criticalPath, dayNum, dependencyConflicts, durationDays, groupSpans,
  phaseProgress, planningTemplate, scheduleOf, shiftSuccessors, wouldCreateCycle, baselineDelta, overlapDays, blockedDays,
} from "./schedule";
import { SIA_PHASES } from "./constants";
import type { ScheduleItem, TimeEntry } from "./types";

const task = (id: string, start: string, end: string, deps: ScheduleItem["deps"] = []): ScheduleItem =>
  ({ id, label: id, kind: "task", track: "planung", start, end, deps });
const ms = (id: string, date: string, deps: ScheduleItem["deps"] = []): ScheduleItem =>
  ({ id, label: id, kind: "milestone", track: "planung", start: date, end: date, deps });
const idGen = () => { let n = 0; return () => `id${++n}`; };

describe("Datum und Dauer", () => {
  it("rechnet in Kalendertagen, beide Tage inklusive", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(dayNum("2026-03-30") - dayNum("2026-03-28")).toBe(2); // Zeitumstellung egal (UTC)
    expect(durationDays(task("a", "2026-01-05", "2026-01-09"))).toBe(5);
    expect(durationDays(ms("m", "2026-01-05"))).toBe(0);
  });
});

describe("shiftSuccessors", () => {
  it("rückt Nachfolger über die ganze Kette nach, Dauer bleibt", () => {
    const items = [
      task("a", "2026-01-05", "2026-01-16"),
      task("b", "2026-01-12", "2026-01-23", [{ fromId: "a" }]),           // beginnt zu früh
      ms("m", "2026-01-20", [{ fromId: "b" }]),
      task("c", "2026-02-02", "2026-02-06", [{ fromId: "m", lagDays: 7 }]),
    ];
    const out = shiftSuccessors(items);
    expect(out[0]).toBe(items[0]);
    expect(out[1]).toMatchObject({ start: "2026-01-17", end: "2026-01-28" });
    expect(out[2]).toMatchObject({ start: "2026-01-29", end: "2026-01-29" }); // Meilenstein am Tag nach b
    expect(out[3]).toMatchObject({ start: "2026-02-05", end: "2026-02-09" }); // m + 7 Tage
  });

  it("zieht nie nach vorne und lässt auto=false stehen", () => {
    const items = [
      task("a", "2026-01-05", "2026-01-09"),
      task("b", "2026-03-01", "2026-03-05", [{ fromId: "a" }]),
      task("c", "2026-01-06", "2026-01-07", [{ fromId: "a", auto: false }]),
    ];
    const out = shiftSuccessors(items);
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toBe(items[2]);
    expect(dependencyConflicts(out)).toEqual([{ fromId: "a", toId: "c" }]);
  });

  it("nimmt bei mehreren Vorgängern den spätesten", () => {
    const out = shiftSuccessors([
      task("a", "2026-01-05", "2026-01-09"),
      task("b", "2026-01-05", "2026-01-20"),
      task("c", "2026-01-01", "2026-01-02", [{ fromId: "a" }, { fromId: "b" }]),
    ]);
    expect(out[2]).toMatchObject({ start: "2026-01-21", end: "2026-01-22" });
  });
});

describe("wouldCreateCycle", () => {
  const items = [task("a", "2026-01-01", "2026-01-02"), task("b", "2026-01-03", "2026-01-04", [{ fromId: "a" }]),
    task("c", "2026-01-05", "2026-01-06", [{ fromId: "b" }])];
  it("erkennt Kreise und Selbstbezug", () => {
    expect(wouldCreateCycle(items, "c", "a")).toBe(true);
    expect(wouldCreateCycle(items, "a", "a")).toBe(true);
    expect(wouldCreateCycle(items, "a", "c")).toBe(false);
  });
});

describe("criticalPath", () => {
  it("findet die Kette ohne Puffer und den Puffer der übrigen", () => {
    const items = [
      task("a", "2026-01-01", "2026-01-10"),
      task("b", "2026-01-11", "2026-01-20", [{ fromId: "a" }]),
      task("x", "2026-01-11", "2026-01-15", [{ fromId: "a" }]),   // 5 Tage Puffer bis zum Ende von b
      ms("end", "2026-01-21", [{ fromId: "b" }, { fromId: "x" }]),
    ];
    const { critical, float } = criticalPath(items);
    expect([...critical].sort()).toEqual(["a", "b", "end"]);
    expect(float.get("x")).toBe(5);
  });

  it("leer bei leerer Liste", () => {
    expect(criticalPath([]).critical.size).toBe(0);
  });
});

describe("Vorlagen", () => {
  it("Planung: Phasen verkettet, Meilensteine dazwischen, 51 parallel zu 41", () => {
    const items = planningTemplate({ enabledPhases: ["31", "32", "33", "41", "51", "52"] }, SIA_PHASES, "2026-01-05", idGen());
    const by = (label: string) => items.find(i => i.label === label)!;
    expect(items.every(i => i.track === "planung")).toBe(true);
    expect(by("Vorprojekt")).toMatchObject({ start: "2026-01-05", end: "2026-03-01", phaseId: "31" }); // 8 Wochen
    expect(by("Baueingabe").kind).toBe("milestone");
    expect(dayNum(by("Bauprojekt").start)).toBe(dayNum(by("Vorprojekt").end) + 1);
    expect(by("Ausführungsprojekt").start).toBe(by("Ausschreibung").start);
    expect(by("Ausführung").start).toBe(by("Vergabe / Baubeginn").start);
    expect(dependencyConflicts(items)).toEqual([]);
  });

  it("Bau: BKP-Abfolge ohne Konflikte, Gruppen in Reihenfolge", () => {
    const items = constructionTemplate("2026-04-06", idGen());
    expect(items.every(i => i.track === "bau")).toBe(true);
    expect(dependencyConflicts(items)).toEqual([]);
    expect(groupSpans(items).map(g => g.group)).toEqual(["Vorbereitung", "Rohbau", "Installationen", "Ausbau", "Umgebung", "Abschluss"]);
    expect(items.find(i => i.bkp === "211")!.start).toBe("2026-04-20");
  });
});

describe("scheduleOf, Soll/Ist, Vergleich", () => {
  it("macht aus fehlenden Daten ein leeres Programm", () => {
    expect(scheduleOf(undefined)).toEqual({ items: [], baselines: {} });
    expect(scheduleOf({ schedule: null })).toEqual({ items: [], baselines: {} });
  });

  it("phaseProgress: Zeitanteil bis heute und Stunden gegen Phasenbudget", () => {
    const it = { ...task("a", "2026-01-01", "2026-01-10"), phaseId: "31" };
    const entries = [
      { projectId: "p", phaseId: "31", minutes: 600 }, { projectId: "p", phaseId: "32", minutes: 60 },
      { projectId: "q", phaseId: "31", minutes: 60 },
    ] as TimeEntry[];
    expect(phaseProgress(it, { id: "p", phasesBudget: [{ id: "31", hours: 40 }] }, entries, "2026-01-05"))
      .toEqual({ timePct: 50, hoursIst: 10, hoursSoll: 40, hoursPct: 25 });
    expect(phaseProgress(it, { id: "p" }, entries, "2025-12-01")!.hoursPct).toBeNull();
    expect(phaseProgress(task("b", "2026-01-01", "2026-01-02"), { id: "p" }, entries, "2026-01-05")).toBeNull();
  });

  it("baselineDelta: Verschiebung des Endes in Tagen", () => {
    const base = { items: [{ id: "a", end: "2026-01-10" }] };
    expect(baselineDelta(task("a", "2026-01-01", "2026-01-14"), base)).toBe(4);
    expect(baselineDelta(task("b", "2026-01-01", "2026-01-14"), base)).toBeNull();
  });
});

describe("Auslastung", () => {
  it("zählt Tage mit Überschneidungen und Aufgaben während Abwesenheiten", () => {
    const tasks = [{ start: "2026-01-01", end: "2026-01-10" }, { start: "2026-01-08", end: "2026-01-12" }, { start: "2026-01-09", end: "2026-01-09" }];
    expect(overlapDays(tasks)).toBe(3); // 8., 9., 10.
    expect(blockedDays(tasks, [{ start: "2026-01-10", end: "2026-01-20" }])).toBe(3); // 10.–12.
    expect(overlapDays([])).toBe(0);
  });
});
