// Arbeitszeit-Rechnung: Soll pro Tag, Monats-/Periodensaldo, Ferienanspruch und Überstundensaldo.
// Eine einzige Quelle für Zeiterfassung (views/time), Mitarbeiter (views/employees), «Heute» und die
// Übersicht-Widgets — bis 26.11 rechnete jede Ansicht selbst und die Salden wichen voneinander ab.
//
// Regeln (alle Stunden, Daten als lokales Kalenderdatum «YYYY-MM-DD», Arithmetik in UTC ohne Sommerzeit):
//  - Tagessoll = Wochenstunden (Standard 35) × Pensum (Standard 100 %) ÷ 5, gleichmässig auf Mo–Fr verteilt.
//  - Kein Soll: Wochenende, vor dem Eintritt, nach dem Austritt, ganzer Feiertag (`stundenDelta` 0/leer).
//  - Halber Feiertag: Tagessoll + `stundenDelta` × Pensum (Delta gilt für ein 100-%-Pensum; nie unter 0).
//  - Vortag eines ganzen Feiertags (Werktag ohne eigenen Feiertag): 1 h weniger (× Pensum), Zürcher Usanz.
//  - Ferien (genehmigt; bei einem Änderungsantrag die bisher genehmigten Daten): der Tag zählt mit seinem
//    Soll als Ferien (Ist-Gutschrift). Ferienbezug in Stunden = Soll der Ferientage, also halber Tag an
//    Heiligabend. Eine ganztägige, genehmigte Absenz (z.B. Krankheit) an einem Ferientag geht vor: der
//    Ferientag wird nicht bezogen (Krankheit in den Ferien, OR 329a).
//  - Absenzen (genehmigt): Einzeltag mit Von/Bis-Zeit → diese Dauer, mit Stunden/Minuten → diese, sonst
//    (und mehrtägig) das Tagessoll. Nur an Tagen mit Soll; an Ferientagen nur ganztägige (siehe oben).
//  - Saldo = Ist (Zeiteinträge) + Absenzen + Ferien − Soll. Soll/Ferien/Absenzen zählen bis `upTo` (heute).
//  - Überstundensaldo = Saldo vom Eintritt bis heute (bzw. Austritt) − ausbezahlte Stunden.
//  - Ferienanspruch = Wochen × Wochenstunden × Pensum × Anteil des Jahres (Kalendertage je Monat wie im
//    Lohn, `monatsAnteilNachEintritt`, mit Ein- und Austritt). Mindestens 4 Wochen, bis zum Kalenderjahr
//    des 20. Geburtstags 5 Wochen (OR 329a Abs. 1).

import { monatsAnteilNachEintritt } from "./utils";
import type { AppData, DateStr, Employee, Feiertag, FerienEntry } from "./types";

/** Datenausschnitt, den die Rechnung braucht. */
export type WorkData = Pick<AppData, "feiertage" | "ferienEntries" | "absences" | "timeEntries"> & Partial<Pick<AppData, "uberstundenAbschluss">>;
/** Felder eines Mitarbeiters, die die Rechnung braucht. */
export type WorkEmployee = Pick<Employee, "id"> & Partial<Pick<Employee, "pensum" | "wochenstunden" | "ferienWochen" | "eintrittsdatum" | "austrittsdatum" | "geburtsdatum" | "ferienUebertragVorjahr">>;

const r1 = (n: number) => Math.round(n * 10) / 10;

// ── Datum ────────────────────────────────────────────────────────────────────

/** Datum + n Tage (UTC-Arithmetik, keine Sommerzeit-Sprünge). */
export function shiftDate(ds: DateStr, n: number): DateStr {
  const d = new Date(`${ds.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Wochentag 0 = Sonntag … 6 = Samstag. */
export const weekday = (ds: DateStr): number => new Date(`${ds.slice(0, 10)}T00:00:00Z`).getUTCDay();

/** Letzter Tag eines Monats «YYYY-MM-DD» (`month` 0-basiert). */
export const monthEnd = (year: number, month: number): DateStr => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);

/** Erster Tag eines Monats (`month` 0-basiert). */
export const monthStart = (year: number, month: number): DateStr => `${year}-${String(month + 1).padStart(2, "0")}-01`;

/** Minuten aus «HH:MM» (null bei Unsinn). */
function hm(t?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ── Feiertage ────────────────────────────────────────────────────────────────

/** Ostersonntag (gregorianisch, Algorithmus nach Meeus/Jones/Butcher). */
export function easterSunday(year: number): DateStr {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Bewegliche Feiertage der Vorlage (Tage ab Ostersonntag). */
const MOVABLE: { label: string; offset: number; stundenDelta: number }[] = [
  { label: "Karfreitag", offset: -2, stundenDelta: 0 },
  { label: "Ostermontag", offset: 1, stundenDelta: 0 },
  { label: "Auffahrt Vortag (Halbtag)", offset: 38, stundenDelta: -3.5 },
  { label: "Auffahrt", offset: 39, stundenDelta: 0 },
  { label: "Pfingstmontag", offset: 50, stundenDelta: 0 },
];

/** Feste Feiertage der Vorlage (Kanton Zürich), jährlich wiederkehrend. */
const FIXED: { label: string; md: string; stundenDelta: number }[] = [
  { label: "Neujahr", md: "01-01", stundenDelta: 0 },
  { label: "Berchtoldstag", md: "01-02", stundenDelta: 0 },
  { label: "Tag der Arbeit", md: "05-01", stundenDelta: 0 },
  { label: "Nationalfeiertag", md: "08-01", stundenDelta: 0 },
  { label: "Heiligabend (Halbtag)", md: "12-24", stundenDelta: -3.5 },
  { label: "Weihnachten", md: "12-25", stundenDelta: 0 },
  { label: "Stephanstag", md: "12-26", stundenDelta: 0 },
  { label: "Silvester (Halbtag)", md: "12-31", stundenDelta: -3.5 },
];

/**
 * Vorlage Feiertage Kanton Zürich: feste als jährlich wiederkehrend (ohne `id`; nur wenn noch nicht
 * vorhanden), bewegliche (Karfreitag, Ostermontag, Auffahrt mit halbem Vortag, Pfingstmontag) für die
 * Jahre `fromYear`–`toYear`, soweit es an dem Datum noch keinen Feiertag gibt.
 */
export function swissHolidayTemplate(existing: Feiertag[] | undefined, fromYear: number, toYear: number): Feiertag[] {
  const list = existing || [];
  const hasRepeating = (md: string) => list.some(f => f.repeatsYearly && f.date.slice(5, 10) === md);
  const hasDate = (ds: string) => list.some(f => f.date === ds || (f.repeatsYearly && f.date.slice(5, 10) === ds.slice(5, 10)));
  const out: Feiertag[] = FIXED.filter(f => !hasRepeating(f.md))
    .map(f => ({ label: f.label, date: `2000-${f.md}`, stundenDelta: f.stundenDelta, repeatsYearly: true }));
  for (let y = fromYear; y <= toYear; y++) {
    const easter = easterSunday(y);
    for (const m of MOVABLE) {
      const date = shiftDate(easter, m.offset);
      if (!hasDate(date)) out.push({ label: m.label, date, stundenDelta: m.stundenDelta, repeatsYearly: false });
    }
  }
  return out;
}

/** Ganzer Feiertag (frei) = kein oder 0 Stunden-Delta. */
export const isFullHoliday = (ft?: Pick<Feiertag, "stundenDelta"> | null): boolean =>
  !!ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);

/** Feiertage eines Jahres ohne Vortage: wiederkehrende aufs Jahr umgeschrieben, übrige nach Jahr gefiltert. */
function holidaysOfYear(feiertage: Feiertag[] | undefined, year: number): Feiertag[] {
  return (feiertage || [])
    .filter(f => f.date && (f.repeatsYearly || f.date.startsWith(String(year))))
    .map(f => f.repeatsYearly ? { ...f, date: `${year}-${f.date.slice(5, 10)}` } : f);
}

/**
 * Feiertage eines Jahres inklusive der automatischen Vortage (−1 h, `id` «vortag-…»): Werktag vor einem
 * ganzen Feiertag, der selbst kein Feiertag ist. Feiertage am 1./2. Januar des Folgejahrs zählen mit.
 */
export function resolveHolidays(feiertage: Feiertag[] | undefined, year: number | string): Feiertag[] {
  const y = Number(year);
  const fts = holidaysOfYear(feiertage, y);
  const all = [...fts, ...holidaysOfYear(feiertage, y + 1).filter(f => f.date.slice(5, 10) <= "01-07")];
  const taken = new Set(all.map(f => f.date));
  const vortage: Feiertag[] = [];
  for (const f of all) {
    if (!isFullHoliday(f)) continue;
    const ds = shiftDate(f.date, -1);
    const dow = weekday(ds);
    if (!ds.startsWith(String(y)) || dow === 0 || dow === 6 || taken.has(ds)) continue;
    taken.add(ds);
    vortage.push({ id: `vortag-${ds}`, date: ds, label: `Vortag ${f.label || f.date}`, stundenDelta: -1 });
  }
  return [...fts, ...vortage];
}

// ── Mitarbeiter ──────────────────────────────────────────────────────────────

/** Pensum als Faktor (fehlend oder 0 → 100 %, wie überall in der App). */
export const pensumFactor = (emp: Pick<WorkEmployee, "pensum">): number => (Number(emp.pensum) || 100) / 100;

/** Tagessoll in Stunden ohne Feiertage: Wochenstunden × Pensum ÷ 5. */
export const baseDailySoll = (emp: Pick<WorkEmployee, "pensum" | "wochenstunden">): number =>
  ((Number(emp.wochenstunden) || 35) * pensumFactor(emp)) / 5;

/** Angestellt an diesem Tag (zwischen Ein- und Austritt, je einschliesslich). */
export const isEmployed = (emp: Pick<WorkEmployee, "eintrittsdatum" | "austrittsdatum">, ds: DateStr): boolean =>
  !(emp.eintrittsdatum && ds < emp.eintrittsdatum) && !(emp.austrittsdatum && ds > emp.austrittsdatum);

/** Ferienwochen pro Jahr mit gesetzlichem Minimum (4, bis zum Jahr des 20. Geburtstags 5; OR 329a). */
export function vacationWeeks(emp: Pick<WorkEmployee, "ferienWochen" | "geburtsdatum">, year: number): number {
  const birthYear = Number((emp.geburtsdatum || "").slice(0, 4));
  const min = birthYear > 1900 && year - birthYear <= 20 ? 5 : 4;
  return Math.max(Number(emp.ferienWochen) || 0, min);
}

/** Anteil des Jahres zwischen Ein- und Austritt (Summe der Monatsanteile nach Kalendertagen ÷ 12). */
export function employedShareOfYear(emp: Pick<WorkEmployee, "eintrittsdatum" | "austrittsdatum">, year: number): number {
  let s = 0;
  for (let m = 1; m <= 12; m++) s += monatsAnteilNachEintritt(emp.eintrittsdatum, `${year}-${String(m).padStart(2, "0")}`, emp.austrittsdatum);
  return s / 12;
}

/** Ferien gelten als bezogen/geplant: genehmigt, ohne Status oder Änderungsantrag (dann die bisherigen Daten). */
export function activeVacationRange(f: FerienEntry): { from: DateStr; to: DateStr } | null {
  if (f.status === "pending" && f.originalData) return { from: f.originalData.dateFrom, to: f.originalData.dateTo };
  if (!f.status || f.status === "approved") return { from: f.dateFrom, to: f.dateTo };
  return null;
}

/** Stundenlohn für Überstunden: Monatslohn (100 %) × 12 bzw. 13 ÷ (Wochenstunden × 52), auf Rappen. */
export function overtimeHourlyRate(emp: Pick<Employee, "monatslohn" | "wochenstunden" | "dreizehnterLohn">): number {
  if (!emp.monatslohn) return 0;
  return Math.round((emp.monatslohn * (emp.dreizehnterLohn ? 13 : 12) / ((emp.wochenstunden || 35) * 52)) * 100) / 100;
}

// ── Rechnung ─────────────────────────────────────────────────────────────────

/** Ergebnis einer Periode in Stunden (ungerundet). */
export interface PeriodResult {
  /** Soll ohne Ferien-Abzug */
  sollBrutto: number;
  /** Soll der Ferientage (= Ferien-Gutschrift) */
  ferien: number;
  /** Soll nach Abzug der Ferien */
  soll: number;
  ist: number;
  absenz: number;
  /** Ist + Absenz − Soll (= Ist + Absenz + Ferien − Soll brutto) */
  saldo: number;
}

/** Ferienrechnung eines Jahres in Stunden (auf 0.1 gerundet). */
export interface VacationYear {
  wochen: number;
  anspruch: number;
  ubertrag: number;
  bezogen: number;
  geplant: number;
  beantragt: number;
  rest: number;
}

/**
 * Rechenfunktionen über einem Datenstand. `today` steuert, bis wann Soll, Ferien und Absenzen zählen
 * (Standard: heute, lokales Datum — vom Aufrufer übergeben, damit Tests feste Daten nutzen können).
 */
export function createWorktime(data: WorkData, today: DateStr) {
  const ftCache = new Map<number, Map<string, Feiertag>>();
  const holidayMap = (year: number) => {
    let m = ftCache.get(year);
    if (!m) {
      m = new Map();
      for (const f of resolveHolidays(data.feiertage, year)) if (!m.has(f.date)) m.set(f.date, f);
      ftCache.set(year, m);
    }
    return m;
  };
  /** Feiertag (inkl. Vortag) an einem Datum. */
  const holidayOn = (ds: DateStr): Feiertag | undefined => holidayMap(Number(ds.slice(0, 4))).get(ds);

  // Ferientage und ganztägige Absenzen je Mitarbeiter (Datum → true) einmal aufbauen
  const vacCache = new Map<string, Set<string>>();
  const vacationDays = (empId: string) => {
    let s = vacCache.get(empId);
    if (!s) {
      s = new Set();
      for (const f of data.ferienEntries || []) {
        if (f.employeeId !== empId) continue;
        const r = activeVacationRange(f);
        if (!r || !r.from || !r.to) continue;
        for (let ds = r.from; ds <= r.to; ds = shiftDate(ds, 1)) s.add(ds);
      }
      vacCache.set(empId, s);
    }
    return s;
  };
  const absCache = new Map<string, { full: Set<string>; byDay: Map<string, { mins: number | null; type: string }[]> }>();
  const absenceIndex = (empId: string) => {
    let x = absCache.get(empId);
    if (!x) {
      x = { full: new Set(), byDay: new Map() };
      for (const a of data.absences || []) {
        if (a.employeeId !== empId || (a.status && a.status !== "approved")) continue;
        const from = a.dateFrom || a.date; const to = a.dateTo || a.date || from;
        if (!from || !to) continue;
        const single = from === to;
        let mins: number | null = null;
        if (single) {
          const s = hm(a.startTime), e = hm(a.endTime);
          if (s !== null && e !== null) mins = Math.max(0, e - s);
          else { const ex = (a.hours || 0) * 60 + (a.minutes || 0); if (ex > 0) mins = ex; }
        }
        for (let ds = from; ds <= to; ds = shiftDate(ds, 1)) {
          if (mins === null) x.full.add(ds);
          const list = x.byDay.get(ds) || [];
          list.push({ mins, type: a.type });
          x.byDay.set(ds, list);
        }
      }
      absCache.set(empId, x);
    }
    return x;
  };

  /** Soll eines Tages ohne Ferien (Wochenende, Ein-/Austritt und Feiertage berücksichtigt). */
  const sollBruttoForDay = (emp: WorkEmployee, ds: DateStr): number => {
    const dow = weekday(ds);
    if (dow === 0 || dow === 6 || !isEmployed(emp, ds)) return 0;
    const ft = holidayOn(ds);
    if (isFullHoliday(ft)) return 0;
    const t = baseDailySoll(emp);
    return ft ? Math.max(0, t + (ft.stundenDelta || 0) * pensumFactor(emp)) : t;
  };

  /** Bezogener Ferientag (Ferien eingetragen, Soll > 0, keine ganztägige Absenz). */
  const isVacationDay = (emp: WorkEmployee, ds: DateStr): boolean =>
    vacationDays(emp.id).has(ds) && !absenceIndex(emp.id).full.has(ds) && sollBruttoForDay(emp, ds) > 0;

  /** Soll eines Tages nach Abzug von Ferien (für Tagesanzeige: Ferientag → 0). */
  const sollForDay = (emp: WorkEmployee, ds: DateStr): number => (isVacationDay(emp, ds) ? 0 : sollBruttoForDay(emp, ds));

  /** Absenz-Gutschrift eines Tages in Stunden (optional nur eine Absenzart). */
  const absenceHoursForDay = (emp: WorkEmployee, ds: DateStr, type?: string): number => {
    const list = absenceIndex(emp.id).byDay.get(ds);
    if (!list) return 0;
    const soll = sollBruttoForDay(emp, ds);
    if (soll <= 0) return 0;
    if (vacationDays(emp.id).has(ds) && !absenceIndex(emp.id).full.has(ds)) return 0;
    return list.reduce((s, a) => (type && a.type !== type ? s : s + (a.mins === null ? soll : a.mins / 60)), 0);
  };

  /** Saldo einer Periode [from, to]; Soll, Ferien und Absenzen nur bis `upTo` (Standard heute). */
  const period = (emp: WorkEmployee, from: DateStr, to: DateStr, upTo: DateStr = today): PeriodResult => {
    let sollBrutto = 0, ferien = 0, absenz = 0;
    const last = to < upTo ? to : upTo;
    for (let ds = from; ds <= last; ds = shiftDate(ds, 1)) {
      const s = sollBruttoForDay(emp, ds);
      if (s <= 0) continue;
      sollBrutto += s;
      if (isVacationDay(emp, ds)) ferien += s;
      absenz += absenceHoursForDay(emp, ds);
    }
    const ist = (data.timeEntries || []).reduce((s, e) =>
      e.employeeId === emp.id && e.date >= from && e.date <= to && isEmployed(emp, e.date) ? s + (e.minutes || 0) : s, 0) / 60;
    return { sollBrutto, ferien, soll: sollBrutto - ferien, ist, absenz, saldo: ist + absenz + ferien - sollBrutto };
  };

  /** Monatssaldo (`month` 0-basiert). */
  const month = (emp: WorkEmployee, year: number, m: number, upTo: DateStr = today) => period(emp, monthStart(year, m), monthEnd(year, m), upTo);

  /** Überstundensaldo seit Eintritt bis heute (bzw. Austritt), abzüglich ausbezahlter Stunden. */
  const overtime = (emp: WorkEmployee, upTo: DateStr = today) => {
    const start = emp.eintrittsdatum || `${today.slice(0, 4)}-01-01`;
    const end = emp.austrittsdatum && emp.austrittsdatum < upTo ? emp.austrittsdatum : upTo;
    const p = start > end ? { sollBrutto: 0, ferien: 0, soll: 0, ist: 0, absenz: 0, saldo: 0 } : period(emp, start, end, end);
    const paidOut = (data.uberstundenAbschluss || [])
      .filter(a => a.empId === emp.id && a.type === "payout" && (!a.date || a.date <= upTo))
      .reduce((s, a) => s + (Number(a.hoursSettled) || 0), 0);
    return { ...p, paidOut, balance: p.saldo - paidOut };
  };

  /** Ferien eines Jahres: Anspruch (anteilig), Übertrag, bezogen (bis heute), geplant, beantragt, Rest. */
  const vacationYear = (emp: WorkEmployee, year: number): VacationYear => {
    const y = String(year);
    const wochen = vacationWeeks(emp, year);
    const anspruch = wochen * (Number(emp.wochenstunden) || 35) * pensumFactor(emp) * employedShareOfYear(emp, year);
    const ubertrag = Number((emp.ferienUebertragVorjahr || {})[year]) || 0;
    let bezogen = 0, geplant = 0;
    for (const ds of vacationDays(emp.id)) {
      if (!ds.startsWith(y) || !isVacationDay(emp, ds)) continue;
      const h = sollBruttoForDay(emp, ds);
      if (ds <= today) bezogen += h; else geplant += h;
    }
    let beantragt = 0;
    for (const f of data.ferienEntries || []) {
      if (f.employeeId !== emp.id || f.status !== "pending" || !f.dateFrom || !f.dateTo) continue;
      for (let ds = f.dateFrom; ds <= f.dateTo; ds = shiftDate(ds, 1)) if (ds.startsWith(y)) beantragt += sollBruttoForDay(emp, ds);
    }
    return { wochen, anspruch: r1(anspruch), ubertrag: r1(ubertrag), bezogen: r1(bezogen), geplant: r1(geplant), beantragt: r1(beantragt), rest: r1(anspruch + ubertrag - bezogen - geplant) };
  };

  return { holidayOn, sollBruttoForDay, sollForDay, isVacationDay, absenceHoursForDay, period, month, overtime, vacationYear };
}

/** Rückgabetyp von `createWorktime`. */
export type Worktime = ReturnType<typeof createWorktime>;
