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
});
