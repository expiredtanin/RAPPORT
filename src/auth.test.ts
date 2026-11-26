// Rechte aus dem Konto: Admin alles, Rolle nach appRoles, ohne Rolle nichts (fail closed).
import { describe, expect, it } from "vitest";
import { defaultAppRoleId, getUserPermissions, syncCloudUser } from "./auth";
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

describe("syncCloudUser (Cloud)", () => {
  const emps = (x: { id: string; appUserId?: string | null }[]) => x as unknown as AppData["employees"];
  const users = (x: { id: string; appRoleId: string }[]) => x as unknown as AppData["users"];
  it("Verknüpfung nach dem Login (Einstellungen → Team) gilt ohne neues Anmelden", () => {
    expect(syncCloudUser(u({ employeeId: null }), [], emps([{ id: "e1", appUserId: "u" }])).employeeId).toBe("e1");
    expect(syncCloudUser(u({ employeeId: "e1" }), [], emps([{ id: "e1", appUserId: null }, { id: "e2", appUserId: "u" }])).employeeId).toBe("e2");
  });
  it("abgetrennt → keine Verknüpfung; unverändert → dasselbe Objekt", () => {
    expect(syncCloudUser(u({ employeeId: "e1" }), [], emps([{ id: "e1", appUserId: "x" }])).employeeId).toBeNull();
    const same = u({ employeeId: "e1", appRoleId: "r-x", role: "user" });
    expect(syncCloudUser(same, users([{ id: "u", appRoleId: "r-x" }]), emps([{ id: "e1", appUserId: "u" }]))).toBe(same);
    expect(syncCloudUser(same, undefined, emps([]))).toBe(same);
  });
  it("geänderte Rolle aus den Mitgliedschaften (Menüs und Rechte ohne neues Anmelden)", () => {
    const pl = u({ appRoleId: "r-projektleiter", role: "user" });
    const r = syncCloudUser(pl, users([{ id: "u", appRoleId: "r-mitarbeiter" }]), []);
    expect(r).toMatchObject({ appRoleId: "r-mitarbeiter", role: "user" });
    expect(syncCloudUser(pl, users([{ id: "u", appRoleId: "r-admin" }]), [])).toMatchObject({ appRoleId: "r-admin", role: "admin" });
    expect(syncCloudUser(pl, users([{ id: "anders", appRoleId: "r-admin" }]), [])).toBe(pl);
  });
});
