// Blattgrösse und Massstab für den Druck eines Terminprogramms (`schedule`, SchedulePrint).
//
// Ein Terminprogramm ist immer EIN Blatt (kein Seitenumbruch): entweder ein A-Format quer, auf das der
// Zeitraum eingepasst wird (Zeilenhöhe passt sich der Blatthöhe an), oder «nach Bedarf» für Plotter und
// Rollenpapier: Breite = Zeitraum × Massstab (mm je Tag), Höhe = Inhalt (misst PrintView nach dem Rendern).

import { addDays, dayNum, scheduleRange } from "../../schedule";
import { localISODate } from "../../utils";
import type { DateStr, ScheduleItem } from "../../types";

/** px je mm bei 96 dpi (CSS). */
export const PX_PER_MM = 96 / 25.4;
/** Breite der Zeilenbeschriftung im Druck, px. */
export const PRINT_LABEL_WIDTH = 270;
/** Geschätzte Höhe von Kopf (Absender, Projekt) und Fuss (Termine, Legende), px — für das Einpassen der Zeilen. */
const HEAD_PX = 150, FOOT_PX = 190;

export type SchedulePaper = "A4" | "A3" | "A2" | "A1" | "A0" | "bedarf";

/** Papierformate quer, in mm. */
export const SCHEDULE_PAPERS: { id: SchedulePaper; label: string; w: number; h: number }[] = [
  { id: "A4", label: "A4 quer", w: 297, h: 210 },
  { id: "A3", label: "A3 quer", w: 420, h: 297 },
  { id: "A2", label: "A2 quer", w: 594, h: 420 },
  { id: "A1", label: "A1 quer", w: 841, h: 594 },
  { id: "A0", label: "A0 quer", w: 1189, h: 841 },
];

/** Massstäbe für «nach Bedarf»: mm je Tag. */
export const SCHEDULE_SCALES: { mmPerDay: number; label: string }[] = [
  { mmPerDay: 10 / 7, label: "1 Woche = 10 mm" },
  { mmPerDay: 15 / 7, label: "1 Woche = 15 mm" },
  { mmPerDay: 20 / 7, label: "1 Woche = 20 mm" },
  { mmPerDay: 30 / 7, label: "1 Woche = 30 mm" },
  { mmPerDay: 5, label: "1 Tag = 5 mm" },
  { mmPerDay: 8, label: "1 Tag = 8 mm" },
];

/** Druckeinstellungen (Leiste über dem Blatt). `from`/`to` leer = ganzes Programm. */
export interface SchedulePrintOptions {
  paper: SchedulePaper;
  mmPerDay: number;
  from: DateStr;
  to: DateStr;
}

export const DEFAULT_SCHEDULE_PRINT: SchedulePrintOptions = { paper: "A3", mmPerDay: 20 / 7, from: "", to: "" };

/** Ergebnis: Blattgrösse (mm; `pageH` null = nach Inhalt), Tagesbreite und Zeilenhöhe (px), Zeitraum, Elemente darin. */
export interface SchedulePrintLayout {
  pageW: number;
  pageH: number | null;
  dayWidth: number;
  rowHeight: number;
  from: DateStr;
  to: DateStr;
  items: ScheduleItem[];
  /** true = Zeitraum eingeschränkt (Elemente ausserhalb weggelassen) */
  cropped: boolean;
}

/** Zeilen im Zeitstrahl: Elemente plus Gruppenköpfe. */
const rowCount = (items: ScheduleItem[]) => items.length + new Set(items.map(it => it.group).filter(Boolean)).size;

/**
 * Blatt und Massstab für ein Terminprogramm.
 *
 * @param margins Seitenränder in mm (Einstellungen → Dokumente)
 */
export function schedulePrintLayout(
  allItems: ScheduleItem[], opts: SchedulePrintOptions, margins: { top: number; right: number; bottom: number; left: number },
): SchedulePrintLayout {
  const r = scheduleRange(allItems);
  const from = opts.from || r?.start || localISODate();
  const to = opts.to || (r ? addDays(r.end, 14) : addDays(from, 60));
  const cropped = !!(opts.from || opts.to);
  // Nur Elemente, die den Zeitraum berühren (sonst leere Zeilen)
  const items = cropped ? allItems.filter(it => it.end >= from && it.start <= to) : allItems;
  const days = Math.max(1, dayNum(to) - dayNum(from) + 1);
  const labelMm = (PRINT_LABEL_WIDTH + 2) / PX_PER_MM;
  const rows = Math.max(1, rowCount(items));

  if (opts.paper === "bedarf") {
    // Breite aus dem Massstab, mindestens A4 quer (sonst wird der Kopf zu eng)
    const pageW = Math.max(297, Math.round(margins.left + margins.right + labelMm + days * opts.mmPerDay));
    return { pageW, pageH: null, dayWidth: opts.mmPerDay * PX_PER_MM, rowHeight: 22, from, to, items, cropped };
  }
  const paper = SCHEDULE_PAPERS.find(p => p.id === opts.paper) || SCHEDULE_PAPERS[1];
  const dayWidth = ((paper.w - margins.left - margins.right) * PX_PER_MM - PRINT_LABEL_WIDTH - 2) / days;
  const avail = (paper.h - margins.top - margins.bottom) * PX_PER_MM - HEAD_PX - FOOT_PX - 40;
  const rowHeight = Math.max(13, Math.min(26, Math.floor(avail / rows)));
  return { pageW: paper.w, pageH: paper.h, dayWidth, rowHeight, from, to, items, cropped };
}
