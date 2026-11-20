// Mitarbeiter-Ansicht und Zeiterfassung müssen dieselben Salden zeigen (bis 26.11 rechneten beide selbst und
// wichen ab: Vortage, Teilabsenzen, Ferien an Halbtagen, Auszahlungen, Austritt). Basis: Demo-Büro der
// Marketing-Screenshots (6 Personen inkl. Teilzeit, Rentner, Austritt) plus Zürcher Feiertage, Ferien, Absenzen.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEmployeeCalc } from "./calc";
import { calcFerienSaldo, calcMonthSaldo, calcTotalSaldo } from "../time/timeUtils";
import { swissHolidayTemplate } from "../../worktime";
import type { AppData, Employee } from "../../types";
// @ts-expect-error Demo-Daten sind ein .mjs-Skript ohne Typen
import { demoData } from "../../../scripts/marketing-shots/demo-data.mjs";

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 20, 10, 0)); });
afterAll(() => { vi.useRealTimers(); });

const build = (): AppData => {
  const d = structuredClone(demoData) as AppData;
  d.feiertage = swissHolidayTemplate([], 2023, 2027).map((f, i) => ({ ...f, id: `ft${i}` }));
  d.ferienEntries = [
    { id: "f1", employeeId: "emp-laura", dateFrom: "2026-07-13", dateTo: "2026-07-24", status: "approved" },
    { id: "f2", employeeId: "emp-julian", dateFrom: "2026-12-21", dateTo: "2026-12-31", status: "approved" },
    { id: "f3", employeeId: "emp-peter", dateFrom: "2026-11-16", dateTo: "2026-11-27", status: "approved" },
    { id: "f4", employeeId: "emp-sara", dateFrom: "2026-10-05", dateTo: "2026-10-09", status: "pending", originalData: { dateFrom: "2026-09-28", dateTo: "2026-10-02" } },
  ];
  d.absences = [
    { id: "a1", employeeId: "emp-julian", type: "krankheit", dateFrom: "2026-11-02", dateTo: "2026-11-04", status: "approved" },
    { id: "a2", employeeId: "emp-nina", type: "intern", date: "2026-11-10", startTime: "13:00", endTime: "15:30", status: "approved" },
    { id: "a3", employeeId: "emp-laura", type: "militaer", dateFrom: "2026-07-20", dateTo: "2026-07-20", status: "approved" },
  ];
  d.uberstundenAbschluss = [{ id: "p", empId: "emp-marc", year: 2025, date: "2026-01-15", type: "payout", hoursSettled: 20, zuschlagPercent: 25, stundenlohn: 80, auszahlungBetrag: 2000 }];
  return d;
};

describe("Zeiterfassung = Mitarbeiter", () => {
  const data = build();
  const calc = createEmployeeCalc(data);
  const emps = data.employees as Employee[];
  it.each(emps.map(e => [e.name, e] as const))("%s: Monatssalden, Totalsaldo, Ferien", (_n, emp) => {
    for (let m = 0; m < 12; m++) {
      const a = calc.calcEmpMonth(emp, 2026, m);
      const b = calcMonthSaldo(data, emp, new Date(2026, m, 15))!;
      if (a.notStarted) continue;
      expect(b.saldo).toBeCloseTo(a.saldo, 1);
      expect(b.soll).toBeCloseTo(a.sollTotal - a.ferienH, 1);
    }
    expect(calcTotalSaldo(data, emp)!.saldo).toBeCloseTo(calc.calcEffectiveUbSaldo(emp), 1);
    const f = calcFerienSaldo(data, emp, new Date(2026, 5, 1))!, g = calc.calcFerienYear(emp, 2026);
    expect([f.anspruch, f.bezogen, f.geplant, f.rest]).toEqual([g.anspruchH, g.bezogenH, g.zukunftH, g.restH]);
  });
  it("Austritt (Sara 15.11.): kein Soll im Dezember, Anspruch anteilig", () => {
    const sara = emps.find(e => e.id === "emp-sara")!;
    expect(calc.calcEmpMonth(sara, 2026, 11).notStarted).toBe(true);
    expect(calc.calcFerienYear(sara, 2026).anspruchH).toBe(165.4);
    // Änderungsantrag pendent: die bisher genehmigten 5 Tage (28.9.–2.10.) gelten als bezogen
    expect(calc.calcFerienYear(sara, 2026).bezogenH).toBeCloseTo(5 * 42 * 0.9 / 5, 1);
  });
  it("Teilabsenz zählt mit ihrer Dauer, Auszahlung mindert den Saldo", () => {
    const nina = emps.find(e => e.id === "emp-nina")!;
    expect(calc.calcEmpMonth(nina, 2026, 10).absenzH).toBe(2.5);
    const marc = emps.find(e => e.id === "emp-marc")!;
    const wtSaldo = calc.wt.overtime(marc);
    expect(wtSaldo.paidOut).toBe(20);
  });
});
