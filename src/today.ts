// «Heute» (views/Today.tsx) und Projekt-Arbeitsraum (ProjectDetail): reine Funktionen ohne React.
//
//  - Stoppuhr: läuft pro Gerät (`rapport_timer` in localStorage, ARCHITECTURE §4); beim Stoppen oder
//    Wechseln wird daraus ein normaler Zeiteintrag (`timerToEntry`) — es gibt keinen zweiten Speicher
//    für Stunden.
//  - Pendenzen: offene Aufgaben aus Protokollen, je Stelle nur die neueste Kopie (Folgeprotokolle),
//    optional nur die einer Person oder eines Projekts (`openTasks`).
//  - Agenda: Termine aus den Terminprogrammen, nächste Sitzungen aus Protokollen und Ferien im Team
//    für die nächsten Tage (`weekAgenda`).
//  - Projektphase: aktuelle SIA-Phase eines Projekts für die Phasenleiste (`phaseStrip`).

import { SIA_PHASES } from "./constants";
import { addDays, entryDue, entryKey, glyphOf, matchEmployee, plainText, scheduleOf, seriesDates } from "./schedule";
import type { AppData, DateStr, Employee, Id, Project, Protocol, TimeEntry } from "./types";

// ── Stoppuhr ────────────────────────────────────────────────────────────────

/** Laufende Stoppuhr (pro Gerät). `start` = ISO-Zeitpunkt. */
export interface RunningTimer {
  employeeId: Id;
  projectId: Id;
  phaseId?: string;
  positionId?: string;
  description?: string;
  start: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date): DateStr => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Laufzeit in Millisekunden (nie negativ). */
export function timerElapsedMs(t: Pick<RunningTimer, "start">, now: Date): number {
  return Math.max(0, now.getTime() - new Date(t.start).getTime());
}

/** «01:42:10» für eine Laufzeit. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Zeiteintrag aus einer gestoppten Stoppuhr: Datum und Beginn vom Start, Ende jetzt (über Mitternacht
 * hinaus wird beim Tagesende 23:59 abgeschnitten). Unter einer Minute → null (nichts speichern).
 */
export function timerToEntry(t: RunningTimer, now: Date, id: Id): TimeEntry | null {
  const start = new Date(t.start);
  if (Number.isNaN(start.getTime())) return null;
  const dayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 0);
  const end = now.getTime() > dayEnd.getTime() ? dayEnd : now;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (minutes < 1) return null;
  return {
    id, date: localDate(start), employeeId: t.employeeId, projectId: t.projectId,
    ...(t.phaseId ? { phaseId: t.phaseId } : {}), ...(t.positionId ? { positionId: t.positionId } : {}),
    minutes, startTime: localTime(start), endTime: localTime(end),
    description: t.description || "", createdAt: now.toISOString(),
  };
}

/** localStorage-Schlüssel der Stoppuhr (pro Gerät, ARCHITECTURE §4). */
export const TIMER_KEY = "rapport_timer";

/** Gespeicherte Stoppuhr dieses Geräts (oder null). */
export function readTimer(): RunningTimer | null {
  try { return parseTimer(localStorage.getItem(TIMER_KEY)); } catch { return null; }
}

/** Speichert bzw. löscht (null) die Stoppuhr dieses Geräts. */
export function writeTimer(t: RunningTimer | null): void {
  try { if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t)); else localStorage.removeItem(TIMER_KEY); } catch { /* privater Modus */ }
}

/** Liest eine gespeicherte Stoppuhr (JSON) robust; Unsinn → null. */
export function parseTimer(raw: string | null): RunningTimer | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<RunningTimer>;
    if (!t || typeof t.projectId !== "string" || typeof t.employeeId !== "string" || typeof t.start !== "string") return null;
    if (Number.isNaN(new Date(t.start).getTime())) return null;
    return t as RunningTimer;
  } catch { return null; }
}

// ── Pendenzen aus Protokollen ───────────────────────────────────────────────

/** Offene Aufgabe aus einem Protokoll (neueste Kopie). */
export interface OpenTask {
  key: string;
  projectId: Id;
  protocolId: Id;
  protocolLabel: string;
  entryId: Id;
  /** Art + Text der Stelle (wie `ScheduleSource.text`), für `setLinkedStatus` */
  textKey: string;
  label: string;
  responsible?: string;
  assigneeId?: Id;
  due: DateStr | null;
  overdue: boolean;
}

/**
 * Offene Protokoll-Aufgaben, je Projekt und Stelle (Art + Text) nur die neueste Kopie; erledigte fallen weg.
 * `employeeId` filtert auf eine Person (über Name/Kürzel im Feld «Wer»), `projectId` auf ein Projekt.
 * Sortiert: überfällig zuerst, dann nach Frist, ohne Frist zuletzt.
 */
export function openTasks(protocols: Protocol[], employees: Pick<Employee, "id" | "name">[], today: DateStr,
  opts: { employeeId?: Id; projectId?: Id } = {}): OpenTask[] {
  const sorted = [...(protocols || [])].filter(p => p.projectId && (!opts.projectId || p.projectId === opts.projectId))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const byKey = new Map<string, OpenTask | null>();
  for (const p of sorted) {
    const year = Number((p.date || today).slice(0, 4));
    for (const t of p.traktanden || []) for (const e of t.items || []) {
      if (e.type !== "aufgabe") continue;
      const label = plainText(e.text);
      if (!label) continue;
      const textKey = entryKey(e.type, e.text);
      const key = `${p.projectId}:${textKey}`;
      if (e.status === "erledigt") { byKey.set(key, null); continue; }
      const due = entryDue(e, year);
      byKey.set(key, {
        key, projectId: p.projectId as Id, protocolId: p.id, protocolLabel: p.nummer || p.title || "Protokoll", entryId: e.id, textKey,
        label, responsible: e.responsible, assigneeId: matchEmployee(e.responsible, employees),
        due, overdue: !!due && due < today,
      });
    }
  }
  return [...byKey.values()]
    .filter((x): x is OpenTask => !!x && (!opts.employeeId || x.assigneeId === opts.employeeId))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due || "9999").localeCompare(b.due || "9999"));
}

// ── Agenda der nächsten Tage ────────────────────────────────────────────────

/** Ein Termin in der Agenda. */
export interface AgendaItem {
  date: DateStr;
  label: string;
  /** Zeichen: Terminprogramm-Symbol, «●» Sitzung, «–» Ferien */
  glyph: string;
  kind: "termin" | "sitzung" | "ferien";
  projectId?: Id;
  projectName?: string;
}

/**
 * Termine der nächsten `days` Tage ab `today`: Meilensteine und Balken-Beginne aus den Terminprogrammen
 * laufender Projekte, Sitzungen (Terminserien und «nächste Sitzung» aus Protokollen, gleiche Tage nur
 * einmal) und Ferien im Team (ohne `employeeId` selbst). `projectId` beschränkt auf ein Projekt.
 */
export function weekAgenda(data: Pick<AppData, "projects" | "protocols" | "ferienEntries" | "employees">, today: DateStr, days = 7,
  opts: { employeeId?: Id; projectId?: Id } = {}): AgendaItem[] {
  const to = addDays(today, days - 1);
  const inRange = (d?: string) => !!d && d.slice(0, 10) >= today && d.slice(0, 10) <= to;
  const out: AgendaItem[] = [];
  const sessions = new Set<string>();
  const projects = (data.projects || []).filter(p => p.status !== "abgeschlossen" && (!opts.projectId || p.id === opts.projectId));
  for (const p of projects) {
    for (const it of scheduleOf(p).items) {
      if (it.variant === "serie") {
        for (const d of seriesDates(it)) if (inRange(d)) { sessions.add(`${p.id}:${d}`); out.push({ date: d, label: it.label, glyph: glyphOf(it), kind: "sitzung", projectId: p.id, projectName: p.name }); }
      } else if (it.kind === "milestone" ? inRange(it.start) : inRange(it.start)) {
        out.push({ date: it.start, label: it.kind === "milestone" ? it.label : `Beginn ${it.label}`, glyph: glyphOf(it), kind: "termin", projectId: p.id, projectName: p.name });
      }
    }
  }
  for (const pr of data.protocols || []) {
    const p = projects.find(x => x.id === pr.projectId);
    const d = pr.nextDate?.slice(0, 10);
    if (!p || !d || !inRange(d) || sessions.has(`${p.id}:${d}`)) continue;
    sessions.add(`${p.id}:${d}`);
    out.push({ date: d, label: pr.type || "Sitzung", glyph: "●", kind: "sitzung", projectId: p.id, projectName: p.name });
  }
  if (!opts.projectId) for (const f of data.ferienEntries || []) {
    if (f.employeeId === opts.employeeId || (f.status && f.status !== "approved")) continue;
    if (f.dateTo < today || f.dateFrom > to) continue;
    const name = (data.employees || []).find(e => e.id === f.employeeId)?.name;
    if (!name) continue;
    out.push({ date: f.dateFrom > today ? f.dateFrom : today, label: `${name} abwesend bis ${f.dateTo.slice(8, 10)}.${f.dateTo.slice(5, 7)}.`, glyph: "–", kind: "ferien" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

// ── Phasenleiste eines Projekts ─────────────────────────────────────────────

/** Eine SIA-Phase in der Phasenleiste. */
export interface PhaseStripItem { id: string; label: string; state: "done" | "current" | "open" }

/**
 * Phasenleiste: aktivierte SIA-Phasen in Normreihenfolge. Aktuell = Phase des neuesten Zeiteintrags
 * (sonst die erste); davor erledigt, danach offen. Abgeschlossene Projekte: alles erledigt.
 */
export function phaseStrip(project: Pick<Project, "enabledPhases" | "status">, entries: Pick<TimeEntry, "phaseId" | "date">[]): PhaseStripItem[] {
  const enabled = SIA_PHASES.filter(p => (project.enabledPhases || []).includes(p.id));
  if (enabled.length === 0) return [];
  if (project.status === "abgeschlossen") return enabled.map(p => ({ id: p.id, label: p.label, state: "done" }));
  const latest = [...entries].filter(e => e.phaseId && enabled.some(p => p.id === e.phaseId))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const cur = Math.max(0, enabled.findIndex(p => p.id === latest?.phaseId));
  return enabled.map((p, i) => ({ id: p.id, label: p.label, state: i < cur ? "done" : i === cur ? "current" : "open" }));
}

/** Merkt den Reiter, mit dem der Projekt-Arbeitsraum beim nächsten Öffnen startet (einmalig, `window.__projectTab`). */
export function requestProjectTab(tab: string): void {
  if (typeof window !== "undefined") window.__projectTab = tab;
}
