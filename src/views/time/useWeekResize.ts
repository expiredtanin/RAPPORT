// Zeiterfassung, Wochenraster: Zustand und Maus-Handler für das Ziehen/Verschieben/Verlängern von Einträgen.

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";
import type { AppData, UpdateFn } from "../../types";
import { SLOT_H, SLOT_COUNT, SLOT_START_H, slotToTime, type ResizeState, type WeekEditForm } from "./timeUtils";

/** Arbeitsstand (`resizingRef`), Render-Kopie (`resizing`) und die globalen mousemove/mouseup-Handler des Wochenrasters. */
export function useWeekResize(
  weekGridRef: RefObject<HTMLDivElement | null>,
  data: AppData,
  update: UpdateFn,
  setWeekEditForm: Dispatch<SetStateAction<WeekEditForm | null>>,
) {
  const resizingRef = useRef<ResizeState | null>(null);
  // `resizingRef` ist der Arbeitsstand der Maus-Handler, `resizing` eine Kopie davon fürs Rendern (Vorschau)
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const syncResizing = () => setResizing(resizingRef.current ? { ...resizingRef.current } : null);
  // Neuester Stand für die Maus-Handler beim Ziehen/Ändern der Dauer (die nicht bei jedem Render neu registriert werden)
  const dataRef = useRef(data);
  const updateRef = useRef(update);
  useLayoutEffect(() => { dataRef.current = data; updateRef.current = update; });

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      // Verrechnete Einträge sind gesperrt (wie in der Tagesliste): Klick öffnet nur die Ansicht, kein Ziehen
      if (!r.isAbs && dataRef.current.timeEntries.find(e => e.id === r.entryId)?.invoiceId) return;
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
      // Verschieben behält die genaue Dauer (z.B. 17 min aus der Stoppuhr), nur Ziehen an den Kanten rastet auf 15 min
      if (!overlaps) { r.previewStart = slotToTime(newStart); r.previewMins = r.edge === "move" ? Math.min(r.origMinutes, (SLOT_COUNT - newStart) * 15) : newDur * 15; }
      syncResizing();
    };
    const onUp = () => {
      const r = resizingRef.current;
      if (r) {
        if (!r.moved) {
          setWeekEditForm({ entryId: r.entryId, isAbs: r.isAbs || false });
        } else if (r.previewMins !== undefined) {
          const [sh, sm] = (r.previewStart as string).split(":").map(Number);
          const endMin = sh * 60 + sm + r.previewMins;
          const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
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
                if (e2.invoiceId) return e2; // verrechnete Einträge nie mitschieben
                const [h, m] = (e2.startTime as string).split(":").map(Number);
                const s = Math.round((h * 60 + m - SLOT_START_H * 60) / 15);
                const dur = Math.round((e2.minutes || 0) / 15);
                if (s >= pEnd || s + dur <= pStart) return e2;
                const newS = s >= pStart ? pEnd : pStart - dur;
                if (newS < 0 || newS + dur > SLOT_COUNT) return e2;
                const e2End = SLOT_START_H * 60 + newS * 15 + (e2.minutes || 0);
                return { ...e2, startTime: slotToTime(newS), endTime: `${String(Math.floor(e2End / 60)).padStart(2, "0")}:${String(e2End % 60).padStart(2, "0")}` };
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
  // weekGridRef und setWeekEditForm sind stabil (Ref bzw. State-Setter der Eltern-Komponente): registriert wird nur einmal
  }, [weekGridRef, setWeekEditForm]);

  return { resizingRef, resizing, syncResizing };
}
