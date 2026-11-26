// Tests für die Suche der Befehlspalette.
import { describe, expect, it } from "vitest";
import { buildPaletteEntries, searchPalette } from "./commandPalette";
import type { AppData } from "./types";
import type { NavItem } from "./constants";

const nav: NavItem[] = [
  { id: "projects", label: "Projekte", icon: "work" },
  { id: "buchhaltung", label: "Buchhaltung", icon: "account_balance", children: [{ id: "invoices", label: "Rechnungen" }] },
] as NavItem[];
const data = {
  projects: [{ id: "p1", name: "Wohnüberbauung Rebweg", number: "2026/07", clientId: "c1" }],
  invoices: [{ id: "i1", number: "2026-014", clientId: "c1", status: "gesendet" }],
  quotes: [{ id: "q1", number: "O2026-011", clientId: "c1" }],
  persons: [{ id: "c1", name: "Baugenossenschaft Rebweg" }],
  protocols: [],
} as unknown as AppData;

describe("Befehlspalette", () => {
  const entries = buildPaletteEntries(data, nav);
  it("zeigt nur Einträge sichtbarer Ansichten", () => {
    expect(entries.some(e => e.group === "Offerten")).toBe(false);
    expect(entries.some(e => e.label === "Rechnung 2026-014")).toBe(true);
  });
  it("findet ohne Akzente und mit mehreren Wörtern", () => {
    const r = searchPalette(entries, "wohnuber reb");
    expect(r[0].target).toEqual({ kind: "project", id: "p1" });
  });
  it("findet Rechnungen über Nummer und Kunde", () => {
    expect(searchPalette(entries, "2026-014")[0].key).toBe("i:i1");
    expect(searchPalette(entries, "rebweg rechnung").map(e => e.key)).toContain("i:i1");
  });
  it("ohne Eingabe: Aktionen und Ansichten", () => {
    const r = searchPalette(entries, "");
    expect(r.every(e => e.group === "Aktionen" || e.group === "Gehe zu")).toBe(true);
    expect(r.some(e => e.label === "Neue Rechnung")).toBe(true);
  });
  it("verträgt Datensätze ohne Namen (kaputte/importierte Daten) statt die ganze App abzuschiessen", () => {
    const broken = {
      projects: [{ id: "p1" }], invoices: [{ id: "i1" }], quotes: [], protocols: [{ id: "pr1" }],
      persons: [{ id: "c1", contacts: [{ id: "k1" }] }, { id: "c2", email: "a@b.ch" }],
    } as unknown as AppData;
    const nav2 = [...nav, { id: "personen", label: "Kontakte", icon: "group" }, { id: "protokolle", label: "Protokolle", icon: "description" }] as NavItem[];
    const e = buildPaletteEntries(broken, nav2);
    expect(() => searchPalette(e, "")).not.toThrow();
    expect(() => searchPalette(e, "ohne")).not.toThrow();
    expect(searchPalette(e, "a@b.ch").some(x => x.key === "c:c2")).toBe(true);
  });
});
