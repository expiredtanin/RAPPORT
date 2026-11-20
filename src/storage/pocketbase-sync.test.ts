// Tests für die Abgleichsplanung des PocketBase-Adapters (pocketbase-sync.ts).

import { describe, expect, it } from "vitest";
import { baseFrom, fieldEqual, normalizeEmpty, planSync, rowUnchanged } from "./pocketbase-sync";

const te = (id: string, extra: Record<string, unknown> = {}) => ({ id, studio: "s1", date: "2026-11-02", hours: 2, note: "", ...extra });
/** Server-Zeile, wie PocketBase sie liefert (Datum mit Uhrzeit, System-Felder). */
const srv = (row: Record<string, unknown>) => ({ ...row, date: `${row.date} 00:00:00.000Z`, collectionId: "c", created: "x", updated: "y" });

describe("normalizeEmpty/fieldEqual", () => {
  it("behandelt leer, null, undefined gleich und kürzt Mitternachts-Zeitstempel", () => {
    expect(normalizeEmpty("")).toBeNull();
    expect(normalizeEmpty(undefined)).toBeNull();
    expect(normalizeEmpty("2026-11-02 00:00:00.000Z")).toBe("2026-11-02");
    expect(normalizeEmpty("2026-11-02 13:00:00.000Z")).toBe("2026-11-02 13:00:00.000Z");
    expect(fieldEqual(null, "")).toBe(true);
    expect(fieldEqual("2026-11-02", "2026-11-02 00:00:00.000Z")).toBe(true);
  });

  it("vergleicht JSON-Felder unabhängig von der Schlüsselreihenfolge (PocketBase sortiert Schlüssel)", () => {
    expect(fieldEqual({ b: 1, a: [1, { y: 2, x: 1 }] }, { a: [1, { x: 1, y: 2 }], b: 1 })).toBe(true);
    expect(fieldEqual([1, 2], [2, 1])).toBe(false);
  });

  it("rowUnchanged ignoriert System-Felder des Servers", () => {
    expect(rowUnchanged(te("a"), srv(te("a")))).toBe(true);
    expect(rowUnchanged(te("a", { hours: 3 }), srv(te("a")))).toBe(false);
  });
});

describe("planSync ohne Abgleichsstand (Full Replace wie bisher)", () => {
  it("legt Neues an, ändert Geändertes, löscht, was lokal fehlt", () => {
    const existing = [srv(te("a")), srv(te("b")), srv(te("c"))];
    const ops = planSync([te("a"), te("b", { hours: 5 }), te("d")], existing, "id", null);
    expect(ops).toEqual([
      { type: "update", id: "b", body: { hours: 5 } },
      { type: "create", body: te("d") },
      { type: "delete", id: "c" },
    ]);
  });
});

describe("planSync mit Abgleichsstand (Drei-Wege)", () => {
  it("überschreibt fremde Änderungen an Zeilen nicht, die wir selbst nicht geändert haben", () => {
    const base = baseFrom([te("a"), te("b")], "id");
    const existing = [srv(te("a", { hours: 8 })), srv(te("b"))]; // jemand anderes hat a geändert
    const ops = planSync([te("a"), te("b", { note: "neu" })], existing, "id", base);
    expect(ops).toEqual([{ type: "update", id: "b", body: { note: "neu" } }]);
  });

  it("schickt beim Update nur die selbst geänderten Felder (Feld-Merge)", () => {
    const base = baseFrom([te("a")], "id");
    const existing = [srv(te("a", { hours: 8 }))]; // fremd: hours
    const ops = planSync([te("a", { note: "meins" })], existing, "id", base);
    expect(ops).toEqual([{ type: "update", id: "a", body: { note: "meins" } }]);
  });

  it("löscht keine Zeilen, die inzwischen jemand anderes angelegt hat", () => {
    const base = baseFrom([te("a")], "id");
    const existing = [srv(te("a")), srv(te("fremd"))];
    expect(planSync([te("a")], existing, "id", base)).toEqual([]);
  });

  it("löscht, was wir selbst entfernt haben — aber nur, wenn es auf dem Server noch existiert", () => {
    const base = baseFrom([te("a"), te("b"), te("weg")], "id");
    const existing = [srv(te("a")), srv(te("b"))]; // "weg" hat schon jemand gelöscht
    expect(planSync([te("a")], existing, "id", base)).toEqual([{ type: "delete", id: "b" }]);
  });

  it("legt eine von anderen gelöschte Zeile nur wieder an, wenn wir sie geändert haben", () => {
    const base = baseFrom([te("a"), te("b")], "id");
    const existing: Record<string, unknown>[] = []; // beide fremd gelöscht
    const ops = planSync([te("a"), te("b", { hours: 4 })], existing, "id", base);
    expect(ops).toEqual([{ type: "create", body: te("b", { hours: 4 }) }]);
  });

  it("arbeitet mit natürlichen Schlüsseln und mit Schlüssel-only-Serverzeilen", () => {
    const role = (roleId: string, label: string) => ({ studio: "s1", roleId, label, rate: 100 });
    const base = baseFrom([role("PL", "Projektleitung"), role("TS", "Technik")], "roleId");
    const existing = [{ id: "r1", roleId: "PL" }, { id: "r2", roleId: "TS" }];
    const ops = planSync([role("PL", ""), role("BL", "Bauleitung")], existing, "roleId", base);
    expect(ops).toEqual([
      { type: "update", id: "r1", body: { label: "" } }, // geleertes Feld geht mit, obwohl der Server es nicht mitgeliefert hat
      { type: "create", body: role("BL", "Bauleitung") },
      { type: "delete", id: "r2" },
    ]);
  });

  it("Personen: geteilte (fremde) Zeilen werden nie gelöscht, studio nur beim Anlegen", () => {
    const p = (id: string, name: string) => ({ id, name });
    const base = baseFrom([p("lokal", "A"), p("geteilt", "B")], "id");
    const existing = [{ id: "lokal", name: "A", studio: "s1" }, { id: "geteilt", name: "B", studio: "" }];
    const ops = planSync([p("neu", "C")], existing, "id", base, {
      deletable: r => r.studio === "s1",
      createExtra: { studio: "s1" },
    });
    expect(ops).toEqual([
      { type: "create", body: { id: "neu", name: "C", studio: "s1" } },
      { type: "delete", id: "lokal" },
    ]);
  });
});
