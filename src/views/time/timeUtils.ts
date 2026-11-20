// Zeiterfassung: Typen, Raster-Konstanten und Hüllen um die Arbeitszeit-Rechnung (worktime.ts: Feiertage, Soll,
// Monats-/Total-/Feriensaldo) sowie die Monatskacheln. Alles ohne React; die Daten kommen als `data` hinein.

import { localISODate } from "../../utils";
import { activeVacationRange, createWorktime, isFullHoliday, monthEnd, monthStart, resolveHolidays, roundHours, weekday } from "../../worktime";
import type { AppData, Employee, Feiertag, Project, TimeEntry } from "../../types";

/** Auswahlstart im Wochenraster (Tag und Slot des ersten Klicks). */
export type SlotPoint = { dayStr: string; slotIdx: number };
/** Formular für einen neuen Eintrag im Wochenraster (Projekt- oder Absenz-Modus). */
export type WeekForm = {
  dayStr: string; startSlot: number; endSlot: number; mode: string;
  projectId: string; phaseId: string; positionId: string; description: string; absType: string; absNote: string;
};
/** Laufende Grössenänderung eines Eintrags per Ziehen (Zwischenzustand, nicht gespeichert). */
export type ResizeState = {
  entryId: string; dayStr: string; empId: string; edge: string; moved: boolean; startAbsY: number;
  origMinutes: number; origStartTime?: string; origSlot: number; isAbs?: boolean;
  /** Vorschau während des Ziehens (Startzeit "HH:MM" und Dauer in Minuten) */
  previewStart?: string; previewMins?: number;
};
/** Offenes Bearbeitungsformular für einen bestehenden Eintrag oder eine Absenz im Wochenraster. */
export type WeekEditForm = { entryId: string; isAbs: boolean };
/** Kontextmenü (Rechtsklick) auf einem Eintrag im Wochenraster. */
export type ContextMenuState = { x: number; y: number; entry: TimeEntry };
/** Eine Zelle der Monatsansicht (Tag mit Ist/Soll und Kennzeichen). */
export type MonthCell = {
  day: number; dateStr: string; mins: number; ft?: Feiertag; isWeekend: boolean; isFeiertag?: boolean; isVortag?: boolean;
  sollH: number | null; isFerien: boolean; isPendingFerien: boolean; isAbsenz: boolean; isPendingAbsenz: boolean; isPast: boolean;
};

export const SLOT_START_H = 0;
export const SLOT_END_H = 24;
export const SLOT_COUNT = (SLOT_END_H - SLOT_START_H) * 4;
export const SLOT_H = 12;
/** Slot-Index → Uhrzeit "HH:MM" (Slot 0 = 00:00, je 15 Minuten). */
export const slotToTime = (idx: number) => { const m = SLOT_START_H * 60 + idx * 15; return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; };

/** Feiertage für ein Jahr auflösen (jährlich wiederkehrende aufs Jahr, plus «Vortag»-Einträge); Regeln in worktime.ts. */
export const resolveFTs = (data: Pick<AppData, "feiertage">, yr: number | string): Feiertag[] => resolveHolidays(data.feiertage, yr);

/** Prüft ob ein Mitarbeiter an einem Tag eingetragene, bestätigte Ferien hat (auch am Wochenende, für die Anzeige). */
export const isApprovedVacationDay = (data: Pick<AppData, "ferienEntries">, empId: string, dateStr: string) =>
  (data.ferienEntries || []).some(f => {
    if (f.employeeId !== empId) return false;
    const r = activeVacationRange(f);
    return !!r && dateStr >= r.from && dateStr <= r.to;
  });

/** Tages-Soll in Stunden für einen Mitarbeiter (Wochenende, Feiertag, Ferien, Ein-/Austritt berücksichtigt). */
export const getSollForDay = (data: AppData, emp: Employee | null, dateStr: string) =>
  emp ? createWorktime(data, localISODate()).sollForDay(emp, dateStr) : 0;

/** Monatssaldo (Soll/Ist/Absenz) des Monats von `viewDate2`; Soll und Absenzen bis heute, `sollTotal` ganzer Monat. */
export const calcMonthSaldo = (data: AppData, emp: Employee | null, viewDate2: Date) => {
  if (!emp) return null;
  const wt = createWorktime(data, localISODate());
  const yr = viewDate2.getFullYear(), mo = viewDate2.getMonth();
  const p = wt.month(emp, yr, mo);
  const whole = wt.month(emp, yr, mo, monthEnd(yr, mo));
  const r = roundHours;
  return { soll: r(p.soll), sollTotal: r(whole.soll), ist: r(p.ist), absenz: r(p.absenz), saldo: r(p.saldo), saldoTotal: r(p.ist + p.absenz - whole.soll) };
};

/** Saldo vom Eintritt bis heute (bzw. Austritt), abzüglich ausbezahlter Überstunden — gleich wie unter Mitarbeiter. */
export const calcTotalSaldo = (data: AppData, emp: Employee | null) => {
  if (!emp) return null;
  const o = createWorktime(data, localISODate()).overtime(emp);
  const r = roundHours;
  return { soll: r(o.soll), ist: r(o.ist), absenz: r(o.absenz), paidOut: r(o.paidOut), uebertrag: r(o.uebertrag), saldo: r(o.balance) };
};

/** Feriensaldo (Anspruch, Übertrag, bezogen, geplant, beantragt, Rest) des Jahres von `viewDate2`. */
export const calcFerienSaldo = (data: AppData, emp: Employee | null, viewDate2: Date) =>
  emp ? createWorktime(data, localISODate()).vacationYear(emp, viewDate2.getFullYear()) : null;

/** Erste Phase/Position eines Projekts (Vorgabe beim Anlegen eines Eintrags). */
export const getFirstPhaseForProject = (proj: Project | undefined) => {
  if (!proj) return { phaseId: "", positionId: "" };
  const cp = proj.customPhases || [];
  if (cp.length > 0) return { phaseId: cp[0].id, positionId: "" };
  const ep = proj.enabledPhases || [];
  if (ep.length > 0) return { phaseId: ep[0], positionId: "" };
  for (const pos of (proj.positions || [])) {
    if ((pos.enabledPhases || []).length > 0) return { phaseId: pos.enabledPhases![0], positionId: pos.code };
  }
  return { phaseId: "", positionId: "" };
};

/** Kacheln der Monatsansicht (leere Zellen vor dem 1., dann ein Eintrag pro Tag). */
export const buildMonthCells = (data: AppData, currentDate: string, selectedEmpId: string, selectedEmp: Employee | null): (MonthCell | null)[] => {
  const year = Number(currentDate.slice(0, 4));
  const month = Number(currentDate.slice(5, 7)) - 1;
  const lastDay = Number(monthEnd(year, month).slice(8, 10));
  const startWeekday = (weekday(monthStart(year, month)) + 6) % 7; // Montag = 0
  const wt = createWorktime(data, localISODate());

  const calFTs = resolveFTs(data, year);

  const todayStr = localISODate();
  const monthCells: (MonthCell | null)[] = [];
  for (let i = 0; i < startWeekday; i++) monthCells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const mins = data.timeEntries.filter(e => e.date === dateStr && (!selectedEmpId || e.employeeId === selectedEmpId)).reduce((s, e) => s + (e.minutes || 0), 0);
    const ft = calFTs.find(f => f.date === dateStr);
    const dow = weekday(dateStr);
    const isWeekend = dow === 0 || dow === 6;
    const isFeiertag = isFullHoliday(ft);
    const isVortag = !!ft && ft.stundenDelta === -1 && (ft.id || "").startsWith("vortag-");
    const sollH = selectedEmp ? wt.sollForDay(selectedEmp, dateStr) : null;
    // Ferien/Absenz für diesen Tag (nur wenn Mitarbeiter gewählt)
    const isFerien = selectedEmpId ? isApprovedVacationDay(data, selectedEmpId, dateStr) : false;
    const isPendingFerien = selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && dateStr >= f.dateFrom && dateStr <= f.dateTo) : false;
    const isAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && (!a.status || a.status === "approved") && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    const isPendingAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && a.status === "pending" && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    monthCells.push({ day: d, dateStr, mins, ft, isWeekend, isFeiertag, isVortag, sollH, isFerien, isPendingFerien, isAbsenz, isPendingAbsenz, isPast: dateStr <= todayStr });
  }
  return monthCells;
};
