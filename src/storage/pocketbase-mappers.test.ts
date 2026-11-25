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
    expect(e).toMatchObject({ bvgSatz: 0, nbuSatz: 0, ktgSatz: 0, quellensteuerSatz: 0 });
    // AHV/ALV 0 % gibt es nicht (Befreiung über Alter/Status) → Standard
    expect(e).toMatchObject({ ahvSatz: null, alvSatz: null });
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
