// Passwort-Hashing (PBKDF2): neue Hashes mit 600'000 Runden (im Salt vermerkt), alte Hashes (100'000 Runden, Salt
// ohne Präfix) und Klartext-Altbestand bleiben gültig und werden nach dem Login neu gehasht.
import { describe, expect, it } from "vitest";
import { hashPassword, needsPasswordUpgrade, verifyPassword, withHashedPassword } from "./utils";

describe("Passwort-Hashing", () => {
  it("neuer Hash: Runden im Salt, prüfbar, kein Upgrade nötig", async () => {
    const { hash, salt } = await hashPassword("Geheim-123");
    expect(salt).toMatch(/^i600000:[0-9a-f]{32}$/);
    const user = { passwordHash: hash, passwordSalt: salt };
    expect(await verifyPassword("Geheim-123", user)).toBe(true);
    expect(await verifyPassword("falsch", user)).toBe(false);
    expect(needsPasswordUpgrade(user)).toBe(false);
  });
  it("alter Hash (100'000 Runden, Salt ohne Präfix) gilt weiter und braucht ein Upgrade", async () => {
    const legacySalt = "00112233445566778899aabbccddeeff";
    const { hash } = await hashPassword("Alt-Passwort", legacySalt);
    const user = { passwordHash: hash, passwordSalt: legacySalt };
    expect(await verifyPassword("Alt-Passwort", user)).toBe(true);
    expect(needsPasswordUpgrade(user)).toBe(true);
    const up = await withHashedPassword({ password: "Alt-Passwort" }, "Alt-Passwort");
    expect(up.passwordSalt).toMatch(/^i600000:/);
    expect(await verifyPassword("Alt-Passwort", up)).toBe(true);
  });
  it("Klartext-Altbestand braucht ein Upgrade", () => {
    expect(needsPasswordUpgrade({ password: "x" })).toBe(true);
    expect(needsPasswordUpgrade(null)).toBe(false);
  });
});
