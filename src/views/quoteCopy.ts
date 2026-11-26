// Offerte kopieren (Offertenliste): reine Ableitung der Kopie aus einer bestehenden Offerte.

import { generateId } from "../utils";
import type { Quote } from "../types";

/**
 * Kopie einer Offerte als Entwurf: neue Nummer, Datum heute, neue Gültigkeit (`validDays` ab heute), Inhalt
 * (Modus, Phasen, Rollen, Positionen, MWST, Notizen) übernommen. Ohne Verknüpfungen: weder zum Projekt (`projectId`;
 * der Projektname bleibt als Text, `projectName` = Name des verknüpften Projekts, falls die Offerte keinen eigenen
 * trägt) noch zur Rechnung (`convertedToInvoiceId`). Id und Erstelldatum entstehen erst beim Speichern.
 * Summen werden im Editor aus dem Inhalt neu gerechnet.
 */
export function copyQuote(q: Quote, opts: { number: string; today: string; validDays: number; projectName?: string }): Omit<Quote, "id"> {
  const { id: _id, createdAt: _createdAt, convertedToInvoiceId: _conv, ...rest } = structuredClone(q);
  const valid = new Date(`${opts.today}T12:00:00`);
  valid.setDate(valid.getDate() + opts.validDays);
  const validUntil = `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, "0")}-${String(valid.getDate()).padStart(2, "0")}`;
  return {
    ...rest,
    number: opts.number,
    status: "entwurf",
    date: opts.today,
    validUntil,
    projectId: "",
    projectName: q.projectName?.trim() || opts.projectName || "",
    ...(rest.freeItems ? { freeItems: rest.freeItems.map(it => ({ ...it, id: generateId() })) } : {}),
  };
}
