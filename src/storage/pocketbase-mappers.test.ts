// Tests für die PocketBase-Mapper (pocketbase-mappers.ts): Hin- und Rückweg der Felder ohne eigene Spalte
// (Studio-Einstellungen im ui-Blob) und der Zeiterfassungs-Felder der Mitarbeitenden.

import { describe, expect, it } from "vitest";
import { fromDB, toDB } from "./pocketbase-mappers";
import type { RecordModel } from "pocketbase";
import type { Employee, Settings } from "../types";

/** Wie PocketBase einen gespeicherten Datensatz zurückliefert (Datum mit Uhrzeit, leere Zahl = 0). */
const asServer = (row: Record<string, unknown>): RecordModel => {
  const out: RecordModel = { id: "rec1", collectionId: "c", collectionName: "c", ...row };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = `${v} 00:00:00.000Z`;
  }
  return out;
};

const rec = { collectionId: "c", collectionName: "employees" };

describe("studioSettings (ui-Blob)", () => {
  it("Mahnwesen und Kanton überstehen Speichern und Laden", () => {
    const s = {
      name: "Büro", kanton: "BE", verzugszinsAktiv: true, verzugszinsSatz: 5.5, mahngebuehrAktiv: true, mahngebuehren: [0, 20, 35],
    } as Partial<Settings>;
    const back = fromDB.studioSettings(asServer(toDB.studioSettings(s, "s1")));
    expect(back).toMatchObject({
      kanton: "BE", verzugszinsAktiv: true, verzugszinsSatz: 5.5, mahngebuehrAktiv: true, mahngebuehren: [0, 20, 35],
    });
  });
});

describe("employee (Saldo-Übertrag, Pensumwechsel)", () => {
  it("Stichtag, Übertrag (auch negativ) und Pensumverlauf überstehen Speichern und Laden", () => {
    const e = {
      id: "e1", name: "A", saldoStichtag: "2026-06-01", saldoUebertragStunden: -4.5,
      pensumVerlauf: [{ ab: "2026-08-15", pensum: 80 }, { ab: "2026-11-01", pensum: 60, wochenstunden: 40 }],
      lohnVerlauf: [{ ab: "2026-04-01", monatslohn: 8500 }],
    } as Employee;
    const back = fromDB.employee(asServer(toDB.employee(e, "s1")));
    expect(back).toMatchObject({ saldoStichtag: "2026-06-01", saldoUebertragStunden: -4.5, pensumVerlauf: e.pensumVerlauf, lohnVerlauf: e.lohnVerlauf });
  });

  it("Lohn-Optionen: 13. Monatslohn je Person und Vorsystem-Summen rundlaufen", () => {
    const e = {
      id: "e1", name: "A", dreizehnterModus: "november",
      lohnVorsystem: [{ jahr: 2026, bisMonat: "2026-05", brutto: 100000, alvBasis: 61750, dreizehnter: 3125, monatslohnSumme: 96875 }],
    } as Employee;
    const wire = toDB.employee(e, "s1");
    expect(wire).toMatchObject({ dreizehnterModus: "november", lohnVorsystem: e.lohnVorsystem });
    expect(fromDB.employee(asServer(wire))).toMatchObject({ dreizehnterModus: "november", lohnVorsystem: e.lohnVorsystem });
    // ohne Übersteuerung speichert PocketBase einen leeren Wert: kein Modus an der Person, leere Vorsystem-Liste
    const ohne = fromDB.employee(asServer(toDB.employee({ id: "e2", name: "B" } as Employee, "s1")));
    expect(ohne.dreizehnterModus).toBeUndefined();
    expect(ohne.lohnVorsystem).toEqual([]);
    expect(fromDB.employee({ ...rec, id: "e3", name: "Alt" })).toMatchObject({ lohnVorsystem: [] });
  });

  it("Büro-Einstellungen 13. Monatslohn und 5-Rappen-Rundung liegen im ui-Blob", () => {
    const wire = toDB.studioSettings({ name: "Büro", dreizehnterModus: "dezember", lohnAuszahlungRunden5: true } as never, "s1");
    expect(wire.ui).toMatchObject({ dreizehnterModus: "dezember", lohnAuszahlungRunden5: true });
    expect(fromDB.studioSettings({ ...rec, id: "s1", name: "Büro", ui: wire.ui })).toMatchObject({ dreizehnterModus: "dezember", lohnAuszahlungRunden5: true });
  });

  it("Büro-Einstellung Rechnungstotal auf 5 Rappen liegt im ui-Blob", () => {
    const wire = toDB.studioSettings({ name: "Büro", rechnungRunden5: true } as never, "s1");
    expect(wire.ui).toMatchObject({ rechnungRunden5: true });
    expect(fromDB.studioSettings({ ...rec, id: "s1", name: "Büro", ui: wire.ui })).toMatchObject({ rechnungRunden5: true });
  });

  it("wiederkehrende interne Ausgabe: Betragsverlauf hin und zurück, ohne Verlauf kein Feld", () => {
    const e = { id: "i1", date: "2026-01-15", category: "Miete", description: "Miete", amount: 1100, mwstRate: 0, inclMwst: false, recurring: true, recurringInterval: "monatlich", amountHistory: [{ before: "2026-04", amount: 1000 }] };
    const wire = toDB.internalExpense(e as never, "s1");
    expect(wire.amountHistory).toEqual([{ before: "2026-04", amount: 1000 }]);
    expect(fromDB.internalExpense({ ...rec, ...wire, id: "i1" })).toMatchObject({ amountHistory: [{ before: "2026-04", amount: 1000 }] });
    const ohne = toDB.internalExpense({ ...e, amountHistory: undefined } as never, "s1");
    expect(ohne.amountHistory).toBeNull();
    expect(fromDB.internalExpense({ ...rec, ...ohne, id: "i1" })).not.toHaveProperty("amountHistory");
  });

  it("alter Datensatz ohne die neuen Felder: kein Stichtag, leerer Verlauf", () => {
    // So liefert PocketBase einen Datensatz von vor der Migration worktime_history (Spalten mit Standardwert)
    const back = fromDB.employee({ ...rec, id: "e1", name: "Alt", saldoStichtag: "", saldoUebertragStunden: 0, pensumVerlauf: null });
    expect(back).toMatchObject({ saldoStichtag: "", saldoUebertragStunden: 0, pensumVerlauf: [] });
    const missing = fromDB.employee({ ...rec, id: "e2", name: "Ohne Spalten" });
    expect(missing).toMatchObject({ saldoStichtag: "", saldoUebertragStunden: null, pensumVerlauf: [], lohnVerlauf: [] });
  });
});

describe("leere Zahlenfelder (PocketBase speichert 0)", () => {
  it("Lohnsätze: 0 bleibt 0 (ausdrücklich abgewählt, z.B. ohne PK/NBU)", () => {
    const e = fromDB.employee({ ...rec, id: "e1", name: "A", ahvSatz: 0, alvSatz: 0, bvgSatz: 0, nbuSatz: 0, ktgSatz: 0, quellensteuerPflichtig: true, quellensteuerSatz: 0 });
    expect(e).toMatchObject({ ahvSatz: 0, alvSatz: 0, bvgSatz: 0, nbuSatz: 0, ktgSatz: 0, quellensteuerSatz: 0 });
  });

  it("Offerte/Rechnung mit MWST und Satz 0 → Büro-Satz; ohne MWST bleibt der Satz", () => {
    expect(fromDB.invoice({ ...rec, id: "i1", mwst: true, mwstRate: 0 }).mwstRate).toBeNull();
    expect(fromDB.quote({ ...rec, id: "q1", mwst: true, mwstRate: 0 }).mwstRate).toBeNull();
    expect(fromDB.invoice({ ...rec, id: "i2", mwst: true, mwstRate: 7.7 }).mwstRate).toBe(7.7);
    expect(fromDB.invoice({ ...rec, id: "i3", mwst: false, mwstRate: 0 }).mwstRate).toBe(0);
  });

  it("PK-Satz Arbeitgeber leer → 8 %", () => {
    expect(fromDB.studioSettings({ ...rec, id: "s1", defaultPkAGSatz: 0 }).defaultPkAGSatz).toBe(8);
  });
});

describe("Feiertage und Rollen (Cloud)", () => {
  it("Feiertag bekommt das Datum als id (Löschen trifft nur ihn)", () => {
    expect(fromDB.holiday({ ...rec, id: "x", date: "2026-04-06 00:00:00.000Z", label: "Ostermontag" }).id).toBe("2026-04-06");
  });
  it("Rollen-Reihenfolge = Position in der Liste", () => {
    const rows = toDB.studioRoles([{ id: "PL", label: "A", rate: 1, sort: 0 }, { id: "ZZ", label: "B", rate: 2 }] as never, "s1");
    expect(rows.map(r => r.sort)).toEqual([0, 1]);
  });
});

describe("resourceEntry (Ressourcenplan)", () => {
  const entry = { id: "r1", employeeId: "e1", label: "Wettbewerb Schulhaus", projectId: "p1", dateFrom: "2026-12-01", dateTo: "2027-01-15", pensum: 60, note: "Phase 1" };

  it("überlebt Speichern und Laden", () => {
    expect(fromDB.resourceEntry(asServer({ ...toDB.resourceEntry(entry, "s1"), id: "r1" }))).toEqual(entry);
  });

  it("leeres Projekt wird null, leere Notiz leer", () => {
    const db = toDB.resourceEntry({ ...entry, projectId: undefined, note: undefined }, "s1");
    expect(db).toMatchObject({ studio: "s1", employee: "e1", project: null });
    const back = fromDB.resourceEntry(asServer({ ...db, id: "r1", project: "" }));
    expect(back.projectId).toBeNull();
    expect(back.note).toBe("");
  });
});
