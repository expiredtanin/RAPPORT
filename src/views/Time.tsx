// Zeiterfassung. Drei Ansichten (`viewMode`):
//   "woche" – Wochenraster in 15-Minuten-Schritten: Zeitspanne anklicken (Start,
//             dann Ende) → Eintrag (Projekt/Phase/Position oder Absenz) anlegen;
//             Einträge per Ziehen an Ober-/Unterkante in der Länge anpassen;
//             Rechtsklick: auf den nächsten Tag duplizieren.
//   "tag"   – Tagesliste mit Formular.
//   Monats-/Jahresübersichten mit Soll/Ist, Ferien- und Absenz-Anzeige.
// Zusätzlich: Spesen erfassen, Ferienanträge stellen (Status «pending» bis zur
// Genehmigung in Employees.tsx), PDF-Stundenrapport.
//
// Einheiten: Einträge speichern `minutes` (Dauer) und optional `startTime`/`endTime`
// ("HH:MM"); das Raster rechnet in Slots à 15 Minuten (`SLOT_*`). Ein Eintrag gehört
// zu einem Mitarbeiter (`employeeId`) und Projekt (`projectId`, optional Phase/Position).
// Berechtigung: Administratoren (userPermissions === null) und Rollen mit
// «mitarbeiter» dürfen den Mitarbeiter wechseln, alle anderen sehen nur sich selbst.
// Gesperrt sind Monate in `settings.closedMonths` (Monatsabschluss) und Einträge,
// die bereits auf einer Rechnung stehen (`invoiceId`).
// Feiertage kommen aus `data.feiertage` (jährlich wiederkehrende werden aufs Jahr
// aufgelöst); der Tag vor einem Feiertag zählt 1 h weniger Soll (`resolveFTs`).

import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { SIA_PHASES, EXPENSE_CATEGORIES } from "../constants";
import { generateId, formatDate, formatHours, getAbsenzTypes, receiptToDataUrl, checkLocalBudget, localISODate } from "../utils";
import { isLocalBackend } from "../storage/adapter";
import { Header, FormField, Modal, DatePicker, CalendarPopup, NavArrows, ShareButton } from "../components/UI";
import { useCalendarNav } from "../hooks/useCalendarNav";
import { ReceiptViewer } from "../components/ReceiptViewer";
import type { Absence, Employee, Expense, Feiertag, FerienEntry, Project, TimeEntry, ViewProps } from "../types";

/** Auswahlstart im Wochenraster (Tag und Slot des ersten Klicks). */
type SlotPoint = { dayStr: string; slotIdx: number };
/** Formular für einen neuen Eintrag im Wochenraster (Projekt- oder Absenz-Modus). */
type WeekForm = {
  dayStr: string; startSlot: number; endSlot: number; mode: string;
  projectId: string; phaseId: string; positionId: string; description: string; absType: string; absNote: string;
};
/** Laufende Grössenänderung eines Eintrags per Ziehen (Zwischenzustand, nicht gespeichert). */
type ResizeState = {
  entryId: string; dayStr: string; empId: string; edge: string; moved: boolean; startAbsY: number;
  origMinutes: number; origStartTime?: string; origSlot: number; isAbs?: boolean;
  /** Vorschau während des Ziehens (Startzeit "HH:MM" und Dauer in Minuten) */
  previewStart?: string; previewMins?: number;
};
/** Eine Zelle der Monatsansicht (Tag mit Ist/Soll und Kennzeichen). */
type MonthCell = {
  day: number; dateStr: string; mins: number; ft?: Feiertag; isWeekend: boolean; isFeiertag?: boolean; isVortag?: boolean;
  sollH: number | null; isFerien: boolean; isPendingFerien: boolean; isAbsenz: boolean; isPendingAbsenz: boolean; isPast: boolean;
};
/** Formular für eine Absenz im Wochenraster. */

const SLOT_START_H = 0;
const SLOT_END_H = 24;
const SLOT_COUNT = (SLOT_END_H - SLOT_START_H) * 4;
const SLOT_H = 12;
/** Slot-Index → Uhrzeit "HH:MM" (Slot 0 = 00:00, je 15 Minuten). */
const slotToTime = (idx: number) => { const m = SLOT_START_H * 60 + idx * 15; return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; };
const PROJ_COLORS = ["#b07848","#4a7c8c","#6b8c4a","#8c5a7c","#5a6c8c","#8c7a4a","#5a8c7a","#8c6a5a"];

export default
function Time({ data, update, currentUser, userPermissions, setPrintContent }: Pick<ViewProps, "data" | "update" | "currentUser" | "userPermissions" | "setPrintContent">) {
  const myEmployeeId = currentUser?.employeeId || null;
  // userPermissions === null bedeutet Vollzugriff (Admin bzw. Rolle ohne Einschränkung) —
  // nicht aus dem Fehlen einer employeeId-Verknüpfung ableiten, sonst sehen frisch
  // eingeladene, noch nicht verknüpfte Nutzer versehentlich alle Zeiteinträge.
  const isAdmin = userPermissions === null;
  const [currentDate, setCurrentDate] = useState(localISODate());
  const [selectedEmpId, setSelectedEmpId] = useState(() => myEmployeeId || "");
  const [viewMode, setViewMode] = useState<string>("woche");
  const [weekSelectStart, setWeekSelectStart] = useState<SlotPoint | null>(null);
  const [weekHover, setWeekHover] = useState<SlotPoint | null>(null);
  const [weekForm, setWeekForm] = useState<WeekForm | null>(null);
  const [weekEditForm, setWeekEditForm] = useState<{ entryId: string; isAbs: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: TimeEntry } | null>(null);
  const weekGridRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<ResizeState | null>(null);
  // `resizingRef` ist der Arbeitsstand der Maus-Handler, `resizing` eine Kopie davon fürs Rendern (Vorschau)
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const syncResizing = () => setResizing(resizingRef.current ? { ...resizingRef.current } : null);
  // Neuester Stand für die Maus-Handler beim Ziehen/Ändern der Dauer (die nicht bei jedem Render neu registriert werden)
  const dataRef = useRef(data);
  const updateRef = useRef(update);
  useLayoutEffect(() => { dataRef.current = data; updateRef.current = update; });

  const employees = data.employees || [];
  const selectedEmp = employees.find(e => e.id === selectedEmpId) || null;

  const changeDate = (delta: number) => {
    const d = new Date(`${currentDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    setCurrentDate(d.toISOString().slice(0, 10));
  };
  const goToday = () => setCurrentDate(localISODate());

  // Wenn MA gewählt: nur dessen Einträge + Einträge ohne MA-Zuweisung ausblenden
  // Wenn kein MA gewählt: alle Einträge (inkl. ohne MA)
  const dayEntries = data.timeEntries.filter(e => {
    if (e.date !== currentDate) return false;
    if (selectedEmpId) return e.employeeId === selectedEmpId;
    return true;
  }).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const dayTotalMins = dayEntries.reduce((s, e) => s + (e.minutes || 0), 0);

  // Hilfsfunktion: Feiertage für ein Jahr auflösen
  const resolveFTs = (yr: number | string): Feiertag[] => {
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

  // Prüft ob ein Mitarbeiter an einem Tag bestätigte Ferien hat
  const isApprovedVacationDay = (empId: string, dateStr: string) =>
    (data.ferienEntries || []).some(f => {
      if (f.employeeId !== empId) return false;
      const active = f.status === "approved" || !f.status || (f.status === "pending" && f.originalData);
      if (!active) return false;
      const df = (f.status === "pending" && f.originalData) ? f.originalData.dateFrom : f.dateFrom;
      const dt = (f.status === "pending" && f.originalData) ? f.originalData.dateTo : f.dateTo;
      return dateStr >= df && dateStr <= dt;
    });

  // Tages-Soll für gewählten Mitarbeiter
  const getSollForDay = (emp: Employee | null, dateStr: string) => {
    if (!emp) return 0;
    // Vor Eintrittsdatum: 0
    if (emp.eintrittsdatum && dateStr < emp.eintrittsdatum) return 0;
    const d = new Date(dateStr);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return 0;
    const yr = d.getFullYear();
    const fts = resolveFTs(yr);
    const ft = fts.find(f => f.date === dateStr);
    const pensum = (emp.pensum || 100) / 100;
    const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
    if (ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined)) return 0;
    if (isApprovedVacationDay(emp.id, dateStr)) return 0;
    if (ft) return Math.max(0, tagessoll + (ft.stundenDelta || 0));
    return tagessoll;
  };
  const daySoll = getSollForDay(selectedEmp, currentDate);

  // Monatssaldo
  const viewDate2 = new Date(currentDate);
  const calcMonthSaldo = (emp: Employee | null) => {
    if (!emp) return null;
    const yr = viewDate2.getFullYear();
    const mo = viewDate2.getMonth();
    const monthStr = `${yr}-${String(mo + 1).padStart(2, "0")}`;
    const today = localISODate();
    const pensum = (emp.pensum || 100) / 100;
    const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
    const fts = resolveFTs(yr);
    let soll = 0, sollTotal = 0;
    // Reine UTC-Arithmetik (siehe getWorkdaysInMonth in utils.js) — lokale
    // Date-Methoden gemischt mit toISOString() drifteten um die Sommerzeit-
    // Umstellung im März einen Tag auseinander.
    const d = new Date(Date.UTC(yr, mo, 1));
    while (d.getUTCMonth() === mo) {
      const ds = d.toISOString().slice(0, 10);
      if (!(emp.eintrittsdatum && ds < emp.eintrittsdatum)) {
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6 && !isApprovedVacationDay(emp.id, ds)) {
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
  const monthSaldo = calcMonthSaldo(selectedEmp);

  // Totalsaldo (Eintrittsdatum bis heute)
  const calcTotalSaldo = (emp: Employee | null) => {
    if (!emp) return null;
    const today = localISODate();
    const start = emp.eintrittsdatum || `${new Date().getFullYear()}-01-01`;
    if (start > today) return { soll: 0, ist: 0, ferien: 0, absenz: 0, saldo: 0 };
    const pensum = (emp.pensum || 100) / 100;
    const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
    const ftsCache: Record<string, Feiertag[]> = {};
    const getFts = (yr: number | string) => { if (!ftsCache[yr]) ftsCache[yr] = resolveFTs(yr); return ftsCache[yr]; };
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
      if (dow !== 0 && dow !== 6 && !isApprovedVacationDay(emp.id, ds)) {
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
  const totalSaldo = calcTotalSaldo(selectedEmp);

  // Feriensaldo
  const calcFerienSaldo = (emp: Employee | null) => {
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
    const fts = resolveFTs(yr);
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
  const ferienSaldo = calcFerienSaldo(selectedEmp);

  const getFirstPhaseForProject = (proj: Project | undefined) => {
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

  const closedMonths = data.settings.closedMonths || [];
  const isMonthClosed = (date?: string) => closedMonths.includes((date || "").slice(0, 7));

  const addEntry = () => {
    if (isMonthClosed(currentDate)) { alert("Dieser Monat ist abgeschlossen und kann nicht mehr bearbeitet werden."); return; }
    const firstActive = data.projects.find(p => p.status === "aktiv") || data.projects[0];
    const { phaseId, positionId } = getFirstPhaseForProject(firstActive);
    const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const todayEnds = data.timeEntries.filter(e => e.date === currentDate && (!selectedEmpId || e.employeeId === selectedEmpId) && e.endTime);
    let startMins = 8 * 60;
    if (todayEnds.length > 0) {
      const maxEnd = todayEnds.reduce((max, e) => { const [h, m] = (e.endTime as string).split(":").map(Number); return Math.max(max, h * 60 + m); }, 0);
      if (maxEnd > 0) startMins = maxEnd;
    }
    const defaultMins = 60;
    const newEntry = { id: generateId(), date: currentDate, projectId: firstActive?.id || "", phaseId, positionId, minutes: defaultMins, startTime: toTime(startMins), endTime: toTime(startMins + defaultMins), description: "", createdAt: new Date().toISOString(), ...(selectedEmpId ? { employeeId: selectedEmpId } : {}) } as TimeEntry;
    update("timeEntries", [...data.timeEntries, newEntry]);
  };

  const updateEntry = (id: string, changes: Partial<TimeEntry>) => {
    const entry = data.timeEntries.find(e => e.id === id);
    if (entry?.invoiceId) { alert("Dieser Eintrag ist bereits verrechnet und kann nicht mehr geändert werden. Lösche zuerst die zugehörige Rechnung."); return; }
    if (isMonthClosed(entry?.date)) { alert("Dieser Monat ist abgeschlossen und kann nicht mehr bearbeitet werden."); return; }
    const merged = { ...entry, ...changes };
    if ("minutes" in changes && merged.startTime) {
      const [h, m] = merged.startTime.split(":").map(Number);
      const endMins = h * 60 + m + (merged.minutes || 0);
      changes = { ...changes, endTime: `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}` };
    }
    update("timeEntries", data.timeEntries.map(e => e.id === id ? { ...e, ...changes } : e));
  };

  const delEntry = (id: string) => {
    const entry = data.timeEntries.find(e => e.id === id);
    if (entry?.invoiceId) { alert("Dieser Eintrag ist bereits verrechnet und kann nicht gelöscht werden. Lösche zuerst die zugehörige Rechnung."); return; }
    if (isMonthClosed(entry?.date)) { alert("Dieser Monat ist abgeschlossen und kann nicht mehr gelöscht werden."); return; }
    update("timeEntries", data.timeEntries.filter(e => e.id !== id));
  };

  // Tages-Spesen — inline editing
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const dayExpenses = (data.expenses || []).filter(e => {
    if (e.date !== currentDate) return false;
    if (selectedEmpId) return e.employeeId === selectedEmpId;
    return true;
  });

  const addExp = () => {
    update("expenses", [...(data.expenses || []), { id: generateId(), date: currentDate, category: (data.settings.expenseCategories || EXPENSE_CATEGORIES)[0], projectId: "", description: "", amount: 0, mwstRate, inclMwst: true, employeeId: selectedEmpId || "" } as Expense]);
  };
  const updateExp = (id: string, changes: Partial<Expense>) => update("expenses", prev => (prev || []).map(e => e.id === id ? { ...e, ...changes } : e));
  const delExp = (id: string) => update("expenses", (data.expenses || []).filter(e => e.id !== id));

  const [receiptView, setReceiptView] = useState<Expense | null>(null);
  const [uploadingExpId, setUploadingExpId] = useState<string | null>(null);
  const expReceiptInputRef = useRef<HTMLInputElement>(null);
  const handleExpReceiptUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    const expId = uploadingExpId;
    if (!file || !expId) return;
    try {
      const receiptData = await receiptToDataUrl(file);
      const old = (data.expenses || []).find(e => e.id === expId)?.receiptData;
      const problem = isLocalBackend ? checkLocalBudget(data, receiptData.length, old?.length || 0) : null;
      if (problem) { alert(problem); return; }
      updateExp(expId, { receiptData, receiptName: file.name });
    } catch (err) {
      alert((err as Error).message || "Der Beleg konnte nicht gelesen werden.");
    }
  };

  // Intern / Absenz — inline editing
  const absenzTypes = getAbsenzTypes(data);
  const dayAbs = (data.absences || []).filter(a => {
    const matchDate = a.date === currentDate || (a.dateFrom && a.dateTo && currentDate >= a.dateFrom && currentDate <= a.dateTo);
    return matchDate && (!selectedEmpId || a.employeeId === selectedEmpId);
  });

  const dayAbsMins = selectedEmp ? dayAbs.filter(a => !a.status || a.status === "approved").reduce((s, a) => {
    if (a.startTime && a.endTime) { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return s+(eh*60+em)-(sh*60+sm); }
    const ex=(a.hours||0)*60+(a.minutes||0); return s+(ex>0?ex:daySoll*60);
  }, 0) : 0;
  const dayIst = (dayTotalMins + dayAbsMins) / 60;
  const dayDiff = Math.round((dayIst - daySoll) * 10) / 10;

  const toAbsTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const addAbs = () => {
    const todayAbs = (data.absences || []).filter(a =>
      (a.date === currentDate || (a.dateFrom && a.dateTo && currentDate >= a.dateFrom && currentDate <= a.dateTo)) &&
      (!selectedEmpId || a.employeeId === selectedEmpId)
    );
    let startMins = 8 * 60;
    if (todayAbs.length > 0) {
      const maxEnd = todayAbs.reduce((max, a) => {
        let endM;
        if (a.endTime) { const [h,m]=a.endTime.split(":").map(Number); endM=h*60+m; }
        else { const dur=(a.hours||0)*60+(a.minutes||0); endM=8*60+(dur>0?dur:Math.round(daySoll*60)); }
        return Math.max(max, endM);
      }, 8 * 60);
      if (maxEnd > 8 * 60) startMins = maxEnd;
    }
    const endMins = startMins + 60;
    update("absences", [...(data.absences || []), { id: generateId(), date: currentDate, employeeId: selectedEmpId || (employees[0]?.id || ""), type: absenzTypes[0]?.id || "", startTime: toAbsTime(startMins), endTime: toAbsTime(endMins), hours: 1, minutes: 0, note: "", status: "pending", createdAt: new Date().toISOString() }]);
  };
  const updateAbs = (id: string, changes: Partial<Absence>) => {
    const abs = (data.absences || []).find(a => a.id === id);
    if (!abs) return;
    if (abs.startTime && ("hours" in changes || "minutes" in changes)) {
      const [sh, sm] = abs.startTime.split(":").map(Number);
      const newH = ("hours" in changes ? changes.hours : (abs.hours || 0)) as number;
      const newM = ("minutes" in changes ? changes.minutes : (abs.minutes || 0)) as number;
      const endMins = Math.min(sh * 60 + sm + newH * 60 + newM, 23 * 60 + 59);
      changes = { ...changes, endTime: toAbsTime(endMins) };
    }
    update("absences", (data.absences || []).map(a => a.id === id ? { ...a, ...changes } : a));
  };
  const delAbs = (id: string) => update("absences", (data.absences || []).filter(a => a.id !== id));

  // Ferien-Antrag Modal
  const [antragModal, setAntragModal] = useState<"ferien" | null>(null);
  const [antragForm, setAntragForm] = useState<Partial<FerienEntry>>({});

  const openFerienAntrag = () => {
    setAntragForm({ employeeId: selectedEmpId || (employees[0]?.id || ""), dateFrom: currentDate, dateTo: currentDate, note: "" });
    setAntragModal("ferien");
  };
  const saveAntrag = () => {
    if (!antragForm.employeeId || !antragForm.dateFrom || !antragForm.dateTo) return;
    if (antragForm.id) {
      const existing = (data.ferienEntries || []).find(f => f.id === antragForm.id);
      let entry: FerienEntry;
      if (existing?.status === "approved" || !existing?.status) {
        entry = {
          ...antragForm,
          status: "pending",
          originalData: existing?.originalData || { dateFrom: existing!.dateFrom, dateTo: existing!.dateTo, note: existing!.note || "" },
        } as FerienEntry;
      } else {
        entry = { ...antragForm, status: "pending" } as FerienEntry;
      }
      update("ferienEntries", (data.ferienEntries || []).map(f => f.id === entry.id ? entry : f));
    } else {
      const entry = { ...antragForm, id: generateId(), status: "pending", createdAt: new Date().toISOString() } as FerienEntry;
      update("ferienEntries", [...(data.ferienEntries || []), entry]);
    }
    setAntragModal(null);
  };
  const deleteFerien = (id: string) => update("ferienEntries", (data.ferienEntries || []).filter(f => f.id !== id));
  const cancelFerienEdit = (id: string) => update("ferienEntries", (data.ferienEntries || []).map(f => {
    if (f.id !== id || !f.originalData) return f;
    const { originalData, ...rest } = f;
    return { ...rest, dateFrom: originalData.dateFrom, dateTo: originalData.dateTo, note: originalData.note, status: "approved" } as FerienEntry;
  }));
  const editFerien = (f: FerienEntry) => { setAntragForm({ ...f }); setAntragModal("ferien"); };

  const [ferienUebersicht, setFerienUebersicht] = useState(false);
  const { ref: navCalRef, open: navCalOpen, setOpen: setNavCalOpen } = useCalendarNav();

  const viewDate = new Date(currentDate);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Montag = 0

  const calFTs = resolveFTs(year);

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
    const sollH = selectedEmp ? getSollForDay(selectedEmp, dateStr) : null;
    // Ferien/Absenz für diesen Tag (nur wenn Mitarbeiter gewählt)
    const isFerien = selectedEmpId ? isApprovedVacationDay(selectedEmpId, dateStr) : false;
    const isPendingFerien = selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && dateStr >= f.dateFrom && dateStr <= f.dateTo) : false;
    const isAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && (!a.status || a.status === "approved") && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    const isPendingAbsenz = selectedEmpId ? (data.absences || []).some(a => a.employeeId === selectedEmpId && a.status === "pending" && (a.date === dateStr || (a.dateFrom && a.dateTo && dateStr >= a.dateFrom && dateStr <= a.dateTo))) : false;
    monthCells.push({ day: d, dateStr, mins, ft, isWeekend, isFeiertag, isVortag, sollH, isFerien, isPendingFerien, isAbsenz, isPendingAbsenz, isPast: dateStr <= todayStr });
  }

  const monthTotalMins = monthCells.filter((c): c is MonthCell => !!c).reduce((s, c) => s + c.mins, 0);

  const weekdayLabel = new Date(currentDate).toLocaleDateString("de-CH", { weekday: "long" });
  const monthLabel = viewDate.toLocaleDateString("de-CH", { month: "long", year: "numeric" });
  const isToday = currentDate === localISODate();

  // Reine UTC-Arithmetik wie im Rest der Datei (lokales setDate() + toISOString() stimmt nur in
  // Zeitzonen östlich von UTC, z.B. Zürich).
  const getWeekDays = (ds: string) => {
    const mon = new Date(`${ds}T00:00:00Z`);
    const dow = mon.getUTCDay();
    mon.setUTCDate(mon.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(mon); day.setUTCDate(mon.getUTCDate() + i);
      return day.toISOString().slice(0, 10);
    });
  };
  const weekDays = getWeekDays(currentDate);
  // calFTs ist nur für "year" (das Jahr von currentDate) aufgelöst — eine Woche kann
  // aber über den Jahreswechsel hinausreichen (z.B. 29.12.–4.1.). Für die Feiertags-
  // Markierung in der Wochenansicht deshalb pro Tag das jeweils richtige Jahr auflösen,
  // sonst wird Neujahr/Berchtoldstag in der Jahreswechsel-Woche fälschlich nicht als
  // Feiertag erkannt (repeatsYearly-Einträge matchen nur im aufgelösten Jahr).
  const weekFTs = [...new Set(weekDays.map(ds => new Date(ds).getFullYear()))].flatMap(y => resolveFTs(y));
  const weekLabel = (() => {
    const from = new Date(weekDays[0]); const to = new Date(weekDays[6]);
    return `${from.toLocaleDateString("de-CH", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" })}`;
  })();
  const changeWeek = (delta: number) => {
    const d = new Date(`${currentDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta * 7);
    setCurrentDate(d.toISOString().slice(0, 10)); setWeekForm(null); setWeekSelectStart(null); setWeekEditForm(null);
  };
  const handleSlotClick = (dayStr: string, slotIdx: number) => {
    if (isMonthClosed(dayStr)) return;
    if (selectedEmp?.eintrittsdatum && dayStr < selectedEmp.eintrittsdatum) return;
    if (!weekSelectStart) { setWeekSelectStart({ dayStr, slotIdx }); return; }
    if (weekSelectStart.dayStr !== dayStr) { setWeekSelectStart({ dayStr, slotIdx }); return; }
    const startSlot = Math.min(weekSelectStart.slotIdx, slotIdx);
    const endSlot = Math.max(weekSelectStart.slotIdx, slotIdx);
    const firstActive = data.projects.find(p => p.status === "aktiv") || data.projects[0];
    setWeekForm({ dayStr, startSlot, endSlot, mode: "projekt", projectId: firstActive?.id || "", phaseId: "", positionId: "", description: "", absType: absenzTypes[0]?.id || "", absNote: "" });
    setWeekEditForm(null); setWeekSelectStart(null);
  };
  const saveWeekEntry = () => {
    if (isMonthClosed(weekForm?.dayStr)) return;
    if (!weekForm) return;
    const mins = (weekForm.endSlot - weekForm.startSlot + 1) * 15;
    if (weekForm?.mode === "absenz") {
      update("absences", [...(data.absences || []), {
        id: generateId(), date: weekForm.dayStr,
        employeeId: selectedEmpId || "",
        type: weekForm.absType || (absenzTypes[0]?.id || ""),
        startTime: slotToTime(weekForm.startSlot), endTime: slotToTime(weekForm.endSlot + 1),
        minutes: mins, hours: 0,
        note: weekForm.absNote || "", status: "pending",
        createdAt: new Date().toISOString(),
      } as Absence]);
      setWeekForm(null);
      return;
    }
    if (!weekForm?.projectId) return;
    update("timeEntries", [...data.timeEntries, {
      id: generateId(), date: weekForm.dayStr,
      projectId: weekForm.projectId, phaseId: weekForm.phaseId || "", positionId: weekForm.positionId || "",
      minutes: mins, startTime: slotToTime(weekForm.startSlot), endTime: slotToTime(weekForm.endSlot + 1),
      description: weekForm.description || "", employeeId: selectedEmpId || "",
      createdAt: new Date().toISOString(),
    } as TimeEntry]);
    setWeekForm(null);
  };


  useEffect(() => {
    if (viewMode === "woche" && weekGridRef.current) {
      weekGridRef.current.scrollTop = (7 - SLOT_START_H) * 4 * SLOT_H;
    }
  }, [viewMode]);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const scrollTop = weekGridRef.current?.scrollTop || 0;
      const absY = ev.clientY + scrollTop;
      const deltaSlots = Math.round((absY - r.startAbsY) / SLOT_H);
      if (deltaSlots !== 0) r.moved = true;
      const origDur = Math.round(r.origMinutes / 15);
      let newStart: number, newDur: number;
      if (r.edge === "bottom") {
        newStart = r.origSlot;
        newDur = Math.max(1, origDur + deltaSlots);
      } else if (r.edge === "top") {
        const s = Math.max(0, Math.min(r.origSlot + deltaSlots, r.origSlot + origDur - 1));
        newStart = s; newDur = r.origSlot + origDur - s;
      } else {
        newStart = Math.max(0, Math.min(SLOT_COUNT - origDur, r.origSlot + deltaSlots));
        newDur = origDur;
      }
      if (newStart + newDur > SLOT_COUNT) newDur = SLOT_COUNT - newStart;
      const overlaps = !r.isAbs && r.edge !== "move" && dataRef.current.timeEntries.filter(e2 =>
        e2.date === r.dayStr && e2.startTime && e2.id !== r.entryId && (!r.empId || e2.employeeId === r.empId)
      ).map(e2 => { const [h,m] = (e2.startTime as string).split(":").map(Number); const s = Math.round((h*60+m-SLOT_START_H*60)/15); return { start: s, end: s + Math.round(e2.minutes/15) }; })
      .some(o => newStart < o.end && newStart + newDur > o.start);
      if (!overlaps) { r.previewStart = slotToTime(newStart); r.previewMins = newDur * 15; }
      syncResizing();
    };
    const onUp = () => {
      const r = resizingRef.current;
      if (r) {
        if (!r.moved) {
          setWeekEditForm({ entryId: r.entryId, isAbs: r.isAbs || false });
        } else if (r.previewMins !== undefined) {
          const [sh, sm] = (r.previewStart as string).split(":").map(Number);
          const endTime = slotToTime((sh * 60 + sm - SLOT_START_H * 60) / 15 + r.previewMins / 15);
          const pStart = Math.round((sh * 60 + sm - SLOT_START_H * 60) / 15);
          const pEnd = pStart + Math.round(r.previewMins / 15);
          if (r.isAbs) {
            updateRef.current("absences", dataRef.current.absences.map(a =>
              a.id === r.entryId ? { ...a, startTime: r.previewStart, endTime, minutes: r.previewMins as number } : a
            ));
          } else {
            let newEntries = dataRef.current.timeEntries.map(e =>
              e.id === r.entryId ? { ...e, startTime: r.previewStart, endTime, minutes: r.previewMins as number } : e
            );
            if (r.edge === "move") {
              newEntries = newEntries.map(e2 => {
                if (e2.id === r.entryId || e2.date !== r.dayStr || !e2.startTime) return e2;
                if (r.empId && e2.employeeId !== r.empId) return e2;
                const [h, m] = (e2.startTime as string).split(":").map(Number);
                const s = Math.round((h * 60 + m - SLOT_START_H * 60) / 15);
                const dur = Math.round((e2.minutes || 0) / 15);
                if (s >= pEnd || s + dur <= pStart) return e2;
                const newS = s >= pStart ? pEnd : pStart - dur;
                if (newS < 0 || newS + dur > SLOT_COUNT) return e2;
                return { ...e2, startTime: slotToTime(newS), endTime: slotToTime(newS + dur) };
              });
            }
            updateRef.current("timeEntries", newEntries);
          }
        }
      }
      resizingRef.current = null;
      syncResizing();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const duplicateToNextDay = (entry: TimeEntry) => {
    const d = new Date(`${entry.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDay = d.toISOString().slice(0, 10);
    update("timeEntries", [...data.timeEntries, { ...entry, id: generateId(), date: nextDay, createdAt: new Date().toISOString() }]);
  };

  if (!isAdmin && !myEmployeeId) {
    // Nicht-Admin ohne Mitarbeiter-Verknüpfung: selectedEmpId bliebe "" und würde von
    // den Filtern unten (!selectedEmpId) fälschlich als "alle Mitarbeitenden" gelesen —
    // also hier komplett blockieren statt fremde Zeiteinträge offenzulegen.
    return (
      <div>
        <Header title="Zeiterfassung" />
        <div style={{ padding: 40, textAlign: "center", color: "var(--text4)" }}>
          Dein Account ist noch keinem Mitarbeiter-Datensatz zugeordnet. Bitte einen Administrator kontaktieren.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Zeiterfassung" action={selectedEmp ? (
        <div style={{ display: "flex", gap: 8 }}>
          <ShareButton options={[{ label: "PDF Stunden", onClick: () => setPrintContent({ type: "timeReport", employee: selectedEmp, entries: (data.timeEntries || []).filter(e => e.employeeId === selectedEmpId), month: currentDate.slice(0, 7), data, settings: data.settings }) }]} />
          <button className="btn btn-ghost" onClick={() => setFerienUebersicht(true)}>Übersicht ↗</button>
          <button className="btn btn-primary" onClick={openFerienAntrag}>Ferien beantragen</button>
        </div>
      ) : null} />


      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        {/* Tages-Erfassung */}
        <div style={{ position: "relative" }}>
          {!selectedEmpId && isAdmin && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(250,248,245,0.88)", zIndex: 10, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(1px)" }}>
              <div style={{ textAlign: "center", color: "var(--text4)" }}>
                {employees.length === 0 ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text3)" }}>Noch keine Mitarbeiter erfasst</div>
                    <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 4 }}>Mitarbeiter unter «Mitarbeiter» anlegen</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text3)" }}>Bitte zuerst einen Mitarbeiter wählen</div>
                    <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 4 }}>Mitarbeiterwahl rechts →</div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8, padding: "12px 16px" }}>
            <NavArrows onPrev={() => viewMode === "tag" ? changeDate(-1) : changeWeek(-1)} onNext={() => viewMode === "tag" ? changeDate(1) : changeWeek(1)} />
            <div ref={navCalRef} style={{ flex: 1, textAlign: "center", position: "relative" }}>
              {viewMode === "tag" ? (
                <div onClick={() => setNavCalOpen(o => !o)} style={{ cursor: "pointer", display: "inline-block" }} title="Datum wählen">
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 400 }}>
                    {`${weekdayLabel}, ${new Date(currentDate).toLocaleDateString("de-CH", { day: "numeric", month: "long" })}`}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 400 }}>{weekLabel}</div>
              )}
              {navCalOpen && (
                <CalendarPopup
                  value={currentDate}
                  onChange={ds => { setCurrentDate(ds); setNavCalOpen(false); }}
                  onClose={() => setNavCalOpen(false)}
                  showClear={false}
                />
              )}
            </div>
            {!isToday && <button className="btn btn-ghost" onClick={goToday} style={{ fontSize: 11 }}>Heute</button>}
            <div style={{ display: "flex", border: "1px solid var(--border2)", borderRadius: 20, overflow: "hidden", marginLeft: 4 }}>
              {[["tag", "Tag"], ["woche", "Woche"]].map(([mode, label], i) => (
                <React.Fragment key={mode}>
                  {i > 0 && <div style={{ width: 1, background: "var(--border2)", alignSelf: "stretch" }} />}
                  <button onClick={() => { setViewMode(mode); setWeekSelectStart(null); setWeekForm(null); setWeekEditForm(null); }} style={{
                    fontSize: 11, padding: "0 12px", height: 30, border: "none", cursor: "pointer", fontFamily: "inherit",
                    background: viewMode === mode ? "var(--text)" : "transparent",
                    color: viewMode === mode ? "var(--bg)" : "var(--text3)", transition: "all 0.15s",
                  }}>{label}</button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {viewMode === "tag" ? (
            <>
              <div className="card" style={{ padding: 0 }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "24%" }}>Projekt</th>
                      <th style={{ width: 130 }}>Phase / Position</th>
                      <th>Tätigkeit</th>
                      <th style={{ width: 80 }}>Std</th>
                      <th style={{ width: 80 }}>Min</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayEntries.length === 0 && (
                      <tr><td colSpan={6} className="empty-state">Keine Einträge an diesem Tag</td></tr>
                    )}
                    {dayEntries.map(e => {
                      const proj = data.projects.find(p => p.id === e.projectId);
                      const projEnabledIds = proj?.enabledPhases || [];
                      const enabledPhases = projEnabledIds.map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
                      const positions = proj?.positions || [];
                      const customPhases = proj?.customPhases || [];
                      const isInvoiced = !!e.invoiceId;
                      const disabled = isInvoiced || isMonthClosed(e.date);
                      const hasAnyPhase = enabledPhases.length > 0 || customPhases.length > 0 || positions.some(pos => (pos.enabledPhases || []).length > 0);
                      const combinedVal = e.phaseId ? (e.positionId ? e.phaseId + "|" + e.positionId : e.phaseId) : "";
                      const onCombinedChange = (val: string) => {
                        if (!val) { updateEntry(e.id, { phaseId: "", positionId: "" }); return; }
                        const [ph, pos] = val.split("|");
                        updateEntry(e.id, { phaseId: ph, positionId: pos || "" });
                      };
                      return (
                        <tr key={e.id} style={isInvoiced ? { opacity: 0.6, background: "#f5f2ed" } : {}}>
                          <td style={{ padding: "6px 8px" }}>
                            <select disabled={disabled} value={e.projectId} onChange={ev => { const proj = data.projects.find(p => p.id === ev.target.value); const { phaseId, positionId } = getFirstPhaseForProject(proj); updateEntry(e.id, { projectId: ev.target.value, phaseId, positionId }); }} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                              <option value="">—</option>
                              {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <select disabled={disabled || !hasAnyPhase} value={combinedVal} onChange={ev => onCombinedChange(ev.target.value)} style={{ border: `1px solid ${hasAnyPhase && !combinedVal && !disabled ? "var(--warning)" : "#e0dbd4"}`, height: 32, fontSize: 12, color: e.positionId ? "var(--pending)" : "inherit", fontWeight: e.positionId ? 600 : 400, opacity: !hasAnyPhase ? 0.4 : 1 }}>
                              <option value="">—</option>
                              {customPhases.length > 0 && (enabledPhases.length > 0 || positions.length > 0) && (<optgroup label="Eigene Phasen">{customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}</optgroup>)}
                              {customPhases.length > 0 && enabledPhases.length === 0 && positions.length === 0 && customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                              {positions.length === 0 && enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                              {positions.length > 0 && (<>{enabledPhases.length > 0 && (<optgroup label="Hauptauftrag">{enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>)}{positions.map(pos => { const pp = (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph); if(!pp.length) return null; return <optgroup key={pos.code} label={pos.code+(pos.label?" · "+pos.label:"")}>{pp.map(ph=><option key={ph.id} value={ph.id+"|"+pos.code}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>; })}</>)}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <input disabled={disabled} value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} placeholder="Was wurde gemacht?" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <input disabled={disabled} type="number" min={0} max={24} value={Math.floor((e.minutes || 0) / 60)} onChange={ev => updateEntry(e.id, { minutes: (+ev.target.value * 60) + ((e.minutes || 0) % 60) })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <select disabled={disabled} value={(e.minutes || 0) % 60} onChange={ev => updateEntry(e.id, { minutes: Math.floor((e.minutes || 0) / 60) * 60 + +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                              {[0, 15, 30, 45].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            <button disabled={disabled} className="btn btn-sm btn-danger" onClick={() => delEntry(e.id)}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ padding: "12px 12px" }}>
                        <button className="btn btn-ghost" onClick={addEntry} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button>
                      </td>
                      <td colSpan={2} style={{ padding: "12px 8px", textAlign: "right", fontSize: 13 }}>
                        <span style={{ color: "var(--text4)" }}>Tagestotal:&nbsp;</span><strong>{formatHours(dayTotalMins)}</strong>
                      </td>
                      <td></td>
                    </tr>
                    {selectedEmp && (daySoll > 0 || dayTotalMins > 0) && (
                      <tr style={{ borderTop: "1px solid var(--border2)", background: "var(--surface2)" }}>
                        <td colSpan={3} style={{ padding: "6px 12px", fontSize: 11, color: "var(--text4)" }}>{selectedEmp.name}{daySoll === 0 ? " · Wochenende / Feiertag" : " · Soll heute"}</td>
                        <td colSpan={2} style={{ padding: "6px 8px", textAlign: "right", fontSize: 12 }}>
                          {daySoll > 0 ? (<><span style={{ color: "var(--text4)" }}>{Math.round(daySoll * 10) / 10}h Soll&nbsp;·&nbsp;</span><span style={{ fontWeight: 600, color: dayDiff === 0 ? "var(--text2)" : dayDiff > 0 ? "var(--positive)" : "var(--negative)" }}>{dayDiff === 0 ? "±0h" : `${dayDiff > 0 ? "+" : ""}${dayDiff}h`}</span></>) : (<span style={{ fontWeight: 600, color: "#b07848" }}>{Math.round(dayIst * 10) / 10}h</span>)}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {dayAbs.length > 0 && (
                <div className="card" style={{ marginTop: 16, padding: 0 }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>ABSENZEN</div>
                  <table style={{ fontSize: 12 }}>
                    <thead><tr><th style={{ width: "22%" }}>Typ</th><th>Bemerkung</th><th style={{ width: 70 }}>Std</th><th style={{ width: 70 }}>Min</th><th style={{ width: 40 }}></th></tr></thead>
                    <tbody>
                      {dayAbs.map(a => {
                        const absTotalMins = a.startTime && a.endTime
                          ? (() => { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return Math.max(0,(eh*60+em)-(sh*60+sm)); })()
                          : (a.hours||0)*60+(a.minutes||0);
                        const absH = Math.floor(absTotalMins / 60);
                        const absM = absTotalMins % 60;
                        return (
                          <tr key={a.id}>
                            <td style={{ padding: "6px 8px" }}>
                              <select value={a.type || ""} onChange={ev => updateAbs(a.id, { type: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                                {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <input value={a.note || ""} onChange={ev => updateAbs(a.id, { note: ev.target.value })} placeholder="Bemerkung…" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <input type="number" min={0} max={24} value={absH} onChange={ev => updateAbs(a.id, { hours: +ev.target.value, minutes: absM })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <select value={absM} onChange={ev => updateAbs(a.id, { hours: absH, minutes: +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                                {[0, 15, 30, 45].map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>
                              <button className="btn btn-danger" style={{ padding: "0 8px", height: 28, fontSize: 12 }} onClick={() => delAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr><td colSpan={4} style={{ padding: "10px 12px" }}><button className="btn btn-ghost" onClick={addAbs} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button></td><td></td></tr></tfoot>
                  </table>
                </div>
              )}

              {dayAbs.length === 0 && (
                <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px", background: "var(--surface)" }} onClick={addAbs}>+ Absenz erfassen</button>
                </div>
              )}

              {dayExpenses.length > 0 && (
                <div className="card" style={{ marginTop: 16, padding: 0 }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>SPESEN</div>
                  <input ref={expReceiptInputRef} type="file" accept="image/*,application/pdf" onChange={handleExpReceiptUpload} style={{ display: "none" }} />
                  <table style={{ fontSize: 12 }}>
                    <thead><tr><th style={{ width: "22%" }}>Kategorie</th><th style={{ width: "20%" }}>Projekt</th><th>Beschreibung</th><th style={{ width: 90 }}>Betrag CHF</th><th style={{ width: 36, textAlign: "center" }}>Beleg</th><th style={{ width: 40 }}></th></tr></thead>
                    <tbody>
                      {dayExpenses.map(e => (
                        <tr key={e.id}>
                          <td style={{ padding: "6px 8px" }}><select value={e.category} onChange={ev => updateExp(e.id, { category: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>{(data.settings.expenseCategories || EXPENSE_CATEGORIES).map(c => <option key={c}>{c}</option>)}</select></td>
                          <td style={{ padding: "6px 8px" }}><select value={e.projectId || ""} onChange={ev => updateExp(e.id, { projectId: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}><option value="">— kein Projekt —</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                          <td style={{ padding: "6px 8px" }}><input value={e.description || ""} onChange={ev => updateExp(e.id, { description: ev.target.value })} placeholder="Beschreibung…" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} /></td>
                          <td style={{ padding: "6px 8px" }}><input type="number" step="0.05" min={0} value={e.amount || ""} onChange={ev => updateExp(e.id, { amount: +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} /></td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            {e.receiptData ? (
                              <button className="btn btn-ghost" title={e.receiptName || "Beleg anzeigen"} onClick={() => setReceiptView(e)} style={{ padding: "0 6px", height: 28 }}>
                                <span className="msr" style={{ fontSize: 16, verticalAlign: "middle", color: "var(--positive)" }}>receipt_long</span>
                              </button>
                            ) : (
                              <button className="btn btn-ghost" title="Beleg hochladen" onClick={() => { setUploadingExpId(e.id); expReceiptInputRef.current?.click(); }} style={{ padding: "0 6px", height: 28 }}>
                                <span className="msr" style={{ fontSize: 16, verticalAlign: "middle", color: "var(--text5)" }}>upload</span>
                              </button>
                            )}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}><button className="btn btn-danger" style={{ padding: "0 8px", height: 28, fontSize: 12 }} onClick={() => delExp(e.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={4} style={{ padding: "10px 12px" }}><button className="btn btn-ghost" onClick={addExp} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button></td><td style={{ padding: "10px 8px", textAlign: "right", fontSize: 13 }}><span style={{ color: "var(--text4)" }}>Total:&nbsp;</span><strong>{(dayExpenses.reduce((s, e) => s + (e.amount || 0), 0)).toFixed(2)}</strong></td><td></td></tr></tfoot>
                  </table>
                </div>
              )}

              {dayExpenses.length === 0 && (
                <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px", background: "var(--surface)" }} onClick={addExp}>+ Spese erfassen</button>
                </div>
              )}
            </>
          ) : (
            /* WOCHENANSICHT */
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {resizing && <style>{`* { cursor: ${resizing.edge === "move" ? "grabbing" : "ns-resize"} !important; user-select: none !important; }`}</style>}
              {/* Zeitraster mit sticky Tageskopf */}
              <div ref={weekGridRef} style={{ isolation: "isolate", overflowY: "auto", maxHeight: "calc(100vh - 260px)" }} onMouseLeave={() => setWeekHover(null)}>

                {/* Sticky Tageskopf */}
                <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "var(--surface)", borderBottom: "2px solid #e8e3dc", transform: "translateZ(0)", willChange: "transform" }}>
                  <div style={{ width: 44, flexShrink: 0 }} />
                  {weekDays.map(ds => {
                    const d = new Date(ds);
                    const isThisToday = ds === todayStr;
                    const isCurDay = ds === currentDate;
                    const ft = weekFTs.find(f => f.date === ds);
                    const isFeiertag = ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);
                    const dow = d.getDay();
                    const noWork = dow === 0 || dow === 6 || isFeiertag;
                    const isBeforeEintritt = !!(selectedEmp?.eintrittsdatum && ds < selectedEmp.eintrittsdatum);
                    const wkTotal = data.timeEntries.filter(e => e.date === ds && (!selectedEmpId || e.employeeId === selectedEmpId)).reduce((s, e) => s + (e.minutes || 0), 0);
                    const absMinutes = selectedEmpId ? (data.absences || []).filter(a => {
                      const matchDate = a.date === ds || (a.dateFrom && a.dateTo && ds >= a.dateFrom && ds <= a.dateTo);
                      return matchDate && a.employeeId === selectedEmpId && (!a.status || a.status === "approved");
                    }).reduce((s, a) => {
                      if (a.startTime && a.endTime) { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return s+(eh*60+em)-(sh*60+sm); }
                      const ex=(a.hours||0)*60+(a.minutes||0); return s+(ex>0?ex:getSollForDay(selectedEmp,ds)*60);
                    }, 0) : 0;
                    const istH = (wkTotal + absMinutes) / 60;
                    const sollH = selectedEmp ? getSollForDay(selectedEmp, ds) : 0;
                    const isPast = ds <= todayStr;
                    const isVacDay = selectedEmpId ? isApprovedVacationDay(selectedEmpId, ds) : false;
                    const isPendingVacDay = !isVacDay && selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && !f.originalData && ds >= f.dateFrom && ds <= f.dateTo) : false;
                    const diff = Math.round((istH - sollH) * 10) / 10;
                    return (
                      <div key={ds} style={{ flex: 1, textAlign: "center", padding: "8px 4px 6px", position: "relative", borderLeft: "1px solid var(--border2)", cursor: "pointer", background: isCurDay ? "#1a1a18" : isVacDay ? ((!isPast && Math.ceil((new Date(ds).getTime() - new Date(todayStr).getTime()) / 86400000) > 21) ? "var(--info-bg)" : "var(--positive-bg)") : isPendingVacDay ? "#fff8e8" : isFeiertag ? "#f5f2ed" : "var(--surface)" }}
                        onClick={() => { setCurrentDate(ds); setViewMode("tag"); }}>
                        <div style={{ fontSize: 9, letterSpacing: "0.1em", color: isCurDay ? "#e8e5df" : isBeforeEintritt ? "#ddd" : "var(--text5)" }}>{d.toLocaleDateString("de-CH", { weekday: "short" }).toUpperCase()}</div>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, lineHeight: 1.2, color: isCurDay ? "#e8e5df" : isBeforeEintritt ? "var(--text5)" : isThisToday ? "var(--accent)" : isFeiertag ? "#bbb" : "var(--text)" }}>{d.getDate()}</div>
                        <div style={{ position: "absolute", top: 8, right: 4, textAlign: "right", lineHeight: 1.2 }}>
                          {(() => {
                            if (!selectedEmp || noWork || isBeforeEintritt) return wkTotal > 0 ? <div style={{ fontSize: 9, fontWeight: 500, color: isCurDay ? "#e8e5df" : "#8a6a3a" }}>{istH.toFixed(1)}h</div> : null;
                            if (isVacDay && wkTotal === 0) {
                              const daysAway = Math.ceil((new Date(ds).getTime() - new Date(todayStr).getTime()) / 86400000);
                              const isPlanned = !isPast && daysAway > 21;
                              const color = isCurDay ? "#a0c4e8" : isPlanned ? "var(--info)" : "var(--positive)";
                              return <div style={{ fontSize: 8, fontWeight: 600, color }}>Ferien</div>;
                            }
                            if (isPendingVacDay && wkTotal === 0) return <div style={{ fontSize: 8, fontWeight: 600, color: isCurDay ? "#e8e5df" : "var(--warning)" }}>Ferien?</div>;
                            if (!isPast) return wkTotal > 0 ? <div style={{ fontSize: 9, fontWeight: 500, color: isCurDay ? "#e8e5df" : "#8a6a3a" }}>{istH.toFixed(1)}h</div> : null;
                            const saldoColor = isCurDay ? "#e8e5df" : diff === 0 ? "#555" : diff > 0 ? "var(--positive)" : "var(--warning)";
                            const saldoText = (wkTotal + absMinutes) === 0 ? `-${sollH.toFixed(1)}h` : diff === 0 ? `${istH.toFixed(1)}h` : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}h`;
                            return <div style={{ fontSize: 9, fontWeight: 600, color: saldoColor }}>{saldoText}</div>;
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>


                {/* Zeitgitter */}
                <div style={{ display: "flex" }}>
                <div style={{ width: 44, flexShrink: 0, pointerEvents: "none" }}>
                  {Array.from({ length: SLOT_COUNT }, (_, i) => {
                    const hour = i / 4;
                    const isOffHour = hour < 7 || hour >= 19;
                    const isHourMark = i % 4 === 0 && i > 0;
                    const labelColor = isOffHour ? "#7a9db8" : "#888";
                    return (
                      <div key={i} style={{ height: SLOT_H, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 6, paddingTop: 2, fontSize: 10, color: labelColor, lineHeight: 1, boxSizing: "border-box", borderTop: isHourMark ? `1px solid ${isOffHour ? "#e8eef2" : "#f0ede8"}` : "none", fontWeight: isOffHour ? 400 : 500 }}>
                        {isHourMark ? slotToTime(i) : ""}
                      </div>
                    );
                  })}
                </div>
                {weekDays.map(ds => {
                  const colTimed = data.timeEntries.filter(e => e.date === ds && e.startTime && (!selectedEmpId || e.employeeId === selectedEmpId));
                  const ft = weekFTs.find(f => f.date === ds);
                  const isFeiertag = ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);
                  const colBeforeEintritt = !!(selectedEmp?.eintrittsdatum && ds < selectedEmp.eintrittsdatum);
                  const isMaiTag = ds.slice(5) === "05-01";
                  const maiTagBlocked = isMaiTag && (data.settings.blockMaiTag !== false);
                  return (
                    <div key={ds} style={{ flex: 1, position: "relative", borderLeft: "1px solid var(--border2)", background: maiTagBlocked || colBeforeEintritt ? "#faf8f5" : isFeiertag ? "#f7f5f1" : "var(--surface)" }}>
                      {Array.from({ length: SLOT_COUNT }, (_, slotIdx) => {
                        const isHour = slotIdx % 4 === 0;
                        const isHalf = slotIdx % 2 === 0 && !isHour;
                        const slotHour = slotIdx / 4;
                        const isOffHours = slotHour < 7 || slotHour >= 19;
                        const inHover = weekSelectStart?.dayStr === ds && weekHover?.dayStr === ds && slotIdx >= Math.min(weekSelectStart.slotIdx, weekHover.slotIdx) && slotIdx <= Math.max(weekSelectStart.slotIdx, weekHover.slotIdx);
                        const isStart = weekSelectStart?.dayStr === ds && slotIdx === weekSelectStart.slotIdx && !weekHover;
                        const inSel = weekForm?.dayStr === ds && slotIdx >= weekForm.startSlot && slotIdx <= weekForm.endSlot;
                        const blocked = maiTagBlocked || colBeforeEintritt;
                        const offBg = isOffHours ? "rgba(100,140,175,0.06)" : "transparent";
                        return (
                          <div key={slotIdx} style={{ height: SLOT_H, boxSizing: "border-box", borderTop: slotIdx > 0 ? `1px solid ${isHour ? (isOffHours ? "#e4eaf0" : "#e8e3dc") : isHalf ? "#f0ede8" : "#f7f5f2"}` : "none", background: inSel ? "rgba(212,168,90,0.15)" : (inHover || isStart) ? "rgba(212,168,90,0.08)" : offBg, cursor: blocked ? "default" : "crosshair" }}
                            onClick={() => !blocked && !resizingRef.current && handleSlotClick(ds, slotIdx)}
                            onMouseEnter={() => setWeekHover({ dayStr: ds, slotIdx })} />
                        );
                      })}
                      {colTimed.map(e => {
                        const r = resizing;
                        const isRes = r?.entryId === e.id;
                        const dispStart = isRes && r.previewStart !== undefined ? r.previewStart : e.startTime;
                        const dispMins = isRes && r.previewMins !== undefined ? r.previewMins : e.minutes;
                        const [sh, sm] = (dispStart as string).split(":").map(Number);
                        const top = ((sh * 60 + sm) - SLOT_START_H * 60) / 15 * SLOT_H;
                        if (top < 0) return null;
                        const height = Math.max(SLOT_H, (dispMins / 15) * SLOT_H) - 2;
                        const proj = data.projects.find(p => p.id === e.projectId);
                        const bg = PROJ_COLORS[data.projects.findIndex(p => p.id === e.projectId) % PROJ_COLORS.length] || PROJ_COLORS[0];
                        const handleH = Math.min(5, Math.floor(height / 3));
                        const phaseDisplay = e.phaseId ? (() => {
                          const cp = (proj?.customPhases||[]).find(c => c.id === e.phaseId);
                          if (cp) return cp.label;
                          const sia = SIA_PHASES.find(p => p.id === e.phaseId);
                          return sia ? (e.positionId ? `${e.positionId}·${e.phaseId}` : e.phaseId) : e.phaseId;
                        })() : null;
                        const startResizing = (ev: React.MouseEvent, edge: string) => {
                          if (isMonthClosed(ds)) return;
                          ev.stopPropagation(); ev.preventDefault();
                          const [s, m] = (e.startTime as string).split(":").map(Number);
                          const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                          resizingRef.current = { entryId: e.id, dayStr: ds, empId: selectedEmpId, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: e.minutes, origStartTime: e.startTime, origSlot, previewStart: e.startTime, previewMins: e.minutes };
                          syncResizing();
                        };
                        const isMoving = isRes && r?.edge === "move";
                        return (
                          <div key={e.id} title={`${proj?.name||"—"}: ${(dispMins/60).toFixed(1)}h${e.description?" · "+e.description:""}`}
                            onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                            style={{ position: "absolute", top, left: 2, right: 2, height, background: bg, borderRadius: 3, padding: `${handleH}px 4px`, fontSize: 9, color: "#fff", overflow: "hidden", zIndex: isRes ? 10 : 2, boxSizing: "border-box", userSelect: "none" }}>
                            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: handleH, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "3px 3px 0 0", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "top")} />
                            <div style={{ position: "absolute", top: handleH, left: 0, right: 0, bottom: handleH, cursor: isMoving ? "grabbing" : "grab", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "move")} />
                            <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingTop: 1, pointerEvents: "none" }}>{proj?.name||"—"}</div>
                            {phaseDisplay && height > 24 && <div style={{ fontSize: 7, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 0, pointerEvents: "none" }}>{phaseDisplay}</div>}
                            {height > 36 && <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1, pointerEvents: "none" }}>{slotToTime((sh*60+sm-SLOT_START_H*60)/15)} – {slotToTime((sh*60+sm-SLOT_START_H*60)/15 + dispMins/15)}</div>}
                            {height > 52 && e.description && <div style={{ opacity: 0.75, fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{e.description}</div>}
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: handleH, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "0 0 3px 3px", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "bottom")} />
                          </div>
                        );
                      })}
                      {/* Absenz-Blöcke im Zeitraster */}
                      {(data.absences || []).filter(a => a.date === ds && a.startTime && a.endTime && (!selectedEmpId || a.employeeId === selectedEmpId)).map(a => {
                        const rA = resizing;
                        const isResA = rA?.entryId === a.id;
                        const dispStartA = isResA && rA.previewStart !== undefined ? rA.previewStart : a.startTime;
                        const [shA, smA] = (dispStartA as string).split(":").map(Number);
                        const dispMinsA = isResA && rA.previewMins !== undefined ? rA.previewMins : (() => { const [eh,em]=(a.endTime as string).split(":").map(Number); return (eh*60+em)-(shA*60+smA); })();
                        const topA = ((shA * 60 + smA) - SLOT_START_H * 60) / 15 * SLOT_H;
                        if (topA < 0) return null;
                        const heightA = Math.max(SLOT_H, (dispMinsA / 15) * SLOT_H) - 2;
                        const handleHA = Math.min(5, Math.floor(heightA / 3));
                        const t = absenzTypes.find(x => x.id === a.type);
                        const bg = t?.color || "#888";
                        const isMovingA = isResA && rA?.edge === "move";
                        const origDurA = (() => { const [eh,em]=(a.endTime as string).split(":").map(Number); return (eh*60+em)-(shA*60+smA); })();
                        const startResizingA = (ev: React.MouseEvent, edge: string) => {
                          if (isMonthClosed(ds)) return;
                          ev.stopPropagation(); ev.preventDefault();
                          const [s, m] = (a.startTime as string).split(":").map(Number);
                          const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                          resizingRef.current = { entryId: a.id, dayStr: ds, empId: selectedEmpId, isAbs: true, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: origDurA, origStartTime: a.startTime, origSlot, previewStart: a.startTime, previewMins: origDurA };
                          syncResizing();
                        };
                        return (
                          <div key={a.id} title={`${t?.label || a.type}: ${(dispMinsA/60).toFixed(1)}h${a.note ? " · " + a.note : ""}`}
                            style={{ position: "absolute", top: topA, left: 2, right: 2, height: heightA, background: bg, opacity: 0.85, borderRadius: 3, padding: `${handleHA}px 5px`, fontSize: 9, color: "#fff", overflow: "hidden", zIndex: isResA ? 10 : 2, boxSizing: "border-box", userSelect: "none" }}>
                            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: handleHA, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "3px 3px 0 0", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "top")} />
                            <div style={{ position: "absolute", top: handleHA, left: 0, right: 0, bottom: handleHA, cursor: isMovingA ? "grabbing" : "grab", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "move")} />
                            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{t?.label || a.type}</div>
                            {heightA > 28 && <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1, pointerEvents: "none" }}>{dispStartA} – {slotToTime((shA*60+smA-SLOT_START_H*60)/15 + dispMinsA/15)}</div>}
                            {heightA > 44 && a.note && <div style={{ opacity: 0.75, fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{a.note}</div>}
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: handleHA, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "0 0 3px 3px", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "bottom")} />
                          </div>
                        );
                      })}
                      {ds === todayStr && (() => {
                        const now = new Date();
                        const top = (now.getHours() * 60 + now.getMinutes() - SLOT_START_H * 60) / 15 * SLOT_H;
                        if (top < 0 || top > SLOT_COUNT * SLOT_H) return null;
                        return <div style={{ position: "absolute", left: 0, right: 0, top, height: 2, background: "var(--accent)", zIndex: 5, pointerEvents: "none" }} />;
                      })()}
                    </div>
                  );
                })}
                </div>{/* end display:flex time grid */}
              </div>{/* end scroll container */}


              {weekSelectStart && !weekForm && (
                <div style={{ borderTop: "1px solid var(--border2)", padding: "8px 16px 8px 56px", fontSize: 11, color: "var(--text4)", background: "var(--surface2)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>{slotToTime(weekSelectStart.slotIdx)}</span>
                  <span>ausgewählt — Endzeit anklicken</span>
                  <button className="btn btn-ghost" onClick={() => setWeekSelectStart(null)} style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px" }}>Abbrechen</button>
                </div>
              )}

              {weekForm && (() => {
                const isAbsMode = weekForm.mode === "absenz";
                const accentColor = isAbsMode ? (absenzTypes.find(t => t.id === weekForm.absType)?.color || "#6b5a8a") : "var(--accent)";
                const proj = data.projects.find(p => p.id === weekForm.projectId);
                const enabledPhases = (proj?.enabledPhases||[]).map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
                const customPhases = proj?.customPhases || [];
                const positions = proj?.positions || [];
                const hasPhase = enabledPhases.length > 0 || customPhases.length > 0 || positions.some(pos => (pos.enabledPhases||[]).length > 0);
                const combinedVal = weekForm.phaseId ? (weekForm.positionId ? weekForm.phaseId+"|"+weekForm.positionId : weekForm.phaseId) : "";
                const onPhaseChange = (val: string) => { if (!val) { setWeekForm({...weekForm, phaseId:"", positionId:""}); return; } const [ph,pos]=val.split("|"); setWeekForm({...weekForm, phaseId:ph, positionId:pos||""}); };
                const mins = (weekForm.endSlot - weekForm.startSlot + 1) * 15;
                return (
                  <div style={{ borderTop: `2px solid ${accentColor}`, padding: "12px 16px", background: "var(--surface2)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.1em", color: accentColor, fontWeight: 600 }}>
                        {new Date(weekForm.dayStr).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {slotToTime(weekForm.startSlot)} – {slotToTime(weekForm.endSlot + 1)} · {mins >= 60 ? `${mins%60===0?mins/60:(mins/60).toFixed(1)}h` : `${mins} min`}
                      </div>
                      <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
                        {[["projekt", "Projekt"], ["absenz", "Intern / Absenz"]].map(([m, label]) => (
                          <button key={m} className={`pill${weekForm.mode === m ? " active" : ""}`} onClick={() => setWeekForm({ ...weekForm, mode: m })}>{label}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {isAbsMode ? (
                        <>
                          <div style={{ flex: "1 1 180px" }}>
                            <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TYP</div>
                            <select value={weekForm.absType || ""} onChange={e => setWeekForm({ ...weekForm, absType: e.target.value })} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                              <option value="">— wählen —</option>
                              {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: "2 1 180px" }}>
                            <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>NOTIZ</div>
                            <input value={weekForm.absNote || ""} onChange={e => setWeekForm({ ...weekForm, absNote: e.target.value })} placeholder="Notiz…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && saveWeekEntry()} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ flex: "1 1 150px" }}>
                            <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PROJEKT</div>
                            <select value={weekForm.projectId} onChange={e => { const proj = data.projects.find(p => p.id === e.target.value); const { phaseId, positionId } = getFirstPhaseForProject(proj); setWeekForm({...weekForm, projectId:e.target.value, phaseId, positionId: positionId || ""}); }} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                              <option value="">— wählen —</option>
                              {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                          {hasPhase && (
                            <div style={{ flex: "1 1 120px" }}>
                              <div style={{ fontSize: 10, color: !combinedVal ? "var(--warning)" : "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PHASE *</div>
                              <select value={combinedVal} onChange={e => onPhaseChange(e.target.value)} style={{ height: 34, fontSize: 12, width: "100%", borderColor: !combinedVal ? "var(--warning)" : undefined }}>
                                <option value="">— wählen —</option>
                                {customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                                {enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                                {positions.flatMap(pos => (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph).map(ph => <option key={ph.id+"|"+pos.code} value={ph.id+"|"+pos.code}>{pos.code} · {ph.id}</option>))}
                              </select>
                            </div>
                          )}
                          <div style={{ flex: "2 1 180px" }}>
                            <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TÄTIGKEIT</div>
                            <input value={weekForm.description} onChange={e => setWeekForm({...weekForm, description:e.target.value})} placeholder="Beschreibung…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && saveWeekEntry()} />
                          </div>
                        </>
                      )}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-primary" onClick={saveWeekEntry} disabled={isAbsMode ? !weekForm.absType : (!weekForm.projectId || (hasPhase && !combinedVal))} style={{ fontSize: 12, height: 34 }}>Speichern</button>
                        <button className="btn btn-ghost" onClick={() => { setWeekForm(null); setWeekSelectStart(null); }} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {weekEditForm && !weekForm && (() => {
                if (weekEditForm.isAbs) {
                  const a = (data.absences||[]).find(x => x.id === weekEditForm.entryId);
                  if (!a) return null;
                  const t = absenzTypes.find(x => x.id === a.type);
                  const accentColor = t?.color || "#6b5a8a";
                  const [shE,smE]=(a.startTime as string).split(":").map(Number); const [ehE,emE]=(a.endTime as string).split(":").map(Number);
                  const durE = (ehE*60+emE)-(shE*60+smE);
                  return (
                    <div style={{ borderTop: `2px solid ${accentColor}`, padding: "12px 16px", background: "var(--surface2)" }}>
                      <div style={{ fontSize: 10, color: accentColor, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 10 }}>
                        {new Date(a.date as string).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {a.startTime} – {a.endTime} · {(durE/60).toFixed(1)}h
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div style={{ flex: "1 1 180px" }}>
                          <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TYP</div>
                          <select value={a.type || ""} onChange={ev => update("absences", (data.absences||[]).map(x => x.id === a.id ? {...x, type: ev.target.value} : x))} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                            <option value="">— wählen —</option>
                            {absenzTypes.map(at => <option key={at.id} value={at.id}>{at.label}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: "2 1 180px" }}>
                          <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>NOTIZ</div>
                          <input value={a.note || ""} onChange={ev => update("absences", (data.absences||[]).map(x => x.id === a.id ? {...x, note: ev.target.value} : x))} placeholder="Notiz…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-danger" onClick={() => { update("absences", (data.absences||[]).filter(x => x.id !== a.id)); setWeekEditForm(null); }} style={{ fontSize: 12, height: 34 }}>Löschen</button>
                          <button className="btn btn-ghost" onClick={() => setWeekEditForm(null)} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  const e = data.timeEntries.find(x => x.id === weekEditForm.entryId);
                  if (!e) return null;
                  const projE = data.projects.find(p => p.id === e.projectId);
                  const enabledPhasesE = (projE?.enabledPhases||[]).map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
                  const customPhasesE = projE?.customPhases || [];
                  const positionsE = projE?.positions || [];
                  const hasPhaseE = enabledPhasesE.length > 0 || customPhasesE.length > 0 || positionsE.some(pos => (pos.enabledPhases||[]).length > 0);
                  const combinedValE = e.phaseId ? (e.positionId ? e.phaseId+"|"+e.positionId : e.phaseId) : "";
                  const onPhaseChangeE = (val: string) => { if (!val) { updateEntry(e.id, { phaseId: "", positionId: "" }); return; } const [ph, pos] = val.split("|"); updateEntry(e.id, { phaseId: ph, positionId: pos || "" }); };
                  const isInvoiced = !!e.invoiceId;
                  const disabledE = isInvoiced || isMonthClosed(e.date);
                  const bgE = PROJ_COLORS[data.projects.findIndex(p => p.id === e.projectId) % PROJ_COLORS.length] || PROJ_COLORS[0];
                  const durE = e.startTime && e.endTime ? (() => { const [sh,sm]=e.startTime.split(":").map(Number); const [eh,em]=e.endTime.split(":").map(Number); return (eh*60+em)-(sh*60+sm); })() : e.minutes;
                  return (
                    <div style={{ borderTop: `2px solid ${bgE}`, padding: "12px 16px", background: "var(--surface2)" }}>
                      <div style={{ fontSize: 10, color: bgE, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{new Date(e.date).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {e.startTime} – {e.endTime} · {(durE/60).toFixed(1)}h</span>
                        {isInvoiced && <span style={{ fontSize: 9, color: "var(--warning)", fontWeight: 400 }}>verrechnet</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div style={{ flex: "1 1 150px" }}>
                          <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PROJEKT</div>
                          <select disabled={disabledE} value={e.projectId} onChange={ev => updateEntry(e.id, { projectId: ev.target.value, phaseId: "", positionId: "" })} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                            <option value="">—</option>
                            {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        {hasPhaseE && (
                          <div style={{ flex: "1 1 120px" }}>
                            <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PHASE</div>
                            <select disabled={disabledE} value={combinedValE} onChange={ev => onPhaseChangeE(ev.target.value)} style={{ height: 34, fontSize: 12, width: "100%" }}>
                              <option value="">—</option>
                              {customPhasesE.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                              {enabledPhasesE.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                              {positionsE.flatMap(pos => (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph).map(ph => <option key={ph.id+"|"+pos.code} value={ph.id+"|"+pos.code}>{pos.code} · {ph.id}</option>))}
                            </select>
                          </div>
                        )}
                        <div style={{ flex: "2 1 180px" }}>
                          <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TÄTIGKEIT</div>
                          <input disabled={disabledE} value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} placeholder="Beschreibung…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-danger" disabled={disabledE} onClick={() => { delEntry(e.id); setWeekEditForm(null); }} style={{ fontSize: 12, height: 34, opacity: disabledE ? 0.4 : 1 }}>Löschen</button>
                          <button className="btn btn-ghost" onClick={() => setWeekEditForm(null)} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                        </div>
                      </div>
                    </div>
                  );
                }
              })()}
            </div>
          )}
        </div>

        {/* Modal: Ferien-Übersicht */}
        {ferienUebersicht && selectedEmp && (
          <Modal title={`Ferien — ${selectedEmp.name}`} onClose={() => setFerienUebersicht(false)} hideSave>
            {(() => {
              const today = localISODate();
              const empFerien = (data.ferienEntries || []).filter(f => f.employeeId === selectedEmp.id).sort((a, b) => (b.dateFrom || "").localeCompare(a.dateFrom || ""));
              if (empFerien.length === 0) return <div style={{ fontSize: 13, color: "var(--text5)", padding: "12px 0" }}>Keine Ferieneinträge vorhanden.</div>;
              const groups = [
                { label: "Pendent", entries: empFerien.filter(f => f.status === "pending") },
                { label: "Bestätigt", entries: empFerien.filter(f => f.status !== "pending") },
              ];
              return groups.filter(g => g.entries.length > 0).map(g => (
                <div key={g.label} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 8 }}>{g.label.toUpperCase()}</div>
                  {g.entries.map(f => {
                    const isPending = f.status === "pending";
                    const isEditPending = isPending && !!f.originalData;
                    const displayTo = isPending && f.originalData ? f.originalData.dateTo : f.dateTo;
                    const isPast = displayTo < today;
                    return (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border2)" }}>
                        <div style={{ flex: 1 }}>
                          {isEditPending ? (
                            <>
                              <div style={{ fontSize: 11, color: "var(--text5)", textDecoration: "line-through" }}>{formatDate(f.originalData?.dateFrom)} – {formatDate(f.originalData?.dateTo)}</div>
                              <div style={{ fontSize: 13, color: "#222" }}>{formatDate(f.dateFrom)} – {formatDate(f.dateTo)} <span style={{ fontSize: 10, color: "var(--warning)", fontWeight: 600 }}>neu</span></div>
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: "#222" }}>{formatDate(f.dateFrom)} – {formatDate(f.dateTo)}</div>
                          )}
                          {f.note && <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>{f.note}</div>}
                        </div>
                        <span style={{ fontSize: 10, padding: "2px 10px", borderRadius: 20, background: isPending ? "#fff8e8" : "var(--positive-bg)", color: isPending ? "var(--warning)" : "var(--positive)", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
                          {isEditPending ? "Änderung" : isPending ? "pendent" : "bestätigt"}
                        </span>
                        {!isPast && !isPending && (
                          <button onClick={() => { setFerienUebersicht(false); editFerien(f); }} style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", fontSize: 13, padding: "0 3px", lineHeight: 1, flexShrink: 0 }} title="Bearbeiten"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>edit</span></button>
                        )}
                        {isPast
                          ? <span style={{ fontSize: 11, color: "var(--text5)", flexShrink: 0, padding: "0 4px" }}>vergangen</span>
                          : isEditPending
                            ? <button onClick={() => cancelFerienEdit(f.id)} style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, flexShrink: 0 }} title="Änderung verwerfen"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                            : <button className="btn btn-sm btn-danger" onClick={() => deleteFerien(f.id)} title="Zurücknehmen"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                        }
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </Modal>
        )}

        {/* Modal: Ferienantrag */}
        {antragModal === "ferien" && (
          <Modal title="Ferien beantragen" onClose={() => setAntragModal(null)} onSave={saveAntrag} overflow>
            {employees.length > 1 && (
              <FormField label="Mitarbeiter">
                <select value={antragForm.employeeId || ""} onChange={e => setAntragForm({ ...antragForm, employeeId: e.target.value })}>
                  <option value="">— wählen —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </FormField>
            )}
            <div className="form-row">
              <FormField label="Von"><DatePicker value={antragForm.dateFrom || ""} onChange={e => setAntragForm({ ...antragForm, dateFrom: e.target.value })} /></FormField>
              <FormField label="Bis"><DatePicker value={antragForm.dateTo || ""} onChange={e => setAntragForm({ ...antragForm, dateTo: e.target.value })} /></FormField>
            </div>
            <FormField label="Notiz (optional)"><input value={antragForm.note || ""} onChange={e => setAntragForm({ ...antragForm, note: e.target.value })} /></FormField>
          </Modal>
        )}

        <div>
          {employees.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>MITARBEITER</div>
              {(() => {
                const canSwitchEmployee = isAdmin || (userPermissions || []).includes("mitarbeiter");
                if (canSwitchEmployee) {
                  return (
                    <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)} style={{ width: "100%", fontSize: 13 }}>
                      {isAdmin && <option value="">— Alle / Kein Filter —</option>}
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.pensum||100}%</option>)}
                    </select>
                  );
                }
                return (
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                    {employees.find(e => e.id === myEmployeeId)?.name || "—"}
                  </div>
                );
              })()}
            </div>
          )}
          <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <NavArrows onPrev={() => { const [y,m]=currentDate.split("-").map(Number); const d=new Date(Date.UTC(y,m-1,1)); d.setUTCMonth(d.getUTCMonth()-1); setCurrentDate(d.toISOString().slice(0, 10)); }} onNext={() => { const [y,m]=currentDate.split("-").map(Number); const d=new Date(Date.UTC(y,m-1,1)); d.setUTCMonth(d.getUTCMonth()+1); setCurrentDate(d.toISOString().slice(0, 10)); }} />
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, textAlign: "center" }}>{monthLabel}</div>
            <div style={{ width: 55 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 6 }}>
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => (
              <div key={d} style={{ fontSize: 9, color: "var(--text5)", textAlign: "center", letterSpacing: "0.05em", padding: "4px 0" }}>{d}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {monthCells.map((cell, i) => {
              if (!cell) return <div key={i}></div>;
              const isSelected = cell.dateStr === currentDate;
              const isCurToday = cell.dateStr === localISODate();
              const hasEntries = cell.mins > 0;
              const noWork = cell.isWeekend || cell.isFeiertag;
              const isVortag = cell.isVortag && !cell.isFeiertag;

              let bg = "transparent";
              if (isSelected) bg = "#1a1a18";
              else if (cell.isFerien) bg = "#e8f5ee";
              else if (cell.isPendingFerien) bg = "#fff8e8";
              else if (cell.isAbsenz) bg = "#f0f0f0";
              else if (cell.isPendingAbsenz) bg = "#f5f0f8";
              else if (hasEntries && !noWork) bg = "#faf3e4";
              else if (hasEntries && noWork) bg = "#f5f0e8";

              const textColor = isSelected ? "#e8e5df" : (noWork && !hasEntries) ? "#ccc" : "#1a1a18";

              return (
                <button key={i} onClick={() => setCurrentDate(cell.dateStr)} style={{
                  aspectRatio: "1", padding: 1,
                  background: bg, color: textColor,
                  border: isCurToday && !isSelected ? "1.5px solid var(--accent)" : "1px solid transparent",
                  borderRadius: 4, fontFamily: "inherit",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "all 0.1s",
                }}>
                  <div style={{ fontSize: 11, fontWeight: noWork ? 400 : 500 }}>{cell.day}</div>
                  {!selectedEmp && hasEntries && (
                    <div style={{ fontSize: 7, color: isSelected ? "#e8e5df" : "#8a6a3a", marginTop: 1 }}>
                      {(cell.mins / 60).toFixed(1)}h
                    </div>
                  )}
                  {selectedEmp && hasEntries && (
                    <div style={{ fontSize: 7, color: isSelected ? "#e8e5df" : "var(--positive)", fontWeight: 600, marginTop: 1 }}>
                      {(cell.mins / 60).toFixed(1)}h
                    </div>
                  )}
                  {(cell.isFerien || cell.isPendingFerien) && !isSelected && (
                    <div style={{ marginTop: 2, display: "flex", justifyContent: "center" }}>
                      {cell.isPendingFerien ? (
                        <div style={{ fontSize: 7, color: "var(--warning)", lineHeight: 1 }}>?</div>
                      ) : (
                        <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
                          <circle cx="6" cy="6" r="2.5" fill="var(--positive)"/>
                          <line x1="6" y1="0" x2="6" y2="2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="6" y1="10" x2="6" y2="12" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="0" y1="6" x2="2" y2="6" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="10" y1="6" x2="12" y2="6" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="1.8" y1="1.8" x2="3.2" y2="3.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="8.8" y1="8.8" x2="10.2" y2="10.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="10.2" y1="1.8" x2="8.8" y2="3.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                          <line x1="3.2" y1="8.8" x2="1.8" y2="10.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                  )}
                  {(cell.isAbsenz || cell.isPendingAbsenz) && !isSelected && !cell.isFerien && !cell.isPendingFerien && (
                    <div style={{ fontSize: 7, color: cell.isPendingAbsenz ? "#7a5a9a" : "var(--text4)", marginTop: 1 }}>
                      {cell.isPendingAbsenz ? "?" : <span className="msr" style={{fontSize:8,verticalAlign:"middle"}}>close</span>}
                    </div>
                  )}
                  {isVortag && !hasEntries && !cell.isFerien && !cell.isAbsenz && (
                    <div style={{ fontSize: 7, color: "var(--text5)", marginTop: 1 }}>−1h</div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: "var(--text4)" }}>Monatstotal</span>
            <strong>{formatHours(monthTotalMins)}</strong>
          </div>
        </div>

        {selectedEmp && (
          <div className="card" style={{ marginTop: 12, padding: "14px 16px" }}>
            <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--border2)" }}>
              <div className="section-label" style={{ marginBottom: 4 }}>Saldo seit Eintritt</div>
              {totalSaldo && [
                { label: "Soll bis heute", value: `${totalSaldo.soll}h` },
                { label: "IST", value: `${totalSaldo.ist}h` },
              ].map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                  <span>{r.label}</span><span>{r.value}</span>
                </div>
              ))}
              {totalSaldo && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                  <span>Saldo</span>
                  <strong style={{ color: totalSaldo.saldo >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {totalSaldo.saldo === 0 ? "0h" : `${totalSaldo.saldo > 0 ? "+" : ""}${totalSaldo.saldo}h`}
                  </strong>
                </div>
              )}
            </div>
            <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--border2)" }}>
              <div className="section-label" style={{ marginBottom: 4 }}>Monatssaldo — {new Date(currentDate + "T12:00:00").toLocaleString("de-CH", { month: "long" })}</div>
              {monthSaldo && [
                { label: "Soll", value: `${monthSaldo.soll}h` },
                { label: "IST", value: `${monthSaldo.ist}h` },
              ].map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                  <span>{r.label}</span><span>{r.value}</span>
                </div>
              ))}
              {monthSaldo && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                  <span>Saldo</span>
                  <strong style={{ color: monthSaldo.saldo >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {monthSaldo.saldo === 0 ? "0h" : `${monthSaldo.saldo > 0 ? "+" : ""}${monthSaldo.saldo}h`}
                  </strong>
                </div>
              )}
            </div>
            <div>
              <div className="section-label" style={{ marginBottom: 4 }}>Ferien {new Date().getFullYear()}</div>
              {ferienSaldo && [
                { label: "Anspruch", value: `${ferienSaldo.anspruch}h`, show: true },
                { label: "Übertrag", value: `${ferienSaldo.ubertrag}h`, show: ferienSaldo.ubertrag > 0 },
                { label: "Bezogen", value: `${ferienSaldo.bezogen}h`, show: ferienSaldo.bezogen > 0 },
                { label: "Geplant", value: `${ferienSaldo.geplant}h`, show: ferienSaldo.geplant > 0 },
              ].filter(r => r.show).map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                  <span>{r.label}</span><span>{r.value}</span>
                </div>
              ))}
              {ferienSaldo && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                  <span>Rest</span>
                  <strong style={{ color: ferienSaldo.rest >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {ferienSaldo.rest === 0 ? "0h" : `${ferienSaldo.rest > 0 ? "+" : ""}${ferienSaldo.rest}h`}
                  </strong>
                </div>
              )}
            </div>
          </div>
        )}

        </div>
      </div>

      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />

      {contextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} onContextMenu={ev => { ev.preventDefault(); setContextMenu(null); }} />
          <div style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 1000, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 180, padding: "4px 0" }}>
            <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "var(--text)" }}
              onMouseEnter={ev => ev.currentTarget.style.background = "#faf8f5"}
              onMouseLeave={ev => ev.currentTarget.style.background = "none"}
              onClick={() => { duplicateToNextDay(contextMenu.entry); setContextMenu(null); }}>
              Auf morgen kopieren
            </button>
          </div>
        </>
      )}
    </div>
  );
}

