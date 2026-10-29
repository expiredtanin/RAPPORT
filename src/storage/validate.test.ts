// Tests für die Formprüfung geladener Daten (validate.ts) und ihr Zusammenspiel mit applyMigrations.

import { describe, expect, it } from "vitest";
import { validateRawData } from "./validate";
import { applyMigrations } from "./migrations";
import { defaultData } from "../constants";

describe("validateRawData", () => {
  it("lässt gültige Daten unverändert", () => {
    const raw = { settings: { name: "X", mwstRate: 8.1 }, invoices: [{ id: "a" }], eigenesFeld: 1 };
    const { data, problems } = validateRawData(raw, defaultData);
    expect(problems).toEqual([]);
    expect(data).toEqual(raw);
  });

  it("ersetzt vertauschte Typen durch den Default und verwirft Unsinn in Listen", () => {
    const raw = { invoices: "kaputt", projects: [{ id: "p" }, null, 3, "x"], settings: { roles: "PL", name: 12, closedMonths: {} } };
    const { data, problems } = validateRawData(raw, defaultData);
    expect(data.invoices).toBeUndefined();
    expect(data.projects).toEqual([{ id: "p" }]);
    expect(data.settings).toEqual({ name: 12 });
    expect(problems).toHaveLength(4);
  });

  it("Zahl als Text gilt nicht als Fehler (Formulare speichern teils Text)", () => {
    const { problems } = validateRawData({ settings: { mwstRate: "8.1" } }, defaultData);
    expect(problems).toEqual([]);
  });

  it("Datenbestand, der kein Objekt ist, wird zum leeren Stand", () => {
    expect(validateRawData(null, defaultData).data).toEqual({});
    expect(validateRawData([1, 2], defaultData).data).toEqual({});
  });

  it("applyMigrations liefert danach eine vollständige, renderbare Form", () => {
    const data = applyMigrations({ invoices: "kaputt", settings: null } as never, defaultData);
    expect(Array.isArray(data.invoices)).toBe(true);
    expect(data.settings.name).toBe(defaultData.settings.name);
  });

  it("prüft Unterlisten wie Rechnungspositionen und lässt gültige Einträge unverändert", () => {
    const ok = { id: "i1", items: [{ desc: "A" }] };
    const raw = {
      invoices: [ok, { id: "i2", items: "kaputt" }, { id: "i3", items: [{ desc: "B" }, 7] }],
      projects: [{ id: "p1", internalMembers: "e1" }, { id: "p2", internalMembers: ["e1"] }],
    };
    const { data, problems } = validateRawData(raw, defaultData);
    expect(data.invoices![0]).toBe(ok);
    expect(data.invoices![1].items).toEqual([]);
    expect(data.invoices![2].items).toEqual([{ desc: "B" }]);
    expect(data.projects![0].internalMembers).toEqual([]);
    expect(data.projects![1].internalMembers).toEqual(["e1"]);
    expect([...problems].sort()).toEqual([
      "«invoices» (i2): «items» ist keine Liste — leere Liste verwendet",
      "«invoices» (i3): «items»: 1 ungültige Einträge entfernt",
      "«projects» (p1): «internalMembers» ist keine Liste — leere Liste verwendet",
    ]);
  });

  it("meldet Reparaturen über onProblems", () => {
    const seen: string[][] = [];
    applyMigrations({ invoices: "kaputt" } as never, defaultData, p => seen.push(p));
    applyMigrations({}, defaultData, p => seen.push(p));
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toContain("invoices");
  });
});
