// Tests der Arbeitszeit-Rechnung. Sollwerte unabhängig nachgerechnet (Python, dateutil.easter, ohne App-Code):
// Ostern 2024–2030, Monats-Soll 2026 mit der Zürcher Vorlage, Ferienanteile nach Kalendertagen; bewegliche
// kantonale Feiertage (Fronleichnam, Genfer Bettag, Bettagsmontag, Näfelser Fahrt) mit dateutil/datetime.
import { describe, expect, it } from "vitest";
import { bettagsmontag, createWorktime, easterSunday, employedShareOfYear, genferBettag, KANTONE, naefelserFahrt, overtimeHourlyRate, replaceHolidayTemplate, resolveHolidays, roundHours, swissHolidayTemplate, vacationWeeks, type WorkData } from "./worktime";
import type { Absence, Feiertag, FerienEntry, OvertimeClosing, TimeEntry } from "./types";

const template = (): Feiertag[] => swissHolidayTemplate([], 2024, 2030).map((f, i) => ({ ...f, id: `f${i}` }));
const data = (extra: Partial<WorkData> = {}): WorkData => ({ feiertage: template(), ferienEntries: [], absences: [], timeEntries: [], uberstundenAbschluss: [], ...extra });
const months = (wt: ReturnType<typeof createWorktime>, emp: Parameters<ReturnType<typeof createWorktime>["month"]>[0], year: number) =>
  Array.from({ length: 12 }, (_, m) => Math.round(wt.month(emp, year, m, "2099-12-31").sollBrutto * 100) / 100);

describe("Feiertage", () => {
  it("Ostersonntag 2024–2030 (Referenz dateutil)", () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029, 2030].map(easterSunday))
      .toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01", "2030-04-21"]);
  });
  it("Vorlage: bewegliche Feiertage 2026 und keine Doppelten beim zweiten Laden", () => {
    const t = template();
    const d2026 = t.filter(f => f.date.startsWith("2026")).map(f => `${f.date} ${f.label}`);
    expect(d2026).toEqual(["2026-04-03 Karfreitag", "2026-04-06 Ostermontag", "2026-05-13 Auffahrt Vortag (Halbtag)", "2026-05-14 Auffahrt", "2026-05-25 Pfingstmontag"]);
    expect(swissHolidayTemplate(t, 2026, 2029)).toEqual([]);
    expect(swissHolidayTemplate(t, 2026, 2031).map(f => f.date)).toEqual(["2031-04-11", "2031-04-14", "2031-05-21", "2031-05-22", "2031-06-02"]);
  });
  it("Vortag −1 h nur an Werktagen ohne eigenen Feiertag; Neujahr des Folgejahrs zählt", () => {
    const onlyNewYear: Feiertag[] = [{ id: "n", date: "2000-01-01", label: "Neujahr", repeatsYearly: true, stundenDelta: 0 }];
    const fts = resolveHolidays(onlyNewYear, 2026);
    expect(fts.find(f => f.date === "2026-12-31")?.stundenDelta).toBe(-1); // Donnerstag vor Neujahr 2027
    expect(fts.find(f => f.date === "2025-12-31")).toBeUndefined();
    // Silvester als Halbtag definiert → kein zusätzlicher Vortag
    expect(resolveHolidays(template(), 2026).filter(f => f.date === "2026-12-31")).toHaveLength(1);
  });
});

describe("Soll", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 42, eintrittsdatum: "2020-01-01" };
  it("Monats-Soll 2026, 42 h, 100 % (Referenz)", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(months(wt, emp, 2026)).toEqual([168, 168, 184.8, 166, 147.7, 184.8, 192.2, 176.4, 184.8, 184.8, 176.4, 177.8]);
  });
  it("Teilzeit 40 %: Halbtage und Vortage anteilig (Referenz)", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(months(wt, { ...emp, pensum: 40 }, 2026)).toEqual([67.2, 67.2, 73.92, 66.4, 59.08, 73.92, 76.88, 70.56, 73.92, 73.92, 70.56, 71.12]);
  });
  it("Schaltjahr: Februar 2024 hat 21 Werktage", () => {
    expect(createWorktime(data(), "2024-12-31").month(emp, 2024, 1).sollBrutto).toBeCloseTo(176.4, 6);
  });
  it("kein Soll vor Eintritt, nach Austritt, am Wochenende und an ganzen Feiertagen", () => {
    const wt = createWorktime(data(), "2026-12-31");
    const e = { ...emp, eintrittsdatum: "2026-03-31", austrittsdatum: "2026-11-15" };
    expect(wt.sollBruttoForDay(e, "2026-03-30")).toBe(0);
    expect(wt.sollBruttoForDay(e, "2026-03-31")).toBeCloseTo(8.4);
    expect(wt.sollBruttoForDay(e, "2026-11-16")).toBe(0);
    expect(wt.month(e, 2026, 11).sollBrutto).toBe(0);
    expect(wt.sollBruttoForDay(e, "2026-04-03")).toBe(0); // Karfreitag
    expect(wt.sollBruttoForDay(e, "2026-04-02")).toBeCloseTo(7.4); // Gründonnerstag = Vortag
  });
  it("Pensum 0/leer gilt wie überall in der App als 100 %", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(wt.sollBruttoForDay({ id: "z", pensum: 0, wochenstunden: 40 }, "2026-03-03")).toBe(8);
  });
});

describe("Rundung der Stunden", () => {
  it("3.75 h aus Tagessolls 7.56 (42 h × 90 %) zeigt 3.8, nicht 3.7", () => {
    // Demobüro Marc, Februar 2026: Saldo 3.749999999999943 (Gleitkomma) statt 3.75
    expect(roundHours(3.749999999999943)).toBe(3.8);
    expect(roundHours(3.74)).toBe(3.7);
    expect(roundHours(-1.25)).toBe(-1.2);   // wie Math.round: .5 Richtung +∞
    expect(roundHours(0)).toBe(0);
  });
});

describe("Saldo", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 40, eintrittsdatum: "2026-03-02" };
  const te = (date: string, minutes: number): TimeEntry => ({ id: date, date, minutes, employeeId: "x", projectId: "p" });
  const entries = ["02", "03", "04", "05", "06", "09", "10", "11"].map(d => te(`2026-03-${d}`, 9 * 60));
  const abs: Absence[] = [{ id: "a", employeeId: "x", type: "arzt", date: "2026-03-10", startTime: "08:00", endTime: "09:00", status: "approved" }];
  const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-03-12", dateTo: "2026-03-13", status: "approved" }];
  const pay: OvertimeClosing[] = [{ id: "p", empId: "x", year: 2026, date: "2026-03-13", type: "payout", hoursSettled: 4, zuschlagPercent: 25, stundenlohn: 50, auszahlungBetrag: 250 }];

  it("Ist + Absenz (Teilabsenz mit ihrer Dauer) + Ferien − Soll, abzüglich Auszahlung", () => {
    const wt = createWorktime(data({ feiertage: [], timeEntries: entries, absences: abs, ferienEntries: fer, uberstundenAbschluss: pay }), "2026-03-13");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p).toMatchObject({ sollBrutto: 80, ferien: 16, soll: 64, ist: 72, absenz: 1, saldo: 9 });
    const o = wt.overtime(emp);
    expect(o.saldo).toBe(9); expect(o.paidOut).toBe(4); expect(o.balance).toBe(5);
    expect(wt.sollForDay(emp, "2026-03-12")).toBe(0);
  });
  it("Pendente und abgelehnte Absenzen zählen nicht; Änderungsantrag zählt mit den bisherigen Daten", () => {
    const ferChange: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-03-09", dateTo: "2026-03-09", status: "pending", originalData: { dateFrom: "2026-03-12", dateTo: "2026-03-13" } }];
    const wt = createWorktime(data({ feiertage: [], absences: [{ ...abs[0], status: "pending" }], ferienEntries: ferChange }), "2026-03-13");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p.absenz).toBe(0); expect(p.ferien).toBe(16);
    expect(wt.vacationYear(emp, 2026).beantragt).toBe(8);
  });
  it("Krankheit (ganztägig) in den Ferien: Ferientag nicht bezogen, keine Doppelgutschrift", () => {
    const sick: Absence[] = [{ id: "k", employeeId: "x", type: "krankheit", dateFrom: "2026-03-13", dateTo: "2026-03-13", status: "approved" }];
    const wt = createWorktime(data({ feiertage: [], ferienEntries: fer, absences: sick }), "2026-03-31");
    const p = wt.period(emp, "2026-03-01", "2026-03-31");
    expect(p.ferien).toBe(8); expect(p.absenz).toBe(8);
    expect(wt.vacationYear(emp, 2026).bezogen).toBe(8);
  });
  it("Austritt beendet den Überstundensaldo", () => {
    const wt = createWorktime(data({ feiertage: [] }), "2026-12-31");
    expect(wt.overtime({ ...emp, austrittsdatum: "2026-03-06" }).sollBrutto).toBe(40);
  });
});

describe("Ferien", () => {
  const emp = { id: "x", pensum: 100, wochenstunden: 42, ferienWochen: 5, eintrittsdatum: "2020-01-01" };
  it("Bezug über Weihnachten: Heiligabend und Silvester nur halb", () => {
    const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-12-21", dateTo: "2026-12-31", status: "approved" }];
    const v = createWorktime(data({ ferienEntries: fer }), "2026-12-31").vacationYear(emp, 2026);
    expect(v.bezogen).toBe(60.2); // 6 × 8.4 + 2 × 4.9
    expect(v.rest).toBe(210 - 60.2);
  });
  it("Jahresübergreifende Ferien werden je Jahr gezählt", () => {
    const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-12-28", dateTo: "2027-01-08", status: "approved" }];
    const wt = createWorktime(data({ ferienEntries: fer }), "2026-11-20");
    expect(wt.vacationYear(emp, 2026).geplant).toBe(30.1); // 28.–30. (3 × 8.4) + 31. halb (4.9)
    expect(wt.vacationYear(emp, 2027).geplant).toBe(42); // 4.–8.1.
  });
  it("Anteil nach Kalendertagen je Monat (Referenz), Eintritt am 31., Austritt, Schaltjahr", () => {
    expect(employedShareOfYear({ eintrittsdatum: "2026-03-01" }, 2026)).toBeCloseTo(0.833333, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2026-01-31" }, 2026)).toBeCloseTo(0.919355, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2023-04-01", austrittsdatum: "2026-11-15" }, 2026)).toBeCloseTo(0.875, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2024-02-29" }, 2024)).toBeCloseTo(0.836207, 6);
    expect(employedShareOfYear({ eintrittsdatum: "2027-03-01" }, 2026)).toBe(0);
    const sara = { id: "s", pensum: 90, wochenstunden: 42, ferienWochen: 5, eintrittsdatum: "2023-04-01", austrittsdatum: "2026-11-15" };
    expect(createWorktime(data(), "2026-11-20").vacationYear(sara, 2026).anspruch).toBe(165.4); // 5 × 42 × 0.9 × 0.875
  });
  it("Gesetzliches Minimum: 4 Wochen, bis zum Jahr des 20. Geburtstags 5 Wochen", () => {
    expect(vacationWeeks({ ferienWochen: 4, geburtsdatum: "2006-08-01" }, 2026)).toBe(5);
    expect(vacationWeeks({ ferienWochen: 4, geburtsdatum: "2005-08-01" }, 2026)).toBe(4);
    expect(vacationWeeks({ ferienWochen: 0 }, 2026)).toBe(4);
    expect(vacationWeeks({ ferienWochen: 6 }, 2026)).toBe(6);
  });
});

describe("Überstunden-Stundenlohn", () => {
  it("Monatslohn × 12 (bzw. 13) ÷ (Wochenstunden × 52)", () => {
    expect(overtimeHourlyRate({ monatslohn: 8200, wochenstunden: 41 })).toBe(46.15);
    expect(overtimeHourlyRate({ monatslohn: 14500, wochenstunden: 42, dreizehnterLohn: true })).toBe(86.31);
    expect(overtimeHourlyRate({ wochenstunden: 42 })).toBe(0);
  });
});

describe("Kantonale Feiertage", () => {
  const dates = (t: Feiertag[], year: number) => t.filter(f => f.date.startsWith(String(year))).map(f => `${f.date} ${f.label}`);
  const fixed = (t: Feiertag[]) => t.filter(f => f.repeatsYearly).map(f => `${f.date.slice(5)} ${f.label}`);
  it("bewegliche Tage (Referenz Python)", () => {
    expect([2021, 2024, 2025, 2026, 2027, 2029, 2030].map(naefelserFahrt))
      .toEqual(["2021-04-08", "2024-04-04", "2025-04-03", "2026-04-09", "2027-04-01", "2029-04-05", "2030-04-04"]); // 2021/2026: 1. Do = Gründonnerstag
    expect([2021, 2024, 2025, 2026, 2027].map(genferBettag)).toEqual(["2021-09-09", "2024-09-05", "2025-09-11", "2026-09-10", "2027-09-09"]);
    expect([2021, 2024, 2025, 2026, 2027].map(bettagsmontag)).toEqual(["2021-09-20", "2024-09-16", "2025-09-22", "2026-09-21", "2027-09-20"]);
    const lu = swissHolidayTemplate([], 2024, 2026, "LU").filter(f => f.label === "Fronleichnam").map(f => f.date);
    expect(lu).toEqual(["2024-05-30", "2025-06-19", "2026-06-04"]);
  });
  it("alle 26 Kantone mit Neujahr, Auffahrt, 1. August und Weihnachten", () => {
    expect(KANTONE).toHaveLength(26);
    for (const k of KANTONE) {
      const t = swissHolidayTemplate([], 2026, 2026, k);
      const labels = t.map(f => f.label);
      for (const l of ["Neujahr", "Auffahrt", "Nationalfeiertag", "Weihnachten"]) expect(labels, `${k} ${l}`).toContain(l);
      expect(new Set(t.map(f => f.date)).size, k).toBe(t.length); // kein Datum doppelt
    }
  });
  it("Zürich ist der Standard und unverändert", () => {
    expect(swissHolidayTemplate([], 2026, 2026)).toEqual(swissHolidayTemplate([], 2026, 2026, "ZH"));
    expect(fixed(swissHolidayTemplate([], 2026, 2026))).toEqual(["01-01 Neujahr", "01-02 Berchtoldstag", "05-01 Tag der Arbeit", "08-01 Nationalfeiertag", "12-24 Heiligabend (Halbtag)", "12-25 Weihnachten", "12-26 Stephanstag", "12-31 Silvester (Halbtag)"]);
  });
  it("Genf: Genfer Bettag, Restauration ganztägig statt Silvester-Halbtag, kein Stephanstag", () => {
    const t = swissHolidayTemplate([], 2026, 2026, "GE");
    expect(fixed(t)).toEqual(["01-01 Neujahr", "08-01 Nationalfeiertag", "12-24 Heiligabend (Halbtag)", "12-25 Weihnachten", "12-31 Restauration der Republik"]);
    expect(dates(t, 2026)).toEqual(["2026-04-03 Karfreitag", "2026-04-06 Ostermontag", "2026-05-13 Auffahrt Vortag (Halbtag)", "2026-05-14 Auffahrt", "2026-05-25 Pfingstmontag", "2026-09-10 Genfer Bettag"]);
  });
  it("Tessin/Wallis ohne Karfreitag; Glarus Näfelser Fahrt; Waadt Bettagsmontag; Jura 23. Juni", () => {
    const has = (k: Parameters<typeof swissHolidayTemplate>[3], label: string) => swissHolidayTemplate([], 2026, 2026, k).some(f => f.label === label);
    expect(has("TI", "Karfreitag")).toBe(false); expect(has("TI", "Peter und Paul")).toBe(true);
    expect(has("VS", "Karfreitag")).toBe(false); expect(has("VS", "Josefstag")).toBe(true);
    expect(dates(swissHolidayTemplate([], 2026, 2026, "GL"), 2026)).toContain("2026-04-09 Näfelser Fahrt");
    expect(dates(swissHolidayTemplate([], 2026, 2026, "VD"), 2026)).toContain("2026-09-21 Bettagsmontag");
    expect(fixed(swissHolidayTemplate([], 2026, 2026, "JU"))).toContain("06-23 Jahrestag der Unabhängigkeit (JU)");
  });
  it("bedingte Tage: Neuenburg 2.1./26.12. nur am Montag, Appenzell AR ohne Stephanstag nach Weihnachten am Montag", () => {
    const ne = swissHolidayTemplate([], 2022, 2024, "NE").filter(f => ["Berchtoldstag", "Stephanstag"].includes(f.label || "")).map(f => f.date);
    expect(ne).toEqual(["2022-12-26", "2023-01-02"]); // 26.12.2022 und 2.1.2023 sind Montage
    const ar = swissHolidayTemplate([], 2022, 2024, "AR").filter(f => f.label === "Stephanstag").map(f => f.date);
    expect(ar).toEqual(["2022-12-26", "2024-12-26"]); // 2023: Weihnachten Montag → nicht gefeiert
  });
  it("Kanton wechseln: Vorlagen-Tage ersetzt, eigene bleiben", () => {
    const own: Feiertag = { id: "x", date: "2000-09-14", label: "Knabenschiessen", repeatsYearly: true, stundenDelta: -3.5 };
    const next = replaceHolidayTemplate([...template(), own], 2026, 2026, "GE");
    expect(next).toContainEqual(own);
    expect(next.some(f => f.label === "Berchtoldstag")).toBe(false);
    expect(next.some(f => f.label === "Genfer Bettag")).toBe(true);
    expect(next.some(f => f.date === "2025-04-18" && f.label === "Karfreitag")).toBe(true); // frühere Jahre bleiben
    expect(next.filter(f => f.date === "2026-04-03")).toHaveLength(1);
  });
});

describe("Saldo-Stichtag", () => {
  const te = (date: string, minutes: number): TimeEntry => ({ id: date, date, minutes, employeeId: "x", projectId: "p" });
  const emp = { id: "x", pensum: 100, wochenstunden: 40, eintrittsdatum: "2020-01-01", saldoStichtag: "2026-03-02", saldoUebertragStunden: -12.5 };
  const entries = [te("2026-02-27", 9 * 60), ...["02", "03", "04", "05", "06", "09", "10", "11"].map(d => te(`2026-03-${d}`, 9 * 60))];
  const pay: OvertimeClosing[] = [
    { id: "p1", empId: "x", year: 2026, date: "2026-02-15", type: "payout", hoursSettled: 4, zuschlagPercent: 0, stundenlohn: 50, auszahlungBetrag: 200 },
    { id: "p2", empId: "x", year: 2026, date: "2026-03-05", type: "payout", hoursSettled: 2, zuschlagPercent: 0, stundenlohn: 50, auszahlungBetrag: 100 },
  ];
  it("zählt ab Stichtag, startet mit dem Übertrag; frühere Einträge und Auszahlungen ignoriert", () => {
    const wt = createWorktime(data({ feiertage: [], timeEntries: entries, uberstundenAbschluss: pay }), "2026-03-13");
    const o = wt.overtime(emp);
    expect(o).toMatchObject({ sollBrutto: 80, ist: 72, saldo: -8, uebertrag: -12.5, paidOut: 2, balance: -22.5 });
    expect(wt.month(emp, 2026, 1).sollBrutto).toBe(0);
    expect(wt.month(emp, 2026, 1).ist).toBe(0);
    // ohne Stichtag: wie bisher seit Eintritt, Übertrag ohne Stichtag wirkungslos
    const ohne = createWorktime(data({ feiertage: [], timeEntries: entries }), "2026-03-13").overtime({ ...emp, saldoStichtag: "" });
    expect(ohne.uebertrag).toBe(0); expect(ohne.ist).toBe(81);
  });
  it("Ferien: Guthaben per Stichtag (ferienUebertragVorjahr), Anspruch und Bezug erst ab Stichtag", () => {
    const e = { id: "x", pensum: 100, wochenstunden: 40, ferienWochen: 5, eintrittsdatum: "2020-01-01", saldoStichtag: "2026-07-01", ferienUebertragVorjahr: { 2026: 60 } };
    const fer: FerienEntry[] = [{ id: "f", employeeId: "x", dateFrom: "2026-06-22", dateTo: "2026-07-03", status: "approved" }];
    const v = createWorktime(data({ feiertage: [], ferienEntries: fer }), "2026-12-31").vacationYear(e, 2026);
    expect(v).toMatchObject({ anspruch: 100, ubertrag: 60, bezogen: 24, rest: 136 }); // 5 × 40 × 6/12; 1.–3.7. = 3 × 8
    expect(createWorktime(data({ feiertage: [] }), "2026-12-31").vacationYear(e, 2025).anspruch).toBe(0);
  });
});

describe("Pensumwechsel", () => {
  const base = { id: "x", pensum: 100, wochenstunden: 40, ferienWochen: 5, eintrittsdatum: "2020-01-01" };
  const emp = { ...base, pensumVerlauf: [{ ab: "2026-03-16", pensum: 50 }] };
  it("Soll je Tag mit dem gültigen Pensum, Wochenstunden laufen weiter", () => {
    const wt = createWorktime(data({ feiertage: [] }), "2026-12-31");
    expect(wt.sollBruttoForDay(emp, "2026-03-13")).toBe(8);
    expect(wt.sollBruttoForDay(emp, "2026-03-16")).toBe(4);
    expect(wt.month(emp, 2026, 2).sollBrutto).toBe(128); // 10 × 8 + 12 × 4
    const e2 = { ...base, pensumVerlauf: [{ ab: "2026-05-01", pensum: 80 }, { ab: "2026-04-01", pensum: 60, wochenstunden: 42 }] };
    expect(wt.sollBruttoForDay(e2, "2026-04-01")).toBeCloseTo(5.04, 9);
    expect(wt.sollBruttoForDay(e2, "2026-05-04")).toBeCloseTo(6.72, 9); // 42 h übernommen
  });
  it("Halbtag anteilig nach dem Pensum des Tages", () => {
    const wt = createWorktime(data(), "2026-12-31");
    expect(wt.sollBruttoForDay(emp, "2026-12-24")).toBeCloseTo(4 - 1.75, 9);
  });
  it("Ferienanspruch anteilig nach Kalendertagen (Referenz)", () => {
    // 5 × 40 × (Jan+Feb 100 %, März 15/31 × 100 % + 16/31 × 50 %, Apr–Dez 50 %) ÷ 12
    expect(createWorktime(data({ feiertage: [] }), "2026-12-31").vacationYear(emp, 2026).anspruch).toBe(120.7);
    expect(createWorktime(data({ feiertage: [] }), "2026-12-31").vacationYear(emp, 2027).anspruch).toBe(100);
  });
  it("Überstunden-Stundenlohn mit den Wochenstunden am Datum", () => {
    const e = { monatslohn: 8400, wochenstunden: 40, pensumVerlauf: [{ ab: "2026-04-01", pensum: 80, wochenstunden: 42 }] };
    expect(overtimeHourlyRate(e, "2026-03-31")).toBe(48.46);
    expect(overtimeHourlyRate(e, "2026-05-01")).toBe(46.15);
  });
});
