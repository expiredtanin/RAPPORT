// Tests für quoteRoles.ts: Rollen-Kürzel umbenennen ohne Stundenverlust, nächste freie Rollen-id (Runde 34).
import { describe, it, expect } from "vitest";
import { nextRoleId, renameQuoteRole } from "./quoteRoles";

const roles = [{ id: "PL", label: "Projektleiter", rate: 150 }, { id: "ZE", label: "Zeichner", rate: 100 }];
const phases = [{ id: "a", hoursByRole: { PL: 10, ZE: 5 } }, { id: "b", hoursByRole: { PL: 2 } }, { id: "c", hoursByRole: {} }] as never;

describe("renameQuoteRole", () => {
  it("führt die Stunden aller Phasen unter dem neuen Kürzel mit", () => {
    const r = renameQuoteRole(roles, phases, 0, "px")!;
    expect(r.quoteRoles[0].id).toBe("PX");
    expect(r.manualPhases.map(p => p.hoursByRole)).toEqual([{ ZE: 5, PX: 10 }, { PX: 2 }, {}]);
  });
  it("übernimmt ein leeres oder doppeltes Kürzel nicht", () => {
    expect(renameQuoteRole(roles, phases, 0, "")).toBeNull();
    expect(renameQuoteRole(roles, phases, 0, "ZE")).toBeNull();
  });
  it("gleiches Kürzel ändert nichts", () => {
    expect(renameQuoteRole(roles, phases, 0, "PL")!.manualPhases).toBe(phases);
  });
});

describe("nextRoleId", () => {
  it("erzeugt keine vorhandene id", () => {
    expect(nextRoleId([{ id: "R2", label: "", rate: 1 }, { id: "PL", label: "", rate: 1 }])).toBe("R3");
    expect(nextRoleId([{ id: "R3", label: "", rate: 1 }, { id: "R2", label: "", rate: 1 }, { id: "R4", label: "", rate: 1 }])).toBe("R5");
  });
});
