// Umzug der Daten in die Cloud (PocketBase): lokal (localStorage) oder Datenordner → ein Büro auf dem Server.
// Auch für ein JSON-Backup, das im Cloud-Modus in ein leeres Büro übertragen wird.
//
// Reine Ablauflogik ohne UI und ohne Netz: das Ziel ist ein `CloudTarget` (im Betrieb der
// PocketBaseAdapter mit `writeAreas`/`countArea`, im Test ein Mock). Ablauf (UI: views/settings/CloudMigration.tsx):
//
//   1. `planMigration`   — was übertragen wird (Bereiche mit Anzahl), was nur lokal bleibt (Akquise …),
//                          ungültige/doppelte Ids, nicht lesbare Anhänge, wer danach einzuladen ist.
//   2. `checkTarget`     — Ziel-Büro leer? Vorgaben eines neuen Büros (Rollen, Vorlagen, Absenztypen …)
//                          zählen nicht als Daten. Ein Büro mit Daten wird nur nach Bestätigung überschrieben.
//   3. `prepareForCloud` — lokale Benutzer gibt es in der Cloud nicht (Konten mit Passwort, siehe unten):
//                          `employees.appUserId` zeigt danach auf das Cloud-Konto bzw. ist leer.
//   4. `runMigration`    — Bereich für Bereich schreiben (Reihenfolge wegen Relationen wie im Adapter),
//                          vorübergehende Fehler (Netz, 429, 5xx) wiederholen, abbrechbar zwischen zwei
//                          Bereichen; am Ende Anzahl je Bereich lokal vs. Cloud vergleichen, auch nach
//                          Abbruch oder Fehler (nichts wird als «fertig» verschleiert).
//
// Ids bleiben erhalten (PocketBase-Ids sind hier freie Texte `^[a-zA-Z0-9-]{1,64}$`, siehe uuidIdField in
// pb/pb_migrations/1787422455_foundation_schema.js), damit Verweise (projectId, employeeId, quoteId …) stimmen.
// Ein erneuter Lauf ins selbe Büro legt nichts doppelt an (Abgleich über die Id).
//
// Lokale Benutzer (`data.users`, PBKDF2-Hashes) lassen sich nicht in PocketBase-Konten umwandeln, weil die
// Passwörter unbekannt sind: der Admin meldet sich mit seinem Cloud-Konto an, alle anderen lädt er danach
// über «Team» ein (`invites`); dabei wird die Verknüpfung zum Mitarbeitenden neu gesetzt.

import type { AppData, Id } from "../types";
import { collectFileRefs } from "./file-assets";

/** Ein Bereich = ein Top-Level-Schlüssel von `AppData`. */
export type AreaKey = keyof AppData;

/** Ziel des Umzugs (PocketBaseAdapter mit aktivem Studio). */
export interface CloudTarget {
  /** Anzahl Datensätze eines Bereichs im Ziel-Büro (`settings` = Studio-Einstellungen, also 1). */
  countArea(key: AreaKey): Promise<number>;
  /** Schreibt diese Bereiche so, dass das Ziel-Büro danach genau `data` enthält. */
  writeAreas(data: AppData, keys: AreaKey[]): Promise<void>;
}

/** Bezeichnungen der Bereiche für Fortschritt und Prüfung. */
export const AREA_LABELS: Record<AreaKey, string> = {
  settings: "Einstellungen",
  persons: "Kontakte",
  employees: "Mitarbeitende",
  projects: "Projekte",
  quotes: "Offerten",
  contracts: "Verträge",
  invoices: "Rechnungen",
  timeEntries: "Zeiteinträge",
  lohnEntries: "Lohnabrechnungen",
  expenses: "Spesen",
  internalExpenses: "Ausgaben",
  absences: "Absenzen",
  ferienEntries: "Ferienanträge",
  uberstundenAbschluss: "Überstunden-Auszahlungen",
  protocols: "Protokolle",
  deliveryNotes: "Lieferscheine",
  blogPosts: "Pinnwand",
  docAssets: "Dokument-Design (Schriften, Briefpapier)",
  feiertage: "Feiertage",
  absenzTypes: "Absenztypen",
  letterTemplates: "Briefvorlagen",
  appRoles: "App-Rollen",
  dashboardTemplates: "Dashboard-Vorlagen",
  users: "Benutzer",
  leads: "Akquise (Leads)",
  activities: "Kontaktverlauf (Akquise)",
};

/**
 * Bereiche, die ein neu angelegtes Büro schon mit Vorgaben enthält (create-studio-Hook, pb_hooks/studios.pb.js).
 * Sie zählen bei der Leer-Prüfung nicht als Daten und werden beim Umzug durch den lokalen Stand ersetzt.
 */
export const SEEDED_AREAS: readonly AreaKey[] = ["settings", "feiertage", "absenzTypes", "letterTemplates", "appRoles", "dashboardTemplates"];

/** Gültige Datensatz-Id in PocketBase (uuidIdField der Migrationen). */
const PB_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;

/** Anzahl Datensätze eines Bereichs lokal (`settings` = 1). */
export function localCount(data: AppData, key: AreaKey): number {
  if (key === "settings") return data.settings ? 1 : 0;
  const v = data[key];
  return Array.isArray(v) ? v.length : 0;
}

/** Ein Bereich mit Anzahl. */
export interface AreaCount { key: AreaKey; label: string; count: number }

/** Lokaler Benutzer, der in der Cloud noch eingeladen werden muss. */
export interface InviteCandidate {
  /** Name für die Einladung (Anzeigename des Benutzers bzw. des Mitarbeitenden). */
  name: string;
  /** Bisheriger Benutzername (nur zur Erinnerung). */
  username: string;
  appRoleId: Id;
  /** Verknüpfter Mitarbeitender (Einladen setzt `employees.appUserId` neu). */
  employeeId: Id | null;
}

/** Ergebnis von `planMigration`. */
export interface MigrationPlan {
  /** Zu übertragende Bereiche in Schreibreihenfolge (auch leere, die Prüfung vergleicht alle). */
  areas: AreaCount[];
  /** Bereiche mit Daten, die die Cloud (noch) nicht speichert — sie bleiben nur in der lokalen Sicherung. */
  localOnly: AreaCount[];
  /** Ungültige oder doppelte Ids je Bereich (blockiert den Umzug). */
  badIds: { key: AreaKey; label: string; ids: string[] }[];
  /** Anhänge, die nicht als Datei gelesen werden konnten (Datenordner) — fehlen danach in der Cloud. */
  unresolvedFiles: string[];
  /** Lokale Benutzer ohne Cloud-Konto (ohne den, der umzieht). */
  invites: InviteCandidate[];
}

/**
 * Plant den Umzug (Regeln im Dateikopf).
 * @param cloudKeys Bereiche, die der Adapter speichert (`CLOUD_DATA_KEYS`), in Schreibreihenfolge
 * @param selfUserId lokaler Benutzer, der umzieht (bekommt das Cloud-Konto, wird nicht eingeladen)
 */
export function planMigration(data: AppData, cloudKeys: readonly AreaKey[], selfUserId: Id | null = null): MigrationPlan {
  const areas = cloudKeys.map(key => ({ key, label: AREA_LABELS[key] ?? String(key), count: localCount(data, key) }));
  const localOnly = (Object.keys(data) as AreaKey[])
    .filter(key => key !== "users" && !cloudKeys.includes(key) && localCount(data, key) > 0)
    .map(key => ({ key, label: AREA_LABELS[key] ?? String(key), count: localCount(data, key) }));

  const badIds: MigrationPlan["badIds"] = [];
  for (const key of cloudKeys) {
    if (SEEDED_AREAS.includes(key)) continue; // natürliche Schlüssel (roleId, date …), PocketBase vergibt die Id
    const list = data[key];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const bad = new Set<string>();
    for (const row of list as { id?: unknown }[]) {
      const id = row?.id === undefined || row?.id === null ? "" : String(row.id);
      if (!PB_ID_RE.test(id) || seen.has(id)) bad.add(id || "(leer)");
      seen.add(id);
    }
    if (bad.size) badIds.push({ key, label: AREA_LABELS[key] ?? String(key), ids: [...bad] });
  }

  const unresolved = new Set<string>();
  for (const key of cloudKeys) collectFileRefs(data[key], unresolved);

  const employees = data.employees || [];
  const invites = (data.users || [])
    .filter(u => u.id !== selfUserId)
    .map(u => {
      const emp = employees.find(e => e.id === u.employeeId) || employees.find(e => e.appUserId === u.id) || null;
      return { name: u.displayName || emp?.name || u.username, username: u.username, appRoleId: u.appRoleId || "r-mitarbeiter", employeeId: emp?.id ?? null };
    });

  return { areas, localOnly, badIds, unresolvedFiles: [...unresolved].map(r => r.slice(r.lastIndexOf("/") + 1)), invites };
}

/** true, wenn der Plan den Umzug nicht zulässt (ungültige Ids). */
export const planBlocked = (plan: MigrationPlan) => plan.badIds.length > 0;

/**
 * Daten für die Cloud: `employees.appUserId` zeigt auf ein Cloud-Konto oder ist leer (in PocketBase eine
 * Relation auf users — eine lokale Benutzer-Id würde abgelehnt). Lokale Benutzer selbst werden nicht übertragen.
 * @param userMap lokale Benutzer-Id → Cloud-Konto (der Admin, der umzieht)
 * @param cloudUserIds Ids, die schon Cloud-Konten sind (Backup aus der Cloud: bestehende Mitglieder bleiben verknüpft)
 */
export function prepareForCloud(data: AppData, userMap: Record<Id, Id>, cloudUserIds: Iterable<Id> = []): AppData {
  const keep = new Set(cloudUserIds);
  const linkedBy = new Map<Id, Id>(); // Mitarbeitender → lokaler Benutzer (aus users[].employeeId)
  for (const u of data.users || []) if (u.employeeId) linkedBy.set(u.employeeId, u.id);
  const employees = (data.employees || []).map(e => {
    const localUser = e.appUserId || linkedBy.get(e.id) || null;
    const cloudUser = localUser ? (userMap[localUser] ?? (keep.has(localUser) ? localUser : null)) : null;
    return { ...e, appUserId: cloudUser };
  });
  return { ...data, employees, users: [] };
}

/** Bereiche, die im Ziel-Büro schon Daten haben (ohne Vorgaben eines neuen Büros, `SEEDED_AREAS`). */
export async function checkTarget(target: CloudTarget, cloudKeys: readonly AreaKey[]): Promise<{ empty: boolean; filled: AreaCount[] }> {
  const filled: AreaCount[] = [];
  for (const key of cloudKeys) {
    if (SEEDED_AREAS.includes(key)) continue;
    const count = await target.countArea(key);
    if (count > 0) filled.push({ key, label: AREA_LABELS[key] ?? String(key), count });
  }
  return { empty: filled.length === 0, filled };
}

/** Zustand eines Bereichs während und nach dem Umzug. */
export type AreaState = "wartet" | "läuft" | "fertig" | "Fehler" | "übersprungen";

/** Ein Bereich im Ergebnis: lokal vs. Cloud. */
export interface AreaResult {
  key: AreaKey;
  label: string;
  local: number;
  /** Anzahl im Ziel-Büro nach dem Umzug; null = nicht prüfbar (Fehler beim Zählen). */
  cloud: number | null;
  state: AreaState;
  error?: string;
}

/** Ergebnis von `runMigration`. */
export interface MigrationResult {
  areas: AreaResult[];
  aborted: boolean;
  /** Bereich, bei dem ein Fehler den Umzug angehalten hat. */
  failedAt: AreaKey | null;
  /** Alles geschrieben und die Anzahlen stimmen überall. */
  complete: boolean;
}

/** Optionen für `runMigration`. */
export interface RunOptions {
  /** Wird bei jeder Zustandsänderung mit dem aktuellen Stand aufgerufen. */
  onProgress?: (areas: AreaResult[]) => void;
  /** Abbrechen (wirkt zwischen zwei Bereichen; ein laufender Bereich wird fertig geschrieben). */
  signal?: AbortSignal;
  /** Wartezeiten (ms) für Wiederholungen bei vorübergehenden Fehlern. */
  retryDelays?: number[];
  /** Warten (im Test ersetzbar). */
  sleep?: (ms: number) => Promise<void>;
}

/** Fehler eines Schreibvorgangs, soweit hier benutzt (PocketBase ClientResponseError). */
type PbLikeError = { status?: number; message?: string; data?: { message?: string; data?: Record<string, unknown> } };

/** Vorübergehend (Netz weg, Rate-Limit, Serverfehler) — ein erneuter Versuch lohnt sich. */
export function isTransientError(e: unknown): boolean {
  const s = (e as PbLikeError | null)?.status;
  return s === 0 || s === 429 || (typeof s === "number" && s >= 500);
}

/** Fehlertext mit den betroffenen Feldern (PocketBase-Validierung: `data.data.<feld>.message`). */
export function describeError(e: unknown): string {
  const err = (e ?? {}) as PbLikeError;
  const base = err.data?.message || err.message || String(e);
  const fields: string[] = [];
  const walk = (obj: unknown, path: string, depth: number) => {
    if (!obj || typeof obj !== "object" || depth > 6 || fields.length >= 3) return;
    const o = obj as Record<string, unknown>;
    if (typeof o.message === "string" && path) { fields.push(`${path}: ${o.message}`); return; }
    for (const [k, v] of Object.entries(o)) walk(v, ["response", "data"].includes(k) ? path : (path ? `${path}.${k}` : k), depth + 1);
  };
  walk(err.data?.data, "", 0);
  const status = err.status ? ` (HTTP ${err.status})` : "";
  return fields.length ? `${base}${status} — ${fields.join("; ")}` : `${base}${status}`;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Überträgt `data` Bereich für Bereich ins Ziel und prüft danach die Anzahlen (Regeln im Dateikopf).
 * Ein Fehler (nach Wiederholungen) hält den Umzug an — spätere Bereiche verweisen oft auf frühere.
 * Die Prüfung läuft immer, auch nach Abbruch oder Fehler.
 */
export async function runMigration(data: AppData, target: CloudTarget, keys: readonly AreaKey[], opts: RunOptions = {}): Promise<MigrationResult> {
  const { onProgress, signal, retryDelays = [2000, 5000, 15000], sleep = defaultSleep } = opts;
  const areas: AreaResult[] = keys.map(key => ({ key, label: AREA_LABELS[key] ?? String(key), local: localCount(data, key), cloud: null, state: "wartet" }));
  const report = () => onProgress?.(areas.map(a => ({ ...a })));
  report();
  let aborted = false;
  let failedAt: AreaKey | null = null;

  for (const area of areas) {
    if (signal?.aborted) { aborted = true; break; }
    area.state = "läuft";
    report();
    for (let attempt = 0; ; attempt++) {
      try {
        await target.writeAreas(data, [area.key]);
        area.state = "fertig";
        break;
      } catch (e) {
        if (isTransientError(e) && attempt < retryDelays.length && !signal?.aborted) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        area.state = "Fehler";
        area.error = describeError(e);
        failedAt = area.key;
        break;
      }
    }
    report();
    if (failedAt) break;
  }
  for (const area of areas) if (area.state === "wartet") area.state = "übersprungen";

  // Prüfung: Anzahl je Bereich im Ziel (auch übersprungene — dort steht, was wirklich drüben ist)
  for (const area of areas) {
    try {
      area.cloud = await target.countArea(area.key);
    } catch (e) {
      area.cloud = null;
      if (!area.error) area.error = `Prüfung nicht möglich: ${describeError(e)}`;
    }
  }
  report();
  const complete = !aborted && !failedAt && areas.every(a => a.state === "fertig" && a.cloud === a.local);
  return { areas, aborted, failedAt, complete };
}

// ── Nach dem Umstellen (per Gerät in localStorage, siehe ARCHITECTURE.md §4) ──

/** Hinweis nach dem Umzug (localStorage `rapport_cloud_migrated`), angezeigt in Einstellungen → System. */
export interface CloudMigratedNote { at: string; from: "local" | "file"; dir?: string | null; studio: string }

/** Einladeliste nach dem Umzug (localStorage `rapport_cloud_invites`), abgearbeitet in Einstellungen → Team. */
export function readPendingInvites(): InviteCandidate[] {
  try {
    const v = JSON.parse(localStorage.getItem("rapport_cloud_invites") || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
/** Speichert die Einladeliste (leer = Schlüssel entfernen). */
export function writePendingInvites(list: InviteCandidate[]): void {
  try {
    if (list.length) localStorage.setItem("rapport_cloud_invites", JSON.stringify(list));
    else localStorage.removeItem("rapport_cloud_invites");
  } catch { /* kein localStorage (Test) */ }
}
