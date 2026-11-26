// Tests für den LocalStorageAdapter (entprelltes Speichern, voller Speicher). localStorage wird nachgebildet.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageAdapter } from "./adapter";
import { STORAGE_KEY, defaultData } from "../constants";
import type { AppData } from "../types";

/** localStorage-Ersatz mit Grenze in Zeichen (WKWebView: ~5,2 Mio.). */
function fakeLocalStorage(limit: number) {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const used = [...store].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
      if (used + k.length + v.length > limit) {
        const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e;
      }
      store.set(k, v);
    },
    removeItem: (k: string) => { store.delete(k); },
  };
}

let ls: ReturnType<typeof fakeLocalStorage>;
beforeEach(() => { ls = fakeLocalStorage(5_000_000); vi.stubGlobal("localStorage", ls); });
afterEach(() => { vi.unstubAllGlobals(); });

const withNote = (note: string): AppData => ({ ...defaultData, settings: { ...defaultData.settings, name: note } });

describe("LocalStorageAdapter", () => {
  it("schreibt bei schnellen Änderungen nur den letzten Stand; alle Promises erfüllen sich", async () => {
    const a = new LocalStorageAdapter();
    const p1 = a.save(withNote("eins"));
    const p2 = a.save(withNote("zwei"));
    await a.flush();
    await expect(Promise.all([p1, p2])).resolves.toBeDefined();
    expect(JSON.parse(ls.getItem(STORAGE_KEY)!).settings.name).toBe("zwei");
    expect((await a.load())?.settings?.name).toBe("zwei");
  });

  it("Daten über 5 MB: Speichern schlägt mit QuotaExceededError fehl, der alte Stand bleibt; danach klappt es wieder", async () => {
    const a = new LocalStorageAdapter();
    await (async () => { const p = a.save(withNote("klein")); await a.flush(); await p; })();
    const big = { ...withNote("gross"), blogPosts: [{ id: "b", imageData: "x".repeat(5_200_000) } as never] };
    const p = a.save(big);
    await expect(a.flush()).rejects.toMatchObject({ name: "QuotaExceededError" });
    await expect(p).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(JSON.parse(ls.getItem(STORAGE_KEY)!).settings.name).toBe("klein");
    // nach dem Entfernen des grossen Bildes speichert der nächste Stand wieder
    const p3 = a.save(withNote("wieder klein"));
    await a.flush();
    await p3;
    expect(JSON.parse(ls.getItem(STORAGE_KEY)!).settings.name).toBe("wieder klein");
  });

  it("kaputter Inhalt lädt als null statt zu werfen", async () => {
    ls.setItem(STORAGE_KEY, "{kaputt");
    expect(await new LocalStorageAdapter().load()).toBeNull();
  });
});

describe("LocalStorageAdapter: zwei Fenster", () => {
  const inv = (id: string, note = "") => ({ id, note } as never);
  const withInvoices = (...ids: string[]): AppData => ({ ...defaultData, invoices: ids.map(i => inv(i)) });
  const write = async (a: LocalStorageAdapter, d: AppData) => { const p = a.save(d); await a.flush(); await p; };
  const stored = () => JSON.parse(ls.getItem(STORAGE_KEY)!) as AppData;

  it("Fenster B speichert mit altem Stand: Änderung von Fenster A bleibt erhalten und wird an B gemeldet", async () => {
    await write(new LocalStorageAdapter(), withInvoices("a"));
    const A = new LocalStorageAdapter(), B = new LocalStorageAdapter();
    await A.load(); await B.load();
    await write(A, withInvoices("a", "von-A"));
    const seen: AppData[] = [];
    B.onExternalChange(d => seen.push(d as AppData));
    await write(B, withInvoices("a", "von-B"));   // B kennt «von-A» nicht
    expect(stored().invoices.map(i => i.id).sort()).toEqual(["a", "von-A", "von-B"]);
    expect(seen).toHaveLength(1);
    expect(seen[0].invoices.map(i => i.id).sort()).toEqual(["a", "von-A", "von-B"]);
    // danach ohne weitere Fremdänderung: kein erneutes Melden, nichts geht verloren
    await write(B, { ...seen[0], settings: { ...defaultData.settings, name: "neu" } });
    expect(seen).toHaveLength(1);
    expect(stored().invoices).toHaveLength(3);
  });

  it("von A gelöschter Eintrag kommt durch B (alter Stand) nicht zurück", async () => {
    await write(new LocalStorageAdapter(), withInvoices("a", "b"));
    const A = new LocalStorageAdapter(), B = new LocalStorageAdapter();
    await A.load(); await B.load();
    await write(A, withInvoices("a"));
    await write(B, { ...withInvoices("a", "b"), settings: { ...defaultData.settings, name: "B" } });
    expect(stored().invoices.map(i => i.id)).toEqual(["a"]);
    expect(stored().settings.name).toBe("B");
  });

  it("storage-Ereignis ohne eigene ausstehende Änderung wird gemeldet, mit ausstehender nicht", async () => {
    const handlers: ((e: StorageEvent) => void)[] = [];
    vi.stubGlobal("window", { addEventListener: (_: string, h: (e: StorageEvent) => void) => handlers.push(h), removeEventListener: () => {} });
    await write(new LocalStorageAdapter(), withInvoices("a"));
    const B = new LocalStorageAdapter();
    await B.load();
    const seen: AppData[] = [];
    B.onExternalChange(d => seen.push(d as AppData));
    handlers[0]({ key: STORAGE_KEY, newValue: JSON.stringify(withInvoices("a", "x")) } as StorageEvent);
    expect(seen).toHaveLength(1);
    // eigene Änderung ausstehend: nicht melden (das Speichern verrechnet)
    const p = B.save(withInvoices("a", "y"));
    handlers[0]({ key: STORAGE_KEY, newValue: JSON.stringify(withInvoices("a", "x")) } as StorageEvent);
    expect(seen).toHaveLength(1);
    await B.flush(); await p;
    handlers[0]({ key: "anderer-key", newValue: "{}" } as StorageEvent);
    expect(seen).toHaveLength(1);
  });
});

