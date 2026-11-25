// Rechte aus dem Konto: Admin alles, Rolle nach appRoles, ohne Rolle nichts (fail closed).
import { describe, expect, it } from "vitest";
import { defaultAppRoleId, getUserPermissions } from "./auth";
import type { AppData, CurrentUser } from "./types";

const data = { appRoles: [{ id: "r-x", name: "X", permissions: ["time"] }] } as unknown as AppData;
const u = (x: Partial<CurrentUser>) => ({ id: "u", username: "u", role: "mitarbeiter", ...x }) as CurrentUser;

describe("getUserPermissions", () => {
  it("Admin: alles; Rolle: ihre Rechte; gelöschte Rolle: nichts", () => {
    expect(getUserPermissions(u({ role: "admin" }), data)).toBeNull();
    expect(getUserPermissions(u({ appRoleId: "r-x" }), data)).toEqual(["time"]);
    expect(getUserPermissions(u({ appRoleId: "r-weg" }), data)).toEqual([]);
  });
  it("ohne Rolle und ohne gesetzte Rechte: keine Rechte (vorher Vollzugriff)", () => {
    expect(getUserPermissions(u({ appRoleId: "" }), data)).toEqual([]);
    expect(getUserPermissions(u({ appRoleId: "", permissions: ["time"] }), data)).toEqual(["time"]);
  });
});

describe("defaultAppRoleId", () => {
  it("schlägt «Mitarbeiter» vor, sonst die Rolle mit den wenigsten Rechten", () => {
    const roles = [{ id: "r-admin", name: "Admin", permissions: null }, { id: "pl", name: "PL", permissions: ["a", "b", "c"] }, { id: "r-mitarbeiter", name: "MA", permissions: ["a", "b"] }];
    expect(defaultAppRoleId(roles as never)).toBe("r-mitarbeiter");
    expect(defaultAppRoleId([roles[1], { id: "x", name: "X", permissions: ["a"] }] as never)).toBe("x");
    expect(defaultAppRoleId([])).toBe("");
  });
});
