// Tests zu den Phasen-Helfern der Projekt-Detailansicht.
import { describe, it, expect } from "vitest";
import { phaseBookedMinutes, renameCustomPhase, unassignedPhaseMinutes } from "./helpers";

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

describe("eigene Phasen umbenennen und löschen", () => {
  const phases = [{ id: "cp_a", label: "Visualisierung" }, { id: "cp_b", label: "Modell" }];
  it("Umbenennen ändert nur das Label, die id bleibt (Zeiteinträge hängen über phaseId daran)", () => {
    const next = renameCustomPhase(phases, "cp_a", "  Renderings ");
    expect(next).toEqual([{ id: "cp_a", label: "Renderings" }, { id: "cp_b", label: "Modell" }]);
    expect(phases[0].label).toBe("Visualisierung");   // Eingabe unverändert
    const entries = [{ phaseId: "cp_a", minutes: 90 }];
    expect(next.some(p => p.id === entries[0].phaseId)).toBe(true);
  });
  it("leerer Name wird nicht übernommen", () => {
    expect(renameCustomPhase(phases, "cp_a", "   ")).toBe(phases);
    expect(renameCustomPhase(phases, "unbekannt", "X")).toEqual(phases);
  });
  it("gebuchte Minuten einer Phase im Projekt", () => {
    const entries = [
      { projectId: "p1", phaseId: "cp_a", minutes: 90 }, { projectId: "p1", phaseId: "cp_a", minutes: 30 },
      { projectId: "p2", phaseId: "cp_a", minutes: 600 }, { projectId: "p1", phaseId: "cp_b", minutes: 15 },
    ];
    expect(phaseBookedMinutes(entries, "p1", "cp_a")).toBe(120);
    expect(phaseBookedMinutes(entries, undefined, "cp_a")).toBe(0);   // neues Projekt ohne id
    expect(phaseBookedMinutes(entries, "p1", "cp_zzz")).toBe(0);
  });
});
