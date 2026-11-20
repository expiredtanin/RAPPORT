// Tests für revertChange (Löschen mit Rückgängig).
import { describe, expect, it } from "vitest";
import { revertChange } from "./undo";
import type { AppData } from "./types";

const D = (o: Record<string, unknown>) => o as unknown as AppData;

describe("revertChange", () => {
  const a = { id: "a", n: 1 }, b = { id: "b", n: 2 }, c = { id: "c", n: 3 };

  it("fügt einen gelöschten Eintrag an alter Stelle wieder ein", () => {
    const before = D({ quotes: [a, b, c] });
    const after = D({ quotes: [a, c] });
    expect((revertChange(before, after, after) as unknown as { quotes: unknown[] }).quotes).toEqual([a, b, c]);
  });

  it("behält spätere Änderungen an anderen Einträgen und Feldern", () => {
    const before = D({ quotes: [a, b, c], settings: { x: 1 } });
    const after = D({ quotes: [a, c], settings: { x: 1 } });
    const c2 = { id: "c", n: 30 }, d = { id: "d", n: 4 };
    const current = D({ quotes: [a, c2, d], settings: { x: 2 } });
    const r = revertChange(before, after, current) as unknown as { quotes: unknown[]; settings: unknown };
    expect(r.quotes).toEqual([a, b, c2, d]);
    expect(r.settings).toEqual({ x: 2 });
  });

  it("setzt geänderte Einträge zurück, aber nicht, wenn sie seither weiter geändert wurden", () => {
    const t1 = { id: "t1", inv: "R1" }, t2 = { id: "t2", inv: "R1" };
    const before = D({ invoices: [{ id: "R1" }], time: [t1, t2] });
    const t1o = { id: "t1", inv: null }, t2o = { id: "t2", inv: null };
    const after = D({ invoices: [], time: [t1o, t2o] });
    const t2x = { id: "t2", inv: "R9" };
    const r = revertChange(before, after, D({ invoices: [], time: [t1o, t2x] })) as unknown as { invoices: unknown[]; time: unknown[] };
    expect(r.invoices).toEqual([{ id: "R1" }]);
    expect(r.time).toEqual([t1, t2x]);
  });

  it("nimmt Hinzugefügtes wieder weg", () => {
    const before = D({ quotes: [a] });
    const after = D({ quotes: [a, b] });
    expect((revertChange(before, after, after) as unknown as { quotes: unknown[] }).quotes).toEqual([a]);
  });
});

describe("revertChange nach Nachladen und mehreren Änderungen", () => {
  const a = { id: "a", n: 1 }, b = { id: "b", n: 2 }, c = { id: "c", n: 3 };
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  it("greift auch, wenn der Stand inzwischen als Kopie nachgeladen wurde (Cloud, Datenordner)", () => {
    const t = { id: "t", minutes: 60 };
    const before = D({ timeEntries: [a] });
    const after = D({ timeEntries: [a, t] });
    // Realtime-Echo: gleiche Inhalte, neue Objekte
    const current = copy(after);
    expect((revertChange(before, after, current) as unknown as { timeEntries: unknown[] }).timeEntries).toEqual([a]);
    // geänderter Eintrag ebenso
    const before2 = D({ time: [{ id: "x", inv: "R1" }] });
    const after2 = D({ time: [{ id: "x", inv: null }] });
    expect((revertChange(before2, after2, copy(after2)) as unknown as { time: unknown[] }).time).toEqual([{ id: "x", inv: "R1" }]);
  });

  it("zwei Löschungen nacheinander, die erste zurückgenommen: Eintrag kommt hinter den nächsten vorhandenen Vorgänger", () => {
    const s0 = D({ quotes: [a, b, c] });
    const s1 = D({ quotes: [a, c] }); // b gelöscht
    const s2 = D({ quotes: [c] });    // a gelöscht
    // Rückgängig der Löschung von b: a fehlt inzwischen → b ganz nach vorn (vor c)
    expect((revertChange(s0, s1, s2) as unknown as { quotes: unknown[] }).quotes).toEqual([b, c]);
    // danach a zurück: vor b, weil a in s1 vorne stand
    const s3 = revertChange(s0, s1, s2);
    expect((revertChange(s1, s2, s3) as unknown as { quotes: unknown[] }).quotes).toEqual([a, b, c]);
  });
});
