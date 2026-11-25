// Tests für Schreib-Robustheit des PocketBase-Adapters (ohne Server: Netzteile gestubbt).

import { afterEach, describe, expect, it, vi } from "vitest";
import { pbMessage, PocketBaseAdapter, RejectedSaveError } from "./pocketbase-adapter";
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
