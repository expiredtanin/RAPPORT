// Tests der Arbeitszeit-Rechnung. Sollwerte unabhängig nachgerechnet (Python, dateutil.easter, ohne App-Code):
// Ostern 2024–2030, Monats-Soll 2026 mit der Zürcher Vorlage, Ferienanteile nach Kalendertagen.
import { describe, expect, it } from "vitest";
import { createWorktime, easterSunday, employedShareOfYear, overtimeHourlyRate, resolveHolidays, swissHolidayTemplate, vacationWeeks, type WorkData } from "./worktime";
import type { Absence, Feiertag, FerienEntry, OvertimeClosing, TimeEntry } from "./types";

const template = (): Feiertag[] => swissHolidayTemplate([], 2024, 2030).map((f, i) => ({ ...f, id: `f${i}` }));
const data = (extra: Partial<WorkData> = {}): WorkData => ({ feiertage: template(), ferienEntries: [], absences: [], timeEntries: [], uberstundenAbschluss: [], ...extra });
const months = (wt: ReturnType<typeof createWorktime>, emp: Parameters<ReturnType<typeof createWorktime>["month"]>[0], year: number) =>
  Array.from({ length: 12 }, (_, m) => Math.round(wt.month(emp, year, m, "2099-12-31").sollBrutto * 100) / 100);

describe("Feiertage", () => {
  it("Ostersonntag 2024–2030 (Referenz dateutil)", () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029, 2030].map(easterSunday))
      .toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01", "2030-04-21"]);
  });
  it("Vorlage: bewegliche Feiertage 2026 und keine Doppelten beim zweiten Laden", () => {
    const t = template();
    const d2026 = t.filter(f => f.date.startsWith("2026")).map(f => `${f.date} ${f.label}`);
    expect(d2026).toEqual(["2026-04-03 Karfreitag", "2026-04-06 Ostermontag", "2026-05-13 Auffahrt Vortag (Halbtag)", "2026-05-14 Auffahrt", "2026-05-25 Pfingstmontag"]);
    expect(swissHolidayTemplate(t, 2026, 2029)).toEqual([]);
    expect(swissHolidayTemplate(t, 2026, 2031).map(f => f.date)).toEqual(["2031-04-11", "2031-04-14", "2031-05-21", "2031-05-22", "2031-06-02"]);
  });
  it("Vortag −1 h nur an Werktagen ohne eigenen Feiertag; Neujahr des Folgejahrs zählt", () => {
    const onlyNewYear: Feiertag[] = [{ id: "n", date: "2000-01-01", label: "Neujahr", repeatsYearly: true, stundenDelta: 0 }];
    const fts = resolveHolidays(onlyNewYear, 2026);
    expect(fts.find(f => f.date === "2026-12-31")?.stundenDelta).toBe(-1); // Donnerstag vor Neujahr 2027
    expect(fts.find(f => f.date === "2025-12-31")).toBeUndefined();
    // Silvester als Halbtag definiert → kein zusätzlicher Vortag
    expect(resolveHolidays(template(), 2026).filter(f => f.date === "2026-12-31")).toHaveLength(1);
  });
});

describe("Soll", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 42, eintrittsdatum: "2020-01-01" };
  it("Monats-Soll 2026, 42 h, 100 % (Referenz)", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(months(wt, emp, 2026)).toEqual([168, 168, 184.8, 166, 147.7, 184.8, 192.2, 176.4, 184.8, 184.8, 176.4, 177.8]);
  });
  it("Teilzeit 40 %: Halbtage und Vortage anteilig (Referenz)", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(months(wt, { ...emp, pensum: 40 }, 2026)).toEqual([67.2, 67.2, 73.92, 66.4, 59.08, 73.92, 76.88, 70.56, 73.92, 73.92, 70.56, 71.12]);
  });
  it("Schaltjahr: Februar 2024 hat 21 Werktage", () => {
    expect(createWorktime(data(), "2024-12-31").month(emp, 2024, 1).sollBrutto).toBeCloseTo(176.4, 6);
  });
  it("kein Soll vor Eintritt, nach Austritt, am Wochenende und an ganzen Feiertagen", () => {
    const wt = createWorktime(data(), "2026-12-31");
    const e = { ...emp, eintrittsdatum: "2026-03-31", austrittsdatum: "2026-11-15" };
    expect(wt.sollBruttoForDay(e, "2026-03-30")).toBe(0);
    expect(wt.sollBruttoForDay(e, "2026-03-31")).toBeCloseTo(8.4);
    expect(wt.sollBruttoForDay(e, "2026-11-16")).toBe(0);
    expect(wt.month(e, 2026, 11).sollBrutto).toBe(0);
    expect(wt.sollBruttoForDay(e, "2026-04-03")).toBe(0); // Karfreitag
    expect(wt.sollBruttoForDay(e, "2026-04-02")).toBeCloseTo(7.4); // Gründonnerstag = Vortag
  });
  it("Pensum 0/leer gilt wie überall in der App als 100 %", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(wt.sollBruttoForDay({ id: "z", pensum: 0, wochenstunden: 40 }, "2026-03-03")).toBe(8);
  });
});

describe("Saldo", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 40, eintrittsdatum: "2026-03-02" };
  const te = (date: string, minutes: number): TimeEntry => ({ id: date, date, minutes, employeeId: "x", projectId: "p" });
  const entries = ["02", "03", "04", "05", "06", "09", "10", "11"].map(d => te(`2026-03-${d}`, 9 * 60));
  const abs: Absence[] = [{ id: "a", employeeId: "x", type: "arzt", date: "2026-03-10", startTime: "08:00", endTime: "09:00", status: "approved" }];
  const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-03-12", dateTo: "2026-03-13", status: "approved" }];
  const pay: OvertimeClosing[] = [{ id: "p", empId: "x", year: 2026, date: "2026-03-13", type: "payout", hoursSettled: 4, zuschlagPercent: 25, stundenlohn: 50, auszahlungBetrag: 250 }];

  it("Ist + Absenz (Teilabsenz mit ihrer Dauer) + Ferien − Soll, abzüglich Auszahlung", () => {
    const wt = createWorktime(data({ feiertage: [], timeEntries: entries, absences: abs, ferienEntries: fer, uberstundenAbschluss: pay }), "2026-03-13");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p).toMatchObject({ sollBrutto: 80, ferien: 16, soll: 64, ist: 72, absenz: 1, saldo: 9 });
    const o = wt.overtime(emp);
    expect(o.saldo).toBe(9); expect(o.paidOut).toBe(4); expect(o.balance).toBe(5);
    expect(wt.sollForDay(emp, "2026-03-12")).toBe(0);
  });
  it("Pendente und abgelehnte Absenzen zählen nicht; Änderungsantrag zählt mit den bisherigen Daten", () => {
    const ferChange: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-03-09", dateTo: "2026-03-09", status: "pending", originalData: { dateFrom: "2026-03-12", dateTo: "2026-03-13" } }];
    const wt = createWorktime(data({ feiertage: [], absences: [{ ...abs[0], status: "pending" }], ferienEntries: ferChange }), "2026-03-13");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p.absenz).toBe(0); expect(p.ferien).toBe(16);
    expect(wt.vacationYear(emp, 2026).beantragt).toBe(8);
  });
  it("Krankheit (ganztägig) in den Ferien: Ferientag nicht bezogen, keine Doppelgutschrift", () => {
    const sick: Absence[] = [{ id: "k", employeeId: "x", type: "krankheit", dateFrom: "2026-03-13", dateTo: "2026-03-13", status: "approved" }];
    const wt = createWorktime(data({ feiertage: [], ferienEntries: fer, absences: sick }), "2026-03-31");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p.ferien).toBe(8); expect(p.absenz).toBe(8);
    expect(wt.vacationYear(emp, 2026).bezogen).toBe(8);
  });
  it("Austritt beendet den Überstundensaldo", () => {
    const wt = createWorktime(data({ feiertage: [] }), "2026-12-31");
    expect(wt.overtime({ ...emp, austrittsdatum: "2026-03-06" }).sollBrutto).toBe(40);
  });
});

describe("Ferien", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 42, ferienWochen: 5, eintrittsdatum: "2020-01-01" };
  it("Bezug über Weihnachten: Heiligabend und Silvester nur halb", () => {
    const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-12-21", dateTo: "2026-12-31", status: "approved" }];
    const v = createWorktime(data({ ferienEntries: fer }), "2026-12-31").vacationYear(emp, 2026);
    expect(v.bezogen).toBe(60.2); // 6 × 8.4 + 2 × 4.9
    expect(v.rest).toBe(210 - 60.2);
  });
  it("Jahresübergreifende Ferien werden je Jahr gezählt", () => {
    const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-12-28", dateTo: "2027-01-08", status: "approved" }];
    const wt = createWorktime(data({ ferienEntries: fer }), "2026-11-20");
    expect(wt.vacationYear(emp, 2026).geplant).toBe(30.1); // 28.–30. (3 × 8.4) + 31. halb (4.9)
    expect(wt.vacationYear(emp, 2027).geplant).toBe(42); // 4.–8.1.
  });
  it("Anteil nach Kalendertagen je Monat (Referenz), Eintritt am 31., Austritt, Schaltjahr", () => {
    expect(employedShareOfYear({ eintrittsdatum: "2026-03-01" }, 2026)).toBeCloseTo(0.833333, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2026-01-31" }, 2026)).toBeCloseTo(0.919355, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2023-04-01", austrittsdatum: "2026-11-15" }, 2026)).toBeCloseTo(0.875, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2024-02-29" }, 2024)).toBeCloseTo(0.836207, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2027-03-01" }, 2026)).toBe(0);
    const sara = { id: "s", pensum: 90, wochenstunden: 42, ferienWochen: 5, eintrittsdatum: "2023-04-01", austrittsdatum: "2026-11-15" };
    expect(createWorktime(data(), "2026-11-20").vacationYear(sara, 2026).anspruch).toBe(165.4); // 5 × 42 × 0.9 × 0.875
  });
  it("Gesetzliches Minimum: 4 Wochen, bis zum Jahr des 20. Geburtstags 5 Wochen", () => {
    expect(vacationWeeks({ ferienWochen: 4, geburtsdatum: "2006-08-01" }, 2026)).toBe(5);
    expect(vacationWeeks({ ferienWochen: 4, geburtsdatum: "2005-08-01" }, 2026)).toBe(4);
    expect(vacationWeeks({ ferienWochen: 0 }, 2026)).toBe(4);
    expect(vacationWeeks({ ferienWochen: 6 }, 2026)).toBe(6);
  });
});

describe("Überstunden-Stundenlohn", () => {
  it("Monatslohn × 12 (bzw. 13) ÷ (Wochenstunden × 52)", () => {
    expect(overtimeHourlyRate({ monatslohn: 8200, wochenstunden: 41 })).toBe(46.15);
    expect(overtimeHourlyRate({ monatslohn: 14500, wochenstunden: 42, dreizehnterLohn: true })).toBe(86.31);
    expect(overtimeHourlyRate({ wochenstunden: 42 })).toBe(0);
  });
});
