// Tests für crm.ts: Pipeline-Wert (gewichtet), Trefferquote, Wiedervorlagen. Zahlen wie in den Demo-Daten
// (scripts/marketing-shots/demo-data.mjs), unabhängig nachgerechnet.
import { describe, expect, it } from "vitest";
import { dueFollowUps, overallWinRate, pipelineValue, winRateBy, wonLeadAverages } from "./crm";
import type { AppData, Lead } from "./types";

const leads = [
  { id: "lim", stage: "gewonnen", source: "Empfehlung Partner", referrerId: "ms", estimatedValue: 185000, createdAt: "2025-04-07", closedAt: "2025-05-19" },
  { id: "reb", stage: "gewonnen", source: "Wiederkehrender Kunde", estimatedValue: 410000, createdAt: "2026-03-23", closedAt: "2026-04-20" },
  { id: "quartier", stage: "verloren", source: "Wettbewerb", estimatedValue: 150000, createdAt: "2026-06-29", closedAt: "2026-09-14" },
  { id: "mfh", stage: "verloren", source: "Empfehlung Partner", referrerId: "ms", estimatedValue: 60000, createdAt: "2026-07-27", closedAt: "2026-10-05" },
  { id: "schul", stage: "verhandlung", estimatedValue: 240000, createdAt: "2026-09-21" },
  { id: "efh", stage: "offerte", estimatedValue: 38000, createdAt: "2026-10-12" },
  { id: "praxis", stage: "besichtigung", estimatedValue: 22000, createdAt: "2026-11-02" },
  { id: "dach", stage: "anfrage", estimatedValue: 12000, createdAt: "2026-11-14" },
  { id: "leer", stage: "anfrage", createdAt: "2026-11-15" },
] as unknown as Lead[];
const data = { leads, persons: [{ id: "ms", name: "Meier + Steiner" }, { id: "k", name: "Kunde K" }], invoices: [], projects: [], activities: [
  { id: "a1", personId: "k", leadId: "efh", type: "meeting", date: "2026-10-26", followUpDate: "2026-11-15" },
  { id: "a2", personId: "k", type: "telefon", date: "2026-11-01", followUpDate: "2026-12-01" },
  { id: "a3", personId: "k", type: "telefon", date: "2026-11-02", followUpDate: "2026-11-10", followUpDone: true },
  { id: "a4", personId: "k", leadId: "reb", type: "besichtigung", date: "2026-04-01" },
] } as unknown as AppData;

describe("Pipeline", () => {
  it("offen: Summe und gewichtet (10/25/50/75 %)", () => {
    expect(pipelineValue(leads)).toBe(240000 + 38000 + 22000 + 12000);
    expect(pipelineValue(leads, true)).toBeCloseTo(240000 * 0.75 + 38000 * 0.5 + 22000 * 0.25 + 12000 * 0.1, 6); // 205'700
  });
  it("Trefferquote nur über Entschiedene des Jahres", () => {
    expect(overallWinRate(data, "2026")).toBeCloseTo(1 / 3, 9);
    expect(overallWinRate(data, "2025")).toBe(1);
    expect(overallWinRate(data, "2024")).toBeNull();
    expect(winRateBy(data, "", "referrer")).toEqual([{ key: "ms", label: "Meier + Steiner", won: 1, lost: 1, rate: 0.5 }]);
  });
  it("Dauer bis zur Zusage und Meetings", () => {
    expect(wonLeadAverages(data, "2026")).toEqual({ count: 1, avgDays: 28, avgMeetings: 1 });
  });
  it("Wiedervorlagen: offene, früheste zuerst, überfällig vor heute", () => {
    const r = dueFollowUps(data, "2026-11-20");
    expect(r.map(a => [a.id, a.overdue])).toEqual([["a1", true], ["a2", false]]);
  });
  it("Wiedervorlagen gelöschter Kontakte ohne Lead zählen nicht mehr (Runde 31)", () => {
    const d2 = { ...data, persons: [{ id: "ms", name: "Meier + Steiner" }] };
    expect(dueFollowUps(d2 as typeof data, "2026-11-20").map(a => a.id)).toEqual(["a1"]);
  });
  it("Wiedervorlagen abgeschlossener Leads zählen nicht mehr", () => {
    const d2 = { ...data, leads: leads.map(l => l.id === "efh" ? { ...l, stage: "verloren", closedAt: "2026-11-18" } : l) };
    expect(dueFollowUps(d2 as typeof data, "2026-11-20").map(a => a.id)).toEqual(["a2"]);
  });
});
