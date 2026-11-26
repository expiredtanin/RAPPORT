// Tests für Schreib-Robustheit des PocketBase-Adapters (ohne Server: Netzteile gestubbt).

import { afterEach, describe, expect, it, vi } from "vitest";
import { pbMessage, PocketBaseAdapter, RejectedSaveError, type SaveConflict } from "./pocketbase-adapter";
import { toDB } from "./pocketbase-mappers";
import { baseFrom } from "./pocketbase-sync";
import type { AppData } from "../types";

const data = (n: number) => ({ n } as unknown as AppData);
const err = (status: number) => Object.assign(new Error("HTTP " + status), { status });

describe("PocketBaseAdapter.save", () => {
  const delays = PocketBaseAdapter.RETRY_DELAYS;
  afterEach(() => { PocketBaseAdapter.RETRY_DELAYS = delays; });
  PocketBaseAdapter.SAVE_DEBOUNCE_MS = 0;

  it("wiederholt bei Netzfehler, Rate-Limit und 5xx und schreibt dann den neuesten Stand", async () => {
    PocketBaseAdapter.RETRY_DELAYS = [0, 0, 0];
    const a = new PocketBaseAdapter("http://test.invalid");
    a.setStudioId("s1");
    const written: number[] = [];
    let fails = [err(0), err(429), err(503)];
    a._writeSnapshot = vi.fn(async (d: AppData) => {
      const f = fails.shift();
      if (f) throw f;
      written.push((d as unknown as { n: number }).n);
    });
    await a.save(data(1));
    expect(written).toEqual([1]);
    expect(a._writeSnapshot).toHaveBeenCalledTimes(4);
    fails = [];
    await a.save(data(2));
    expect(written).toEqual([1, 2]);
  });

  it("gibt bei Validierungsfehlern sofort auf (kein Wiederholen)", async () => {
    PocketBaseAdapter.RETRY_DELAYS = [0, 0, 0];
    const a = new PocketBaseAdapter("http://test.invalid");
    a.setStudioId("s1");
    a._writeSnapshot = vi.fn(async () => { throw err(400); });
    await expect(a.save(data(1))).rejects.toMatchObject({ status: 400 });
    expect(a._writeSnapshot).toHaveBeenCalledTimes(1);
  });

  it("gibt nach den vorgesehenen Wiederholungen auf; whenIdle wartet auf das Ende", async () => {
    PocketBaseAdapter.RETRY_DELAYS = [0, 0];
    const a = new PocketBaseAdapter("http://test.invalid");
    a.setStudioId("s1");
    a._writeSnapshot = vi.fn(async () => { throw err(0); });
    const p = a.save(data(1));
    await a.whenIdle();
    await expect(p).rejects.toMatchObject({ status: 0 });
    expect(a._writeSnapshot).toHaveBeenCalledTimes(3);
    expect(a._currentWrite).toBeNull();
  });
});

describe("PocketBaseAdapter._applyOpsSequential", () => {
  it("überspringt Update/Delete auf inzwischen fehlende Datensätze und schreibt den Rest weiter", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    const done: string[] = [];
    const coll = {
      create: vi.fn(async (b: { id: string }) => { done.push("c:" + b.id); }),
      update: vi.fn(async (id: string) => { if (id === "weg") throw err(404); done.push("u:" + id); }),
      delete: vi.fn(async (id: string) => { if (id === "weg2") throw err(404); done.push("d:" + id); }),
      getOne: vi.fn(async () => { throw err(404); }),
    };
    await a._applyOpsSequential(coll as never, [
      { type: "update", id: "weg", body: {} },
      { type: "delete", id: "weg2" },
      { type: "create", body: { id: "neu" } },
      { type: "update", id: "da", body: {} },
    ]);
    expect(done).toEqual(["c:neu", "u:da"]);
  });

  it("404, aber Datensatz noch lesbar (Regel lehnt ab): gemeldet statt still übersprungen", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    const coll = { update: vi.fn(async () => { throw err(404); }), getOne: vi.fn(async () => ({ id: "f1" })), create: vi.fn(), delete: vi.fn() };
    await expect(a._applyOpsSequential(coll as never, [{ type: "update", id: "f1", body: {} }])).rejects.toMatchObject({ status: 400 });
  });

  it("andere Fehler werden gemeldet, halten die übrigen Operationen aber nicht auf", async () => {
    // vorher brach der erste Fehler den Rest ab: ein erlaubter Eintrag im selben Chunk ging still verloren
    const a = new PocketBaseAdapter("http://test.invalid");
    const coll = { create: vi.fn(async () => { throw err(400); }), update: vi.fn(), delete: vi.fn() };
    await expect(a._applyOpsSequential(coll as never, [{ type: "create", body: {} }, { type: "delete", id: "x" }]))
      .rejects.toMatchObject({ status: 400 });
    expect(coll.delete).toHaveBeenCalledWith("x");
  });
  it("vorübergehende Fehler (Netz, 429, 5xx) brechen sofort ab", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    const coll = { create: vi.fn(async () => { throw err(503); }), update: vi.fn(), delete: vi.fn() };
    await expect(a._applyOpsSequential(coll as never, [{ type: "create", body: {} }, { type: "delete", id: "x" }]))
      .rejects.toMatchObject({ status: 503 });
    expect(coll.delete).not.toHaveBeenCalled();
  });
});

describe("PocketBaseAdapter: Rate-Limit für Anlagen («*:create» gilt auch im Batch)", () => {
  const ops = (spec: string) => [...spec].map((t, i) => t === "c"
    ? { type: "create" as const, body: { id: "n" + i } }
    : { type: "update" as const, id: "u" + i, body: {} });

  it("höchstens 20 Anlagen und 50 Operationen pro Batch", () => {
    const chunks = PocketBaseAdapter._chunkOps(ops("c".repeat(45) + "u".repeat(60)));
    expect(chunks.map(c => c.length)).toEqual([20, 20, 50, 15]);
    expect(chunks.map(c => c.filter(o => o.type === "create").length)).toEqual([20, 20, 5, 0]);
  });

  it("wartet, bis Anlagen wieder ins Fenster passen", async () => {
    vi.useFakeTimers();
    try {
      const a = new PocketBaseAdapter("http://test.invalid");
      await a._reserveCreates(20);
      let done = false;
      const p = a._reserveCreates(5).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(PocketBaseAdapter.CREATE_WINDOW_MS - 100);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pbMessage: Servermeldung für das Fehlerbanner", () => {
  it("Hook-Text und Feldfehler", () => {
    expect(pbMessage({ status: 403, data: { message: "Der Monat 2026-10 ist abgeschlossen." } })).toBe("Der Monat 2026-10 ist abgeschlossen.");
    expect(pbMessage({ status: 400, message: "Failed to create record.", data: { message: "Failed to create record.", data: { amount: { code: "validation_required", message: "Cannot be blank." } } } }))
      .toBe("Failed to create record. (amount: Cannot be blank.)");
  });
});

describe("PocketBaseAdapter.save: nach einer Ablehnung weiterschreiben", () => {
  it("schreibt einen während des Fehlschlags eingegangenen Stand noch und meldet den Fehler danach", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    (a as unknown as { _studioId: string })._studioId = "s1";
    const written: unknown[] = [];
    let first = true;
    a._writeSnapshot = vi.fn(async (d: unknown) => {
      await Promise.resolve();   // wie ein echter Netzwerkaufruf: save() läuft schon
      if (first) {
        first = false;
        void a.save({ n: 2 } as never);   // kommt während des ersten Schreibens dazu
        throw new RejectedSaveError("Der Monat 2026-10 ist abgeschlossen.", ["timeEntries"]);
      }
      written.push(d);
    }) as never;
    await expect(a.save({ n: 1 } as never)).resolves.toBeUndefined();   // letzter Durchlauf war erfolgreich
    expect(written).toEqual([{ n: 2 }]);
  });
  it("wirft die Ablehnung mit den betroffenen Bereichen, wenn nichts mehr nachkommt", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    (a as unknown as { _studioId: string })._studioId = "s1";
    a._writeSnapshot = vi.fn(async () => { throw new RejectedSaveError("abgelehnt", ["timeEntries"]); }) as never;
    await expect(a.save({ n: 1 } as never)).rejects.toMatchObject({ keys: ["timeEntries"] });
  });
});

describe("PocketBaseAdapter: optimistische Sperre (409 → frisch laden, verrechnen, erneut schreiben)", () => {
  type Rec = Record<string, unknown>;
  const item = (id: string, price: number) => ({ id, desc: "Pos " + id, qty: 1, price, discount: 0 });
  const invoice = (items: ReturnType<typeof item>[], extra: Rec = {}) => ({
    id: "inv1", number: "R-2026-001", clientId: "c1", date: "2026-11-26", items, mwst: true, mwstRate: 8.1, status: "gesendet",
    sub: 0, globalDisc: 0, subAfterDisc: 0, tax: 0, total: 0, ...extra,
  });
  /** Server mit einem Datensatz; Update mit Header prüft den Stand wie concurrency.pb.js. */
  function fakeServer(rec: Rec) {
    let n = 2;
    const calls: { id: string; body: Rec; header?: string }[] = [];
    const coll = {
      getFullList: vi.fn(async () => [{ id: rec.id }]),
      getOne: vi.fn(async () => ({ ...rec })),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(async (id: string, body: Rec, opts?: { headers?: Record<string, string> }) => {
        const header = opts?.headers?.["X-Rapport-If-Updated"];
        calls.push({ id, body, header });
        if (header && header !== rec.updated) throw Object.assign(new Error("409"), { status: 409 });
        Object.assign(rec, body, { updated: "v" + ++n });
        return { ...rec };
      }),
    };
    return { coll, calls, rec, client: { collection: () => coll, filter: (f: string) => f } };
  }
  const setup = (base: ReturnType<typeof invoice>, server: ReturnType<typeof invoice>, version = "v1") => {
    const a = new PocketBaseAdapter("http://test.invalid");
    a.setStudioId("s1");
    const srv = fakeServer({ ...toDB.invoice(server as never, "s1"), updated: "v2" });
    (a as unknown as { client: unknown }).client = srv.client;
    a._base.set("invoices", baseFrom([toDB.invoice(base as never, "s1")], "id"));
    a._versions.set("invoices", new Map([["inv1", version]]));
    const conflicts: SaveConflict[] = [];
    a.onConflict = c => conflicts.push(c);
    const sync = (mine: ReturnType<typeof invoice>) => a._syncTable("invoices", "s1", [toDB.invoice(mine as never, "s1")], "id",
      { mapper: "invoice", ctx: { settings: { mwstRate: 8.1, roles: [] }, projects: [], quotes: [], invoices: [] } as never });
    return { a, srv, conflicts, sync };
  };
  const base = invoice([item("i1", 1000), item("i2", 2000), item("i3", 3000)], { sub: 6000, subAfterDisc: 6000, tax: 486, total: 6486 });

  it("verschiedene Positionen: beide Änderungen bleiben, Summen neu, kein Hinweis", async () => {
    const { srv, conflicts, sync } = setup(base, invoice([item("i1", 1000), item("i2", 2222), item("i3", 3000)], { sub: 6222, subAfterDisc: 6222, tax: 503.98, total: 6725.98 }));
    await sync(invoice([item("i1", 1111), item("i2", 2000), item("i3", 3000)], { sub: 6111, subAfterDisc: 6111, tax: 494.99, total: 6605.99 }));
    expect(srv.calls[0].header).toBe("v1");   // erster Versuch mit dem bekannten Stand → 409
    expect(srv.calls[1].header).toBe("v2");   // zweiter mit dem frisch geladenen
    expect((srv.rec.items as { price: number }[]).map(i => i.price)).toEqual([1111, 2222, 3000]);
    expect(srv.rec.sub).toBe(6333);
    expect(srv.rec.total).toBe(6845.97);
    expect(conflicts).toEqual([]);
  });

  it("dieselbe Position: eigene Fassung gilt, Hinweis an die App", async () => {
    const { srv, conflicts, sync } = setup(base, invoice([item("i1", 1222), item("i2", 2000), item("i3", 3000)], { sub: 6222, total: 6725.98 }));
    await sync(invoice([item("i1", 1111), item("i2", 2000), item("i3", 3000)], { sub: 6111, subAfterDisc: 6111, tax: 494.99, total: 6605.99 }));
    expect((srv.rec.items as { price: number }[])[0].price).toBe(1111);
    expect(srv.rec.total).toBe(6605.99);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ table: "invoices", dataKey: "invoices", id: "inv1", paths: ["items[i1].price"] });
    expect(conflicts[0].message).toContain("die Rechnung R-2026-001");
  });

  it("Stand stimmt: ein Update mit Header, danach gilt der neue Stand der Antwort", async () => {
    const { a, srv, sync } = setup(base, base, "v2");
    await sync(invoice([item("i1", 1111), item("i2", 2000), item("i3", 3000)]));
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0].header).toBe("v2");
    expect(a._versions.get("invoices")?.get("inv1")).toBe("v3");
  });

  it("nach dem Verrechnen bleibt der alte Stand bekannt: nächstes Speichern wird wieder verrechnet statt fremde Positionen zu überschreiben", async () => {
    const { a, srv, sync } = setup(base, invoice([...base.items, item("b", 20)]));
    const mine = invoice([item("i1", 1000), item("i2", 2000), item("i3", 3000), item("a", 10)]);
    await sync(mine);
    expect((srv.rec.items as { id: string }[]).map(i => i.id)).toEqual(["i1", "i2", "i3", "b", "a"]);
    expect(a._versions.get("invoices")?.get("inv1")).toBe("v1");
    // App zeigt noch meine Fassung (ohne «b»), ich ändere weiter
    await sync({ ...mine, items: [...mine.items.slice(0, 3), item("a", 15)] });
    expect((srv.rec.items as { id: string; price: number }[]).map(i => `${i.id}:${i.price}`)).toEqual(["i1:1000", "i2:2000", "i3:3000", "b:20", "a:15"]);
  });

  it("ohne bekannten Stand (älterer Server/kein updated): Update ohne Header wie bisher", async () => {
    const { a, srv, sync } = setup(base, base);
    a._versions = new Map();
    await sync(invoice([item("i1", 1111), item("i2", 2000), item("i3", 3000)]));
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0].header).toBeUndefined();
  });

  it("gibt nach CONFLICT_RETRIES Versuchen auf und meldet, dass nicht gespeichert wurde", async () => {
    const { srv, sync } = setup(base, base);
    srv.coll.update.mockImplementation(async () => { throw Object.assign(new Error("409"), { status: 409 }); });
    await expect(sync(invoice([item("i1", 1111), item("i2", 2000), item("i3", 3000)]))).rejects.toThrow(/nicht gespeichert/);
    expect(srv.coll.update).toHaveBeenCalledTimes(1 + PocketBaseAdapter.CONFLICT_RETRIES);
  });
});
