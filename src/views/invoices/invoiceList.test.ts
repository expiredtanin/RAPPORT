// Gruppieren mit Schlüsseln aus den Daten: Namen wie «constructor» oder «__proto__» dürfen die Liste nicht abstürzen
// lassen (vorher stiess `{}`[key] auf Object.prototype — `.push` ist dort keine Funktion).
import { describe, expect, it } from "vitest";
import type { AppData, Invoice, Person } from "../../types";
import { filterAndSortInvoices, groupInvoices, summarizeUnbilled } from "./invoiceList";

describe("groupInvoices", () => {
  it("verträgt Schlüssel wie «constructor» und «__proto__»", () => {
    const inv = (id: string, status: string, clientId: string) => ({ id, status, clientId, date: "2026-11-01" }) as unknown as Invoice;
    const list = [inv("a", "constructor", "__proto__"), inv("b", "__proto__", "constructor"), inv("c", "toString", "x")];
    const byStatus = groupInvoices(list, "status", []);
    expect(byStatus.flatMap(g => g.items).map(i => i.id).sort()).toEqual(["a", "b", "c"]);
    const byClient = groupInvoices(list, "client", []);
    expect(byClient.flatMap(g => g.items).map(i => i.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("filterAndSortInvoices / summarizeUnbilled", () => {
  const inv = (id: string, clientId: string, over: Partial<Invoice> = {}) => ({ id, number: id, clientId, date: "2026-11-01", status: "gesendet", ...over }) as unknown as Invoice;
  const person = (id: string, name: string) => ({ id, name }) as unknown as Person;

  it("Suche und Sortierung nach Kunde nutzen den ersten Kontakt mit gleicher ID (wie find)", () => {
    const clients = [person("c1", "Zeta AG"), person("c1", "Alpha AG"), person("c2", "Beta AG")];
    const list = [inv("a", "c1"), inv("b", "c2")];
    const byName = filterAndSortInvoices(list, clients, { status: "", clientId: "", year: "", search: "zeta" }, { col: "date", dir: 1 });
    expect(byName.map(i => i.id)).toEqual(["a"]);
    const sorted = filterAndSortInvoices(list, clients, { status: "", clientId: "", year: "", search: "" }, { col: "client", dir: 1 });
    expect(sorted.map(i => i.id)).toEqual(["b", "a"]);   // Beta vor Zeta
  });

  it("unverrechnete Minuten je Stundensatz-Projekt, nur ohne Rechnung", () => {
    const data = {
      projects: [{ id: "p1", billingType: "stundensatz", status: "aktiv", hourlyRate: 100 }, { id: "p2", billingType: "pauschal", status: "aktiv" }],
      timeEntries: [{ projectId: "p1", minutes: 60 }, { projectId: "p1", minutes: 30, invoiceId: "i" }, { projectId: "p1", minutes: 60 }, { projectId: "p2", minutes: 60 }, { minutes: 5 }],
    } as unknown as AppData;
    const r = summarizeUnbilled(data);
    expect(r.unbilledProjects.map(p => [p.id, p.mins, p.amount])).toEqual([["p1", 120, 200]]);
    expect(r.totalUnbilledMins).toBe(120);
  });
});
