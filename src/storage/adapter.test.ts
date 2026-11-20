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
