// Tests: Offerte kopieren — neue Nummer, Entwurf, heutiges Datum, neue Gültigkeit, ohne Verknüpfungen.
import { describe, expect, it } from "vitest";
import { copyQuote } from "./quoteCopy";
import type { Quote } from "../types";

const orig = {
  id: "q1", number: "O2026-004", clientId: "c1", projectId: "p1", projectName: "", date: "2026-03-01", validUntil: "2026-04-30",
  convertedToInvoiceId: "i1", mode: "free", status: "angenommen", mwst: true, mwstRate: 8.1,
  freeItems: [{ id: "a", desc: "Vorprojekt", qty: 1, price: 5000 }], notes: "Hinweis", sub: 5000, tax: 405, total: 5405, createdAt: "2026-03-01T10:00:00Z",
} as Quote;

describe("copyQuote", () => {
  const c = copyQuote(orig, { number: "O2026-009", today: "2026-11-26", validDays: 60, projectName: "Haus Muster" });
  it("neue Nummer, Entwurf, Datum heute, Gültig-bis neu (60 Tage)", () => {
    expect(c.number).toBe("O2026-009");
    expect(c.status).toBe("entwurf");
    expect(c.date).toBe("2026-11-26");
    expect(c.validUntil).toBe("2027-01-25");
  });
  it("ohne Verknüpfungen zu Projekt und Rechnung; Projektname bleibt als Text", () => {
    expect(c.projectId).toBe("");
    expect(c.projectName).toBe("Haus Muster");
    expect(c.convertedToInvoiceId).toBeUndefined();
    expect("id" in c).toBe(false);
    expect("createdAt" in c).toBe(false);
  });
  it("Inhalt bleibt, Positionen sind unabhängige Kopien mit neuen ids", () => {
    expect(c.freeItems?.[0]).toMatchObject({ desc: "Vorprojekt", qty: 1, price: 5000 });
    expect(c.freeItems?.[0].id).not.toBe("a");
    expect(c.freeItems).not.toBe(orig.freeItems);
    expect(c.notes).toBe("Hinweis");
    expect(c.mwstRate).toBe(8.1);
  });
  it("eigener Projektname hat Vorrang vor dem des verknüpften Projekts", () => {
    expect(copyQuote({ ...orig, projectName: "Eigener Name" }, { number: "x", today: "2026-11-26", validDays: 30, projectName: "Haus Muster" }).projectName).toBe("Eigener Name");
  });
});
