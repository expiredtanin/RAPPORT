// Datei: statusVar.test.ts — ein fehlender Status (kaputte Daten) darf die Statuspille nicht zum Absturz bringen
import { describe, it, expect } from "vitest";
import { statusVar } from "./constants";

describe("statusVar", () => {
  it("normalisiert Umlaute und Leerzeichen", () => {
    expect(statusVar("überfällig")).toBe("uberfallig");
    expect(statusVar("auf nächsten Lohn")).toBe("auf-nachsten-lohn");
  });
  it("verträgt null/undefined/Zahlen aus kaputten Daten", () => {
    expect(statusVar(null as unknown as string)).toBe("");
    expect(statusVar(undefined as unknown as string)).toBe("");
    expect(statusVar(5 as unknown as string)).toBe("5");
  });
});
