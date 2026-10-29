// Zeiterfassung: Typen, Raster-Konstanten und reine Berechnungen (Feiertage, Soll, Monats-/Total-/Feriensaldo,
// Monatskacheln). Alles ohne React; die Daten kommen als `data` hinein.

import { localISODate } from "../../utils";
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
export const PROJ_COLORS = ["#b07848","#4a7c8c","#6b8c4a","#8c5a7c","#5a6c8c","#8c7a4a","#5a8c7a","#8c6a5a"];

/** Feiertage für ein Jahr auflösen (jährlich wiederkehrende aufs Jahr, plus «Vortag»-Einträge). */
export const resolveFTs = (data: AppData, yr: number | string): Feiertag[] => {
  const fts = (data.feiertage || []).map(f =>
    f.repeatsYearly ? { ...f, date: `${yr}-${f.date.slice(5, 10)}` } : f
  );
  // Tag vor Feiertag: -1h (nur wenn stundenDelta nicht schon gesetzt)
  const ftDates = new Set(fts.filter(f => f.stundenDelta === 0 || f.stundenDelta === null || f.stundenDelta === undefined).map(f => f.date));
  const vortage: Feiertag[] = [];
  ftDates.forEach(ftDate => {
    const d = new Date(`${ftDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const ds = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !ftDates.has(ds) && !fts.some(f => f.date === ds)) {
      vortage.push({ id: `vortag-${ds}`, date: ds, label: `Vortag ${ftDate}`, stundenDelta: -1 });
    }
  });
  return [...fts, ...vortage];
};

/** Prüft ob ein Mitarbeiter an einem Tag bestätigte Ferien hat. */
export const isApprovedVacationDay = (data: AppData, empId: string, dateStr: string) =>
  (data.ferienEntries || []).some(f => {
    if (f.employeeId !== empId) return false;
    const active = f.status === "approved" || !f.status || (f.status === "pending" && f.originalData);
    if (!active) return false;
    const df = (f.status === "pending" && f.originalData) ? f.originalData.dateFrom : f.dateFrom;
    const dt = (f.status === "pending" && f.originalData) ? f.originalData.dateTo : f.dateTo;
    return dateStr >= df && dateStr <= dt;
  });;

/** Tages-Soll in Stunden für einen Mitarbeiter (Wochenende, Feiertag, Ferien, Eintritt berücksichtigt). */
export const getSollForDay = (data: AppData, emp: Employee | null, dateStr: string) => {
  if (!emp) return 0;
  // Vor Eintrittsdatum: 0
  if (emp.eintrittsdatum && dateStr < emp.eintrittsdatum) return 0;
  const d = new Date(dateStr);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 0;
  const yr = d.getFullYear();
  const fts = resolveFTs(data, yr);
  const ft = fts.find(f => f.date === dateStr);
  const pensum = (emp.pensum || 100) / 100;
  const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
  if (ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined)) return 0;
  if (isApprovedVacationDay(data, emp.id, dateStr)) return 0;
  if (ft) return Math.max(0, tagessoll + (ft.stundenDelta || 0));
  return tagessoll;
};

/** Monatssaldo (Soll/Ist/Absenz) des Monats von `viewDate2`. */
export const calcMonthSaldo = (data: AppData, emp: Employee | null, viewDate2: Date) => {
  if (!emp) return null;
  const yr = viewDate2.getFullYear();
  const mo = viewDate2.getMonth();
  const monthStr = `${yr}-${String(mo + 1).padStart(2, "0")}`;
  const today = localISODate();
  const pensum = (emp.pensum || 100) / 100;
  const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
  const fts = resolveFTs(data, yr);
  let soll = 0, sollTotal = 0;
  // Reine UTC-Arithmetik (siehe getWorkdaysInMonth in utils.js) — lokale
  // Date-Methoden gemischt mit toISOString() drifteten um die Sommerzeit-
  // Umstellung im März einen Tag auseinander.
  const d = new Date(Date.UTC(yr, mo, 1));
  while (d.getUTCMonth() === mo) {
    const ds = d.toISOString().slice(0, 10);
    if (!(emp.eintrittsdatum && ds < emp.eintrittsdatum)) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6 && !isApprovedVacationDay(data, emp.id, ds)) {
        const ft = fts.find(f => f.date === ds);
        // Feiertag ohne Delta = frei; mit Delta = Tagessoll ± Delta (z.B. halber Tag)
        const h = !ft ? tagessoll : !ft.stundenDelta ? 0 : Math.max(0, tagessoll + ft.stundenDelta);
        sollTotal += h;
        if (ds <= today) soll += h;
      }
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const istMins = (data.timeEntries || []).filter(e => e.date?.startsWith(monthStr) && e.employeeId === emp.id).reduce((s, e) => s + (e.minutes || 0), 0);
  const absenzH = (data.absences || []).filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved")).reduce((s, a) => {
    const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
    if (!from) return s;
    const isSingleDay = from === to;
    const ad = new Date(`${from}T00:00:00Z`); const ae = new Date(`${to}T00:00:00Z`);
    let h = 0;
    while (ad <= ae) {
      const ds = ad.toISOString().slice(0, 10);
      if (ds.startsWith(monthStr) && ds <= today && ad.getUTCDay()!==0 && ad.getUTCDay()!==6 && !fts.some(ft=>ft.date===ds&&(ft.stundenDelta===0||ft.stundenDelta===null||ft.stundenDelta===undefined))) {
        if (isSingleDay && a.startTime && a.endTime) { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); h+=(eh*60+em-sh*60-sm)/60; }
        else if (isSingleDay) { const ex=(a.hours||0)*60+(a.minutes||0); h+=ex>0?ex/60:tagessoll; }
        else { h+=tagessoll; }
      }
      ad.setUTCDate(ad.getUTCDate()+1);
    }
    return s + h;
  }, 0);
  const istH = Math.round(istMins / 60 * 10) / 10;
  return { soll: Math.round(soll*10)/10, sollTotal: Math.round(sollTotal*10)/10, ist: istH, absenz: Math.round(absenzH*10)/10, saldo: Math.round((istH+absenzH-soll)*10)/10, saldoTotal: Math.round((istH+absenzH-sollTotal)*10)/10 };
};

/** Totalsaldo vom Eintrittsdatum bis heute. */
export const calcTotalSaldo = (data: AppData, emp: Employee | null) => {
  if (!emp) return null;
  const today = localISODate();
  const start = emp.eintrittsdatum || `${new Date().getFullYear()}-01-01`;
  if (start > today) return { soll: 0, ist: 0, ferien: 0, absenz: 0, saldo: 0 };
  const pensum = (emp.pensum || 100) / 100;
  const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
  const ftsCache: Record<string, Feiertag[]> = {};
  const getFts = (yr: number | string) => { if (!ftsCache[yr]) ftsCache[yr] = resolveFTs(data, yr); return ftsCache[yr]; };
  // Reine UTC-Arithmetik in beiden Schleifen — siehe getWorkdaysInMonth
  // (utils.js) für die Wurzelursache des Sommerzeit-Drifts.
  const todayDate = new Date(`${today}T00:00:00Z`);
  let soll = 0;
  const d = new Date(`${start}T00:00:00Z`);
  while (d <= todayDate) {
    const ds = d.toISOString().slice(0, 10);
    const yr = d.getUTCFullYear();
    const fts = getFts(yr);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isApprovedVacationDay(data, emp.id, ds)) {
      const ft = fts.find(f => f.date === ds);
      if (!ft || ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined) {
        soll += ft ? 0 : tagessoll;
      } else {
        soll += Math.max(0, tagessoll + (ft.stundenDelta || 0));
      }
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const istMins = (data.timeEntries || []).filter(e => e.employeeId === emp.id && e.date >= start && e.date <= today).reduce((s, e) => s + (e.minutes || 0), 0);
  const absenzH = (data.absences || []).filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved")).reduce((s, a) => {
    const from = a.dateFrom || a.date; const to = a.dateTo || a.date;
    if (!from) return s;
    const isSingleDay = from === to;
    const ad = new Date(`${from < start ? start : from}T00:00:00Z`);
    const ae = new Date(`${(to as string) > today ? today : to}T00:00:00Z`);
    let h = 0;
    while (ad <= ae) {
      const ds = ad.toISOString().slice(0, 10);
      const fts = getFts(ad.getUTCFullYear());
      if (ad.getUTCDay()!==0 && ad.getUTCDay()!==6 && !fts.some(ft=>ft.date===ds&&(ft.stundenDelta===0||ft.stundenDelta===null||ft.stundenDelta===undefined))) {
        if (isSingleDay && a.startTime && a.endTime) { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); h+=(eh*60+em-sh*60-sm)/60; }
        else if (isSingleDay) { const ex=(a.hours||0)*60+(a.minutes||0); h+=ex>0?ex/60:tagessoll; }
        else { h+=tagessoll; }
      }
      ad.setUTCDate(ad.getUTCDate()+1);
    }
    return s + h;
  }, 0);
  const istH = Math.round(istMins / 60 * 10) / 10;
  return { soll: Math.round(soll*10)/10, ist: istH, absenz: Math.round(absenzH*10)/10, saldo: Math.round((istH+absenzH-soll)*10)/10 };
};

/** Feriensaldo (Anspruch, Übertrag, bezogen, geplant, beantragt, Rest) des Jahres von `viewDate2`. */
export const calcFerienSaldo = (data: AppData, emp: Employee | null, viewDate2: Date) => {
  if (!emp) return null;
  const yr = viewDate2.getFullYear();
  const yearStr = String(yr);
  const pensum = (emp.pensum || 100) / 100;
  const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
  const yearStart = `${yr}-01-01`;
  const eintrittsdatum = emp.eintrittsdatum || null;
  let proRata = 1;
  if (eintrittsdatum && eintrittsdatum > yearStart) {
    const entryMonth = parseInt(eintrittsdatum.slice(5, 7));
    proRata = (13 - entryMonth) / 12;
  }
  const anspruchH = (emp.ferienWochen || 4) * (emp.wochenstunden || 35) * pensum * proRata;
  const ubertragH = (emp.ferienUebertragVorjahr || {})[yr] || 0;
  const fts = resolveFTs(data, yr);
  const today = localISODate();
  const isFtFree = (ds: string) => fts.some(ft => ft.date === ds && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined));
  const countWorkdays = (from: string, to: string, onlyPast?: boolean, onlyFuture?: boolean) => {
    let cnt = 0;
    const d = new Date(`${from}T00:00:00Z`); const e = new Date(`${to}T00:00:00Z`);
    while (d <= e) {
      const ds = d.toISOString().slice(0, 10);
      if (ds.startsWith(yearStr) && d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !isFtFree(ds)) {
        if (onlyPast && ds > today) { d.setUTCDate(d.getUTCDate() + 1); continue; }
        if (onlyFuture && ds <= today) { d.setUTCDate(d.getUTCDate() + 1); continue; }
        cnt++;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return cnt;
  };
  // Bestätigte Ferien: approved OR pending-with-originalData (use originalData dates)
  const confirmedEntries = (data.ferienEntries || []).filter(f =>
    f.employeeId === emp.id && (f.status === "approved" || !f.status || (f.status === "pending" && f.originalData))
  ).map(f => ({
    from: (f.status === "pending" && f.originalData) ? f.originalData.dateFrom : f.dateFrom,
    to: (f.status === "pending" && f.originalData) ? f.originalData.dateTo : f.dateTo,
  }));
  const bezogenH = confirmedEntries.reduce((s, f) => s + countWorkdays(f.from, f.to, true, false) * tagessoll, 0);
  // Kein Vorfilter auf f.from > today — countWorkdays(..., onlyFuture=true)
  // filtert bereits pro Tag korrekt. Der Vorfilter liess bei einer bereits
  // begonnenen, aber noch laufenden Ferienperiode (from <= today <= to)
  // deren künftige Tage spurlos aus Rest verschwinden (weder in bezogenH
  // noch in geplantH gezählt).
  const geplantH = confirmedEntries.reduce((s, f) => s + countWorkdays(f.from, f.to, false, true) * tagessoll, 0);
  // Beantragt: pending entries (use their requested dates)
  const beantragtH = (data.ferienEntries || []).filter(f =>
    f.employeeId === emp.id && f.status === "pending" &&
    (f.dateFrom.startsWith(yearStr) || f.dateTo.startsWith(yearStr))
  ).reduce((s, f) => s + countWorkdays(f.dateFrom, f.dateTo, false, false) * tagessoll, 0);
  return {
    anspruch: Math.round(anspruchH*10)/10,
    ubertrag: Math.round(ubertragH*10)/10,
    bezogen: Math.round(bezogenH*10)/10,
    geplant: Math.round(geplantH*10)/10,
    beantragt: Math.round(beantragtH*10)/10,
    rest: Math.round((anspruchH + ubertragH - bezogenH - geplantH) * 10) / 10,
  };
};

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
  const viewDate = new Date(currentDate);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Montag = 0

  const calFTs = resolveFTs(data, year);

  const todayStr = localISODate();
  const monthCells: (MonthCell | null)[] = [];
  for (let i = 0; i < startWeekday; i++) monthCells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const mins = data.timeEntries.filter(e => e.date === dateStr && (!selectedEmpId || e.employeeId === selectedEmpId || !e.employeeId)).reduce((s, e) => s + (e.minutes || 0), 0);
    const ft = calFTs.find(f => f.date === dateStr);
    const dow = new Date(dateStr).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isFeiertag = ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);
    const isVortag = ft && ft.stundenDelta === -1 && (ft.id || "").startsWith("vortag-");
    const sollH = selectedEmp ? getSollForDay(data, selectedEmp, dateStr) : null;
    // Ferien/Absenz für diesen Tag (nur wenn Mitarbeiter gewählt)
    const isFerien = selectedEmpId ? isApprovedVacationDay(data, selectedEmpId, dateStr) : false;
    const isPendingFerien = selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && dateStr >= f.dateFrom && dateStr <= f.dateTo) : false;
    const isAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && (!a.status || a.status === "approved") && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    const isPendingAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && a.status === "pending" && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    monthCells.push({ day: d, dateStr, mins, ft, isWeekend, isFeiertag, isVortag, sollH, isFerien, isPendingFerien, isAbsenz, isPendingAbsenz, isPast: dateStr <= todayStr });
  }
  return monthCells;
};
