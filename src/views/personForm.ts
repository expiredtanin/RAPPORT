// Formularstand zum Bearbeiten eines Kontakts (Persons.tsx).
//
// Beim Bearbeiten darf das Formular nichts vorbelegen, was am Kontakt nicht steht: früher kamen aus den Vorgaben
// für «Neuer Kontakt» (Kategorie «Unternehmer», Land, Altflags) Werte dazu, die beim Speichern still in einen
// Altkontakt ohne Kategorie geschrieben wurden.

import { contactCategory } from "../utils";
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
