// Terminprogramm (Planung und Bau) eines Projekts: reine Funktionen, nichts wird gespeichert.
//
// Datenmodell in types.ts (`ProjectSchedule`, `ScheduleItem`): Aufgaben (Balken) und Meilensteine
// (Raute) mit Start und Ende als `YYYY-MM-DD` (beide Tage inklusive, Meilenstein: Start = Ende).
// Abhängigkeiten sind «beginnt nach» (Ende → Anfang) mit optionalem Abstand in Kalendertagen.
//
// Gerechnet wird in Kalendertagen: Wochenenden, Feiertage und Betriebsferien zeigt die Ansicht an,
// sie verschieben aber keine Termine (in der Planung denkt man in Wochen, nicht in Arbeitstagen).
//
//  - `planningTemplate` / `constructionTemplate`: Startvorlagen aus den SIA-Phasen bzw. BKP-Arbeiten.
//  - `shiftSuccessors`: nach einer Änderung rücken Nachfolger mit (nur nach hinten, `auto !== false`).
//  - `wouldCreateCycle`: verhindert Kreise beim Ziehen eines Pfeils.
//  - `criticalPath`: Elemente ohne Puffer bis zum Programmende (klassische Netzplan-Rechnung).
//  - `phaseProgress`: Zeit- und Stundenfortschritt einer Planungsphase (Soll/Ist aus Zeiterfassung).
// Benutzt von views/schedule (Editor, Büroübersicht) und print/docs/SchedulePrint.

import { getFeiertageForYear } from "./utils";
import type {
  DateStr, Employee, Feiertag, Id, Project, ProjectSchedule, Protocol, ProtocolEntry, ProtocolTraktandum, ScheduleBaseline, ScheduleBreak,
  ScheduleItem, ScheduleMarker, ScheduleSource, ScheduleTrack, ScheduleVariant, TimeEntry,
} from "./types";

const DAY = 86400000;

/** Termin-Symbole (Meilenstein-Zeilen) mit Zeichen für Listen/Legende; gezeichnet wird in GanttChart (`markerPath`). */
export const SCHEDULE_MARKERS: { id: ScheduleMarker; label: string; glyph: string; hint: string }[] = [
  { id: "meilenstein", label: "Meilenstein", glyph: "◆", hint: "Etappenziel, z.B. Baubeginn, Aufrichte" },
  { id: "abgabe", label: "Abgabe / Frist", glyph: "▼", hint: "z.B. Baueingabe, Wettbewerbsabgabe, Planlieferung" },
  { id: "entscheid", label: "Entscheid / Freigabe", glyph: "◇", hint: "z.B. Bauherrenentscheid, Baubewilligung" },
  { id: "sitzung", label: "Sitzung", glyph: "●", hint: "z.B. Bauherrensitzung, Baukommission" },
  { id: "lieferung", label: "Lieferung", glyph: "■", hint: "z.B. Fenster, Küche, Lift" },
  { id: "abnahme", label: "Abnahme / Übergabe", glyph: "★", hint: "z.B. Bauabnahme, Bezug" },
  { id: "vertrag", label: "Vertragstermin", glyph: "▲", hint: "verbindlicher Termin, z.B. mit Konventionalstrafe" },
];

/** Darstellungen von Balken (leer = eigene Leistung). */
export const SCHEDULE_VARIANTS: { id: ScheduleVariant | ""; label: string; hint: string }[] = [
  { id: "", label: "Eigene Leistung", hint: "voller Balken" },
  { id: "extern", label: "Durch Dritte", hint: "nur umrandet, z.B. Bewilligungsverfahren, Leistungen des Bauherrn" },
  { id: "reserve", label: "Reserve / Puffer", hint: "schraffiert" },
  { id: "serie", label: "Terminserie", hint: "wiederkehrender Termin, z.B. Bausitzung alle 2 Wochen" },
];

/** Symbol eines Elements: Termin → `marker` (Standard Meilenstein), Terminserie → `marker` (Standard Sitzung). */
export const markerOf = (it: Pick<ScheduleItem, "kind" | "marker" | "variant">): ScheduleMarker =>
  it.marker || (it.kind === "task" && it.variant === "serie" ? "sitzung" : "meilenstein");

/** Zeichen für die Zeilenbeschriftung: Symbol bei Terminen und Serien, sonst leer. */
export const glyphOf = (it: Pick<ScheduleItem, "kind" | "marker" | "variant">): string =>
  it.kind === "milestone" || it.variant === "serie" ? SCHEDULE_MARKERS.find(m => m.id === markerOf(it))!.glyph : "";

/** Termine einer Terminserie: ab Beginn alle `repeatDays` Tage (Standard 14) bis zum Ende. */
export function seriesDates(it: Pick<ScheduleItem, "start" | "end" | "repeatDays">): DateStr[] {
  const step = Math.max(1, Math.round(it.repeatDays || 14));
  const out: DateStr[] = [];
  for (let d = dayNum(it.start); d <= dayNum(it.end) && out.length < 500; d += step) out.push(numToDate(d));
  return out;
}

/** Unterbrüche, die in einem Programm gelten (ohne `track` = in beiden). */
export const breaksOf = (schedule: ProjectSchedule, track: ScheduleTrack): ScheduleBreak[] =>
  (schedule.breaks || []).filter(b => !b.track || b.track === track);

/** Bezeichnungen der beiden Programme. */
export const TRACK_LABELS: Record<ScheduleTrack, string> = { planung: "Planungsterminprogramm", bau: "Bauprogramm" };

/** Tagesnummer (Tage seit 1970-01-01, UTC) eines Datums. */
export const dayNum = (d: DateStr): number => Math.round(Date.parse(d.slice(0, 10) + "T00:00:00Z") / DAY);

/** Datum zu einer Tagesnummer. */
export const numToDate = (n: number): DateStr => new Date(n * DAY).toISOString().slice(0, 10);

/** Datum plus `days` Kalendertage. */
export const addDays = (d: DateStr, days: number): DateStr => numToDate(dayNum(d) + days);

/** Dauer lesbar: «5 T», «3 W», «12 W 2 T» (Kalendertage). */
export function formatDuration(days: number): string {
  if (days < 14) return `${days} T`;
  const w = Math.floor(days / 7), r = days % 7;
  return r ? `${w} W ${r} T` : `${w} W`;
}

/** Dauer in Tagen (beide Tage inklusive); Meilenstein = 0. */
export const durationDays = (it: Pick<ScheduleItem, "kind" | "start" | "end">): number =>
  it.kind === "milestone" ? 0 : Math.max(1, dayNum(it.end) - dayNum(it.start) + 1);

/** Frühester Start eines Nachfolgers: Tag nach dem Ende (Meilenstein: gleicher Tag) plus Abstand. */
function earliestAfter(pred: ScheduleItem, lagDays = 0): number {
  return dayNum(pred.end) + (pred.kind === "milestone" ? 0 : 1) + lagDays;
}

/** Verschiebt ein Element um `days` Tage, Dauer bleibt. */
export function moveItem(it: ScheduleItem, days: number): ScheduleItem {
  return { ...it, start: addDays(it.start, days), end: addDays(it.end, days) };
}

/**
 * true, wenn das Element Termine hat. Leere Zeilen (`start`/`end` = "") legt der Editor an, damit man sie
 * benennen und später im Zeitraster aufziehen kann; sie zählen nirgends mit (Rechnung, Druck, Übersichten).
 */
export const isPlaced = (it: Pick<ScheduleItem, "start" | "end">): boolean => !!it.start && !!it.end;

/**
 * Leeres Terminprogramm; `null`/alte Daten werden zu einer gültigen Form.
 * Leere Zeilen (ohne Termine) nur mit `withEmptyRows` — das braucht allein der Editor.
 */
export function scheduleOf(project: Pick<Project, "schedule"> | undefined, withEmptyRows = false): ProjectSchedule {
  const s = project?.schedule;
  const items = Array.isArray(s?.items) ? s!.items : [];
  return { items: withEmptyRows ? items : items.filter(isPlaced), baselines: s?.baselines || {}, breaks: Array.isArray(s?.breaks) ? s!.breaks : [],
    dismissed: Array.isArray(s?.dismissed) ? s!.dismissed : [] };
}

// ─── Zeilen bearbeiten (Editor) ────────────────────────────────────────────────

/** Neue leere Zeile (Aufgabe ohne Termine) in der Gruppe von `after`. */
export function emptyRow(track: ScheduleTrack, id: Id, after?: Pick<ScheduleItem, "group" | "phaseId"> | null): ScheduleItem {
  return { id, label: "", kind: "task", track, group: after?.group || "", phaseId: track === "planung" ? after?.phaseId : undefined, start: "", end: "", deps: [] };
}

/** Zeilen in der angezeigten Reihenfolge (nach Gruppen, wie GanttChart sie zeigt). */
export const displayOrder = (items: ScheduleItem[]): ScheduleItem[] => groupSpans(items).flatMap(g => g.items);

/** Ziel beim Verschieben einer Zeile: vor/nach einer anderen Zeile oder als erste in eine Gruppe. */
export type RowTarget = { id: Id; where: "before" | "after" } | { group: string };

/**
 * Verschiebt eine Zeile an ein Ziel; sie übernimmt dabei die Gruppe des Ziels (und bei der Planung
 * deren SIA-Phase nicht — die bleibt). Unbekannte Ids → unverändert.
 */
export function moveRow(items: ScheduleItem[], id: Id, target: RowTarget): ScheduleItem[] {
  const it = items.find(x => x.id === id);
  if (!it || ("id" in target && target.id === id)) return items;
  const rest = items.filter(x => x.id !== id);
  if ("group" in target) {
    const at = rest.findIndex(x => (x.group || "") === target.group);
    const moved = { ...it, group: target.group };
    return at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
  }
  const ref = rest.findIndex(x => x.id === target.id);
  if (ref < 0) return items;
  const moved = { ...it, group: rest[ref].group || "" };
  const at = target.where === "before" ? ref : ref + 1;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** Eine Zeile in der angezeigten Reihenfolge um eins nach oben (-1) oder unten (1); am Gruppenrand in die Nachbargruppe. */
export function stepRow(items: ScheduleItem[], id: Id, dir: -1 | 1): ScheduleItem[] {
  const order = displayOrder(items);
  const idx = order.findIndex(x => x.id === id);
  const nb = order[idx + dir];
  if (idx < 0 || !nb) return items;
  // Am Gruppenrand erst nur die Gruppe wechseln (letzte der Gruppe davor bzw. erste der Gruppe danach)
  if ((nb.group || "") !== (order[idx].group || "")) return moveRow(items, id, dir < 0 ? { id: nb.id, where: "after" } : { group: nb.group || "" });
  return moveRow(items, id, { id: nb.id, where: dir < 0 ? "before" : "after" });
}

/**
 * Ablageziel beim Ziehen einer Zeile. `rows` = sichtbare Zeilen (Gruppenkopf oder Element), `pos` =
 * Zeiger in Zeilen (z.B. 2.7 = in der dritten Zeile, untere Hälfte). Gruppenkopf → als erste in die Gruppe,
 * obere/untere Hälfte einer Zeile → davor/danach, unterhalb der letzten → nach der letzten Zeile.
 * null = keine Änderung (auf sich selbst).
 */
export function rowDropTarget(rows: ({ group: string } | { id: Id })[], pos: number, dragId: Id): RowTarget | null {
  if (!rows.length) return null;
  const i = Math.max(0, Math.min(rows.length - 1, Math.floor(pos)));
  const r = rows[i];
  if ("group" in r) {
    // Untere Hälfte eines Gruppenkopfs = erste Zeile der Gruppe; obere Hälfte = nach dem Ende der Gruppe davor
    if (pos - i >= 0.5 || i === 0) return { group: r.group };
    const prev = rows[i - 1];
    return "id" in prev ? (prev.id === dragId ? null : { id: prev.id, where: "after" }) : { group: prev.group };
  }
  if (r.id === dragId) return null;
  return { id: r.id, where: pos >= rows.length || pos - i >= 0.5 ? "after" : "before" };
}

/**
 * Zeitraum aus einem aufgezogenen Balken (Tagesnummern, Reihenfolge egal). Mit `snapDays` 7 auf ganze
 * Wochen erweitert (Montag bis Sonntag), sonst tageweise.
 */
export function drawnSpan(a: number, b: number, snapDays = 1): { start: DateStr; end: DateStr } {
  let lo = Math.min(a, b), hi = Math.max(a, b);
  if (snapDays === 7) {
    const dow = (n: number) => (new Date(n * DAY).getUTCDay() + 6) % 7; // 0 = Montag
    lo -= dow(lo);
    hi += 6 - dow(hi);
  }
  return { start: numToDate(lo), end: numToDate(hi) };
}

/** Tagesnummer unter einem Punkt im Zeitstrahl (`px` ab linkem Rand, Zeitraum ab Tag `startDay`). */
export const dayAtX = (px: number, startDay: number, dayWidth: number): number => startDay + Math.floor(px / dayWidth);

/** Entfernt ein Element und die Pfeile von ihm. */
export function removeScheduleItem(items: ScheduleItem[], id: Id): ScheduleItem[] {
  return items.filter(x => x.id !== id).map(x => (x.deps || []).some(d => d.fromId === id) ? { ...x, deps: (x.deps || []).filter(d => d.fromId !== id) } : x);
}

/**
 * Macht das Löschen von `id` rückgängig, ohne spätere Änderungen zu verlieren: das Element kommt aus
 * `before` an seine alte Stelle (hinter den nächsten noch vorhandenen Vorgänger in der Liste), Pfeile von
 * ihm werden bei noch vorhandenen Nachfolgern wieder eingesetzt.
 */
export function restoreScheduleItem(current: ScheduleItem[], before: ScheduleItem[], id: Id): ScheduleItem[] {
  const idx = before.findIndex(x => x.id === id);
  if (idx < 0 || current.some(x => x.id === id)) return current;
  const item = before[idx];
  let at = 0;
  for (let j = idx - 1; j >= 0; j--) {
    const pos = current.findIndex(x => x.id === before[j].id);
    if (pos !== -1) { at = pos + 1; break; }
  }
  const lostDeps = new Map(before.map(x => [x.id, (x.deps || []).filter(d => d.fromId === id)]));
  const list = current.map(x => {
    const add = lostDeps.get(x.id) || [];
    return add.length && !(x.deps || []).some(d => d.fromId === id) ? { ...x, deps: [...(x.deps || []), ...add] } : x;
  });
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** Elemente eines Programms (Planung oder Bau) in gespeicherter Reihenfolge. */
export const trackItems = (schedule: ProjectSchedule, track: ScheduleTrack): ScheduleItem[] =>
  schedule.items.filter(it => it.track === track);

/**
 * Rückt Nachfolger nach, deren Abhängigkeit verletzt ist (Start vor dem Ende des Vorgängers + Abstand).
 * Nur nach hinten, Dauer bleibt; Abhängigkeiten mit `auto === false` werden nicht nachgeführt.
 * Wirkt über ganze Ketten. Pfeile in einem Kreis werden nicht nachgeführt: einen Kreis verhindert der Editor
 * (`wouldCreateCycle`), er entsteht aber, wenn zwei Personen gleichzeitig entgegengesetzte Pfeile ziehen und die
 * Programme zusammengeführt werden — vorher schoben sich die Elemente dann gegenseitig um Jahre nach hinten
 * (Abbruch erst nach n² Schritten), und das wurde gespeichert.
 *
 * @returns neue Liste (unveränderte Elemente behalten ihre Identität)
 */
export function shiftSuccessors(items: ScheduleItem[]): ScheduleItem[] {
  const byId = new Map(items.map(it => [it.id, it]));
  const succs = new Map<Id, ScheduleItem[]>();
  const cyclic = new Set<string>();
  for (const it of items) for (const d of it.deps || []) if (wouldCreateCycle(items, d.fromId, it.id)) cyclic.add(`${d.fromId}>${it.id}`);
  for (const it of items) for (const d of it.deps || []) {
    if (cyclic.has(`${d.fromId}>${it.id}`)) continue;
    if (!succs.has(d.fromId)) succs.set(d.fromId, []);
    succs.get(d.fromId)!.push(it);
  }
  let guard = items.length * items.length + 10;
  const queue = [...items];
  while (queue.length && guard-- > 0) {
    const cur = byId.get(queue.shift()!.id)!;
    for (const s of succs.get(cur.id) || []) {
      const succ = byId.get(s.id)!;
      let need = -Infinity;
      for (const d of succ.deps || []) {
        if (d.auto === false || cyclic.has(`${d.fromId}>${succ.id}`)) continue;
        const pred = byId.get(d.fromId);
        // Vorgänger ohne Datum (leere Zeile) ergibt NaN und hob sonst die ganze Verschiebung auf (Runde 30)
        const after = pred ? earliestAfter(pred, d.lagDays) : NaN;
        if (Number.isFinite(after)) need = Math.max(need, after);
      }
      const delta = need - dayNum(succ.start);
      if (delta > 0) {
        byId.set(succ.id, moveItem(succ, delta));
        queue.push(succ);
      }
    }
  }
  return items.map(it => byId.get(it.id)!);
}

/** Abhängigkeiten, die verletzt sind (Start zu früh), z.B. bei `auto === false`: Paare Vorgänger → Nachfolger. */
export function dependencyConflicts(items: ScheduleItem[]): { fromId: Id; toId: Id }[] {
  const byId = new Map(items.map(it => [it.id, it]));
  const out: { fromId: Id; toId: Id }[] = [];
  for (const it of items) for (const d of it.deps || []) {
    const pred = byId.get(d.fromId);
    if (pred && dayNum(it.start) < earliestAfter(pred, d.lagDays)) out.push({ fromId: d.fromId, toId: it.id });
  }
  return out;
}

/** true, wenn ein Pfeil `fromId → toId` einen Kreis schliessen würde (oder auf sich selbst zeigt). */
export function wouldCreateCycle(items: ScheduleItem[], fromId: Id, toId: Id): boolean {
  if (fromId === toId) return true;
  const succs = new Map<Id, Id[]>();
  for (const it of items) for (const d of it.deps || []) {
    if (!succs.has(d.fromId)) succs.set(d.fromId, []);
    succs.get(d.fromId)!.push(it.id);
  }
  // Kreis, wenn fromId von toId aus schon erreichbar ist
  const seen = new Set<Id>();
  const stack = [toId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(succs.get(id) || []));
  }
  return false;
}

/**
 * Kritischer Weg: Elemente ohne Puffer, d.h. jede Verspätung verschiebt das Programmende.
 * Rückwärtsrechnung auf den geplanten Terminen: spätestes Ende = Programmende bzw. spätester Start der
 * Nachfolger minus Abstand; Puffer = spätester Start − geplanter Start.
 *
 * @returns Puffer in Tagen je Element und die Menge der kritischen Elemente (Puffer ≤ 0)
 */
export function criticalPath(items: ScheduleItem[]): { float: Map<Id, number>; critical: Set<Id> } {
  const float = new Map<Id, number>();
  const critical = new Set<Id>();
  if (!items.length) return { float, critical };
  const byId = new Map(items.map(it => [it.id, it]));
  const succs = new Map<Id, { succ: ScheduleItem; lag: number }[]>();
  const indeg = new Map<Id, number>(items.map(it => [it.id, 0]));
  for (const it of items) for (const d of it.deps || []) {
    if (!byId.has(d.fromId)) continue;
    if (!succs.has(d.fromId)) succs.set(d.fromId, []);
    succs.get(d.fromId)!.push({ succ: it, lag: d.lagDays || 0 });
    indeg.set(d.fromId, (indeg.get(d.fromId) || 0) + 1);
  }
  const projectEnd = Math.max(...items.map(it => dayNum(it.end)));
  // Rückwärts in umgekehrter topologischer Reihenfolge (Elemente ohne Nachfolger zuerst)
  const lateStart = new Map<Id, number>();
  const ready = items.filter(it => !indeg.get(it.id));
  const preds = new Map<Id, Id[]>();
  for (const it of items) preds.set(it.id, (it.deps || []).map(d => d.fromId).filter(id => byId.has(id)));
  let done = 0;
  while (ready.length) {
    const it = ready.pop()!;
    done++;
    const dur = durationDays(it);
    let lateEnd = projectEnd;
    for (const { succ, lag } of succs.get(it.id) || []) {
      const ls = lateStart.get(succ.id)!;
      lateEnd = Math.min(lateEnd, ls - lag - (it.kind === "milestone" ? 0 : 1));
    }
    const ls = it.kind === "milestone" ? lateEnd : lateEnd - dur + 1;
    lateStart.set(it.id, ls);
    const f = ls - dayNum(it.start);
    float.set(it.id, f);
    if (f <= 0) critical.add(it.id);
    for (const p of preds.get(it.id) || []) {
      indeg.set(p, indeg.get(p)! - 1);
      if (indeg.get(p) === 0) ready.push(byId.get(p)!);
    }
  }
  // Kreis (sollte wouldCreateCycle verhindern): keine Aussage
  if (done < items.length) return { float: new Map(), critical: new Set() };
  return { float, critical };
}

/** Feiertage (`YYYY-MM-DD`) der Jahre zwischen `from` und `to` (für die graue Hinterlegung). */
export function holidayDates(feiertage: Feiertag[] | undefined, from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const f of getFeiertageForYear(feiertage, y)) if (f.date >= from && f.date <= to) out.push(f.date.slice(0, 10));
  }
  return out;
}

/** Erster und letzter Tag aller Elemente (leer oder nur leere Zeilen → null). */
export function scheduleRange(items: ScheduleItem[]): { start: DateStr; end: DateStr } | null {
  items = items.filter(isPlaced); // leere Zeilen zählen nicht
  if (!items.length) return null;
  const s = Math.min(...items.map(it => dayNum(it.start)));
  const e = Math.max(...items.map(it => dayNum(it.end)));
  return { start: numToDate(s), end: numToDate(e) };
}

/** Gruppen in der Reihenfolge ihres ersten Auftretens, mit Zeitraum (Sammelbalken; "" = nur leere Zeilen). */
export function groupSpans(items: ScheduleItem[]): { group: string; start: DateStr; end: DateStr; items: ScheduleItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, ScheduleItem[]>();
  for (const it of items) {
    const g = it.group || "";
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push(it);
  }
  return order.map(group => {
    const list = map.get(group)!;
    const r = scheduleRange(list); // null = nur leere Zeilen
    return { group, start: r?.start || "", end: r?.end || "", items: list };
  });
}

/** Abweichung gegenüber dem eingefrorenen Stand in Tagen (Ende; positiv = später); null = nicht im Vergleich. */
export function baselineDelta(it: ScheduleItem, baseline: { items: { id: Id; end: DateStr }[] } | undefined): number | null {
  const b = baseline?.items.find(x => x.id === it.id);
  return b ? dayNum(it.end) - dayNum(b.end) : null;
}

/**
 * Zeit- und Stundenfortschritt einer Planungsphase: verstrichene Zeit des Balkens bis `today` und
 * erfasste Stunden der Phase im Verhältnis zum Phasenbudget (`project.phasesBudget`).
 *
 * @returns null ohne `phaseId`; `hoursPct` null ohne Budget
 */
export function phaseProgress(
  it: ScheduleItem, project: Pick<Project, "id" | "phasesBudget">, timeEntries: TimeEntry[], today: DateStr,
): { timePct: number; hoursIst: number; hoursSoll: number; hoursPct: number | null } | null {
  if (!it.phaseId) return null;
  const s = dayNum(it.start), e = dayNum(it.end), t = dayNum(today);
  const timePct = t < s ? 0 : t > e ? 100 : Math.round(((t - s + 1) / (e - s + 1)) * 100);
  const hoursIst = (timeEntries || []).filter(te => te.projectId === project.id && te.phaseId === it.phaseId)
    .reduce((sum, te) => sum + (te.minutes || 0), 0) / 60;
  const hoursSoll = (project.phasesBudget || []).find(p => p.id === it.phaseId)?.hours || 0;
  return { timePct, hoursIst, hoursSoll, hoursPct: hoursSoll > 0 ? Math.round((hoursIst / hoursSoll) * 100) : null };
}

// ─── Vorlagen ──────────────────────────────────────────────────────────────────

/** Vorlage einer Zeile: Dauer in Wochen, Vorgänger über `after` (Schlüssel anderer Zeilen der Vorlage). */
interface TemplateRow {
  key: string;
  label: string;
  group: string;
  weeks: number;
  milestone?: boolean;
  phaseId?: string;
  bkp?: string;
  after?: string[];
  lagDays?: number;
  marker?: ScheduleMarker;
  variant?: ScheduleVariant;
}

/** Übliche Dauern der SIA-Phasen in Wochen (Startwerte, danach im Projekt anpassen). */
const PHASE_WEEKS: Record<string, number> = { "11": 4, "21": 6, "22": 4, "31": 8, "32": 12, "33": 12, "41": 10, "51": 16, "52": 52, "53": 6 };

/** Termine, die nach einer Phase folgen, mit passendem Symbol. */
const PHASE_MILESTONES: Record<string, { label: string; marker: ScheduleMarker }> = {
  "32": { label: "Baueingabe", marker: "abgabe" },
  "33": { label: "Baubewilligung", marker: "entscheid" },
  "41": { label: "Vergabe / Baubeginn", marker: "meilenstein" },
  "53": { label: "Bauabnahme", marker: "abnahme" },
};

/** Baut aus Vorlagenzeilen echte Elemente ab `start`, verkettet über `after`. */
function buildFromTemplate(rows: TemplateRow[], track: ScheduleTrack, start: DateStr, newId: () => string): ScheduleItem[] {
  const ids = new Map(rows.map(r => [r.key, newId()]));
  const items: ScheduleItem[] = rows.map(r => ({
    id: ids.get(r.key)!, label: r.label, kind: r.milestone ? "milestone" : "task", track, group: r.group,
    ...(r.marker ? { marker: r.marker } : {}), ...(r.variant ? { variant: r.variant } : {}),
    phaseId: r.phaseId, bkp: r.bkp, start,
    end: r.milestone ? start : addDays(start, r.weeks * 7 - 1),
    deps: (r.after || []).filter(k => ids.has(k)).map(k => ({ fromId: ids.get(k)!, lagDays: r.lagDays || 0 })),
  }));
  return shiftSuccessors(items);
}

/**
 * Planungsterminprogramm aus den SIA-Phasen des Projekts (`enabledPhases`, sonst Vorprojekt bis Abschluss):
 * je Phase ein Balken, verkettet, mit den üblichen Meilensteinen (Baueingabe, Baubewilligung, …).
 * Ausführungsprojekt (51) läuft parallel zur Ausschreibung (41).
 */
export function planningTemplate(
  project: Pick<Project, "enabledPhases">, phases: { id: string; label: string }[], start: DateStr, newId: () => string,
): ScheduleItem[] {
  const wanted = project.enabledPhases?.length ? project.enabledPhases : ["31", "32", "33", "41", "51", "52", "53"];
  const list = phases.filter(p => wanted.includes(p.id));
  const rows: TemplateRow[] = [];
  let prev: string | undefined;
  let before41: string | undefined;
  for (const ph of list) {
    if (ph.id === "41") before41 = prev;
    // 51 beginnt mit 41 (gleicher Vorgänger), 52 folgt auf 41
    const after = ph.id === "51" && list.some(p => p.id === "41") ? before41 : prev;
    // Bewilligungsverfahren läuft bei der Behörde: Balken «durch Dritte»
    rows.push({ key: ph.id, label: ph.label.replace(/^\d+\s*/, ""), group: ph.label, weeks: PHASE_WEEKS[ph.id] || 6, phaseId: ph.id, after: after ? [after] : [], variant: ph.id === "33" ? "extern" : undefined });
    let last = ph.id;
    if (PHASE_MILESTONES[ph.id]) {
      const m = PHASE_MILESTONES[ph.id];
      rows.push({ key: `m${ph.id}`, label: m.label, group: ph.label, weeks: 0, milestone: true, phaseId: ph.id, after: [ph.id], marker: m.marker });
      last = `m${ph.id}`;
    }
    if (ph.id !== "51" || !list.some(p => p.id === "41")) prev = last;
  }
  return buildFromTemplate(rows, "planung", start, newId);
}

/** Startvorlage Bauprogramm nach BKP (übliche Abfolge Neubau; Dauern in Wochen, danach anpassen). */
const CONSTRUCTION_ROWS: TemplateRow[] = [
  { key: "1", label: "Baustelleneinrichtung, Vorbereitung", group: "Vorbereitung", weeks: 2, bkp: "1" },
  { key: "211", label: "Baumeisterarbeiten", group: "Rohbau", weeks: 20, bkp: "211", after: ["1"] },
  { key: "aufrichte", label: "Aufrichte", group: "Rohbau", weeks: 0, milestone: true, after: ["211"] },
  { key: "221", label: "Fenster, Aussentüren", group: "Rohbau", weeks: 3, bkp: "221", after: ["aufrichte"] },
  { key: "222", label: "Spenglerarbeiten", group: "Rohbau", weeks: 3, bkp: "222", after: ["aufrichte"] },
  { key: "224", label: "Bedachungsarbeiten", group: "Rohbau", weeks: 3, bkp: "224", after: ["aufrichte"] },
  { key: "23", label: "Elektroanlagen", group: "Installationen", weeks: 16, bkp: "23", after: ["aufrichte"] },
  { key: "24", label: "Heizung, Lüftung, Klima", group: "Installationen", weeks: 12, bkp: "24", after: ["aufrichte"] },
  { key: "25", label: "Sanitäranlagen", group: "Installationen", weeks: 12, bkp: "25", after: ["aufrichte"] },
  { key: "271", label: "Gipserarbeiten", group: "Ausbau", weeks: 6, bkp: "271", after: ["221"] },
  { key: "273", label: "Schreinerarbeiten", group: "Ausbau", weeks: 6, bkp: "273", after: ["271"] },
  { key: "281", label: "Bodenbeläge", group: "Ausbau", weeks: 4, bkp: "281", after: ["271"] },
  { key: "285", label: "Malerarbeiten", group: "Ausbau", weeks: 4, bkp: "285", after: ["281"] },
  { key: "287", label: "Baureinigung", group: "Ausbau", weeks: 1, bkp: "287", after: ["273", "285"] },
  { key: "4", label: "Umgebung", group: "Umgebung", weeks: 6, bkp: "4", after: ["224"] },
  { key: "bs", label: "Bausitzung (alle 2 Wochen)", group: "Bausitzungen", weeks: 37, variant: "serie", marker: "sitzung", after: ["1"] },
  { key: "abnahme", label: "Bauabnahme", group: "Abschluss", weeks: 0, milestone: true, after: ["287", "4"], marker: "abnahme" },
];

/** Bauprogramm-Vorlage ab `start` (übliche BKP-Abfolge eines Neubaus). */
export function constructionTemplate(start: DateStr, newId: () => string): ScheduleItem[] {
  return buildFromTemplate(CONSTRUCTION_ROWS, "bau", start, newId);
}

// ─── Auslastung (Büroübersicht) ────────────────────────────────────────────────

/** Tage, an denen sich mindestens zwei Zeiträume überschneiden (Meilensteine zählen nicht). */
export function overlapDays(ranges: { start: DateStr; end: DateStr }[]): number {
  const count = new Map<number, number>();
  for (const r of ranges) for (let d = dayNum(r.start); d <= dayNum(r.end); d++) count.set(d, (count.get(d) || 0) + 1);
  let n = 0;
  for (const c of count.values()) if (c >= 2) n++;
  return n;
}

/** Tage, an denen ein Zeitraum aus `tasks` in einen aus `blocked` fällt (z.B. Aufgabe während Ferien). */
export function blockedDays(tasks: { start: DateStr; end: DateStr }[], blocked: { start: DateStr; end: DateStr }[]): number {
  const off = new Set<number>();
  for (const b of blocked) for (let d = dayNum(b.start); d <= dayNum(b.end); d++) off.add(d);
  const hit = new Set<number>();
  for (const t of tasks) for (let d = dayNum(t.start); d <= dayNum(t.end); d++) if (off.has(d)) hit.add(d);
  return hit.size;
}

// ─── Protokolle ↔ Terminprogramm ──────────────────────────────────────────────
//
// Aus den Protokollen eines Projekts werden Vorschläge: offene Aufgaben mit Frist (▼), Beschlüsse mit
// Datum (◇) und «nächste Sitzung» (●). Übernommene Einträge tragen `source`; ein Folgeprotokoll kopiert
// offene Aufgaben mit neuer Id, darum wird eine Stelle über Art + Text wiedererkannt und das neueste
// Protokoll ist massgebend (Status «erledigt», `linkedEntry`).

/** HTML (Rich-Text) → einzeiliger Text. */
export function plainText(html: string | undefined): string {
  return (html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

/** Schlüssel zum Wiedererkennen einer Protokollstelle: Art + Text (klein, ohne Satzzeichen). */
export const entryKey = (type: string, text: string | undefined): string =>
  `${type}:${plainText(text).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim()}`;

/** Montag der ISO-Kalenderwoche `kw` im Jahr `year`. */
export function isoWeekMonday(year: number, kw: number): DateStr {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return numToDate(Math.round(jan4 / DAY) - dow + (kw - 1) * 7);
}

/**
 * Jahr zu einer eingegebenen KW, bezogen auf ein Datum (Protokolldatum): liegt die KW mehr als 8 Wochen vor der
 * KW des Datums, ist das nächste Jahr gemeint (im Dezember «KW 2»). Rechnet mit dem ISO-Wochenjahr (1.1.2027 = KW 53/2026).
 */
export function kwDueYear(kw: number, refDate: DateStr): number {
  const d = dayNum(refDate);
  const thursday = d - ((new Date(d * DAY).getUTCDay() + 6) % 7) + 3;
  const isoYear = new Date(thursday * DAY).getUTCFullYear();
  const refKW = Math.floor((thursday - dayNum(isoWeekMonday(isoYear, 1))) / 7) + 1;
  return kw < refKW - 8 ? isoYear + 1 : isoYear;
}

/** Frist einer Protokoll-Aufgabe: Datum oder Freitag der KW; null = keine Frist. */
export function entryDue(e: Pick<ProtocolEntry, "dueDateType" | "dueDate" | "dueKW" | "dueYear">, fallbackYear: number): DateStr | null {
  if ((e.dueDateType || "kw") === "datum") return e.dueDate ? e.dueDate.slice(0, 10) : null;
  const kw = Number(e.dueKW);
  if (!kw || kw < 1 || kw > 53) return null;
  return addDays(isoWeekMonday(Number(e.dueYear) || fallbackYear, kw), 4);
}

/** Vorschlag aus einem Protokoll. */
export interface ProtocolSuggestion {
  /** stabil: «Art:Text» bzw. «sitzung:Datum» — für Ausblenden und Doppelte */
  key: string;
  kind: ScheduleSource["kind"];
  date: DateStr;
  label: string;
  /** Verantwortliche/r laut Protokoll (Freitext/Kürzel) und passende/r Mitarbeitende/r */
  responsible?: string;
  assigneeId?: Id;
  protocol: Pick<Protocol, "id" | "nummer" | "title" | "date" | "type">;
  traktandum?: string;
  entryId?: Id;
  /** Vorschlag fürs Bauprogramm (Baubesprechung), sonst Planung */
  track: ScheduleTrack;
}

/**
 * Bereich, in dem gleiche Protokollstellen als Kopien gelten: die Projekt-Id, bei Protokollen ohne Projekt
 * «~» + Freitext-Projekt (Projekt-Ids beginnen nie mit «~»). So gehen auch deren Pendenzen nicht verloren.
 */
export const protocolScope = (p: Pick<Protocol, "projectId" | "projectManual">): string =>
  p.projectId || `~${(p.projectManual || "").trim()}`;

/** Reihenfolge der Protokolle: nach Datum, am selben Tag nach Erstellung (Folgeprotokoll nach dem Vorgänger). */
export const byProtocolDate = (a: Pick<Protocol, "date" | "createdAt">, b: Pick<Protocol, "date" | "createdAt">): number =>
  (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || "");

/** Protokolle eines Projekts (bzw. Bereichs, siehe `protocolScope`), neueste zuletzt. */
const projectProtocols = (protocols: Protocol[], projectId: Id) =>
  (protocols || []).filter(p => protocolScope(p) === projectId).sort(byProtocolDate);

/** Mitarbeitende/r zu einem Verantwortlichen-Text (Name, Vorname oder Kürzel). */
export function matchEmployee(responsible: string | undefined, employees: Pick<Employee, "id" | "name">[]): Id | undefined {
  const r = (responsible || "").trim().toLowerCase();
  if (!r) return undefined;
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toLowerCase();
  return employees.find(e => (e.name || "").toLowerCase() === r || initials(e.name || "") === r.replace(/[^a-zäöü]/g, "")
    || (e.name || "").toLowerCase().split(/\s+/).includes(r))?.id;
}

/**
 * Vorschläge aus den Protokollen eines Projekts, die noch nicht im Terminprogramm stehen und nicht
 * ausgeblendet sind: offene Aufgaben mit Frist, Beschlüsse mit Datum, nächste Sitzung (ab heute).
 * Gleiche Stellen aus Folgeprotokollen erscheinen einmal (neuestes Protokoll).
 */
export function protocolSuggestions(
  project: Pick<Project, "id" | "schedule">, protocols: Protocol[], employees: Pick<Employee, "id" | "name">[], today: DateStr,
): ProtocolSuggestion[] {
  const schedule = scheduleOf(project);
  const taken = new Set<string>(schedule.dismissed || []);
  for (const it of schedule.items) if (it.source) taken.add(it.source.kind === "sitzung" ? `sitzung:${it.start}` : it.source.text || "");
  const byKey = new Map<string, ProtocolSuggestion>();
  for (const p of projectProtocols(protocols, project.id)) {
    const track: ScheduleTrack = /bau/i.test(p.type || "") && !/bauherr/i.test(p.type || "") ? "bau" : "planung";
    const proto = { id: p.id, nummer: p.nummer, title: p.title, date: p.date, type: p.type };
    const year = Number((p.date || today).slice(0, 4));
    for (const t of p.traktanden || []) for (const e of t.items || []) {
      if (e.type !== "aufgabe" && e.type !== "beschluss") continue;
      const key = entryKey(e.type, e.text);
      const label = plainText(e.text);
      if (!label) continue;
      if (e.type === "aufgabe") {
        const due = entryDue(e, year);
        // neuere Kopie ersetzt ältere (auch wenn sie inzwischen erledigt ist)
        if (!due || e.status === "erledigt") { byKey.delete(key); continue; }
        byKey.set(key, { key, kind: "aufgabe", date: due, label, responsible: e.responsible, assigneeId: matchEmployee(e.responsible, employees),
          protocol: proto, traktandum: t.title, entryId: e.id, track });
      } else if (e.date) {
        byKey.set(key, { key, kind: "beschluss", date: e.date.slice(0, 10), label, protocol: proto, traktandum: t.title, entryId: e.id, track });
      }
    }
    if (p.nextDate && p.nextDate >= today) {
      const key = `sitzung:${p.nextDate.slice(0, 10)}`;
      byKey.set(key, { key, kind: "sitzung", date: p.nextDate.slice(0, 10), label: `${p.type || "Sitzung"}`, protocol: proto, track });
    }
  }
  return [...byKey.values()].filter(s => !taken.has(s.key)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Übernimmt einen Vorschlag als Termin (Gruppe «Aus Protokollen»). */
export function suggestionToItem(s: ProtocolSuggestion, track: ScheduleTrack, id: Id): ScheduleItem {
  const marker: ScheduleMarker = s.kind === "aufgabe" ? "abgabe" : s.kind === "beschluss" ? "entscheid" : "sitzung";
  const label = s.label.length > 70 ? `${s.label.slice(0, 68)}…` : s.label;
  return {
    id, label, kind: "milestone", marker, track, group: "Aus Protokollen", start: s.date, end: s.date,
    assigneeId: s.assigneeId || null, deps: [],
    note: [`Aus Protokoll ${s.protocol.nummer || s.protocol.title || ""} vom ${s.protocol.date || ""}`.trim(), s.traktandum ? `Traktandum: ${s.traktandum}` : "", s.responsible ? `Verantwortlich laut Protokoll: ${s.responsible}` : ""].filter(Boolean).join("\n"),
    source: { protocolId: s.protocol.id, entryId: s.entryId, kind: s.kind, text: s.kind === "sitzung" ? undefined : s.key },
  };
}

/**
 * Massgebende Protokollstelle eines übernommenen Eintrags: die gleiche Stelle (Art + Text) im neuesten
 * Protokoll des Projekts, sonst die ursprüngliche. null = Protokoll/Stelle gelöscht.
 */
export function linkedEntry(source: ScheduleSource | undefined, protocols: Protocol[], projectId: Id):
  { protocol: Protocol; traktandum: ProtocolTraktandum; entry: ProtocolEntry } | null {
  if (!source || source.kind === "sitzung") return null;
  let found: { protocol: Protocol; traktandum: ProtocolTraktandum; entry: ProtocolEntry } | null = null;
  for (const p of projectProtocols(protocols, projectId)) for (const t of p.traktanden || []) for (const e of t.items || []) {
    if (e.id === source.entryId || (source.text && entryKey(e.type, e.text) === source.text)) found = { protocol: p, traktandum: t, entry: e };
  }
  return found;
}

/** true, wenn ein Eintrag erledigt ist: Protokoll-Aufgabe «erledigt» oder Fortschritt 100 %. */
export function isDone(it: ScheduleItem, protocols: Protocol[], projectId: Id): boolean {
  if (it.source?.kind === "aufgabe") {
    const l = linkedEntry(it.source, protocols, projectId);
    if (l) return l.entry.status === "erledigt";
  }
  return (it.progress || 0) >= 100;
}

/** Setzt den Status einer Protokoll-Aufgabe (massgebende Stelle) und gibt die neue Protokoll-Liste zurück. */
export function setLinkedStatus(protocols: Protocol[], projectId: Id, source: ScheduleSource, done: boolean): Protocol[] {
  const l = linkedEntry(source, protocols, projectId);
  if (!l) return protocols;
  return protocols.map(p => p.id !== l.protocol.id ? p : {
    ...p, traktanden: p.traktanden.map(t => t.id !== l.traktandum.id ? t : {
      ...t, items: t.items.map(e => e.id !== l.entry.id ? e : { ...e, status: done ? "erledigt" : "offen" }),
    }),
  });
}

/** Termine und Balken, die im Zeitraum [from, from + days) beginnen, enden oder laufen (für «Termine einfügen»). */
export function upcomingItems(items: ScheduleItem[], from: DateStr, days: number): ScheduleItem[] {
  const to = addDays(from, days - 1);
  return items.filter(it => it.end >= from && it.start <= to).sort((a, b) => a.start.localeCompare(b.start));
}

/** Verschiebungen gegenüber dem eingefrorenen Stand (Ende, in Tagen), grösste zuerst. */
export function baselineChanges(items: ScheduleItem[], baseline: ScheduleBaseline | undefined): { item: ScheduleItem; days: number }[] {
  if (!baseline) return [];
  return items.map(item => ({ item, days: baselineDelta(item, baseline) }))
    .filter((x): x is { item: ScheduleItem; days: number } => x.days !== null && x.days !== 0)
    .sort((a, b) => Math.abs(b.days) - Math.abs(a.days));
}

/**
 * Sitzungen einer Terminserie mit den Protokollen abgleichen: zu jedem Termin das Protokoll desselben
 * Projekts in ±3 Tagen («gehalten»), sonst «kommend» (ab heute) bzw. «ohne Protokoll».
 */
export function seriesSessions(it: ScheduleItem, protocols: Protocol[], projectId: Id, today: DateStr):
  { date: DateStr; state: "gehalten" | "kommend" | "ohne"; protocol?: Protocol }[] {
  const ps = projectProtocols(protocols, projectId).filter(p => p.date);
  return seriesDates(it).map(date => {
    const protocol = ps.find(p => Math.abs(dayNum(p.date) - dayNum(date)) <= 3);
    return { date, protocol, state: protocol ? "gehalten" : date >= today ? "kommend" : "ohne" };
  });
}
