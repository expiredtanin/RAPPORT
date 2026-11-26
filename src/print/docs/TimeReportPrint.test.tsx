// Test der Druckvorlage Stundenrapport: Summen, Maskierung von Sonderzeichen, gelöschte Projekte, Eintrag ohne Datum.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeReportPrint } from "./EmployeePrints";
import type { AppData, Employee, Settings, TimeEntry } from "../../types";

const settings = { name: "Atelier" } as unknown as Settings;
const emp = { id: "e1", name: "Jürg <script>alert(1)</script> & Söhne" } as unknown as Employee;
const data = { projects: [{ id: "p1", number: "2026/1", name: "Villa <b>X</b>" }] } as unknown as AppData;
const te = (o: Partial<TimeEntry>) => ({ id: Math.random().toString(36), employeeId: "e1", date: "2026-11-03", minutes: 90, ...o }) as TimeEntry;
const html = (entries: TimeEntry[]) => renderToStaticMarkup(<TimeReportPrint employee={emp} entries={entries} month="2026-11" data={data} settings={settings} />);

describe("TimeReportPrint", () => {
  it("maskiert Namen und Notizen, summiert nur den gewählten Monat", () => {
    const out = html([te({ projectId: "p1", description: "<img src=x onerror=alert(1)> & Notiz" }), te({ projectId: "p1", minutes: 30 }), te({ date: "2026-10-31", minutes: 600 })]);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain(">2h<");
  });
  it("Einträge ohne Projekt und mit gelöschtem Projekt ergeben nur EINE Zeile «Kein Projekt»", () => {
    const out = html([te({ projectId: "" }), te({ projectId: "geloescht" })]);
    expect(out.match(/Kein Projekt/g)?.length).toBe(1);
  });
  it("stürzt bei Eintrag ohne Datum oder Minuten nicht ab und zeigt bei leerem Monat den Hinweis", () => {
    expect(() => html([te({ date: undefined as unknown as string }), te({ minutes: undefined })])).not.toThrow();
    expect(html([])).toContain("Keine Einträge");
  });
});
