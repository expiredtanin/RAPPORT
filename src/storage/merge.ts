// Drei-Wege-Merge für den Datenordner (storage/file-adapter.ts).
//
// Zwei Personen schreiben in denselben Ordner (z.B. über iCloud). Bevor eine Datei
// überschrieben wird, die jemand anderes inzwischen geändert hat, werden drei Stände
// verrechnet: `base` (Stand beim letzten Lesen/Schreiben), `mine` (unsere Änderung) und
// `theirs` (Stand auf der Platte). Reine Funktion, keine Abhängigkeiten.
//
// Regeln (pro Wert, rekursiv):
//   - nur eine Seite hat sich gegenüber `base` geändert → diese Änderung gilt
//   - beide haben dasselbe geändert → dieser Wert
//   - Objekte → pro Schlüssel; Listen von Objekten mit `id` → pro Eintrag
//   - Konflikt (beide ändern denselben Wert verschieden) → `mine` gewinnt
//   - Eintrag gelöscht, aber von der Gegenseite geändert → bleibt (Löschen verliert)
// Listen ohne `id` (z.B. Zahlen, Strings) gelten als ein Wert.

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isIdList = (v: Json): v is Obj[] => Array.isArray(v) && v.every(x => isObj(x) && typeof x.id === "string");

/** Tiefer Vergleich (JSON-Werte; Schlüsselreihenfolge egal). */
export function jsonEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
    return ka.length === kb.length && ka.every(k => jsonEqual(a[k], b[k]));
  }
  return false;
}

function mergeIdLists(base: Obj[] | undefined, mine: Obj[], theirs: Obj[]): Obj[] {
  const byId = (l: Obj[] | undefined) => new Map((l || []).map(x => [x.id as string, x]));
  const b = byId(base), m = byId(mine), t = byId(theirs);
  const out: Obj[] = [];
  const done = new Set<string>();
  const take = (id: string) => {
    done.add(id);
    const bi = b.get(id), mi = m.get(id), ti = t.get(id);
    if (mi === undefined && ti === undefined) return;
    if (mi === undefined) { if (bi !== undefined && jsonEqual(bi, ti)) return; out.push(ti as Obj); return; } // ich habe gelöscht
    if (ti === undefined) { if (bi === undefined || !jsonEqual(bi, mi)) out.push(mi); return; } // sie haben gelöscht
    out.push(mergeValue(bi, mi, ti) as Obj);
  };
  // Reihenfolge der Platte beibehalten, eigene neue Einträge hinten anhängen
  for (const x of theirs) take(x.id as string);
  for (const x of mine) if (!done.has(x.id as string)) take(x.id as string);
  return out;
}

/** Drei-Wege-Merge eines JSON-Werts. `base` darf fehlen (dann zählen nur `mine` und `theirs`). */
export function mergeValue(base: Json, mine: Json, theirs: Json): Json {
  if (jsonEqual(mine, theirs)) return mine;
  if (base !== undefined) {
    if (jsonEqual(mine, base)) return theirs;
    if (jsonEqual(theirs, base)) return mine;
  }
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const inMine = k in mine && mine[k] !== undefined, inTheirs = k in theirs && theirs[k] !== undefined;
      if (inMine && inTheirs) out[k] = mergeValue(b[k], mine[k], theirs[k]);
      else if (inMine) { if (!(k in b) || !jsonEqual(b[k], mine[k])) out[k] = mine[k]; }   // neu oder von mir geändert; sonst von ihnen gelöscht
      else if (inTheirs) { if (!(k in b) || !jsonEqual(b[k], theirs[k])) out[k] = theirs[k]; } // neu oder von ihnen geändert; sonst von mir gelöscht
    }
    return out;
  }
  if (isIdList(mine) && isIdList(theirs)) return mergeIdLists(isIdList(base) ? base : undefined, mine, theirs);
  return mine;
}
