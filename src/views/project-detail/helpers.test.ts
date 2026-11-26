// Tests zu den Phasen-Helfern der Projekt-Detailansicht.
import { describe, it, expect } from "vitest";
import { unassignedPhaseMinutes } from "./helpers";

describe("unassignedPhaseMinutes", () => {
  const entries = [
    { phaseId: "31", minutes: 60 },
    { phaseId: "32", minutes: 120 },
    { phaseId: "", minutes: 30 },
    { phaseId: "cp_x", minutes: 15 },
    { phaseId: "51", minutes: 10 },
  ];
  it("zählt Stunden ohne Phase und in nicht (mehr) aktiven Phasen", () => {
    expect(unassignedPhaseMinutes({ enabledPhases: ["31"], customPhases: [] }, entries, [])).toBe(120 + 30 + 15 + 10);
  });
  it("eigene Phasen und Nachtrags-Phasen gelten als aktiv", () => {
    expect(unassignedPhaseMinutes({ enabledPhases: ["31", "32"], customPhases: [{ id: "cp_x", label: "X" }] }, entries, [{ enabledPhases: ["51"] }])).toBe(30);
  });
  it("ohne Angaben zählt alles mit Phase als nicht aktiv", () => {
    expect(unassignedPhaseMinutes({}, entries, [])).toBe(235);
  });
});
