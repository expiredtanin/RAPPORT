// Blattgrösse und Massstab für den Druck eines Terminprogramms (`schedule`, SchedulePrint).
//
// Ein Terminprogramm ist immer EIN Blatt (kein Seitenumbruch): entweder ein A-Format quer, auf das der
// Zeitraum eingepasst wird (Zeilenhöhe passt sich der Blatthöhe an), oder «nach Bedarf» für Plotter und
// Rollenpapier: Breite = Zeitraum × Massstab (mm je Tag), Höhe = Inhalt (misst PrintView nach dem Rendern).
//
// Ausschnitt und Massstab (Leiste ScheduleFormatBar, Ziehen in der Vorschau): Bei A-Formaten ist der Zeitraum
// entweder eingepasst (`mmPerDay` 0) oder durch einen Massstab bestimmt — dann ergibt die Blattbreite, wie
// viele Tage ab `from` sichtbar sind. `shiftPrintWindow` schiebt den Ausschnitt, `zoomPrint` wechselt den
// Massstab um die Mitte des Ausschnitts. Vorschau = Druck, weil beide dasselbe Layout verwenden.

import { addDays, dayNum, numToDate, scheduleRange } from "../../schedule";
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
  { mmPerDay: 3 / 7, label: "1 Woche = 3 mm" },
  { mmPerDay: 5 / 7, label: "1 Woche = 5 mm" },
  { mmPerDay: 10 / 7, label: "1 Woche = 10 mm" },
  { mmPerDay: 15 / 7, label: "1 Woche = 15 mm" },
  { mmPerDay: 20 / 7, label: "1 Woche = 20 mm" },
  { mmPerDay: 30 / 7, label: "1 Woche = 30 mm" },
  { mmPerDay: 5, label: "1 Tag = 5 mm" },
  { mmPerDay: 8, label: "1 Tag = 8 mm" },
  { mmPerDay: 12, label: "1 Tag = 12 mm" },
];

/**
 * Druckeinstellungen (Leiste über dem Blatt). `from`/`to` leer = ganzes Programm.
 * `mmPerDay` 0 = auf das A-Format einpassen; > 0 = fester Massstab (bei A-Formaten zählt dann nur `from`,
 * das Ende ergibt sich aus der Blattbreite). «Nach Bedarf» braucht immer einen Massstab (0 → 1 Woche = 20 mm).
 */
export interface SchedulePrintOptions {
  paper: SchedulePaper;
  mmPerDay: number;
  from: DateStr;
  to: DateStr;
}

export const DEFAULT_SCHEDULE_PRINT: SchedulePrintOptions = { paper: "A3", mmPerDay: 0, from: "", to: "" };
/** Massstab für «nach Bedarf», wenn keiner gewählt ist */
export const DEFAULT_MM_PER_DAY = 20 / 7;

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
  /** ganzes Programm (für Regler und «Alles»), null = leer */
  full: { start: DateStr; end: DateStr } | null;
  /** fester Massstab in mm je Tag (null = eingepasst) */
  mmPerDay: number | null;
  /** Zeilen passen auch mit der kleinsten Zeilenhöhe nicht aufs Blatt (unten abgeschnitten) */
  tooTall?: boolean;
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
  const full = r ? { start: r.start, end: addDays(r.end, 14) } : null;
  const paper = SCHEDULE_PAPERS.find(p => p.id === opts.paper) || SCHEDULE_PAPERS[1];
  /** Breite des Zeitstrahls auf dem A-Format, px */
  const usable = (paper.w - margins.left - margins.right) * PX_PER_MM - PRINT_LABEL_WIDTH - 2;
  const scaled = opts.paper === "bedarf" ? opts.mmPerDay || DEFAULT_MM_PER_DAY : opts.mmPerDay > 0 ? opts.mmPerDay : null;
  const from = opts.from || full?.start || localISODate();
  // A-Format mit Massstab: Ende aus der Blattbreite
  const to = opts.paper !== "bedarf" && scaled
    ? addDays(from, Math.max(1, Math.floor(usable / (scaled * PX_PER_MM))) - 1)
    : opts.to || full?.end || addDays(from, 60);
  const cropped = !!(opts.from || opts.to) || (!!full && (from > full.start || to < full.end));
  // Nur Elemente, die den Zeitraum berühren (sonst leere Zeilen)
  const items = cropped ? allItems.filter(it => it.end >= from && it.start <= to) : allItems;
  const days = Math.max(1, dayNum(to) - dayNum(from) + 1);
  const labelMm = (PRINT_LABEL_WIDTH + 2) / PX_PER_MM;
  const rows = Math.max(1, rowCount(items));

  if (opts.paper === "bedarf") {
    // Breite aus dem Massstab, mindestens A4 quer (sonst wird der Kopf zu eng)
    const pageW = Math.max(297, Math.round(margins.left + margins.right + labelMm + days * scaled!));
    return { pageW, pageH: null, dayWidth: scaled! * PX_PER_MM, rowHeight: 22, from, to, items, cropped, full, mmPerDay: scaled };
  }
  const dayWidth = scaled ? scaled * PX_PER_MM : usable / days;
  // Fuss wächst mit der Termine-Liste (eine Zeile je Meilenstein; sonst lag sie bei vielen Zeilen unter dem Blattrand)
  const footPx = Math.max(FOOT_PX, 60 + items.filter(it => it.kind === "milestone").length * 14);
  const avail = (paper.h - margins.top - margins.bottom) * PX_PER_MM - HEAD_PX - footPx - 40;
  const rowHeight = Math.max(13, Math.min(26, Math.floor(avail / rows)));
  return { pageW: paper.w, pageH: paper.h, dayWidth, rowHeight, from, to, items, cropped, full, mmPerDay: scaled, tooTall: rows * 13 > avail };
}

/** Bezeichnung eines Massstabs (aus SCHEDULE_SCALES, sonst «1 Woche ≈ n mm»). */
export function printScaleLabel(mmPerDay: number): string {
  return SCHEDULE_SCALES.find(s => Math.abs(s.mmPerDay - mmPerDay) < 0.001)?.label || `1 Woche ≈ ${Math.round(mmPerDay * 7)} mm`;
}

/**
 * Ausschnitt um `days` Tage verschieben (negativ = früher). Die Länge bleibt: «eingepasst» und «nach Bedarf»
 * setzen `from` und `to`, ein A-Format mit festem Massstab nur `from` (Ende aus der Blattbreite).
 */
export function shiftPrintWindow(opts: SchedulePrintOptions, layout: Pick<SchedulePrintLayout, "from" | "to">, days: number): SchedulePrintOptions {
  if (!days) return opts;
  return { ...opts, from: addDays(layout.from, days), to: opts.paper !== "bedarf" && opts.mmPerDay > 0 ? "" : addDays(layout.to, days) };
}

/** Ausschnitt so legen, dass er bei `start` beginnt (Regler); Länge bleibt. */
export function movePrintWindowTo(opts: SchedulePrintOptions, layout: Pick<SchedulePrintLayout, "from" | "to">, start: DateStr): SchedulePrintOptions {
  return shiftPrintWindow(opts, layout, dayNum(start) - dayNum(layout.from));
}

/** Breite des Zeitstrahls auf einem A-Format in mm. */
export function printUsableMm(paper: SchedulePaper, margins: { left: number; right: number }): number {
  const p = SCHEDULE_PAPERS.find(x => x.id === paper) || SCHEDULE_PAPERS[1];
  return p.w - margins.left - margins.right - (PRINT_LABEL_WIDTH + 2) / PX_PER_MM;
}

/**
 * Massstab eine Stufe stärker (`dir` 1: mehr mm je Tag, weniger Tage) oder schwächer (-1), um die Mitte des
 * Ausschnitts. A-Format: fasst der neue Ausschnitt das ganze Programm, zurück auf «eingepasst» (Alles).
 * «Nach Bedarf»: Zeitraum bleibt, das Blatt wird breiter bzw. schmaler.
 *
 * @param usableMm Breite des Zeitstrahls auf dem Blatt in mm (`printUsableMm`; bei «nach Bedarf» egal)
 */
export function zoomPrint(
  opts: SchedulePrintOptions, layout: Pick<SchedulePrintLayout, "from" | "to" | "dayWidth" | "full">, dir: 1 | -1, usableMm: number,
): SchedulePrintOptions {
  const cur = layout.dayWidth / PX_PER_MM;
  const scales = SCHEDULE_SCALES.map(s => s.mmPerDay);
  const next = dir > 0 ? scales.find(m => m > cur + 1e-6) : [...scales].reverse().find(m => m < cur - 1e-6);
  if (opts.paper === "bedarf") return next === undefined ? opts : { ...opts, mmPerDay: next };
  const fullDays = layout.full ? dayNum(layout.full.end) - dayNum(layout.full.start) + 1 : Infinity;
  if (next === undefined || (dir < 0 && Math.floor(usableMm / next) >= fullDays)) {
    return dir < 0 ? { ...opts, mmPerDay: 0, from: "", to: "" } : opts;
  }
  const days = Math.max(1, Math.floor(usableMm / next));
  const center = (dayNum(layout.from) + dayNum(layout.to) + 1) / 2;
  let start = Math.round(center - days / 2);
  if (layout.full) start = Math.max(Math.min(start, dayNum(layout.full.end) - days + 1), dayNum(layout.full.start));
  return { ...opts, mmPerDay: next, from: numToDate(start), to: "" };
}
