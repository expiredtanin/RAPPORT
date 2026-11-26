// Tests für das Terminprogramm (schedule.ts): Mitrutschen, Kreise, kritischer Weg, Vorlagen, Soll/Ist.

import { describe, expect, it } from "vitest";
import {
  addDays, formatDuration, constructionTemplate, criticalPath, dayNum, dependencyConflicts, durationDays, groupSpans,
  phaseProgress, planningTemplate, scheduleOf, shiftSuccessors, wouldCreateCycle, baselineDelta, overlapDays, blockedDays,
  markerOf, glyphOf, seriesDates, breaksOf,
  emptyRow, isPlaced, moveRow, stepRow, displayOrder, rowDropTarget, drawnSpan, dayAtX, removeScheduleItem, restoreScheduleItem, scheduleRange,
  entryDue, isoWeekMonday, protocolSuggestions, suggestionToItem, linkedEntry, isDone, setLinkedStatus, seriesSessions, upcomingItems, baselineChanges,
} from "./schedule";
import { SIA_PHASES } from "./constants";
import type { Protocol, ScheduleItem, TimeEntry } from "./types";

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
    expect([5, 14, 16, 84].map(formatDuration)).toEqual(["5 T", "2 W", "2 W 2 T", "12 W"]);
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

  it("Vorgänger ohne Datum hebt die Verschiebung durch einen echten nicht auf (Runde 30)", () => {
    const items = [task("a", "2026-03-01", "2026-03-10"), task("leer", "", ""), task("b", "2026-03-05", "2026-03-06", [{ fromId: "a" }, { fromId: "leer" }])];
    const out = shiftSuccessors(items);
    expect(out[2].start > "2026-03-10").toBe(true);
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
    expect(by("Baueingabe")).toMatchObject({ kind: "milestone", marker: "abgabe" });
    expect(by("Baubewilligung").marker).toBe("entscheid");
    expect(by("Bewilligungsverfahren").variant).toBe("extern");
    expect(dayNum(by("Bauprojekt").start)).toBe(dayNum(by("Vorprojekt").end) + 1);
    expect(by("Ausführungsprojekt").start).toBe(by("Ausschreibung").start);
    expect(by("Ausführung").start).toBe(by("Vergabe / Baubeginn").start);
    expect(dependencyConflicts(items)).toEqual([]);
  });

  it("Bau: BKP-Abfolge ohne Konflikte, Gruppen in Reihenfolge", () => {
    const items = constructionTemplate("2026-04-06", idGen());
    expect(items.every(i => i.track === "bau")).toBe(true);
    expect(dependencyConflicts(items)).toEqual([]);
    expect(groupSpans(items).map(g => g.group)).toEqual(["Vorbereitung", "Rohbau", "Installationen", "Ausbau", "Umgebung", "Bausitzungen", "Abschluss"]);
    expect(items.find(i => i.variant === "serie")).toMatchObject({ marker: "sitzung", label: "Bausitzung (alle 2 Wochen)" });
    expect(items.find(i => i.label === "Bauabnahme")!.marker).toBe("abnahme");
    expect(items.find(i => i.bkp === "211")!.start).toBe("2026-04-20");
  });
});

describe("scheduleOf, Soll/Ist, Vergleich", () => {
  it("macht aus fehlenden Daten ein leeres Programm", () => {
    expect(scheduleOf(undefined)).toEqual({ items: [], baselines: {}, breaks: [], dismissed: [] });
    expect(scheduleOf({ schedule: null })).toEqual({ items: [], baselines: {}, breaks: [], dismissed: [] });
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

describe("Symbole, Terminserien, Unterbrüche", () => {
  it("markerOf/glyphOf: Standard Meilenstein, Serie Sitzung, Balken ohne Zeichen", () => {
    expect(markerOf({ kind: "milestone" })).toBe("meilenstein");
    expect(markerOf({ kind: "milestone", marker: "abgabe" })).toBe("abgabe");
    expect(markerOf({ kind: "task", variant: "serie" })).toBe("sitzung");
    expect(glyphOf({ kind: "milestone", marker: "abnahme" })).toBe("★");
    expect(glyphOf({ kind: "task", variant: "serie" })).toBe("●");
    expect(glyphOf({ kind: "task" })).toBe("");
  });

  it("seriesDates: alle n Tage ab Beginn bis Ende", () => {
    expect(seriesDates({ start: "2026-01-05", end: "2026-02-05", repeatDays: 14 })).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(seriesDates({ start: "2026-01-05", end: "2026-01-20" })).toEqual(["2026-01-05", "2026-01-19"]);
  });

  it("breaksOf: ohne Programm gilt für beide", () => {
    const s = { items: [], breaks: [
      { id: "a", label: "Bauferien", start: "2026-07-13", end: "2026-07-31", track: "bau" as const },
      { id: "b", label: "Betriebsferien", start: "2026-12-24", end: "2027-01-03" },
    ] };
    expect(breaksOf(s, "bau").map(b => b.id)).toEqual(["a", "b"]);
    expect(breaksOf(s, "planung").map(b => b.id)).toEqual(["b"]);
    expect(scheduleOf({ schedule: { items: [] } }).breaks).toEqual([]);
  });
});

describe("Protokolle ↔ Terminprogramm", () => {
  const proto = (id: string, date: string, items: Protocol["traktanden"][number]["items"], extra: Partial<Protocol> = {}): Protocol =>
    ({ id, title: "", type: "Baubesprechung", date, projectId: "p", nummer: id, participants: [], traktanden: [{ id: `t-${id}`, nr: "1", title: "Termine", items }], ...extra }) as Protocol;
  const emp = [{ id: "e1", name: "Julian Roth" }, { id: "e2", name: "Laura Meier" }];

  it("isoWeekMonday/entryDue: KW → Freitag, Datum direkt, ohne Frist null", () => {
    expect(isoWeekMonday(2027, 1)).toBe("2027-01-04");
    expect(isoWeekMonday(2026, 53)).toBe("2026-12-28");
    expect(entryDue({ dueDateType: "kw", dueKW: 12, dueYear: 2027 }, 2026)).toBe("2027-03-26");
    expect(entryDue({ dueDateType: "datum", dueDate: "2027-02-01" }, 2026)).toBe("2027-02-01");
    expect(entryDue({ dueDateType: "kw", dueKW: "" }, 2026)).toBeNull();
  });

  it("Vorschläge: offene Aufgaben mit Frist, Beschlüsse, nächste Sitzung; Folgeprotokoll-Kopien nur einmal", () => {
    const a = { id: "a1", type: "aufgabe", text: "<p>Muster Klinker bestellen</p>", responsible: "JR", dueDateType: "kw", dueKW: 2, dueYear: 2027, status: "offen" };
    const protocols = [
      proto("P1", "2026-12-01", [a, { id: "b1", type: "beschluss", text: "Variante B", date: "2026-12-01" }, { id: "i1", type: "info", text: "Rohbau im Plan" }], { nextDate: "2026-12-15" }),
      // Folgeprotokoll: gleiche Aufgabe kopiert (neue Id), Frist verschoben
      proto("P2", "2026-12-15", [{ ...a, id: "a2", dueKW: 4 }], { nextDate: "2027-01-12" }),
      proto("X", "2026-12-15", [a], { projectId: "anderes" }),
    ];
    const s = protocolSuggestions({ id: "p" }, protocols, emp, "2026-12-10");
    expect(s.map(x => `${x.kind}:${x.date}`)).toEqual(["beschluss:2026-12-01", "sitzung:2026-12-15", "aufgabe:2027-01-29", "sitzung:2027-01-12"].sort((p, q) => p.slice(-10).localeCompare(q.slice(-10))));
    const auf = s.find(x => x.kind === "aufgabe")!;
    expect(auf).toMatchObject({ label: "Muster Klinker bestellen", assigneeId: "e1", entryId: "a2", track: "bau" });
    // Übernommen → kein Vorschlag mehr; ausgeblendet ebenso
    const item = suggestionToItem(auf, "bau", "n1");
    expect(item).toMatchObject({ kind: "milestone", marker: "abgabe", start: "2027-01-29", group: "Aus Protokollen", assigneeId: "e1" });
    const rest = protocolSuggestions({ id: "p", schedule: { items: [item], dismissed: ["sitzung:2026-12-15"] } }, protocols, emp, "2026-12-10");
    expect(rest.map(x => x.kind).sort()).toEqual(["beschluss", "sitzung"]);
    // Erledigte Aufgabe im neuesten Protokoll → kein Vorschlag
    const done = [...protocols.slice(0, 2), proto("P3", "2027-01-12", [{ ...a, id: "a3", status: "erledigt" }])];
    expect(protocolSuggestions({ id: "p" }, done, emp, "2026-12-10").some(x => x.kind === "aufgabe")).toBe(false);
  });

  it("Status: massgebend ist die Stelle im neuesten Protokoll, Setzen schreibt dorthin", () => {
    const a = { id: "a1", type: "aufgabe", text: "Muster bestellen", dueDateType: "datum", dueDate: "2027-01-10", status: "offen" };
    const protocols = [proto("P1", "2026-12-01", [a]), proto("P2", "2026-12-15", [{ ...a, id: "a2" }])];
    const item = suggestionToItem(protocolSuggestions({ id: "p" }, protocols, emp, "2026-12-01")[0], "bau", "n1");
    expect(linkedEntry(item.source, protocols, "p")!.protocol.id).toBe("P2");
    expect(isDone(item, protocols, "p")).toBe(false);
    const next = setLinkedStatus(protocols, "p", item.source!, true);
    expect(next[1].traktanden[0].items[0].status).toBe("erledigt");
    expect(next[0]).toBe(protocols[0]);
    expect(isDone(item, next, "p")).toBe(true);
  });

  it("seriesSessions: Protokoll in ±3 Tagen = gehalten, sonst kommend/ohne", () => {
    const serie = { start: "2026-12-01", end: "2026-12-29", repeatDays: 14 } as ScheduleItem;
    const r = seriesSessions(serie, [proto("P1", "2026-12-02", [])], "p", "2026-12-20");
    expect(r.map(x => x.state)).toEqual(["gehalten", "ohne", "kommend"]);
    expect(r[0].protocol!.id).toBe("P1");
  });

  it("upcomingItems und baselineChanges", () => {
    const items = [task("a", "2026-12-01", "2026-12-20"), task("b", "2027-02-01", "2027-02-10"), ms("m", "2026-12-24")];
    expect(upcomingItems(items, "2026-12-15", 28).map(i => i.id)).toEqual(["a", "m"]);
    const ch = baselineChanges(items, { savedAt: "", items: [{ id: "a", start: "2026-12-01", end: "2026-12-10" }, { id: "m", start: "2026-12-24", end: "2026-12-24" }] });
    expect(ch.map(c => [c.item.id, c.days])).toEqual([["a", 10]]);
  });
});


describe("Zeilen bearbeiten (Editor)", () => {
  const g = (it: ScheduleItem, group: string): ScheduleItem => ({ ...it, group });
  const ids = (list: ScheduleItem[]) => list.map(x => x.id);

  it("leere Zeilen zählen nirgends mit, ausser im Editor", () => {
    const row = emptyRow("planung", "e1", { group: "Rohbau", phaseId: "31" });
    expect(row).toMatchObject({ id: "e1", label: "", kind: "task", track: "planung", group: "Rohbau", phaseId: "31", start: "", end: "" });
    expect(isPlaced(row)).toBe(false);
    const project = { schedule: { items: [task("a", "2026-01-05", "2026-01-09"), row] } };
    expect(ids(scheduleOf(project).items)).toEqual(["a"]);
    expect(ids(scheduleOf(project, true).items)).toEqual(["a", "e1"]);
    expect(scheduleRange([row])).toBeNull();
    expect(scheduleRange([row, task("a", "2026-01-05", "2026-01-09")])).toEqual({ start: "2026-01-05", end: "2026-01-09" });
    expect(groupSpans([g(row, "X")])).toEqual([{ group: "X", start: "", end: "", items: [g(row, "X")] }]);
    expect(emptyRow("bau", "e2", { group: "G", phaseId: "31" }).phaseId).toBeUndefined();
  });

  it("moveRow verschiebt vor/nach eine Zeile und übernimmt deren Gruppe", () => {
    const items = [g(task("a", "2026-01-05", "2026-01-09"), "A"), g(task("b", "2026-01-05", "2026-01-09"), "A"), g(task("c", "2026-01-05", "2026-01-09"), "B")];
    expect(ids(moveRow(items, "a", { id: "b", where: "after" }))).toEqual(["b", "a", "c"]);
    expect(ids(moveRow(items, "c", { id: "a", where: "before" }))).toEqual(["c", "a", "b"]);
    expect(moveRow(items, "c", { id: "a", where: "before" })[0].group).toBe("A");
    const intoB = moveRow(items, "a", { group: "B" });
    expect(ids(intoB)).toEqual(["b", "a", "c"]);
    expect(intoB.find(x => x.id === "a")!.group).toBe("B");
    expect(moveRow(items, "x", { id: "a", where: "before" })).toBe(items);
    expect(moveRow(items, "a", { id: "a", where: "before" })).toBe(items);
  });

  it("stepRow folgt der angezeigten Reihenfolge und wechselt am Rand die Gruppe", () => {
    // gespeichert gemischt: A, B, A → angezeigt A(a, c), B(b)
    const items = [g(task("a", "2026-01-05", "2026-01-09"), "A"), g(task("b", "2026-01-05", "2026-01-09"), "B"), g(task("c", "2026-01-05", "2026-01-09"), "A")];
    expect(ids(displayOrder(items))).toEqual(["a", "c", "b"]);
    expect(ids(displayOrder(stepRow(items, "c", -1)))).toEqual(["c", "a", "b"]);
    const up = stepRow(items, "b", -1); // erste in B → letzte in A
    expect(ids(displayOrder(up))).toEqual(["a", "c", "b"]);
    expect(up.find(x => x.id === "b")!.group).toBe("A");
    const down = stepRow(items, "c", 1);
    expect(ids(displayOrder(down))).toEqual(["a", "c", "b"]); // jetzt erste Zeile in B
    expect(down.find(x => x.id === "c")!.group).toBe("B");
    expect(stepRow(items, "a", -1)).toBe(items); // schon oben
    expect(stepRow(items, "b", 1)).toBe(items);  // schon unten
  });

  it("rowDropTarget: obere/untere Hälfte, Gruppenkopf, unterhalb der letzten Zeile", () => {
    const rows = [{ group: "A" }, { id: "a" }, { id: "b" }, { group: "B" }, { id: "c" }];
    expect(rowDropTarget(rows, 1.2, "c")).toEqual({ id: "a", where: "before" });
    expect(rowDropTarget(rows, 1.7, "c")).toEqual({ id: "a", where: "after" });
    expect(rowDropTarget(rows, 0.3, "c")).toEqual({ group: "A" });
    expect(rowDropTarget(rows, 3.6, "a")).toEqual({ group: "B" });
    expect(rowDropTarget(rows, 3.2, "a")).toEqual({ id: "b", where: "after" });
    expect(rowDropTarget(rows, 9, "a")).toEqual({ id: "c", where: "after" });
    expect(rowDropTarget(rows, 2.5, "b")).toBeNull();
    expect(rowDropTarget([], 1, "a")).toBeNull();
  });

  it("drawnSpan: Ziehen → Datum, in beide Richtungen, mit Wochenraster", () => {
    const mon = dayNum("2026-11-16"); // Montag
    expect(drawnSpan(mon + 2, mon + 9)).toEqual({ start: "2026-11-18", end: "2026-11-25" });
    expect(drawnSpan(mon + 9, mon + 2)).toEqual({ start: "2026-11-18", end: "2026-11-25" });
    expect(drawnSpan(mon + 2, mon + 9, 7)).toEqual({ start: "2026-11-16", end: "2026-11-29" });
    expect(drawnSpan(mon + 3, mon + 3, 7)).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(dayAtX(0, mon, 8)).toBe(mon);
    expect(dayAtX(7.9, mon, 8)).toBe(mon);
    expect(dayAtX(8, mon, 8)).toBe(mon + 1);
    expect(dayAtX(-1, mon, 8)).toBe(mon - 1);
  });

  it("Löschen und Rückgängig: alte Stelle, Pfeile zurück, spätere Änderungen bleiben", () => {
    const before = [task("a", "2026-01-05", "2026-01-09"), task("b", "2026-01-12", "2026-01-16", [{ fromId: "a", lagDays: 2 }]), task("c", "2026-01-19", "2026-01-23", [{ fromId: "b" }])];
    const after = removeScheduleItem(before, "b");
    expect(ids(after)).toEqual(["a", "c"]);
    expect(after[1].deps).toEqual([]);
    // seither: c umbenannt, neue Zeile d
    const current = [after[0], { ...after[1], label: "C neu" }, task("d", "2026-02-02", "2026-02-06")];
    const restored = restoreScheduleItem(current, before, "b");
    expect(ids(restored)).toEqual(["a", "b", "c", "d"]);
    expect(restored[2]).toMatchObject({ label: "C neu", deps: [{ fromId: "b" }] });
    expect(restoreScheduleItem(restored, before, "b")).toBe(restored); // schon da
  });
});
