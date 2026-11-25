// Tests für den Umzug in die Cloud (cloud-migrate.ts) gegen ein gemocktes Ziel.

import { describe, expect, it, vi } from "vitest";
import { checkTarget, describeError, planBlocked, planMigration, prepareForCloud, runMigration, type AreaKey, type CloudTarget } from "./cloud-migrate";
import type { AppData } from "../types";

const KEYS: AreaKey[] = ["settings", "persons", "employees", "projects", "expenses", "appRoles"];

const sample = (): AppData => ({
  settings: { name: "Büro Test" },
  persons: [{ id: "p-1", name: "Kunde" }, { id: "p-2", name: "Partner" }],
  employees: [{ id: "e-1", name: "Anna", appUserId: "admin" }, { id: "e-2", name: "Ben" }, { id: "e-3", name: "Cleo", appUserId: "u-cleo" }],
  projects: [{ id: "pr-1", name: "Haus" }],
  expenses: [{ id: "x-1", receiptData: "data:application/pdf;base64,JVBERi0=" }],
  appRoles: [{ id: "r-admin", name: "Admin", permissions: null }],
  users: [
    { id: "admin", username: "admin", role: "admin", displayName: "Anna", appRoleId: "r-admin", employeeId: "e-1" },
    { id: "u-ben", username: "ben", role: "user", displayName: "Ben B.", appRoleId: "r-mitarbeiter", employeeId: "e-2" },
    { id: "u-cleo", username: "cleo", role: "user", displayName: "", appRoleId: "r-projektleiter" },
  ],
  leads: [{ id: "l-1" }],
  activities: [],
} as unknown as AppData);

/** Ziel, das geschriebene Bereiche zählt; `fail` steuert Fehler je Bereich (Liste wird abgearbeitet). */
function mockTarget(fail: Partial<Record<AreaKey, unknown[]>> = {}, preset: Partial<Record<AreaKey, number>> = {}) {
  const counts: Partial<Record<AreaKey, number>> = { ...preset };
  const writes: AreaKey[] = [];
  const target: CloudTarget = {
    countArea: vi.fn(async (key: AreaKey) => counts[key] ?? 0),
    writeAreas: vi.fn(async (data: AppData, keys: AreaKey[]) => {
      for (const key of keys) {
        writes.push(key);
        const f = fail[key]?.shift();
        if (f) throw f;
        counts[key] = key === "settings" ? 1 : (data[key] as unknown[]).length;
      }
    }),
  };
  return { target, writes, counts };
}
const err = (status: number, extra: object = {}) => Object.assign(new Error("HTTP " + status), { status, ...extra });

describe("planMigration", () => {
  it("zählt die Bereiche in Schreibreihenfolge, meldet Nur-lokal-Bereiche und Einzuladende", () => {
    const plan = planMigration(sample(), KEYS, "admin");
    expect(plan.areas.map(a => [a.key, a.count])).toEqual([["settings", 1], ["persons", 2], ["employees", 3], ["projects", 1], ["expenses", 1], ["appRoles", 1]]);
    expect(plan.localOnly).toEqual([{ key: "leads", label: "Akquise (Leads)", count: 1 }]);
    expect(plan.invites).toEqual([
      { name: "Ben B.", username: "ben", appRoleId: "r-mitarbeiter", employeeId: "e-2" },
      { name: "Cleo", username: "cleo", appRoleId: "r-projektleiter", employeeId: "e-3" },
    ]);
    expect(plan.badIds).toEqual([]);
    expect(planBlocked(plan)).toBe(false);
  });

  it("blockiert bei ungültigen oder doppelten Ids (PocketBase: ^[a-zA-Z0-9-]{1,64}$)", () => {
    const d = sample();
    d.projects = [{ id: "a_b" }, { id: "ok-1" }, { id: "ok-1" }, { id: "" }] as AppData["projects"];
    const plan = planMigration(d, KEYS, "admin");
    expect(plan.badIds).toEqual([{ key: "projects", label: "Projekte", ids: ["a_b", "ok-1", "(leer)"] }]);
    expect(planBlocked(plan)).toBe(true);
  });

  it("meldet Anhänge aus dem Datenordner, die nicht aufgelöst wurden", () => {
    const d = sample();
    d.expenses = [{ id: "x-1", receiptData: "rapport-datei:Dateien/Belege/Quittung-abc.pdf" }] as AppData["expenses"];
    expect(planMigration(d, KEYS).unresolvedFiles).toEqual(["Quittung-abc.pdf"]);
  });
});

describe("prepareForCloud", () => {
  it("verknüpft den eigenen Mitarbeitenden mit dem Cloud-Konto, alle anderen werden leer", () => {
    const out = prepareForCloud(sample(), { admin: "cloud-1" });
    expect(out.employees.map(e => e.appUserId)).toEqual(["cloud-1", null, null]);
    expect(out.users).toEqual([]);
  });

  it("findet die Verknüpfung auch über users[].employeeId und behält bekannte Cloud-Konten", () => {
    const d = sample();
    d.employees = [{ id: "e-1", name: "Anna" }, { id: "e-3", name: "Cleo", appUserId: "u-cleo" }] as AppData["employees"];
    const out = prepareForCloud(d, { admin: "cloud-1" }, ["u-cleo"]);
    expect(out.employees.map(e => e.appUserId)).toEqual(["cloud-1", "u-cleo"]);
  });
});

describe("checkTarget", () => {
  it("Vorgaben eines neuen Büros zählen nicht als Daten", async () => {
    const { target } = mockTarget({}, { settings: 1, appRoles: 4 });
    expect(await checkTarget(target, KEYS)).toEqual({ empty: true, filled: [] });
    expect(target.countArea).not.toHaveBeenCalledWith("appRoles");
  });

  it("meldet Bereiche mit Daten", async () => {
    const { target } = mockTarget({}, { projects: 3 });
    expect(await checkTarget(target, KEYS)).toEqual({ empty: false, filled: [{ key: "projects", label: "Projekte", count: 3 }] });
  });
});

describe("runMigration", () => {
  it("schreibt alle Bereiche einzeln in Reihenfolge und prüft die Anzahlen", async () => {
    const { target, writes } = mockTarget();
    const progress = vi.fn();
    const res = await runMigration(sample(), target, KEYS, { onProgress: progress });
    expect(writes).toEqual(KEYS);
    expect(res.complete).toBe(true);
    expect(res.areas.every(a => a.state === "fertig" && a.cloud === a.local)).toBe(true);
    // Fortschritt: Start, je Bereich «läuft» + Ergebnis, Prüfung
    expect(progress).toHaveBeenCalledTimes(1 + KEYS.length * 2 + 1);
    expect(progress.mock.calls[1][0][0].state).toBe("läuft");
  });

  it("wiederholt vorübergehende Fehler (Netz, 429, 5xx)", async () => {
    const { target, writes } = mockTarget({ persons: [err(429), err(0), err(503)] });
    const sleep = vi.fn(async () => {});
    const res = await runMigration(sample(), target, KEYS, { sleep, retryDelays: [1, 2, 3] });
    expect(res.complete).toBe(true);
    expect(writes.filter(k => k === "persons")).toHaveLength(4);
    expect(sleep.mock.calls.map(c => (c as unknown[])[0])).toEqual([1, 2, 3]);
  });

  it("hält bei einem Validierungsfehler an, meldet das Feld und prüft trotzdem alles", async () => {
    const bad = err(400, { data: { message: "Failed to create record.", data: { name: { code: "validation_max_text_constraint", message: "Must be less than 200 character(s)." } } } });
    const { target, writes } = mockTarget({ projects: [bad] });
    const res = await runMigration(sample(), target, KEYS, { sleep: async () => {} });
    expect(writes).toEqual(["settings", "persons", "employees", "projects"]);
    expect(res.complete).toBe(false);
    expect(res.failedAt).toBe("projects");
    const projects = res.areas.find(a => a.key === "projects")!;
    expect(projects.state).toBe("Fehler");
    expect(projects.error).toContain("name: Must be less than 200 character(s).");
    expect(res.areas.find(a => a.key === "expenses")).toMatchObject({ state: "übersprungen", local: 1, cloud: 0 });
    expect(target.countArea).toHaveBeenCalledTimes(KEYS.length);
  });

  it("bricht zwischen zwei Bereichen ab und zeigt den halben Stand ehrlich", async () => {
    const ctrl = new AbortController();
    const { target } = mockTarget();
    const res = await runMigration(sample(), target, KEYS, {
      onProgress: areas => { if (areas.find(a => a.key === "persons")?.state === "fertig") ctrl.abort(); },
      signal: ctrl.signal,
    });
    expect(res.aborted).toBe(true);
    expect(res.complete).toBe(false);
    expect(res.areas.map(a => a.state)).toEqual(["fertig", "fertig", "übersprungen", "übersprungen", "übersprungen", "übersprungen"]);
    expect(res.areas.find(a => a.key === "employees")).toMatchObject({ local: 3, cloud: 0 });
  });

  it("meldet abweichende Anzahlen als unvollständig", async () => {
    const { target, counts } = mockTarget();
    target.countArea = vi.fn(async (key: AreaKey) => key === "expenses" ? 0 : counts[key] ?? 0);
    const res = await runMigration(sample(), target, KEYS);
    expect(res.complete).toBe(false);
    expect(res.areas.find(a => a.key === "expenses")).toMatchObject({ state: "fertig", local: 1, cloud: 0 });
  });
});

describe("describeError", () => {
  it("nennt Batch-Fehler mit Feld", () => {
    const e = err(400, { data: { message: "Batch transaction failed.", data: { requests: { "2": { code: "batch_request_failed", response: { data: { note: { message: "Too long." } } } } } } } });
    expect(describeError(e)).toBe("Batch transaction failed. (HTTP 400) — requests.2.note: Too long.");
  });
});

describe("prepareForCloud: Lohnsätze", () => {
  it("setzt leere Sätze auf die Standards, gesetzte (auch 0) bleiben", () => {
    const data = { employees: [{ id: "e1", name: "A", bvgSatz: 0 }], users: [], settings: { defaultPkAGSatz: 6 } } as unknown as AppData;
    const [e] = prepareForCloud(data, {}).employees;
    expect(e).toMatchObject({ ahvSatz: 5.3, alvSatz: 1.1, bvgSatz: 0, nbuSatz: 1.5, ktgSatz: 0.5, quellensteuerSatz: 10, pkAGSatz: 6 });
  });
});
