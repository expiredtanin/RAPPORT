// Reine Kalkulationen der Mitarbeiter-Ansicht: Monatssaldo, Ferienanspruch, Überstundensaldo.
// `createEmployeeCalc(data)` bindet die Rechenfunktionen an den aktuellen Datenstand.

import { getFeiertageForYear, getWorkdaysInMonth, localISODate } from "../../utils";
import type { Employee, ViewProps } from "../../types";

/** Monatsnamen (Januar … Dezember), Index = Monat 0–11. */
export const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

/** Rechenfunktionen für Soll/Ist/Saldo, Ferien und Überstunden eines Mitarbeiters. */
export function createEmployeeCalc(data: ViewProps["data"]) {
  const feiertage = data.feiertage || [];
  const absences = data.absences || [];
  const ferienEntries = data.ferienEntries || [];

  const calcEmpMonth = (emp: Employee, year: number, month: number) => {
    const today = localISODate();
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    const entryDate = emp.eintrittsdatum || null;
    const monthLastDay = `${monthStr}-${new Date(year, month + 1, 0).getDate().toString().padStart(2, "0")}`;

    // Monat liegt vollständig vor Anstellung → leer
    if (entryDate && entryDate > monthLastDay) return { sollTotal: 0, istH: 0, absenzH: 0, ferienH: 0, saldo: 0, notStarted: true };

    const pensum = (emp.pensum || 100) / 100;
    const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
    const workdays = getWorkdaysInMonth(year, month, getFTYear(year));

    // Soll: nur Arbeitstage ab Eintrittsdatum und bis heute
    const sollTotal = workdays.reduce((s, d) => {
      if (entryDate && d.date < entryDate) return s;
      if (d.date > today) return s;
      const ft = getFTYear(year).find(f => f.date === d.date);
      if (ft && (ft.stundenDelta === 0 || ft.stundenDelta === undefined || ft.stundenDelta === null)) return s;
      return s + tagessoll + (ft?.stundenDelta || 0);
    }, 0);

    const istMins = (data.timeEntries || []).filter(e => e.employeeId === emp.id && (e.date || "").startsWith(monthStr)).reduce((s, e) => s + (e.minutes || 0), 0);

    // Absenzen: unterstützt sowohl date als auch dateFrom/dateTo
    const empAbsences = absences.filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved"));
    const absenzH = empAbsences.reduce((s, a) => {
      const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
      if (!from) return s;
      if (from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
      const days = workdays.filter(d => d.date >= from && d.date <= to && (!entryDate || d.date >= entryDate) && d.date <= today && !(d.feiertag && (d.feiertag.stundenDelta === 0 || d.feiertag.stundenDelta === null || d.feiertag.stundenDelta === undefined)));
      return s + days.length * tagessoll;
    }, 0);

    // Ferien
    const empFerienRaw = ferienEntries.filter(f => f.employeeId === emp.id && (!f.status || f.status === "approved"));
    const ferienH = empFerienRaw.reduce((s, f) => {
      if (!f.dateFrom) return s;
      if (f.dateFrom.slice(0, 7) > monthStr || f.dateTo.slice(0, 7) < monthStr) return s;
      const days = workdays.filter(d => d.date >= f.dateFrom && d.date <= f.dateTo && (!entryDate || d.date >= entryDate) && d.date <= today && !(d.feiertag && (d.feiertag.stundenDelta === 0 || d.feiertag.stundenDelta === null || d.feiertag.stundenDelta === undefined)));
      return s + days.length * tagessoll;
    }, 0);

    const istH = istMins / 60;
    const saldo = istH + absenzH + ferienH - sollTotal;
    return { sollTotal: Math.round(sollTotal * 10) / 10, istH: Math.round(istH * 10) / 10, absenzH: Math.round(absenzH * 10) / 10, ferienH: Math.round(ferienH * 10) / 10, saldo: Math.round(saldo * 10) / 10 };
  };

  const getFTYear = (year: number) => getFeiertageForYear(feiertage, year);

  // Ferien-Kalkulation für ein Jahr
  // Ferien-Kalkulation für ein Jahr
  const calcFerienYear = (emp: Employee, year: number) => {
    const anspruch = emp.ferienWochen || 4;
    const pensum = (emp.pensum || 100) / 100;
    const wochenstunden = emp.wochenstunden || 35;
    const yearStr = String(year);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const eintrittsdatum = emp.eintrittsdatum || null;

    if (eintrittsdatum && eintrittsdatum > yearEnd) {
      return { anspruchH: 0, ubertragH: 0, bezogenH: 0, zukunftH: 0, restH: 0 };
    }
    let proRata = 1;
    if (eintrittsdatum && eintrittsdatum > yearStart) {
      const entryMonth = parseInt(eintrittsdatum.slice(5, 7));
      proRata = (13 - entryMonth) / 12;
    }
    const anspruchH = Math.round(anspruch * wochenstunden * pensum * proRata * 10) / 10;

    const empFerien = ferienEntries.filter(f => f.employeeId === emp.id && (!f.status || f.status === "approved"));
    const vorjahr = emp.ferienUebertragVorjahr || {};
    const ubertragH = vorjahr[year] || 0;

    // Reine UTC-Arithmetik (Date.UTC/getUTCDay/setUTCDate) statt lokaler
    // Date-Methoden gemischt mit toISOString() (UTC) — die Mischung driftete
    // beim Sommerzeit-Wechsel um einen Tag auseinander (siehe getWorkdaysInMonth
    // in utils.js für die gleiche Wurzelursache) und liess Ferien, die den
    // Umstellungstermin überspannen, falsch zählen.
    const todayStrForBezogen = localISODate();
    const bezogenH = empFerien.filter(f => f.dateFrom.startsWith(yearStr) || f.dateTo.startsWith(yearStr)).reduce((s, f) => {
      // count workdays in this entry within the year, nur bis heute — sonst
      // überlappt bezogenH mit zukunftH (Time.jsx calcFerienSaldo trennt
      // beide exklusiv über denselben ds<=today-Filter, hier bisher gefehlt).
      let count = 0;
      const d = new Date(`${f.dateFrom}T00:00:00Z`);
      const end = new Date(`${f.dateTo}T00:00:00Z`);
      const fts = getFTYear(year);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (ds.startsWith(yearStr) && ds <= todayStrForBezogen) {
          const dow = d.getUTCDay();
          if (dow !== 0 && dow !== 6 && !fts.some(ft => ft.date === ds && !ft.stundenDelta)) count++;
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const tagessoll = (wochenstunden * pensum) / 5;
      return s + count * tagessoll;
    }, 0);

    // Kein Vorfilter auf f.dateFrom > today — eine bereits begonnene, aber
    // noch laufende Ferienperiode hat auch künftige Tage, die sonst spurlos
    // aus "Geplant" verschwinden (identisches Muster wie der Time.jsx-
    // calcFerienSaldo-Fix). Der Tages-Filter ds > today übernimmt die
    // eigentliche Vergangenheit/Zukunft-Abgrenzung.
    const todayStr = localISODate();
    const zukunftH = empFerien.filter(f => f.dateTo.startsWith(yearStr) || f.dateFrom.startsWith(yearStr)).reduce((s, f) => {
      let count = 0;
      const d = new Date(`${f.dateFrom}T00:00:00Z`);
      const end = new Date(`${f.dateTo}T00:00:00Z`);
      const fts = getFTYear(year);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        // Fehlte bisher (anders als bei bezogenH) — ohne diese Grenze zählten
        // jahresübergreifende Ferieneinträge auch Tage des Folgejahrs mit.
        if (ds.startsWith(yearStr) && ds > todayStr) {
          const dow = d.getUTCDay();
          if (dow !== 0 && dow !== 6 && !fts.some(ft => ft.date === ds && !ft.stundenDelta)) count++;
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const tagessoll = (wochenstunden * pensum) / 5;
      return s + count * tagessoll;
    }, 0);

    return {
      anspruchH: Math.round(anspruchH * 10) / 10,
      ubertragH: Math.round(ubertragH * 10) / 10,
      bezogenH: Math.round(bezogenH * 10) / 10,
      zukunftH: Math.round(zukunftH * 10) / 10,
      restH: Math.round((anspruchH + ubertragH - bezogenH - zukunftH) * 10) / 10,
    };
  };


  // Überstundensaldo (total von Eintritt bis heute, minus bereits ausbezahlte)
  const calcEffectiveUbSaldo = (emp: Employee) => {
    if (!emp?.eintrittsdatum) return 0;
    const today = localISODate();
    const start = emp.eintrittsdatum;
    if (start > today) return 0;
    const startY = parseInt(start.slice(0, 4));
    const startM = parseInt(start.slice(5, 7)) - 1;
    const endY = new Date().getFullYear();
    const endM = new Date().getMonth();
    let total = 0;
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      total += calcEmpMonth(emp, y, m).saldo;
      m++;
      if (m > 11) { m = 0; y++; }
    }
    const settled = (data.uberstundenAbschluss || [])
      .filter(a => a.empId === emp.id && a.type === "payout")
      .reduce((s, a) => s + (a.hoursSettled || 0), 0);
    return Math.round((total - settled) * 10) / 10;
  };

  return { calcEmpMonth, getFTYear, calcFerienYear, calcEffectiveUbSaldo };
}

/** Rückgabetyp von `createEmployeeCalc`. */
export type EmployeeCalc = ReturnType<typeof createEmployeeCalc>;
