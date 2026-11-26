// Test der Druckvorlage Lohnabrechnung: Beschriftung bei Jugendlichen, Rentner:innen und ohne PK-Abzug.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LohnPrint } from "./PayrollPrint";
import { calcLohn } from "../../utils";
import type { AppData, Employee, LohnEntry, Settings } from "../../types";

const settings = { name: "Atelier" } as unknown as Settings;
const data = { expenses: [] } as unknown as AppData;
const html = (emp: Employee, monat: string) => {
  const entry = { id: "L1", employeeId: emp.id, monat, createdAt: "2026-11-30T10:00:00Z",
    saetzeSnapshot: { ahvSatz: 5.3, alvSatz: 1.1, bvgSatz: 8, nbuSatz: 1.5, ktgSatz: 0.5, quellensteuerPflichtig: false, quellensteuerSatz: 10,
      dreizehnterLohn: false, pensum: 100, eintrittsdatum: emp.eintrittsdatum || "", pkAGSatz: 8, ahvRentner: !!emp.ahvRentner },
    ...calcLohn(emp, monat) } as LohnEntry;
  return renderToStaticMarkup(<LohnPrint entry={entry} emp={emp} data={data} monatLabel="November 2026" settings={settings} />);
};

describe("LohnPrint", () => {
  it("Jugendliche: kein «Rentnerfreibetrag», kein PK-Satz bei Abzug 0", () => {
    const out = html({ id: "j", name: "Lea", monatslohn: 1200, pensum: 100, geburtsdatum: "2010-06-01", eintrittsdatum: "2025-08-01" } as Employee, "2026-11");
    expect(out).not.toContain("Rentnerfreibetrag");
    expect(out).toContain("unter 18: beitragsfrei");
    expect(out).toContain("unter 18: keine Pflicht");
    expect(out).not.toContain(">8%<");
  });
  it("Rentner:in: Freibetrag beschriftet, keine BVG-Pflicht", () => {
    const out = html({ id: "r", name: "Peter", monatslohn: 4000, pensum: 100, geburtsdatum: "1958-03-12", eintrittsdatum: "2024-01-01" } as Employee, "2026-11");
    expect(out).toContain("Rentnerfreibetrag");
    expect(out).toContain("Rentner:in: keine Pflicht");
  });
  it("Aktive mit PK-Abzug: Satz wie bisher", () => {
    const out = html({ id: "a", name: "Anna", monatslohn: 8000, pensum: 100, geburtsdatum: "1990-01-01", eintrittsdatum: "2024-01-01" } as Employee, "2026-11");
    expect(out).toContain(">8%<");
    expect(out).not.toContain("keine Pflicht");
    expect(out).not.toContain("beitragsfrei");
  });
  it("Nachzahlung (mit Differenz je Monat), 13. im Auszahlungsmonat und Rundung sind im Druck sichtbar", () => {
    const emp = { id: "n", name: "Nora", monatslohn: 7500, pensum: 100, dreizehnterLohn: true, geburtsdatum: "1990-01-01", eintrittsdatum: "2024-01-01" } as Employee;
    const entry = { id: "L2", employeeId: emp.id, monat: "2026-11", createdAt: "2026-11-30T10:00:00Z",
      nachzahlungBeschrieb: "Nachzahlung Lohn 08.2026–09.2026", nachzahlungMonate: [{ monat: "2026-08", betrag: 500 }, { monat: "2026-09", betrag: 500 }],
      ...calcLohn(emp, "2026-11", [{ amount: 12.34 }], 0, undefined, undefined, 0, { dreizehnterModus: "november", nachzahlung: 1000, runden5: true }) } as LohnEntry;
    const out = renderToStaticMarkup(<LohnPrint entry={entry} emp={emp} data={data} monatLabel="November 2026" settings={settings} />);
    expect(out).toContain("Nachzahlung Lohn 08.2026–09.2026");
    expect(out).toContain("Differenz 08.2026");
    expect(out).toContain("13. Monatslohn (Auszahlung, 1/12 der Monatslöhne)");
    expect(out).toContain("Rundung auf 5 Rappen");
  });
});
