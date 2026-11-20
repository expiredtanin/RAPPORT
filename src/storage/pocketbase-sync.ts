// Abgleichsplanung für den PocketBase-Adapter (reine Funktionen, ohne Netz).
//
// Der Adapter bekommt bei jedem Speichern den GANZEN Datenstand einer Collection
// (`rows`, bereits durch die toDB-Mapper übersetzt). Diese Datei entscheidet, welche
// create/update/delete-Operationen daraus folgen. Grundlage ist ein Drei-Wege-Vergleich:
//
//   base     = Stand dieser Collection, wie er zuletzt mit dem Server übereinstimmte
//              (nach dem Laden bzw. nach dem letzten erfolgreichen Schreiben)
//   rows     = unser neuer Stand (was die App speichern will)
//   existing = was jetzt auf dem Server liegt (Schlüssel, ggf. ganze Zeilen)
//
// Regeln:
//   - Zeile gegenüber `base` unverändert → nichts schreiben, auch wenn der Server
//     inzwischen anders aussieht (dann hat jemand anderes geändert, das bleibt).
//   - Zeile geändert → Update nur mit den Feldern, die sich gegenüber `base` geändert
//     haben (zwei Personen, die verschiedene Felder derselben Zeile ändern,
//     überschreiben sich nicht mehr); fehlt sie auf dem Server → Create.
//   - Zeile fehlt in `rows`, war aber in `base` → wir haben sie gelöscht → Delete
//     (nur wenn sie auf dem Server noch existiert).
//   - Zeile auf dem Server, die `base` nicht kennt → hat jemand anderes inzwischen
//     angelegt → bleibt stehen (früher wurde sie gelöscht, wenn das Speichern vor dem
//     Realtime-Nachladen kam).
// Ohne `base` (null) gilt das frühere Verhalten «Full Replace»: alles, was lokal fehlt,
// wird gelöscht, geänderte Zeilen werden ganz geschrieben.

import { jsonEqual } from "./merge";

/** Eine Zeile in Datenbankform (Ausgabe der toDB-Mapper bzw. ein PocketBase-Record). */
export type SyncRow = Record<string, unknown>;

/** Eine create/update/delete-Operation, die der Adapter ausführt. */
export type SyncOp =
  | { type: "create"; body: SyncRow }
  | { type: "update"; id: string; body: SyncRow }
  | { type: "delete"; id: string };

// PocketBase liefert Datumsfelder als "YYYY-MM-DD 00:00:00.000Z", die Mapper
// schreiben "YYYY-MM-DD" — ohne Angleichung galt jede Zeile mit Datum als geändert.
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2}) 00:00:00(?:\.0+)?Z$/;

/**
 * Bringt «kein Wert» auf einen Nenner: die App schreibt fehlende Werte als
 * null/undefined, PocketBase liefert leere Relationen/Texte als "". Datumsangaben um
 * Mitternacht (PocketBase-Form) werden auf `YYYY-MM-DD` gekürzt.
 */
export function normalizeEmpty(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") {
    const m = MIDNIGHT.exec(v);
    if (m) return m[1];
  }
  return v;
}

/** Feldvergleich nach `normalizeEmpty`; Objekte/Listen tief und unabhängig von der Schlüsselreihenfolge. */
export function fieldEqual(a: unknown, b: unknown): boolean {
  return jsonEqual(normalizeEmpty(a), normalizeEmpty(b));
}

/**
 * true, wenn alle Felder von `row` in `other` gleich sind. Zusätzliche Felder in
 * `other` (System-Felder von PocketBase wie created/collectionId) zählen nicht.
 */
export function rowUnchanged(row: SyncRow, other: SyncRow): boolean {
  return Object.keys(row).every(k => fieldEqual(row[k], other[k]));
}

/** Nur die Felder von `row`, die sich gegenüber `other` unterscheiden. */
export function changedFields(row: SyncRow, other: SyncRow): SyncRow {
  const out: SyncRow = {};
  for (const k of Object.keys(row)) if (!fieldEqual(row[k], other[k])) out[k] = row[k];
  return out;
}

/** Schlüssel einer Zeile: `id` oder ein natürlicher Schlüssel (z.B. `roleId`, `date`). */
const keyOf = (row: SyncRow, keyField: string) => String(row[keyField]);

/** Baut den Abgleichsstand (`base`) aus Zeilen in Datenbankform. */
export function baseFrom(rows: SyncRow[], keyField: string): Map<string, SyncRow> {
  return new Map(rows.map(r => [keyOf(r, keyField), r]));
}

/** Optionen für `planSync`. */
export interface PlanOptions {
  /** Darf diese Server-Zeile gelöscht werden? (Personen: nur lokale, nicht geteilte) */
  deletable?: (existing: SyncRow) => boolean;
  /** Zusätzliche Felder nur beim Anlegen (Personen: `studio`). */
  createExtra?: SyncRow;
}

/**
 * Plant die Operationen für eine Collection (Regeln im Dateikopf).
 * `existing` braucht mindestens `id` und das Schlüsselfeld; enthält es ganze Zeilen,
 * werden Felder, die auf dem Server schon stimmen, weggelassen (ganz gleiche Zeilen
 * erzeugen kein Update).
 */
export function planSync(
  rows: SyncRow[],
  existing: SyncRow[],
  keyField: string,
  base: Map<string, SyncRow> | null,
  opts: PlanOptions = {},
): SyncOp[] {
  const existingByKey = new Map(existing.map(r => [keyOf(r, keyField), r]));
  const nextKeys = new Set<string>();
  const ops: SyncOp[] = [];

  for (const row of rows) {
    const key = keyOf(row, keyField);
    nextKeys.add(key);
    const before = base?.get(key);
    if (before && rowUnchanged(row, before) && rowUnchanged(before, row)) continue; // lokal unverändert
    const match = existingByKey.get(key);
    if (match) {
      // Nur selbst geänderte Felder schicken, davon nur die, die auf dem Server noch anders
      // sind. Felder, die `existing` nicht mitliefert (nur Schlüssel geladen), bleiben drin.
      const mine = before ? changedFields(row, before) : row;
      const body: SyncRow = {};
      for (const k of Object.keys(mine)) if (!(k in match) || !fieldEqual(mine[k], match[k])) body[k] = mine[k];
      if (Object.keys(body).length > 0) ops.push({ type: "update", id: String(match.id), body });
    } else {
      ops.push({ type: "create", body: { ...row, ...opts.createExtra } });
    }
  }
  for (const r of existing) {
    const key = keyOf(r, keyField);
    if (nextKeys.has(key)) continue;
    if (base && !base.has(key)) continue; // von jemand anderem neu angelegt
    if (opts.deletable && !opts.deletable(r)) continue;
    ops.push({ type: "delete", id: String(r.id) });
  }
  return ops;
}
