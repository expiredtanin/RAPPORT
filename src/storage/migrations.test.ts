// Tests für applyMigrations: alte Datenstände bis zur aktuellen Form und Idempotenz (läuft bei jedem Laden).

import { describe, expect, it } from "vitest";
import { applyMigrations, type RawData } from "./migrations";
import { defaultData } from "../constants";

/** Speichern und wieder laden wie im Betrieb: JSON-Rundreise, dann erneut migrieren. */
const reload = (d: unknown) => applyMigrations(JSON.parse(JSON.stringify(d)), defaultData);

describe("applyMigrations", () => {
  it("führt Auftraggeber (clients) und Partner (contacts) zu persons zusammen und biegt Verweise um", () => {
    const raw = {
      settings: { name: "Altbüro" },
      clients: [{ id: "c1", name: "Bauherr AG", linkedContactId: "k1" }, { id: "c2", name: "Gemeinde" }],
      contacts: [{ id: "k1", name: "Bauherr AG", type: "Bauherr", note: "Notiz" }, { id: "k2", name: "Ingenieur GmbH" }],
      projects: [{ id: "p1", name: "Haus", projectContacts: [{ contactId: "k1" }, { contactId: "k2" }] }],
      protocols: [{ id: "pr1", entries: [{ assignee: "k1" }] }],
    } as unknown as RawData;
    const d = applyMigrations(raw, defaultData);
    expect(d.persons.map(p => p.id)).toEqual(["c1", "c2", "k2"]);
    expect(d.persons[0]).toMatchObject({ isAuftraggeber: true, isPartner: true, type: "Bauherr", note: "Notiz" });
    expect(d.persons[2]).toMatchObject({ isAuftraggeber: false, isPartner: true });
    expect(d.projects[0].projectContacts!.map(pc => pc.contactId)).toEqual(["c1", "k2"]);
    expect((d as unknown as { clients?: unknown }).clients).toBeUndefined();
    // zweites Laden ändert nichts mehr
    expect(reload(d).persons).toEqual(JSON.parse(JSON.stringify(d.persons)));
  });

  it("alte Listen neben schon vorhandenen persons (Stand, den der frühere Fehler gespeichert hat): beide bleiben", () => {
    const d = applyMigrations({ persons: [{ id: "p" }, { id: "c", name: "schon da" }], clients: [{ id: "c", name: "alt" }, { id: "c2" }] } as unknown as RawData, defaultData);
    expect(d.persons.map(p => p.id)).toEqual(["p", "c", "c2"]);
    expect(d.persons[1].name).toBe("schon da");
    expect(reload(d).persons.map(p => p.id)).toEqual(["p", "c", "c2"]);
  });

  it("Altprojekt ohne billingType mit SIA-Offerte wird pauschal; bewusst gesetzter Stundensatz bleibt", () => {
    const raw = {
      quotes: [{ id: "q1", mode: "sia" }, { id: "q2", mode: "manual" }],
      projects: [
        { id: "alt", type: "stundensatz", budgetAmount: 5000, linkedQuotes: [{ quoteId: "q1" }] },
        { id: "neu", billingType: "stundensatz", linkedQuotes: [{ quoteId: "q2" }] },
      ],
    } as unknown as RawData;
    const d = applyMigrations(raw, defaultData);
    expect(d.projects.find(p => p.id === "alt")).toMatchObject({ billingType: "pauschal", budget: 5000 });
    expect(d.projects.find(p => p.id === "neu")!.billingType).toBe("stundensatz");
    expect(reload(d).projects.find(p => p.id === "neu")!.billingType).toBe("stundensatz");
  });

  it("ergänzt die Projektleiter-Rolle nur bei alten Beständen, eine gelöschte kommt nicht zurück", () => {
    const old = applyMigrations({ appRoles: [{ id: "r-admin", name: "Admin", permissions: null }, { id: "r-mitarbeiter", name: "MA", permissions: [] }] } as unknown as RawData, defaultData);
    expect(old.appRoles.map(r => r.id)).toEqual(["r-admin", "r-projektleiter", "r-mitarbeiter"]);
    // Rolle gelöscht, gespeichert, neu geladen
    const deleted = { ...old, appRoles: old.appRoles.filter(r => r.id !== "r-projektleiter") };
    expect(reload(deleted).appRoles.map(r => r.id)).toEqual(["r-admin", "r-mitarbeiter"]);
  });

  it("ist idempotent für einen aktuellen Datenstand", () => {
    const d = applyMigrations({ ...defaultData, users: [{ id: "u", username: "a", role: "admin", displayName: "A", dashboardWidgets: ["unbekannt"] as never }] }, defaultData);
    const again = reload(d);
    expect(again).toEqual(JSON.parse(JSON.stringify(d)));
  });

  it("verändert die Eingabe nicht", () => {
    const raw = { projects: [{ id: "alt", linkedQuotes: [{ quoteId: "q" }] }], quotes: [{ id: "q", mode: "sia" }] } as unknown as RawData;
    const copy = JSON.parse(JSON.stringify(raw));
    applyMigrations(raw, defaultData);
    expect(raw).toEqual(copy);
  });
});

describe("Konten ohne Rolle", () => {
  it("bekommen die Standardrolle Mitarbeiter (sonst seit der Korrektur keine Rechte mehr); Admin bleibt", () => {
    const out = applyMigrations({ users: [{ id: "a", username: "admin", role: "admin" }, { id: "m", username: "m", role: "mitarbeiter", appRoleId: "" }] } as never, defaultData);
    expect(out.users.find(u => u.id === "m")?.appRoleId).toBe("r-mitarbeiter");
    expect(out.users.find(u => u.id === "a")?.appRoleId).toBeUndefined();
  });
});
