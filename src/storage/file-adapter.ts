// FileStorageAdapter — Daten in einem Ordner statt in localStorage (nur Desktop-App).
//
// Gedacht für ein Büro mit zwei Personen, die denselben Ordner nutzen (iCloud Drive,
// NAS, Dropbox): eine pflegt alles, die andere trägt nur Stunden ein. Damit sie sich
// nicht überschreiben, sind die Daten nach Schreiber aufgeteilt:
//
//   <Ordner>/studio.json                       alles ausser Zeiteinträgen (settings, Rechnungen, …)
//   <Ordner>/time/<mitarbeiter>_<YYYY-MM>.json Zeiteinträge, eine Datei pro Person und Monat
//   <Ordner>/backups/backup-<Tag>-<Gerät>.json ein Gesamtstand pro Tag und Gerät (letzte 14)
//
// Ablauf: load() liest alles und merkt sich pro Datei Inhalt + Änderungszeit («known»).
// save() ist entprellt (250 ms) und schreibt nur Dateien, deren Inhalt sich geändert hat.
// Hat jemand eine Datei inzwischen geändert (Zeit/Grösse ≠ known), wird vor dem Schreiben
// per Drei-Wege-Merge (merge.ts) verrechnet statt überschrieben. Eine Dateiüberwachung
// meldet Änderungen der anderen Person über `onExternalChange` an die App.
//
// Schreiben ist atomar (temp-Datei, dann umbenennen). Konfliktkopien der Sync-Dienste
// («studio 2.json», «… conflicted copy …») werden nicht gelesen, aber über
// `findConflictFiles()` gemeldet; nicht heruntergeladene iCloud-Dateien (`.x.json.icloud`)
// führen zu einer verständlichen Fehlermeldung statt zu leeren Daten.
//
// Die Dateischicht (`FsApi`) ist austauschbar: im Betrieb Tauri (`tauriFs`), für
// Prüfungen Node-`fs`. Nicht enthalten: Verschlüsselung, Assets als eigene Dateien, Rechte
// (wer den Ordner lesen darf, sieht alles).

import type { AppData, TimeEntry } from "../types";
import type { RawData } from "./migrations";
import type { StorageAdapter } from "./adapter";
import { jsonEqual, mergeValue } from "./merge";
import { localISODate } from "../utils";

/** Dateizugriff, den der Adapter braucht. Pfade sind absolut, getrennt mit «/». */
export interface FsApi {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Legt den Ordner samt Eltern an; kein Fehler, wenn er existiert. */
  mkdir(path: string): Promise<void>;
  /** null = Datei existiert nicht. */
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  /** Namen der Einträge; leer, wenn der Ordner fehlt. */
  list(path: string): Promise<string[]>;
  /** Meldet Änderungen unterhalb von `path` (rekursiv); gibt die Abmeldefunktion zurück. */
  watch(path: string, onChange: () => void): Promise<() => void>;
}

const FORMAT = 1;
const SAVE_DELAY_MS = 250;
const WATCH_DELAY_MS = 700;
const KEEP_BACKUPS = 14;

type Json = unknown;
interface Known { content: Json; mtime: number; size: number }
type StudioFile = { format: number; data: Record<string, unknown> };
type TimeFile = { format: number; entries: TimeEntry[] };

const STUDIO = "studio.json";
const safe = (s: string) => (s || "_none").replace(/[^A-Za-z0-9-]/g, "_");
const timeFileName = (e: TimeEntry) => `time/${safe(e.employeeId || "")}_${/^\d{4}-\d{2}/.test(e.date || "") ? e.date.slice(0, 7) : "0000-00"}.json`;

/** Zerlegt den Gesamtstand in Dateiinhalte (Dateiname → Inhalt). Immer enthalten: studio.json. */
export function splitData(data: AppData): Map<string, StudioFile | TimeFile> {
  const { timeEntries, ...rest } = data;
  const files = new Map<string, StudioFile | TimeFile>();
  files.set(STUDIO, { format: FORMAT, data: rest as Record<string, unknown> });
  for (const e of timeEntries || []) {
    const name = timeFileName(e);
    const f = (files.get(name) as TimeFile | undefined) || { format: FORMAT, entries: [] };
    f.entries.push(e);
    files.set(name, f);
  }
  return files;
}

/** Setzt die Dateiinhalte wieder zum Gesamtstand zusammen (Gegenstück zu splitData). */
export function joinData(files: Map<string, Json>): RawData | null {
  const studio = files.get(STUDIO) as StudioFile | undefined;
  if (!studio) return null;
  const entries: TimeEntry[] = [];
  for (const [name, content] of files) if (name !== STUDIO) entries.push(...((content as TimeFile).entries || []));
  entries.sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
  return { ...(studio.data as RawData), timeEntries: entries };
}

/** Meldung, wenn der Ordner (noch) nicht lesbar ist — z.B. iCloud hat Dateien nicht heruntergeladen. */
export class DataFolderError extends Error {}

/** Cloud-/Sync-Dienste benennen Konfliktkopien so; solche Dateien werden nie als Daten gelesen. */
const isConflictName = (n: string) => / \d+\.json$/.test(n) || /conflict|konflikt/i.test(n);
const isDataName = (n: string) => n.endsWith(".json") && !n.includes(".tmp-") && !isConflictName(n);

export class FileStorageAdapter implements StorageAdapter {
  readonly dir: string;
  private fs: FsApi;
  private deviceId: string;
  private known = new Map<string, Known>();
  private pending: AppData | null = null;
  private waiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<(data: RawData) => void>();
  private unwatch: (() => void) | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private backupDay = "";

  constructor(dir: string, fs: FsApi, deviceId = "geraet") {
    this.dir = dir.replace(/\/+$/, "");
    this.fs = fs;
    this.deviceId = safe(deviceId).slice(0, 12);
  }

  private path(name: string) { return `${this.dir}/${name}`; }

  async hasExistingData() {
    if (await this.fs.stat(this.path(STUDIO))) return true;
    return (await this.fs.list(this.dir)).includes(`.${STUDIO}.icloud`);
  }

  /** Namen der vorhandenen Datendateien (studio.json, time/…) und ob iCloud noch Platzhalter statt Dateien hat. */
  private async dataNames(): Promise<{ names: string[]; icloudPending: boolean }> {
    const [top, time] = await Promise.all([this.fs.list(this.dir), this.fs.list(this.path("time"))]);
    return {
      names: [...(top.includes(STUDIO) ? [STUDIO] : []), ...time.filter(isDataName).map(n => `time/${n}`)],
      icloudPending: !top.includes(STUDIO) && [...top, ...time].some(n => n.startsWith(".") && n.endsWith(".icloud")),
    };
  }

  /** Gesamtstand aus dem, was zuletzt gelesen/geschrieben wurde. */
  private snapshot(): RawData | null {
    return joinData(new Map([...this.known].map(([n, k]) => [n, k.content])));
  }

  /** Liest alle Datendateien, aktualisiert `known` und gibt den Gesamtstand zurück (null = noch keine Daten). */
  async load(): Promise<RawData | null> {
    await this.fs.mkdir(this.dir);
    const { names, icloudPending } = await this.dataNames();
    if (icloudPending) {
      throw new DataFolderError("Der Datenordner ist noch nicht vollständig von iCloud geladen. Im Finder Rechtsklick auf den Ordner → «Jetzt laden» bzw. «Download behalten» und danach Rapport neu starten.");
    }
    const read = await Promise.all(names.map(async name => {
      const st = await this.fs.stat(this.path(name));
      if (!st) return null;
      try { return [name, { content: JSON.parse(await this.fs.readText(this.path(name))), mtime: st.mtime, size: st.size }] as const; }
      catch (e) { throw new DataFolderError(`Die Datei «${name}» ist beschädigt oder noch nicht fertig synchronisiert (${(e as Error).message}). Rapport wurde nicht geladen, damit nichts überschrieben wird.`); }
    }));
    this.known = new Map(read.filter(<T,>(x: T | null): x is T => x !== null));
    return this.snapshot();
  }

  /** Merkt den Stand vor und schreibt ihn entprellt. Das Promise erfüllt sich, sobald er auf der Platte ist. */
  save(data: AppData): Promise<void> {
    this.pending = data;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.flush().catch(() => {}); }, SAVE_DELAY_MS);
    });
  }

  /** Schreibt einen ausstehenden Stand sofort (z.B. beim Verlassen des Fensters). */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.chain = this.chain.then(async () => {
      const data = this.pending;
      const waiters = this.waiters;
      this.pending = null; this.waiters = [];
      if (!data) { waiters.forEach(w => w.resolve()); return; }
      try {
        const pulled = await this.writeAll(data);
        waiters.forEach(w => w.resolve());
        if (pulled) await this.emitExternal();
      } catch (e) {
        console.error("Datenordner: Speichern fehlgeschlagen:", e);
        waiters.forEach(w => w.reject(e));
      }
    });
    return this.chain;
  }

  /** Schreibt alle geänderten Dateien. true = dabei sind Änderungen der anderen Person eingeflossen. */
  private async writeAll(data: AppData): Promise<boolean> {
    await this.fs.mkdir(this.path("time"));
    const next = splitData(data);
    // Zeitdateien, die es nicht mehr gibt (alle Einträge gelöscht/verschoben), leeren
    for (const name of this.known.keys()) if (name !== STUDIO && !next.has(name)) next.set(name, { format: FORMAT, entries: [] });
    let pulled = false;
    for (const [name, mine] of next) {
      const k = this.known.get(name);
      if (k && jsonEqual(k.content, mine)) continue;
      if (!k && name !== STUDIO && (mine as TimeFile).entries.length === 0) continue;
      const path = this.path(name);
      const st = await this.fs.stat(path);
      let result: Json = mine;
      if (st && (!k || st.mtime !== k.mtime || st.size !== k.size)) {
        // Datei wurde von aussen geändert (oder neu angelegt) → verrechnen statt überschreiben
        const theirs = JSON.parse(await this.fs.readText(path));
        result = mergeValue(k?.content, mine, theirs);
        if (!jsonEqual(result, mine)) pulled = true;
        if (jsonEqual(result, theirs)) { this.known.set(name, { content: theirs, mtime: st.mtime, size: st.size }); continue; }
      }
      if (name !== STUDIO && (result as TimeFile).entries.length === 0) {
        if (st) await this.fs.remove(path);
        this.known.delete(name);
        continue;
      }
      await this.writeAtomic(path, JSON.stringify(result));
      const after = await this.fs.stat(path);
      this.known.set(name, { content: result, mtime: after?.mtime ?? 0, size: after?.size ?? 0 });
    }
    await this.backupIfDue();
    return pulled;
  }

  private async writeAtomic(path: string, text: string) {
    const tmp = `${path}.tmp-${Math.random().toString(36).slice(2, 8)}`;
    await this.fs.writeText(tmp, text);
    await this.fs.rename(tmp, path);
  }

  /** Ein Gesamtstand pro Tag und Gerät in backups/, die letzten KEEP_BACKUPS werden behalten. */
  private async backupIfDue() {
    const day = localISODate();
    if (this.backupDay === day) return;
    const data = this.snapshot();
    if (!data) return;
    await this.fs.mkdir(this.path("backups"));
    const name = `backup-${day}-${this.deviceId}.json`;
    if (!(await this.fs.stat(this.path(`backups/${name}`)))) await this.writeAtomic(this.path(`backups/${name}`), JSON.stringify(data));
    this.backupDay = day;
    const mine = (await this.fs.list(this.path("backups"))).filter(n => n.startsWith("backup-") && n.endsWith(`-${this.deviceId}.json`)).sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) await this.fs.remove(this.path(`backups/${old}`)).catch(() => {});
  }

  /** Sichert den aktuellen Stand nach backups/ und entfernt danach die Datendateien (Zurücksetzen). */
  async clear() {
    await this.flush();
    const data = this.snapshot();
    if (data) {
      await this.fs.mkdir(this.path("backups"));
      await this.writeAtomic(this.path(`backups/vor-zuruecksetzen-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(data));
    }
    for (const name of this.known.keys()) await this.fs.remove(this.path(name)).catch(() => {});
    this.known.clear();
  }

  /** Dateien, die ein Sync-Dienst als Konfliktkopie angelegt hat (werden ignoriert, sollten aber geprüft werden). */
  async findConflictFiles(): Promise<string[]> {
    const top = (await this.fs.list(this.dir)).filter(n => n.endsWith(".json") && isConflictName(n));
    const time = (await this.fs.list(this.path("time"))).filter(n => n.endsWith(".json") && isConflictName(n)).map(n => `time/${n}`);
    return [...top, ...time];
  }

  /** Registriert `cb`, das mit dem neuen Gesamtstand aufgerufen wird, wenn die andere Person Dateien geändert hat. */
  onExternalChange(cb: (data: RawData) => void): () => void {
    this.listeners.add(cb);
    if (!this.unwatch) {
      this.fs.watch(this.dir, () => {
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => { this.checkExternal().catch(e => console.error("Datenordner: Prüfung fehlgeschlagen:", e)); }, WATCH_DELAY_MS);
      }).then(un => { this.unwatch = un; }).catch(e => console.error("Datenordner: Überwachung nicht möglich:", e));
    }
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size) { this.unwatch?.(); this.unwatch = null; }
    };
  }

  /** Vergleicht die Platte mit `known`; bei Abweichung neu laden und melden. Eigene Schreibvorgänge lösen nichts aus. */
  async checkExternal() {
    await this.flush();
    const { names } = await this.dataNames();
    let changed = names.length !== this.known.size || names.some(n => !this.known.has(n));
    if (!changed) {
      const stats = await Promise.all(names.map(n => this.fs.stat(this.path(n))));
      changed = stats.some((st, i) => { const k = this.known.get(names[i])!; return !st || st.mtime !== k.mtime || st.size !== k.size; });
    }
    if (changed) await this.emitExternal();
  }

  private async emitExternal() {
    const data = await this.load();
    if (data) this.listeners.forEach(cb => cb(data));
  }
}

/** Dateischicht auf Basis von tauri-plugin-fs (lädt das Plugin erst beim ersten Zugriff). Der Ordner muss vorher per Dialog gewählt worden sein (fs-Scope). */
export function tauriFs(): FsApi {
  const fs = () => import("@tauri-apps/plugin-fs");
  return {
    readText: async p => (await fs()).readTextFile(p),
    writeText: async (p, t) => (await fs()).writeTextFile(p, t),
    rename: async (a, b) => (await fs()).rename(a, b),
    remove: async p => (await fs()).remove(p),
    mkdir: async p => (await fs()).mkdir(p, { recursive: true }),
    stat: async p => {
      try { const st = await (await fs()).stat(p); return { mtime: st.mtime ? st.mtime.getTime() : 0, size: st.size }; } catch { return null; }
    },
    list: async p => {
      try { return (await (await fs()).readDir(p)).map(e => e.name); } catch { return []; }
    },
    watch: async (p, cb) => (await fs()).watch(p, () => cb(), { recursive: true, delayMs: 300 }),
  };
}
