// Formprüfung geladener Daten, bevor sie migriert und gerendert werden.
//
// Der Speicher (localStorage, Datenordner, Cloud) kann Daten liefern, die nicht zur erwarteten Form
// passen: von Hand bearbeitete Dateien, halb synchronisierte Stände, Fehler älterer Versionen. Statt
// dass eine View beim Rendern abstürzt (`data.invoices.map is not a function`), wird hier grob
// repariert: Liste, Objekt und einfacher Wert vertauscht (oberste Ebene und `settings`) → Default aus
// `defaultData`; Listeneinträge, die keine Objekte sind → verworfen. Eine Ebene tiefer werden die
// Unterlisten geprüft, auf die Ansichten ohne Absicherung zugreifen (Rechnungspositionen, Traktanden …,
// siehe NESTED_LISTS): keine Liste → leere Liste. Unbekannte Felder bleiben erhalten.
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

/**
 * Unterlisten in Listeneinträgen: oberste Liste → Feld → Art der Einträge («Objekt»: Nicht-Objekte werden
 * verworfen; «Wert»: Ids/Texte, nur die Liste selbst wird geprüft). Nur Felder, die vorhanden sind, werden geprüft.
 */
const NESTED_LISTS: Record<string, Record<string, "Objekt" | "Wert">> = {
  invoices: { items: "Objekt", reminders: "Objekt" },
  quotes: { manualPhases: "Objekt", quoteRoles: "Objekt" },
  projects: { positions: "Objekt", projectContacts: "Objekt", internalMembers: "Wert", enabledPhases: "Wert" },
  persons: { contacts: "Objekt", tags: "Wert" },
  protocols: { participants: "Objekt", traktanden: "Objekt" },
  lohnEntries: { spesenIds: "Wert" },
};

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
      let items = value.filter(isPlainObject);
      if (items.length !== value.length) {
        problems.push(`«${key}»: ${value.length - items.length} ungültige Einträge entfernt`);
      }
      if (NESTED_LISTS[key]) items = items.map(item => checkNested(key, item, problems));
      if (items.length !== value.length || items.some((item, i) => item !== value[i])) out[key] = items;
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

/** Prüft die Unterlisten eines Listeneintrags (siehe NESTED_LISTS); gibt den Eintrag unverändert zurück, wenn alles stimmt. */
function checkNested(listKey: string, item: Record<string, unknown>, problems: string[]): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  const label = `«${listKey}»${typeof item.id === "string" || typeof item.id === "number" ? ` (${item.id})` : ""}`;
  for (const [field, itemKind] of Object.entries(NESTED_LISTS[listKey])) {
    const value = item[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      problems.push(`${label}: «${field}» ist keine Liste — leere Liste verwendet`);
      out = out || { ...item };
      out[field] = [];
    } else if (itemKind === "Objekt" && !value.every(isPlainObject)) {
      const kept = value.filter(isPlainObject);
      problems.push(`${label}: «${field}»: ${value.length - kept.length} ungültige Einträge entfernt`);
      out = out || { ...item };
      out[field] = kept;
    }
  }
  return out || item;
}
