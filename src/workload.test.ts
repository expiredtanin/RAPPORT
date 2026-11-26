// Tests für workload.ts: Wochen-Auslastung (verfügbar, erfasst, verplant, doppelt belegt).
import { describe, it, expect } from "vitest";
import { mondayOf, upsertResourceEntry, weeklyLoad } from "./workload";

const emp = { id: "e1", pensum: 100, wochenstunden: 40, eintrittsdatum: "2020-01-01" };
const base = { feiertage: [], ferienEntries: [], absences: [], timeEntries: [] };

describe("weeklyLoad", () => {
  it("Montag einer Woche", () => {
    expect(mondayOf("2026-11-26")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
  });
  it("kommende Woche: verfügbar 40 h; 100 % Mi–Fr = 24 h, dazu 50 % ab Fr → 4 h, Fr überbucht", () => {
    const [w] = weeklyLoad(base, emp, [{ dateFrom: "2026-12-02", dateTo: "2026-12-04", pensum: 100 }, { dateFrom: "2026-12-04", dateTo: "2026-12-10", pensum: 50 }], ["2026-11-30"], "2026-11-26");
    expect(w.available).toBe(40);
    expect(w.planned).toBe(28);
    expect(w.overbooked).toBe(1);
    expect(w.ist).toBe(0);
    expect(w.past).toBe(false);
  });
  it("Ferien und Teilzeit verringern verfügbar und verplant", () => {
    const data = { ...base, ferienEntries: [{ id: "f", employeeId: "e1", dateFrom: "2026-12-03", dateTo: "2026-12-03", status: "approved" }] };
    const [w] = weeklyLoad(data as never, { ...emp, pensum: 50 }, [{ dateFrom: "2026-11-30", dateTo: "2026-12-06", pensum: 100 }], ["2026-11-30"], "2026-11-26");
    expect(w.available).toBe(16);   // 5 × 4 h − 4 h Ferien
    expect(w.planned).toBe(16);
  });
  it("laufende Woche: heute zählt als erfasst, verplant erst ab morgen (nicht doppelt)", () => {
    const data = { ...base, timeEntries: [{ id: "t", employeeId: "e1", date: "2026-11-26", minutes: 480 }] };
    const [w] = weeklyLoad(data as never, emp, [{ dateFrom: "2026-11-23", dateTo: "2026-11-27", pensum: 100 }], ["2026-11-23"], "2026-11-26");
    expect(w.ist).toBe(8);
    expect(w.planned).toBe(8);   // nur Freitag
  });
  it("vergangene Woche: erfasst zählt, nichts verplant", () => {
    const data = { ...base, timeEntries: [{ id: "t", employeeId: "e1", date: "2026-11-17", minutes: 300 }] };
    const [w] = weeklyLoad(data as never, emp, [{ dateFrom: "2026-11-16", dateTo: "2026-11-20", pensum: 100 }], ["2026-11-16"], "2026-11-26");
    expect(w.past).toBe(true);
    expect(w.ist).toBe(5);
    expect(w.planned).toBe(0);
    expect(w.available).toBe(40);
  });
});

describe("upsertResourceEntry", () => {
  const e = { id: "r1", employeeId: "e1", label: "Werkplanung", projectId: null, dateFrom: "2026-11-30", dateTo: "2026-12-18", pensum: 80 };
  it("offenes Fenster setzt eine fremde Änderung nicht zurück (nur eigene Felder)", () => {
    const current = [{ ...e, pensum: 70 }];
    const out = upsertResourceEntry(current, { ...e, note: "neu" }, e);
    expect(out).toEqual([{ ...e, pensum: 70, note: "neu" }]);
  });
  it("gleiches Feld: eigener Wert gewinnt; neuer Einsatz wird angehängt", () => {
    expect(upsertResourceEntry([{ ...e, pensum: 70 }], { ...e, pensum: 50 }, e)[0].pensum).toBe(50);
    expect(upsertResourceEntry([e], { ...e, id: "r2" }, null).map(x => x.id)).toEqual(["r1", "r2"]);
  });
});
