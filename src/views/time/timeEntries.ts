// Zeiterfassung: Aktionen auf Zeiteinträgen (anlegen, ändern, löschen, auf den nächsten Tag kopieren).
// Sperren (verrechnet, Monat abgeschlossen) melden sich mit einer kurzen Meldung (showToast; showToast() ist im
// Tauri-Fenster stumm). Löschen mit «Rückgängig».

import { generateId } from "../../utils";
import { showToast } from "../../toast";
import { removeWithUndo } from "../../undo";
import { shiftDate } from "../../worktime";
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
    if (isMonthClosed(currentDate)) { showToast("Dieser Monat ist abgeschlossen und kann nicht mehr bearbeitet werden."); return; }
    const firstActive = data.projects.find(p => p.status === "aktiv") || data.projects[0];
    const { phaseId, positionId } = getFirstPhaseForProject(firstActive);
    const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const todayEnds = data.timeEntries.filter(e => e.date === currentDate && (!selectedEmpId || e.employeeId === selectedEmpId) && e.endTime);
    let startMins = 8 * 60;
    if (todayEnds.length > 0) {
      const maxEnd = todayEnds.reduce((max, e) => { const [h, m] = (e.endTime as string).split(":").map(Number); return Math.max(max, h * 60 + m); }, 0);
      if (maxEnd > 0) startMins = Math.min(maxEnd, 23 * 60);   // neuer Eintrag endet spätestens 24:00
    }
    const defaultMins = 60;
    const newEntry = { id: generateId(), date: currentDate, projectId: firstActive?.id || "", phaseId, positionId, minutes: defaultMins, startTime: toTime(startMins), endTime: toTime(startMins + defaultMins), description: "", createdAt: new Date().toISOString(), ...(selectedEmpId ? { employeeId: selectedEmpId } : {}) } as TimeEntry;
    update("timeEntries", [...data.timeEntries, newEntry]);
  };

  const updateEntry = (id: string, changes: Partial<TimeEntry>) => {
    const entry = data.timeEntries.find(e => e.id === id);
    if (entry?.invoiceId) { showToast("Dieser Eintrag ist bereits verrechnet und kann nicht mehr geändert werden. Lösche zuerst die zugehörige Rechnung."); return; }
    if (isMonthClosed(entry?.date)) { showToast("Dieser Monat ist abgeschlossen und kann nicht mehr bearbeitet werden."); return; }
    const merged = { ...entry, ...changes };
    if ("minutes" in changes && merged.startTime) {
      const [h, m] = merged.startTime.split(":").map(Number);
      // Ein Eintrag endet spätestens um Mitternacht (sonst entstand «25:00»); Rest am Folgetag erfassen
      const minutes = Math.max(0, Math.min(merged.minutes || 0, 24 * 60 - (h * 60 + m)));
      const endMins = h * 60 + m + minutes;
      changes = { ...changes, minutes, endTime: `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}` };
    }
    update("timeEntries", data.timeEntries.map(e => e.id === id ? { ...e, ...changes } : e));
  };

  const delEntry = (id: string) => {
    const entry = data.timeEntries.find(e => e.id === id);
    if (entry?.invoiceId) { showToast("Dieser Eintrag ist bereits verrechnet und kann nicht gelöscht werden. Lösche zuerst die zugehörige Rechnung."); return; }
    if (isMonthClosed(entry?.date)) { showToast("Dieser Monat ist abgeschlossen und kann nicht mehr gelöscht werden."); return; }
    removeWithUndo("Zeiteintrag gelöscht", "timeEntries", e => e.id === id);
  };

  const duplicateToNextDay = (entry: TimeEntry) => {
    const nextDay = shiftDate(entry.date, 1);
    if (isMonthClosed(nextDay)) { showToast("Der Folgetag liegt in einem abgeschlossenen Monat."); return; }
    // Die Kopie ist ein neuer, unverrechneter Eintrag (vorher wurde `invoiceId` mitkopiert → gesperrt und
    // fälschlich als verrechnet gezählt)
    const { invoiceId: _inv, ...rest } = entry;
    update("timeEntries", [...data.timeEntries, { ...rest, id: generateId(), date: nextDay, createdAt: new Date().toISOString() }]);
  };
  return { addEntry, updateEntry, delEntry, duplicateToNextDay };
}
