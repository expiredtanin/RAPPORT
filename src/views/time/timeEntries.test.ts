// Aktionen auf Zeiteinträgen: Kopie auf morgen und Dauer über Mitternacht.
import { describe, expect, it } from "vitest";
import { createEntryActions } from "./timeEntries";
import type { AppData, TimeEntry } from "../../types";

const setup = (entries: TimeEntry[], closed: string[] = []) => {
  const calls: TimeEntry[][] = [];
  const data = { timeEntries: entries, projects: [] } as unknown as AppData;
  const update = ((_k: string, v: TimeEntry[]) => { calls.push(v); }) as never;
  const a = createEntryActions({ data, update, currentDate: "2026-11-20", selectedEmpId: "e", isMonthClosed: d => closed.includes((d || "").slice(0, 7)) });
  return { a, calls };
};
const entry: TimeEntry = { id: "1", date: "2026-11-30", employeeId: "e", projectId: "p", minutes: 90, startTime: "22:00", endTime: "23:30", invoiceId: "inv" };

describe("Zeiteinträge", () => {
  it("Kopie auf morgen ist unverrechnet und landet im Folgemonat", () => {
    const { a, calls } = setup([entry]);
    a.duplicateToNextDay(entry);
    expect(calls[0][1]).toMatchObject({ date: "2026-12-01", minutes: 90 });
    expect(calls[0][1].invoiceId).toBeUndefined();
  });
  it("keine Kopie in einen abgeschlossenen Monat", () => {
    const { a, calls } = setup([entry], ["2026-12"]);
    a.duplicateToNextDay(entry);
    expect(calls).toHaveLength(0);
  });
  it("Dauer endet spätestens um Mitternacht", () => {
    const e = { ...entry, invoiceId: null };
    const { a, calls } = setup([e]);
    a.updateEntry("1", { minutes: 180 });
    expect(calls[0][0]).toMatchObject({ minutes: 120, endTime: "24:00" });
  });
});
