// Formprüfung geladener Daten, bevor sie migriert und gerendert werden.
//
// Der Speicher (localStorage, Datenordner, Cloud) kann Daten liefern, die nicht zur erwarteten Form
// passen: von Hand bearbeitete Dateien, halb synchronisierte Stände, Fehler älterer Versionen. Statt
// dass eine View beim Rendern abstürzt (`data.invoices.map is not a function`), wird hier grob
// repariert: Liste, Objekt und einfacher Wert vertauscht (oberste Ebene und `settings`) → Default aus
// `defaultData`; Listeneinträge, die keine Objekte sind → verworfen. Unbekannte Felder bleiben erhalten.
// Läuft am Anfang von `applyMigrations`, also bei jedem Laden auf jedem Weg.

import type { AppData } from "../types";
import type { RawData } from "./migrations";

/** Ergebnis der Prüfung: reparierte Rohdaten und was dabei auffiel (leer = alles in Ordnung). */
export interface ValidationResult {
  data: RawData;
  problems: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Grobe Typklasse für den Vergleich mit dem Default. Zahl/Text/Wahrheitswert gelten als gleich:
 * Formularfelder speichern Zahlen teils als Text, das soll keine Daten verwerfen.
 */
const kind = (v: unknown) => (Array.isArray(v) ? "Liste" : isPlainObject(v) ? "Objekt" : v === null || v === undefined ? "leer" : typeof v === "function" ? "Funktion" : "Wert");

/** Alte Listen, die `applyMigrations` noch umbaut; gleiche Regel wie für die aktuellen Listen. */
const LEGACY_LISTS = ["clients", "contacts"];

/**
 * Prüft und repariert geladene Rohdaten (siehe Dateikopf). Die Eingabe wird nicht verändert.
 *
 * @param raw Rohdaten aus dem Speicher (beliebiger Inhalt).
 * @param defaults `defaultData` aus constants.ts — liefert die erwarteten Typen.
 */
export function validateRawData(raw: unknown, defaults: AppData): ValidationResult {
  const problems: string[] = [];
  if (!isPlainObject(raw)) {
    problems.push(`Datenbestand ist kein Objekt (${kind(raw)}) — leerer Stand verwendet`);
    return { data: {}, problems };
  }
  const out: Record<string, unknown> = { ...raw };
  const def = defaults as unknown as Record<string, unknown>;

  for (const key of [...Object.keys(def), ...LEGACY_LISTS]) {
    if (!(key in out) || out[key] === undefined) continue;
    const value = out[key];
    const expected = key in def ? kind(def[key]) : "Liste";
    if (kind(value) !== expected) {
      problems.push(`«${key}» hat den Typ ${kind(value)} statt ${expected} — Standardwert verwendet`);
      delete out[key];
      continue;
    }
    if (Array.isArray(value)) {
      const items = value.filter(isPlainObject);
      if (items.length !== value.length) {
        problems.push(`«${key}»: ${value.length - items.length} ungültige Einträge entfernt`);
        out[key] = items;
      }
    }
  }

  if (isPlainObject(out.settings)) {
    const settings: Record<string, unknown> = { ...out.settings };
    const defSettings = defaults.settings as unknown as Record<string, unknown>;
    for (const key of Object.keys(defSettings)) {
      const value = settings[key];
      if (value === undefined || value === null) continue;
      if (kind(value) !== kind(defSettings[key])) {
        problems.push(`«settings.${key}» hat den Typ ${kind(value)} statt ${kind(defSettings[key])} — Standardwert verwendet`);
        delete settings[key];
      }
    }
    out.settings = settings;
  }

  return { data: out as RawData, problems };
}
