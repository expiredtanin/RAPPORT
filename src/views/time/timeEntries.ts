// Zeiterfassung: Aktionen auf Zeiteinträgen (anlegen, ändern, löschen, auf den nächsten Tag kopieren).
// Sperren (verrechnet, Monat abgeschlossen) wie bisher mit alert().

import { generateId } from "../../utils";
import type { TimeEntry, UpdateFn, AppData } from "../../types";
import { getFirstPhaseForProject } from "./timeUtils";

/** Parameter der Eintrags-Aktionen (Daten, Update-Funktion, gewählter Tag/Mitarbeiter, Monatssperre). */
interface EntryActionsArgs {
  data: AppData;
  update: UpdateFn;
  currentDate: string;
  selectedEmpId: string;
  isMonthClosed: (date?: string) => boolean;
}

/** Liefert addEntry / updateEntry / delEntry / duplicateToNextDay für die Tagesliste und das Wochenraster. */
export function createEntryActions({ data, update, currentDate, selectedEmpId, isMonthClosed }: EntryActionsArgs) {
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

  const duplicateToNextDay = (entry: TimeEntry) => {
    const d = new Date(`${entry.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDay = d.toISOString().slice(0, 10);
    update("timeEntries", [...data.timeEntries, { ...entry, id: generateId(), date: nextDay, createdAt: new Date().toISOString() }]);
  };
  return { addEntry, updateEntry, delEntry, duplicateToNextDay };
}
