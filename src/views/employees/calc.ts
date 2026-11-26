// Kalkulationen der Mitarbeiter-Ansicht: Monatssaldo, Ferienanspruch, Überstundensaldo.
// `createEmployeeCalc(data)` bindet die Rechenfunktionen (Regeln in worktime.ts) an den aktuellen Datenstand.

import { localISODate } from "../../utils";
import { createWorktime, monthEnd, monthStart, resolveHolidays, roundHours } from "../../worktime";
import type { Employee, ViewProps } from "../../types";

/** Monatsnamen (Januar … Dezember), Index = Monat 0–11. */
export const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

/**
 * Rechenfunktionen für Soll/Ist/Saldo, Ferien und Überstunden eines Mitarbeiters — dünne Hülle um
 * `createWorktime` (worktime.ts), damit Mitarbeiter- und Zeiterfassungs-Ansicht dieselben Zahlen zeigen.
 */
export function createEmployeeCalc(data: ViewProps["data"]) {
  const today = localISODate();
  const wt = createWorktime(data, today);
  const r = roundHours;

  /** Monat (0-basiert): Soll bis heute ohne Ferienabzug, Ist, Absenzen, Ferien und Saldo; `notStarted` vor Eintritt bzw. Saldo-Stichtag oder nach Austritt. */
  const calcEmpMonth = (emp: Employee, year: number, month: number) => {
    const from = monthStart(year, month), to = monthEnd(year, month);
    if ((emp.eintrittsdatum && emp.eintrittsdatum > to) || (emp.austrittsdatum && emp.austrittsdatum < from) || (emp.saldoStichtag && emp.saldoStichtag > to)) {
      return { sollTotal: 0, istH: 0, absenzH: 0, ferienH: 0, saldo: 0, notStarted: true };
    }
    const p = wt.period(emp, from, to);
    return { sollTotal: r(p.sollBrutto), istH: r(p.ist), absenzH: r(p.absenz), ferienH: r(p.ferien), saldo: r(p.saldo) };
  };

  /** Feiertage eines Jahres inklusive Vortage (gleiche Liste wie in der Zeiterfassung). */
  const getFTYear = (year: number) => resolveHolidays(data.feiertage, year, data.settings?.vortagStunden ?? 1, data.settings?.vortagModus);

  /** Ferien eines Jahres in Stunden: Anspruch (anteilig), Übertrag, bezogen, künftig, Rest. */
  const calcFerienYear = (emp: Employee, year: number) => {
    const v = wt.vacationYear(emp, year);
    return { anspruchH: v.anspruch, ubertragH: v.ubertrag, bezogenH: v.bezogen, zukunftH: v.geplant, restH: v.rest, wochen: v.wochen };
  };

  /** Überstundensaldo seit Eintritt bis heute bzw. `upTo` (bzw. Austritt), abzüglich ausbezahlter Stunden. */
  const calcEffectiveUbSaldo = (emp: Employee, upTo?: string) => r(wt.overtime(emp, upTo).balance);

  return { calcEmpMonth, getFTYear, calcFerienYear, calcEffectiveUbSaldo, wt };
}

/** Rückgabetyp von `createEmployeeCalc`. */
export type EmployeeCalc = ReturnType<typeof createEmployeeCalc>;
