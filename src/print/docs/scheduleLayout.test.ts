// Tests für Blatt, Ausschnitt und Massstab beim Druck eines Terminprogramms (scheduleLayout.ts).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE_PRINT, PX_PER_MM, movePrintWindowTo, printScaleLabel, printUsableMm, schedulePrintLayout, shiftPrintWindow, zoomPrint,
  type SchedulePrintOptions,
} from "./scheduleLayout";
import { dayNum } from "../../schedule";
import type { ScheduleItem } from "../../types";

const task = (id: string, start: string, end: string): ScheduleItem => ({ id, label: id, kind: "task", track: "planung", start, end });
const items = [task("a", "2026-01-05", "2026-03-29"), task("b", "2026-04-01", "2026-12-20"), { ...task("leer", "", ""), start: "", end: "" }];
const m = { top: 20, right: 20, bottom: 20, left: 20 };
const span = (l: { from: string; to: string }) => dayNum(l.to) - dayNum(l.from) + 1;

describe("schedulePrintLayout", () => {
  it("eingepasst: ganzes Programm (+2 Wochen) auf die Blattbreite", () => {
    const l = schedulePrintLayout(items, DEFAULT_SCHEDULE_PRINT, m);
    expect(l).toMatchObject({ from: "2026-01-05", to: "2027-01-03", cropped: false, mmPerDay: null, pageW: 420, pageH: 297 });
    expect(l.full).toEqual({ start: "2026-01-05", end: "2027-01-03" });
    expect(l.dayWidth * span(l)).toBeCloseTo(printUsableMm("A3", m) * PX_PER_MM, 3);
  });

  it("A-Format mit Massstab: Ende aus der Blattbreite, nur berührte Elemente", () => {
    const opts: SchedulePrintOptions = { paper: "A3", mmPerDay: 5, from: "2026-01-10", to: "" };
    const l = schedulePrintLayout(items, opts, m);
    expect(l.dayWidth).toBeCloseTo(5 * PX_PER_MM, 6);
    expect(span(l)).toBe(Math.floor(printUsableMm("A3", m) / 5));
    expect(l.cropped).toBe(true);
    expect(l.items.map(i => i.id)).toEqual(["a"]); // b beginnt erst nach dem Ausschnitt
    // gedruckter Zeitstrahl passt aufs Blatt
    expect(span(l) * l.dayWidth).toBeLessThanOrEqual(printUsableMm("A3", m) * PX_PER_MM);
  });

  it("nach Bedarf: Breite = Zeitraum × Massstab, ohne Massstab 1 Woche = 20 mm", () => {
    const l = schedulePrintLayout(items, { paper: "bedarf", mmPerDay: 0, from: "", to: "" }, m);
    expect(l.mmPerDay).toBeCloseTo(20 / 7, 6);
    expect(l.pageH).toBeNull();
    expect(l.pageW).toBeGreaterThan(297);
  });
});

describe("Ausschnitt verschieben und zoomen", () => {
  it("shiftPrintWindow hält die Länge (eingepasst: from+to, Massstab: nur from)", () => {
    const fit = schedulePrintLayout(items, DEFAULT_SCHEDULE_PRINT, m);
    const o1 = shiftPrintWindow(DEFAULT_SCHEDULE_PRINT, fit, 14);
    expect(o1).toMatchObject({ from: "2026-01-19", to: "2027-01-17" });
    expect(span(schedulePrintLayout(items, o1, m))).toBe(span(fit));
    const scaledOpts: SchedulePrintOptions = { paper: "A4", mmPerDay: 5, from: "2026-03-01", to: "" };
    const sl = schedulePrintLayout(items, scaledOpts, m);
    const o2 = shiftPrintWindow(scaledOpts, sl, -7);
    expect(o2).toMatchObject({ from: "2026-02-22", to: "" });
    expect(span(schedulePrintLayout(items, o2, m))).toBe(span(sl));
    expect(shiftPrintWindow(scaledOpts, sl, 0)).toBe(scaledOpts);
    expect(movePrintWindowTo(scaledOpts, sl, "2026-06-01").from).toBe("2026-06-01");
  });

  it("zoomPrint: stärker = nächster Massstab um die Mitte, schwächer bis zurück auf «Alles»", () => {
    const fit = schedulePrintLayout(items, DEFAULT_SCHEDULE_PRINT, m);
    const usable = printUsableMm("A3", m);
    const z1 = zoomPrint(DEFAULT_SCHEDULE_PRINT, fit, 1, usable);
    expect(z1.mmPerDay).toBeGreaterThan(fit.dayWidth / PX_PER_MM);
    const l1 = schedulePrintLayout(items, z1, m);
    // Mitte bleibt (±1 Tag)
    const mid = (l: { from: string; to: string }) => (dayNum(l.from) + dayNum(l.to)) / 2;
    expect(Math.abs(mid(l1) - mid(fit))).toBeLessThanOrEqual(1);
    const z2 = zoomPrint(z1, l1, 1, usable);
    expect(z2.mmPerDay).toBeGreaterThan(z1.mmPerDay);
    // zurück: einen Schritt schwächer, dann wieder ganz eingepasst
    const back = zoomPrint(z2, schedulePrintLayout(items, z2, m), -1, usable);
    expect(back.mmPerDay).toBeCloseTo(z1.mmPerDay, 6);
    expect(zoomPrint(z1, l1, -1, usable)).toMatchObject({ mmPerDay: 0, from: "", to: "" });
    // stärkster Massstab: bleibt
    const max: SchedulePrintOptions = { paper: "A3", mmPerDay: 12, from: "2026-05-01", to: "" };
    expect(zoomPrint(max, schedulePrintLayout(items, max, m), 1, usable)).toBe(max);
    // nach Bedarf: nur der Massstab
    const bed: SchedulePrintOptions = { paper: "bedarf", mmPerDay: 20 / 7, from: "", to: "" };
    expect(zoomPrint(bed, schedulePrintLayout(items, bed, m), 1, usable)).toMatchObject({ mmPerDay: 30 / 7, from: "", to: "" });
  });

  it("printScaleLabel", () => {
    expect(printScaleLabel(20 / 7)).toBe("1 Woche = 20 mm");
    expect(printScaleLabel(1)).toBe("1 Woche ≈ 7 mm");
  });
});
