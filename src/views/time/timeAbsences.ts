// Zeiterfassung: Absenzen des gewählten Tages (Tagesliste, Ist/Soll-Differenz) und ihre Aktionen.

import { generateId, getAbsenzTypes } from "../../utils";
import type { AppData, Absence, Employee, UpdateFn } from "../../types";

/** Parameter der Absenz-Ableitungen (Tag, Mitarbeiter, Tages-Soll und gebuchte Minuten). */
interface AbsenceArgs {
  data: AppData;
  update: UpdateFn;
  currentDate: string;
  selectedEmpId: string;
  selectedEmp: Employee | null;
  employees: Employee[];
  daySoll: number;
  dayTotalMins: number;
}

/** Absenz-Typen, Absenzen des Tages, Tages-Differenz und die Aktionen addAbs / updateAbs / delAbs. */
export function buildAbsenceState({ data, update, currentDate, selectedEmpId, selectedEmp, employees, daySoll, dayTotalMins }: AbsenceArgs) {
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
  return { absenzTypes, dayAbs, dayIst, dayDiff, addAbs, updateAbs, delAbs };
}
