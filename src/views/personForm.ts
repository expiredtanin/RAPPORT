// Formularstand zum Bearbeiten eines Kontakts (Persons.tsx).
//
// Beim Bearbeiten darf das Formular nichts vorbelegen, was am Kontakt nicht steht: früher kamen aus den Vorgaben
// für «Neuer Kontakt» (Kategorie «Unternehmer», Land, Altflags) Werte dazu, die beim Speichern still in einen
// Altkontakt ohne Kategorie geschrieben wurden.

import { contactCategory } from "../utils";
import { COUNTRIES, countryCode } from "../countries";
import type { Person } from "../types";

/** Formular einer Firma; die `_haupt*`-Felder gibt es nur beim Neuanlegen (erster Ansprechpartner). */
export type FirmForm = Partial<Person> & { _hauptName?: string; _hauptPosition?: string; _hauptPhone?: string; _hauptEmail?: string; /** Tags als kommagetrennter Text im Formular */ _tags?: string };

/**
 * Formular für einen bestehenden Kontakt: genau dessen Felder. Die Kategorie zeigt, was die Liste anzeigt
 * (`contactCategory`: Altpartner gelten als «Unternehmer», Kontakte ohne Kategorie bleiben ohne).
 */
export function firmEditForm(p: Person): FirmForm {
  return { ...p, category: contactCategory(p), _tags: (p.tags || []).join(", ") };
}

/**
 * Wert der Land-Auswahl: der ISO-Code des Kontakts (ausgeschriebene Namen wie «Deutschland» als Code), leer → CH.
 * Unbekannter Freitext bleibt als eigener Eintrag sichtbar (`countryOptions`), statt still als CH zu erscheinen.
 */
export function countrySelectValue(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "CH";
  return countryCode(v, "") || v;
}

/** Einträge der Land-Auswahl: gängige Länder, dazu der bisherige Wert, falls er nicht in der Liste steht. */
export function countryOptions(raw: string | null | undefined): { code: string; label: string }[] {
  const v = countrySelectValue(raw);
  if (COUNTRIES.some(c => c.code === v)) return [...COUNTRIES];
  const known = /^[A-Z]{2}$/.test(v);
  return [...COUNTRIES, { code: v, label: known ? v : `${v} (kein Ländercode – QR-Code: CH)` }];
}
