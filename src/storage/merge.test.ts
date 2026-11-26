// Tests für den Drei-Wege-Merge (merge.ts), mit dem Datenordner und Cloud-Nachladen gleichzeitige Änderungen verrechnen.
import { describe, expect, it } from "vitest";
import { jsonEqual, mergeValue, applyEdit } from "./merge";

describe("mergeValue", () => {
  const base = { settings: { name: "A", iban: "1" }, invoices: [{ id: "r1", total: 10 }, { id: "r2", total: 20 }] };

  it("Änderungen an verschiedenen Feldern und Einträgen kommen beide durch", () => {
    const mine = { settings: { name: "B", iban: "1" }, invoices: [{ id: "r1", total: 11 }, { id: "r2", total: 20 }, { id: "r3", total: 30 }] };
    const theirs = { settings: { name: "A", iban: "2" }, invoices: [{ id: "r1", total: 10 }, { id: "r2", total: 22 }, { id: "r4", total: 40 }] };
    expect(mergeValue(base, mine, theirs)).toEqual({
      settings: { name: "B", iban: "2" },
      invoices: [{ id: "r1", total: 11 }, { id: "r2", total: 22 }, { id: "r4", total: 40 }, { id: "r3", total: 30 }],
    });
  });

  it("Konflikt: eigene Änderung gewinnt; Löschen verliert gegen Änderung", () => {
    const mine = { ...base, settings: { name: "Meins", iban: "1" }, invoices: [{ id: "r2", total: 20 }] };
    const theirs = { ...base, settings: { name: "Ihres", iban: "1" }, invoices: [{ id: "r1", total: 99 }, { id: "r2", total: 20 }] };
    const out = mergeValue(base, mine, theirs) as typeof base;
    expect(out.settings.name).toBe("Meins");
    expect(out.invoices.map(i => i.id)).toEqual(["r1", "r2"]);
  });

  it("unverändert gelöschte Einträge bleiben gelöscht, auf beiden Seiten", () => {
    const mine = { ...base, invoices: [{ id: "r2", total: 20 }] };
    const theirs = { ...base, invoices: [{ id: "r1", total: 10 }] };
    expect((mergeValue(base, mine, theirs) as typeof base).invoices).toEqual([]);
  });

  it("jsonEqual ignoriert Schlüsselreihenfolge und undefined", () => {
    expect(jsonEqual({ a: 1, b: undefined, c: [1, { d: 2 }] }, { c: [1, { d: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("applyEdit (Bearbeiten-Fenster)", () => {
  it("übernimmt nur die im Fenster geänderten Felder, fremde Änderungen seit dem Öffnen bleiben", () => {
    const original = { id: "r1", status: "entwurf", note: "orig", items: [{ id: "a", qty: 1 }, { id: "b", qty: 2 }] };
    const current = { ...original, status: "gesendet", items: [{ id: "a", qty: 1 }, { id: "b", qty: 5 }] };
    const edited = { ...original, note: "neu", items: [{ id: "a", qty: 3 }, { id: "b", qty: 2 }] };
    expect(applyEdit(original, edited, current)).toEqual({ id: "r1", status: "gesendet", note: "neu", items: [{ id: "a", qty: 3 }, { id: "b", qty: 5 }] });
  });
});

describe("mergeValue: Listen aus Texten", () => {
  it("beide fügen hinzu → beides bleibt; Entfernen einer Seite gilt", () => {
    expect(mergeValue(["a", "b"], ["a", "b", "x"], ["a", "b", "y"])).toEqual(["a", "b", "y", "x"]);
    expect(mergeValue(["a", "b", "c"], ["a", "c"], ["a", "b", "c", "y"])).toEqual(["a", "c", "y"]);
  });
});

describe("mergeValue: Listen mit fester Position", () => {
  it("Zahlenlisten (Mahngebühren je Stufe) bleiben ein Wert — keine vertauschten Stufen", () => {
    expect(mergeValue([0, 20, 30], [0, 25, 30], [0, 20, 40])).toEqual([0, 25, 30]);
  });
  it("Textlisten mit Duplikaten ebenfalls", () => {
    expect(mergeValue(["a", "a"], ["a", "a", "b"], ["a", "a", "c"])).toEqual(["a", "a", "b"]);
  });
});

describe("mergeValue: Konflikte melden (onConflict, für den Hinweis der Cloud-Sperre)", () => {
  const collect = (base: unknown, mine: unknown, theirs: unknown) => { const p: string[] = []; const v = mergeValue(base, mine, theirs, x => p.push(x), "items"); return { v, p }; };
  const base = [{ id: "a", price: 1 }, { id: "b", price: 2 }];

  it("verschiedene Einträge geändert: kein Konflikt", () => {
    const { v, p } = collect(base, [{ id: "a", price: 10 }, { id: "b", price: 2 }], [{ id: "a", price: 1 }, { id: "b", price: 20 }]);
    expect(v).toEqual([{ id: "a", price: 10 }, { id: "b", price: 20 }]);
    expect(p).toEqual([]);
  });
  it("derselbe Eintrag verschieden geändert: Konflikt mit Pfad, meiner gilt", () => {
    const { v, p } = collect(base, [{ id: "a", price: 10 }, { id: "b", price: 2 }], [{ id: "a", price: 11 }, { id: "b", price: 2 }]);
    expect(v).toEqual([{ id: "a", price: 10 }, { id: "b", price: 2 }]);
    expect(p).toEqual(["items[a].price"]);
  });
  it("gleich geändert ist kein Konflikt; neue Einträge beider Seiten auch nicht", () => {
    expect(collect(base, [{ id: "a", price: 5 }, { id: "b", price: 2 }], [{ id: "a", price: 5 }, { id: "b", price: 2 }]).p).toEqual([]);
    expect(collect(base, [...base, { id: "c", price: 3 }], [...base, { id: "d", price: 4 }]).p).toEqual([]);
  });
  it("gelöscht gegen geändert ist ein Konflikt (in beide Richtungen)", () => {
    expect(collect(base, [{ id: "b", price: 2 }], [{ id: "a", price: 9 }, { id: "b", price: 2 }]).p).toEqual(["items[a]"]);
    expect(collect(base, [{ id: "a", price: 9 }, { id: "b", price: 2 }], [{ id: "b", price: 2 }]).p).toEqual(["items[a]"]);
  });
  it("ohne onConflict unverändert", () => {
    expect(mergeValue(1, 2, 3)).toBe(2);
  });
});
