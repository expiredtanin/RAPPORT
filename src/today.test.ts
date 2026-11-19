// Tests für «Heute»: Stoppuhr → Zeiteintrag, offene Pendenzen, Agenda, Phasenleiste.
import { describe, expect, it } from "vitest";
import { formatElapsed, openTasks, parseTimer, phaseStrip, timerToEntry, weekAgenda } from "./today";
import type { AppData, Protocol } from "./types";

describe("Stoppuhr", () => {
  const t = { employeeId: "e1", projectId: "p1", phaseId: "52", description: "Bauleitung", start: new Date(2026, 10, 19, 7, 30).toISOString() };
  it("macht aus der Laufzeit einen Zeiteintrag (lokale Zeit)", () => {
    const e = timerToEntry(t, new Date(2026, 10, 19, 9, 12, 20), "x")!;
    expect(e).toMatchObject({ date: "2026-11-19", startTime: "07:30", endTime: "09:12", minutes: 102, phaseId: "52", employeeId: "e1", projectId: "p1" });
  });
  it("unter einer Minute → nichts", () => {
    expect(timerToEntry(t, new Date(2026, 10, 19, 7, 30, 20), "x")).toBeNull();
  });
  it("über Mitternacht: endet um 23:59 des Starttags", () => {
    const e = timerToEntry({ ...t, start: new Date(2026, 10, 19, 22, 0).toISOString() }, new Date(2026, 10, 20, 1, 0), "x")!;
    expect(e.endTime).toBe("23:59"); expect(e.minutes).toBe(119); expect(e.date).toBe("2026-11-19");
  });
  it("Anzeige und robustes Einlesen", () => {
    expect(formatElapsed((1 * 3600 + 42 * 60 + 10) * 1000)).toBe("01:42:10");
    expect(parseTimer("kaputt")).toBeNull();
    expect(parseTimer(JSON.stringify({ projectId: "p", employeeId: "e", start: "nein" }))).toBeNull();
    expect(parseTimer(JSON.stringify(t))?.projectId).toBe("p1");
  });
});

const task = (id: string, text: string, extra = {}) => ({ id, type: "aufgabe", text: `<p>${text}</p>`, responsible: "JR", dueDateType: "datum", dueDate: "2026-11-27", status: "offen", ...extra });
const protocols = [
  { id: "a", title: "BS 1", date: "2026-11-01", projectId: "p1", nummer: "BS-01", nextDate: "2026-11-25", traktanden: [{ id: "t", nr: "1", title: "", items: [task("1", "Pläne Attika"), task("2", "Muster bestellen", { responsible: "LM" }), task("3", "Offerte prüfen", { dueDate: "2026-11-10" })] }] },
  { id: "b", title: "BS 2", date: "2026-11-15", projectId: "p1", nummer: "BS-02", traktanden: [{ id: "t", nr: "1", title: "", items: [task("4", "Pläne Attika", { status: "erledigt" }), task("5", "Offerte prüfen", { dueDate: "2026-11-10" })] }] },
] as unknown as Protocol[];
const employees = [{ id: "e1", name: "Julian Roth" }, { id: "e2", name: "Laura Meier" }];

describe("openTasks", () => {
  it("nimmt die neueste Kopie, lässt Erledigtes weg, überfällig zuerst", () => {
    const r = openTasks(protocols, employees, "2026-11-19");
    expect(r.map(x => x.label)).toEqual(["Offerte prüfen", "Muster bestellen"]);
    expect(r[0]).toMatchObject({ overdue: true, protocolId: "b", entryId: "5", assigneeId: "e1" });
  });
  it("filtert auf eine Person", () => {
    expect(openTasks(protocols, employees, "2026-11-19", { employeeId: "e2" }).map(x => x.label)).toEqual(["Muster bestellen"]);
  });
});

describe("weekAgenda", () => {
  const data = {
    projects: [{ id: "p1", name: "Limmatfeld", status: "aktiv", schedule: { items: [
      { id: "m", label: "Abgabe Attika", kind: "milestone", marker: "abgabe", start: "2026-11-27", end: "2026-11-27", deps: [] },
      { id: "s", label: "Bausitzung", kind: "task", variant: "serie", repeatDays: 14, start: "2026-11-11", end: "2026-12-31", deps: [] },
      { id: "x", label: "Später", kind: "milestone", start: "2027-01-10", end: "2027-01-10", deps: [] },
    ] } }],
    protocols, employees,
    ferienEntries: [{ id: "f", employeeId: "e2", dateFrom: "2026-11-20", dateTo: "2026-11-21", status: "approved" }],
  } as unknown as AppData;
  it("sammelt Termine, Sitzungen (ohne Doppel) und Ferien im Zeitraum", () => {
    const r = weekAgenda(data, "2026-11-19", 10, { employeeId: "e1" });
    expect(r.map(x => `${x.date} ${x.kind} ${x.label}`)).toEqual([
      "2026-11-20 ferien Laura Meier abwesend bis 21.11.",
      "2026-11-25 sitzung Bausitzung",
      "2026-11-27 termin Abgabe Attika",
    ]);
  });
});

describe("phaseStrip", () => {
  it("aktuelle Phase = Phase des neuesten Eintrags", () => {
    const r = phaseStrip({ enabledPhases: ["31", "32", "33"], status: "aktiv" }, [{ phaseId: "31", date: "2026-01-01" }, { phaseId: "32", date: "2026-03-01" }]);
    expect(r.map(p => p.state)).toEqual(["done", "current", "open"]);
  });
});
