// Tests für das Verrechnen nach einer Ablehnung «inzwischen geändert» (pocketbase-conflict.ts).
import { describe, expect, it } from "vitest";
import { conflictMessage, deriveMerged, editConflict, mergeRow, type DeriveContext } from "./pocketbase-conflict";
import { toDB } from "./pocketbase-mappers";
import type { Invoice, InvoiceItem } from "../types";

const items = (...p: [string, number][]): InvoiceItem[] => p.map(([id, price]) => ({ id, desc: "Pos " + id, qty: 1, price, discount: 0 }));
const inv = (it: InvoiceItem[], extra: Partial<Invoice> = {}) => toDB.invoice({
  id: "inv1", number: "R-2026-001", clientId: "c1", date: "2026-11-26", items: it, mwst: true, mwstRate: 8.1, status: "gesendet",
  sub: 0, tax: 0, total: 0, ...extra,
} as Invoice, "s1");
const ctx = { settings: { mwstRate: 8.1, roles: [] }, projects: [], quotes: [], invoices: [] } as unknown as DeriveContext;

describe("mergeRow", () => {
  const before = inv(items(["i1", 1000], ["i2", 2000], ["i3", 3000]), { total: 6486 });

  it("verschiedene Positionen geändert: beide bleiben, kein Konflikt", () => {
    const mine = inv(items(["i1", 1111], ["i2", 2000], ["i3", 3000]));
    const server = { ...inv(items(["i1", 1000], ["i2", 2222], ["i3", 3000])), updated: "x", collectionName: "invoices" };
    const { row, conflicts } = mergeRow(before, mine, server);
    expect((row.items as InvoiceItem[]).map(i => i.price)).toEqual([1111, 2222, 3000]);
    expect(conflicts).toEqual([]);
    expect("updated" in row).toBe(false);   // System-Felder des Servers kommen nicht ins Update
  });
  it("Status vom Server, Positionen von mir", () => {
    const mine = inv(items(["i1", 1111], ["i2", 2000], ["i3", 3000]));
    const server = inv(items(["i1", 1000], ["i2", 2000], ["i3", 3000]), { status: "bezahlt", paidDate: "2026-11-26" });
    const { row, conflicts } = mergeRow(before, mine, server);
    expect(row.status).toBe("bezahlt");
    expect(row.paidDate).toBe("2026-11-26");
    expect((row.items as InvoiceItem[])[0].price).toBe(1111);
    expect(conflicts).toEqual([]);
  });
  it("dieselbe Position verschieden geändert: meine gilt, Konflikt gemeldet", () => {
    const mine = inv(items(["i1", 1111], ["i2", 2000], ["i3", 3000]));
    const server = inv(items(["i1", 1222], ["i2", 2000], ["i3", 3000]));
    const { row, conflicts } = mergeRow(before, mine, server);
    expect((row.items as InvoiceItem[])[0].price).toBe(1111);
    expect(conflicts).toEqual(["items[i1].price"]);
  });
  it("beide fügen eine Position an: beide bleiben", () => {
    const mine = inv(items(["i1", 1000], ["i2", 2000], ["i3", 3000], ["a", 10]));
    const server = inv(items(["i1", 1000], ["i2", 2000], ["i3", 3000], ["b", 20]));
    const { row, conflicts } = mergeRow(before, mine, server);
    expect((row.items as InvoiceItem[]).map(i => i.id)).toEqual(["i1", "i2", "i3", "b", "a"]);
    expect(conflicts).toEqual([]);
  });
  it("einfaches Feld von beiden verschieden geändert: Konflikt", () => {
    const { row, conflicts } = mergeRow(before, { ...before, notes: "meins" }, { ...before, notes: "ihres" });
    expect(row.notes).toBe("meins");
    expect(conflicts).toEqual(["notes"]);
  });
});

describe("deriveMerged: Summen nach dem Verrechnen", () => {
  it("Positionen aus beiden Fassungen → Summen neu (calcTotal, MWST der Rechnung)", () => {
    const mine = inv(items(["i1", 1111], ["i2", 2000]), { sub: 3111, tax: 252, total: 3363 });
    const server = inv(items(["i1", 1000], ["i2", 2222]), { sub: 3222, tax: 261, total: 3483 });
    const merged = inv(items(["i1", 1111], ["i2", 2222]), { sub: 3111, tax: 252, total: 3363 });
    const out = deriveMerged("invoices", merged, mine, server, ctx);
    expect(out.sub).toBe(3333);
    expect(out.tax).toBe(269.97);
    expect(out.total).toBe(3602.97);
  });
  it("Grundlage gleich wie eine Fassung → deren Summen (keine Neuberechnung)", () => {
    const mine = inv(items(["i1", 1000]), { sub: 1, total: 1 });
    const server = inv(items(["i1", 2000]), { sub: 2, total: 2, status: "bezahlt" });
    expect(deriveMerged("invoices", { ...server, status: "entwurf" }, mine, server, ctx).total).toBe(2);
    expect(deriveMerged("invoices", { ...mine }, mine, server, ctx).total).toBe(1);
  });
  it("Offerte (frei): Summen aus den zusammengeführten Positionen", () => {
    const q = (free: { id: string; price: number }[], total = 0) => toDB.quote({ id: "q1", number: "O-1", clientId: "c", mode: "free", mwst: true, mwstRate: 8.1, status: "entwurf",
      freeItems: free.map(f => ({ ...f, desc: "x", qty: 1 })), sub: total, tax: 0, total } as never, "s1");
    const out = deriveMerged("quotes", q([{ id: "a", price: 100 }, { id: "b", price: 200 }]), q([{ id: "a", price: 100 }], 100), q([{ id: "b", price: 200 }], 200), ctx);
    expect(out.sub).toBe(300);
    expect(out.total).toBe(324.3);
  });
  it("andere Collections bleiben unverändert", () => {
    const row = { id: "x", name: "A" };
    expect(deriveMerged("contracts", row, row, row, ctx)).toBe(row);
  });
});

describe("conflictMessage", () => {
  it("nennt Art und Nummer", () => {
    expect(conflictMessage("invoices", { number: "R-2026-001" })).toBe("Jemand anders hat die Rechnung R-2026-001 inzwischen ebenfalls geändert; deine Änderung wurde übernommen, bitte prüfen.");
    expect(conflictMessage("persons", { name: "Muster AG" })).toContain("den Kontakt Muster AG");
    expect(conflictMessage("unbekannt", {})).toContain("diesen Eintrag");
    expect(conflictMessage("invoices", { number: "R-1" }, true)).toContain("nicht gespeichert");
  });
});

describe("editConflict: Hinweis im Bearbeiten-Fenster", () => {
  it("abgeleitete Summen zählen nicht, Positionen und Felder schon", () => {
    expect(editConflict("invoices", ["total", "sub", "billingSummary.fee"])).toBe(false);
    expect(editConflict("invoices", ["total", "items[i1].price"])).toBe(true);
    expect(editConflict("quotes", ["totalHours"])).toBe(false);
    expect(editConflict("contracts", ["status"])).toBe(true);
    expect(editConflict("contracts", [])).toBe(false);
  });
});
