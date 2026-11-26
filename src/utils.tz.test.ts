// Datumsfunktionen in Zeitzonen westlich von UTC: reine «YYYY-MM-DD» dürfen nie auf den Vortag rutschen.
// Die Zeitzone wird vor dem ersten Date-Aufruf gesetzt (Node liest TZ bei Änderung neu).
import { describe, expect, it, vi } from "vitest";

describe.each(["America/New_York", "Europe/Zurich", "Pacific/Auckland"])("Zeitzone %s", tz => {
  // Modul je Zeitzone neu laden: `formatDate` hält einen Intl-Formatierer, der die Zeitzone beim Anlegen festhält
  const run = async (fn: (u: typeof import("./utils")) => void): Promise<void> => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try { vi.resetModules(); fn(await import("./utils")); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  };
  it("formatDate: Datum ohne Uhrzeit bleibt der Tag", async () => {
    await run(({ formatDate }) => {
      expect(formatDate("2026-03-29")).toBe("29.3.2026");
      expect(formatDate("2026-01-01")).toBe("1.1.2026");
      expect(formatDate("2028-02-29")).toBe("29.2.2028");
    });
  });
  it("KW über den Jahreswechsel (2026 hat KW 53)", async () => {
    await run(({ formatKW, getWeekNumber }) => {
      expect(formatKW("2026-12-28")).toBe("KW 53 / 2026");
      expect(formatKW("2027-01-03")).toBe("KW 53 / 2026");
      expect(formatKW("2027-01-04")).toBe("KW 1 / 2027");
      expect(getWeekNumber("2026-03-29")).toBe(13);
      expect(getWeekNumber("2026-10-25")).toBe(43);
    });
  });
  it("localISODate am Tag der Zeitumstellung", async () => {
    await run(({ localISODate }) => {
      expect(localISODate(new Date(2026, 2, 29, 0, 30))).toBe("2026-03-29");
      expect(localISODate(new Date(2026, 9, 25, 23, 59))).toBe("2026-10-25");
    });
  });
});
