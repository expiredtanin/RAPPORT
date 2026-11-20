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
