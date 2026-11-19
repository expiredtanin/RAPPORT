// Löschen mit «Rückgängig» statt Bestätigungsdialog.
//
// `changeWithUndo(text, change)` führt eine Änderung am Gesamtstand aus (über `save` aus useStudioData,
// das sich hier beim Start registriert) und zeigt eine Meldung mit «Rückgängig». Rückgängig macht nur
// diese Änderung rückgängig, nicht alles, was seither geschah (`revertChange`): gelöschte Einträge kommen
// an ihre alte Stelle zurück, geänderte nur, wenn sie seither niemand weiter verändert hat.

import type { AppData } from "./types";
import { showToast } from "./toast";

type Saver = (fn: (prev: AppData) => AppData) => void;
let saver: Saver | null = null;

/** Registriert die Speicherfunktion (useStudioData). Rückgabe meldet ab. */
export function registerUndoSaver(fn: Saver): () => void {
  saver = fn;
  return () => { if (saver === fn) saver = null; };
}

type WithId = { id: string };
const isIdList = (v: unknown): v is WithId[] =>
  Array.isArray(v) && v.every(x => x && typeof x === "object" && typeof (x as WithId).id === "string");

/**
 * Nimmt die Änderung `before → after` am aktuellen Stand `current` zurück, ohne spätere Änderungen anderer
 * Einträge zu verlieren. Listen mit `id`: gelöschte Einträge wieder einfügen (alte Position), geänderte nur
 * zurücksetzen, wenn sie in `current` noch genau dem Stand nach der Änderung entsprechen; neu hinzugekommene
 * wieder entfernen. Andere Felder: zurücksetzen, wenn sie seither unverändert sind.
 */
export function revertChange(before: AppData, after: AppData, current: AppData): AppData {
  const out = { ...current } as Record<string, unknown>;
  const b = before as unknown as Record<string, unknown>, a = after as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (b[key] === a[key]) continue;
    const bv = b[key], av = a[key], cv = out[key];
    if (isIdList(bv) && isIdList(av) && isIdList(cv)) {
      const afterById = new Map(av.map(x => [x.id, x]));
      const beforeIds = new Set(bv.map(x => x.id));
      // geändert → zurück, hinzugefügt → weg
      let list = cv
        .filter(x => beforeIds.has(x.id) || afterById.get(x.id) !== x)
        .map(x => (afterById.get(x.id) === x ? bv.find(y => y.id === x.id) ?? x : x));
      // gelöscht → an alter Stelle wieder einfügen
      bv.forEach((item, idx) => {
        if (afterById.has(item.id) || list.some(x => x.id === item.id)) return;
        const prevId = idx > 0 ? bv[idx - 1].id : null;
        const at = prevId ? list.findIndex(x => x.id === prevId) + 1 : 0;
        list = [...list.slice(0, at), item, ...list.slice(at)];
      });
      out[key] = list;
    } else if (cv === av) {
      out[key] = bv;
    }
  }
  return out as unknown as AppData;
}

/** Führt `change` aus und bietet «Rückgängig» an. Ohne registrierte Speicherfunktion (Tests) nur die Änderung. */
export function changeWithUndo(text: string, change: (prev: AppData) => AppData): void {
  if (!saver) return;
  const save = saver;
  let before: AppData | null = null, after: AppData | null = null;
  save(prev => { before = prev; after = change(prev); return after; });
  showToast(text, {
    action: {
      label: "Rückgängig",
      run: () => { if (before && after) { const b = before, a = after; save(cur => revertChange(b, a, cur)); } },
    },
  });
}

/** Häufigster Fall: Einträge einer Liste entfernen (`keep` = false → weg). */
export function removeWithUndo<K extends keyof AppData>(text: string, key: K, remove: (item: NonNullable<AppData[K]> extends (infer T)[] ? T : never) => boolean): void {
  changeWithUndo(text, prev => {
    const list = (prev[key] || []) as unknown[];
    return { ...prev, [key]: list.filter(x => !remove(x as never)) };
  });
}
