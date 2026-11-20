// Tests für den Drei-Wege-Merge (merge.ts), mit dem Datenordner und Cloud-Nachladen gleichzeitige Änderungen verrechnen.
import { describe, expect, it } from "vitest";
import { jsonEqual, mergeValue } from "./merge";

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
