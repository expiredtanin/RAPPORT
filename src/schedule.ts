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
  DateStr, Feiertag, Id, Project, ProjectSchedule, ScheduleBreak, ScheduleItem, ScheduleMarker, ScheduleTrack, ScheduleVariant, TimeEntry,
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

/** Leeres Terminprogramm; `null`/alte Daten werden zu einer gültigen Form. */
export function scheduleOf(project: Pick<Project, "schedule"> | undefined): ProjectSchedule {
  const s = project?.schedule;
  return { items: Array.isArray(s?.items) ? s!.items : [], baselines: s?.baselines || {}, breaks: Array.isArray(s?.breaks) ? s!.breaks : [] };
}

/** Elemente eines Programms (Planung oder Bau) in gespeicherter Reihenfolge. */
export const trackItems = (schedule: ProjectSchedule, track: ScheduleTrack): ScheduleItem[] =>
  schedule.items.filter(it => it.track === track);

/**
 * Rückt Nachfolger nach, deren Abhängigkeit verletzt ist (Start vor dem Ende des Vorgängers + Abstand).
 * Nur nach hinten, Dauer bleibt; Abhängigkeiten mit `auto === false` werden nicht nachgeführt.
 * Wirkt über ganze Ketten; bei einem (eigentlich verhinderten) Kreis bricht sie nach endlich vielen Schritten ab.
 *
 * @returns neue Liste (unveränderte Elemente behalten ihre Identität)
 */
export function shiftSuccessors(items: ScheduleItem[]): ScheduleItem[] {
  const byId = new Map(items.map(it => [it.id, it]));
  const succs = new Map<Id, ScheduleItem[]>();
  for (const it of items) for (const d of it.deps || []) {
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
        if (d.auto === false) continue;
        const pred = byId.get(d.fromId);
        if (pred) need = Math.max(need, earliestAfter(pred, d.lagDays));
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

/** Erster und letzter Tag aller Elemente (leer → null). */
export function scheduleRange(items: ScheduleItem[]): { start: DateStr; end: DateStr } | null {
  if (!items.length) return null;
  const s = Math.min(...items.map(it => dayNum(it.start)));
  const e = Math.max(...items.map(it => dayNum(it.end)));
  return { start: numToDate(s), end: numToDate(e) };
}

/** Gruppen in der Reihenfolge ihres ersten Auftretens, mit Zeitraum (Sammelbalken). */
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
    const r = scheduleRange(list)!;
    return { group, start: r.start, end: r.end, items: list };
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
