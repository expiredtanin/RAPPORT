// Reine Hilfen für die Rollen-Tabelle einer Aufwand-Offerte (Kürzel umbenennen, neue Rolle).
// Die Stunden der Phasen hängen unter dem Kürzel (`hoursByRole[id]`) — Umbenennen muss sie mitführen.

import type { Quote } from "../types";

type QuoteRoleList = Quote["quoteRoles"];
type PhaseList = Quote["manualPhases"];

/** Normalisiertes Kürzel: Grossbuchstaben, höchstens 4 Zeichen, ohne Leerraum an den Rändern. */
export const normalizeRoleId = (raw: string) => raw.trim().toUpperCase().slice(0, 4);

/**
 * Benennt das Kürzel der Rolle `idx` um und führt `hoursByRole` aller Phasen mit (alter → neuer Schlüssel).
 * Ein leeres oder bereits von einer anderen Rolle verwendetes Kürzel wird nicht übernommen (`null`):
 * sonst würden Stunden verloren gehen oder zweier Rollen zusammenfallen.
 */
export const renameQuoteRole = (roles: NonNullable<QuoteRoleList>, phases: NonNullable<PhaseList>, idx: number, rawId: string)
  : { quoteRoles: NonNullable<QuoteRoleList>; manualPhases: NonNullable<PhaseList> } | null => {
  const old = roles[idx];
  if (!old) return null;
  const id = normalizeRoleId(rawId);
  if (!id || roles.some((r, i) => i !== idx && r.id === id)) return null;
  if (id === old.id) return { quoteRoles: roles, manualPhases: phases };
  return {
    quoteRoles: roles.map((r, i) => i === idx ? { ...r, id } : r),
    manualPhases: phases.map(p => {
      const h = p.hoursByRole || {};
      if (!(old.id in h)) return p;
      const { [old.id]: hours, ...rest } = h;
      return { ...p, hoursByRole: { ...rest, [id]: hours } };
    }),
  };
};

/** Nächstes freies Kürzel «R<n>» (kollidiert nie mit einer vorhandenen Rolle, auch nach Löschen/Umbenennen). */
export const nextRoleId = (roles: NonNullable<QuoteRoleList>) => {
  const used = new Set(roles.map(r => r.id));
  let n = roles.length + 1;
  while (used.has("R" + n)) n++;
  return "R" + n;
};
