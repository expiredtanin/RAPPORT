// Arbeitszeit-Rechnung: Soll pro Tag, Monats-/Periodensaldo, Ferienanspruch und Überstundensaldo.
// Eine einzige Quelle für Zeiterfassung (views/time), Mitarbeiter (views/employees), «Heute» und die
// Übersicht-Widgets — bis 26.11 rechnete jede Ansicht selbst und die Salden wichen voneinander ab.
//
// Regeln (alle Stunden, Daten als lokales Kalenderdatum «YYYY-MM-DD», Arithmetik in UTC ohne Sommerzeit):
//  - Tagessoll = Wochenstunden (Standard 35) × Pensum (Standard 100 %) ÷ 5, gleichmässig auf Mo–Fr verteilt.
//    Pensum und Wochenstunden gelten je Tag (`pensumVerlauf`, `arbeitszeitAm` in utils.ts).
//  - Saldo-Stichtag (`saldoStichtag`): davor zählt nichts (Soll, Ist, Ferien, Absenzen, Anspruch) — wie ein
//    zweiter Eintritt; der Überstundensaldo startet mit `saldoUebertragStunden`, Auszahlungen vor dem Stichtag
//    stecken schon im Übertrag. Ferienguthaben per Stichtag = `ferienUebertragVorjahr[Stichtag-Jahr]`.
//  - Kein Soll: Wochenende, vor dem Eintritt, nach dem Austritt, ganzer Feiertag (`stundenDelta` 0/leer).
//  - Halber Feiertag: Tagessoll + `stundenDelta` × Pensum (Delta gilt für ein 100-%-Pensum; nie unter 0).
//  - Vortag eines ganzen Feiertags (Werktag ohne eigenen Feiertag): 1 h weniger (× Pensum), Büro-Usanz, nicht
//    gesetzlich; Stunden einstellbar (`settings.vortagStunden`, 0 = aus).
//  - Ferien (genehmigt; bei einem Änderungsantrag die bisher genehmigten Daten): der Tag zählt mit seinem
//    Soll als Ferien (Ist-Gutschrift). Ferienbezug in Stunden = Soll der Ferientage, also halber Tag an
//    Heiligabend. Eine ganztägige, genehmigte Absenz (z.B. Krankheit) an einem Ferientag geht vor: der
//    Ferientag wird nicht bezogen (Krankheit in den Ferien, OR 329a).
//  - Absenzen (genehmigt): Einzeltag mit Von/Bis-Zeit → diese Dauer, mit Stunden/Minuten → diese, sonst
//    (und mehrtägig) das Tagessoll. Nur an Tagen mit Soll; an Ferientagen nur ganztägige (siehe oben).
//  - Saldo = Ist (Zeiteinträge) + Absenzen + Ferien − Soll. Soll/Ferien/Absenzen zählen bis `upTo` (heute).
//  - Überstundensaldo = Saldo vom Eintritt bis heute (bzw. Austritt) − ausbezahlte Stunden.
//  - Ferienanspruch = Wochen × Wochenstunden × Pensum × Anteil des Jahres (Kalendertage je Monat wie im
//    Lohn, `monatsAnteilNachEintritt`, mit Ein- und Austritt; mit Pensumwechsel/Stichtag Tag für Tag summiert). Mindestens 4 Wochen, bis zum Kalenderjahr
//    des 20. Geburtstags 5 Wochen (OR 329a Abs. 1).

import { arbeitszeitAm, monatsAnteilNachEintritt, monatslohnAm, roundCHF } from "./utils";
import type { AppData, DateStr, Employee, Feiertag, FerienEntry, Kanton, Settings } from "./types";

/** Datenausschnitt, den die Rechnung braucht. */
export type WorkData = Pick<AppData, "feiertage" | "ferienEntries" | "absences" | "timeEntries"> & Partial<Pick<AppData, "uberstundenAbschluss">> & { settings?: Partial<Pick<Settings, "vortagStunden">> };
/** Felder eines Mitarbeiters, die die Rechnung braucht. */
export type WorkEmployee = Pick<Employee, "id"> & Partial<Pick<Employee, "pensum" | "wochenstunden" | "ferienWochen" | "eintrittsdatum" | "austrittsdatum" | "geburtsdatum" | "ferienUebertragVorjahr" | "pensumVerlauf" | "saldoStichtag" | "saldoUebertragStunden" | "lohnVerlauf" | "monatslohn">>;

/**
 * Stunden auf eine Dezimale (x.x5 auf). Die Tagessolls (z.B. 42 × 90 % ÷ 5 = 7.56) sind binär nicht exakt; eine
 * Summe von genau 3.75 h liegt als 3.7499999… vor und zeigte sonst 3.7 statt 3.8 — der Zuschlag 1e-7 hebt das auf.
 */
export const roundHours = (n: number): number => Math.round(n * 10 + 1e-7) / 10;
const r1 = roundHours;

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

/** Erster Wochentag `dow` (0 = So) im Monat (`month` 1-basiert). */
function firstWeekdayOfMonth(year: number, month: number, dow: number): DateStr {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  return shiftDate(first, (dow - weekday(first) + 7) % 7);
}

/** Näfelser Fahrt (GL): erster Donnerstag im April; fällt er in die Karwoche (= Gründonnerstag), eine Woche später. */
export function naefelserFahrt(year: number): DateStr {
  const d = firstWeekdayOfMonth(year, 4, 4);
  return d === shiftDate(easterSunday(year), -3) ? shiftDate(d, 7) : d;
}

/** Genfer Bettag (Jeûne genevois): Donnerstag nach dem ersten Sonntag im September. */
export const genferBettag = (year: number): DateStr => shiftDate(firstWeekdayOfMonth(year, 9, 0), 4);

/** Bettagsmontag (Lundi du Jeûne, VD): Montag nach dem eidg. Bettag (dritter Sonntag im September). */
export const bettagsmontag = (year: number): DateStr => shiftDate(firstWeekdayOfMonth(year, 9, 0), 15);

/** Ein Feiertag der Vorlagen: fest (`md`), ab Ostern (`easter`) oder per Regel (`rule`); `onlyIf` = nur in manchen Jahren. */
interface HolidayDef {
  label: string;
  stundenDelta: number;
  md?: string;
  easter?: number;
  rule?: (year: number) => DateStr;
  /** Bedingung je Jahr (Datum → gilt); solche Tage werden wie bewegliche je Jahr eingetragen. */
  onlyIf?: (ds: DateStr) => boolean;
}

/** Feiertage aller Vorlagen (Schlüssel → Definition). Bezeichnungen der Zürcher Vorlage unverändert wie bis 26.11. */
const HOLIDAYS = {
  neujahr: { label: "Neujahr", md: "01-01", stundenDelta: 0 },
  berchtold: { label: "Berchtoldstag", md: "01-02", stundenDelta: 0 },
  dreikoenig: { label: "Dreikönigstag", md: "01-06", stundenDelta: 0 },
  republikNE: { label: "Jahrestag der Republik Neuenburg", md: "03-01", stundenDelta: 0 },
  josef: { label: "Josefstag", md: "03-19", stundenDelta: 0 },
  naefels: { label: "Näfelser Fahrt", rule: naefelserFahrt, stundenDelta: 0 },
  karfreitag: { label: "Karfreitag", easter: -2, stundenDelta: 0 },
  ostermontag: { label: "Ostermontag", easter: 1, stundenDelta: 0 },
  maiTag: { label: "Tag der Arbeit", md: "05-01", stundenDelta: 0 },
  maiTagHalb: { label: "Tag der Arbeit (Nachmittag)", md: "05-01", stundenDelta: -3.5 },
  auffahrtVortag: { label: "Auffahrt Vortag (Halbtag)", easter: 38, stundenDelta: -3.5 },
  auffahrt: { label: "Auffahrt", easter: 39, stundenDelta: 0 },
  pfingstmontag: { label: "Pfingstmontag", easter: 50, stundenDelta: 0 },
  fronleichnam: { label: "Fronleichnam", easter: 60, stundenDelta: 0 },
  unabhaengigkeitJU: { label: "Jahrestag der Unabhängigkeit (JU)", md: "06-23", stundenDelta: 0 },
  peterPaul: { label: "Peter und Paul", md: "06-29", stundenDelta: 0 },
  bundesfeier: { label: "Nationalfeiertag", md: "08-01", stundenDelta: 0 },
  mariaHimmelfahrt: { label: "Mariä Himmelfahrt", md: "08-15", stundenDelta: 0 },
  genferBettag: { label: "Genfer Bettag", rule: genferBettag, stundenDelta: 0 },
  mauritius: { label: "Mauritiustag", md: "09-22", stundenDelta: 0 },
  bruderKlaus: { label: "Bruder Klaus", md: "09-25", stundenDelta: 0 },
  bettagsmontag: { label: "Bettagsmontag", rule: bettagsmontag, stundenDelta: 0 },
  allerheiligen: { label: "Allerheiligen", md: "11-01", stundenDelta: 0 },
  mariaEmpfaengnis: { label: "Mariä Empfängnis", md: "12-08", stundenDelta: 0 },
  heiligabend: { label: "Heiligabend (Halbtag)", md: "12-24", stundenDelta: -3.5 },
  weihnachten: { label: "Weihnachten", md: "12-25", stundenDelta: 0 },
  stephan: { label: "Stephanstag", md: "12-26", stundenDelta: 0 },
  silvester: { label: "Silvester (Halbtag)", md: "12-31", stundenDelta: -3.5 },
  restaurationGE: { label: "Restauration der Republik", md: "12-31", stundenDelta: 0 },
  // Bedingte Tage
  berchtoldMontag: { label: "Berchtoldstag", md: "01-02", stundenDelta: 0, onlyIf: ds => weekday(ds) === 1 },
  stephanMontag: { label: "Stephanstag", md: "12-26", stundenDelta: 0, onlyIf: ds => weekday(ds) === 1 },
  stephanAR: { label: "Stephanstag", md: "12-26", stundenDelta: 0, onlyIf: ds => weekday(ds) !== 2 && weekday(ds) !== 6 },
} satisfies Record<string, HolidayDef>;
type HolidayKey = keyof typeof HOLIDAYS;

/** Eidgenössisch bzw. in allen Kantonen frei; Halbtage und Auffahrt-Vortag als Büro-Usanz (wie bisher Zürich). */
const COMMON: HolidayKey[] = ["neujahr", "auffahrtVortag", "auffahrt", "bundesfeier", "heiligabend", "weihnachten", "silvester"];

/**
 * Kantonale Feiertage zusätzlich zu `COMMON` — gesetzliche bzw. verbreitet arbeitsfreie Tage, Grundlage:
 * SECO «Feiertage Schweiz» (den Sonntagen gleichgestellt, Art. 20a ArG, Stand 12.12.2024) und das Verzeichnis
 * des BJ; wo Bezirke/Gemeinden abweichen (AG, FR, SO, GR, BE), gilt die Regelung des Kantonshauptorts bzw.
 * der Mehrheit. In der Liste lassen sich Tage jederzeit löschen oder ergänzen.
 */
export const KANTON_FEIERTAGE: Record<Kanton, { name: string; tage: HolidayKey[] }> = {
  AG: { name: "Aargau", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "stephan"] },
  AI: { name: "Appenzell Innerrhoden", tage: ["karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "mauritius", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  AR: { name: "Appenzell Ausserrhoden", tage: ["karfreitag", "ostermontag", "pfingstmontag", "stephanAR"] },
  BE: { name: "Bern", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "stephan"] },
  BL: { name: "Basel-Landschaft", tage: ["karfreitag", "ostermontag", "maiTag", "pfingstmontag", "stephan"] },
  BS: { name: "Basel-Stadt", tage: ["karfreitag", "ostermontag", "maiTag", "pfingstmontag", "stephan"] },
  FR: { name: "Freiburg", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  GE: { name: "Genf", tage: ["karfreitag", "ostermontag", "pfingstmontag", "genferBettag", "restaurationGE"] },
  GL: { name: "Glarus", tage: ["berchtold", "naefels", "karfreitag", "ostermontag", "pfingstmontag", "allerheiligen", "stephan"] },
  GR: { name: "Graubünden", tage: ["karfreitag", "ostermontag", "pfingstmontag", "stephan"] },
  JU: { name: "Jura", tage: ["berchtold", "karfreitag", "ostermontag", "maiTag", "pfingstmontag", "fronleichnam", "unabhaengigkeitJU", "mariaHimmelfahrt", "allerheiligen"] },
  LU: { name: "Luzern", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  NE: { name: "Neuenburg", tage: ["berchtoldMontag", "republikNE", "karfreitag", "maiTag", "stephanMontag"] },
  NW: { name: "Nidwalden", tage: ["josef", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  OW: { name: "Obwalden", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "bruderKlaus", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  SG: { name: "St. Gallen", tage: ["karfreitag", "ostermontag", "pfingstmontag", "allerheiligen", "stephan"] },
  SH: { name: "Schaffhausen", tage: ["berchtold", "karfreitag", "ostermontag", "maiTag", "pfingstmontag", "stephan"] },
  SO: { name: "Solothurn", tage: ["berchtold", "karfreitag", "ostermontag", "maiTagHalb", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "stephan"] },
  SZ: { name: "Schwyz", tage: ["dreikoenig", "josef", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  TG: { name: "Thurgau", tage: ["berchtold", "karfreitag", "ostermontag", "maiTag", "pfingstmontag", "stephan"] },
  TI: { name: "Tessin", tage: ["dreikoenig", "josef", "ostermontag", "maiTag", "pfingstmontag", "fronleichnam", "peterPaul", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  UR: { name: "Uri", tage: ["dreikoenig", "josef", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  VD: { name: "Waadt", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "bettagsmontag"] },
  VS: { name: "Wallis", tage: ["josef", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis"] },
  ZG: { name: "Zug", tage: ["berchtold", "karfreitag", "ostermontag", "pfingstmontag", "fronleichnam", "mariaHimmelfahrt", "allerheiligen", "mariaEmpfaengnis", "stephan"] },
  ZH: { name: "Zürich", tage: ["berchtold", "karfreitag", "ostermontag", "maiTag", "pfingstmontag", "stephan"] },
};

/** Alle Kantone, alphabetisch nach Kürzel. */
export const KANTONE = Object.keys(KANTON_FEIERTAGE).sort() as Kanton[];

/** Feiertage eines Kantons: ganze Tage verdrängen einen Halbtag am selben Datum (z.B. Genf 31.12.). */
function cantonHolidays(kanton: Kanton): HolidayDef[] {
  const defs: HolidayDef[] = [...COMMON, ...(KANTON_FEIERTAGE[kanton] || KANTON_FEIERTAGE.ZH).tage].map(k => HOLIDAYS[k]);
  const fullMd = new Set(defs.filter(d => d.md && d.stundenDelta === 0 && !d.onlyIf).map(d => d.md));
  return defs.filter(d => !(d.md && d.stundenDelta !== 0 && fullMd.has(d.md)));
}

/**
 * Feiertags-Vorlage eines Kantons (Standard Zürich): feste als jährlich wiederkehrend (ohne `id`; nur wenn
 * noch nicht vorhanden), bewegliche (Ostern, Näfelser Fahrt, Genfer Bettag, Bettagsmontag …) und an Bedingungen
 * geknüpfte (z.B. Stephanstag NE nur am Montag) je Jahr für `fromYear`–`toYear`, soweit es an dem Datum noch
 * keinen Feiertag gibt. Halbtage (Heiligabend, Silvester, Vortag Auffahrt) als Büro-Usanz in allen Kantonen.
 */
export function swissHolidayTemplate(existing: Feiertag[] | undefined, fromYear: number, toYear: number, kanton: Kanton = "ZH"): Feiertag[] {
  const list = existing || [];
  const defs = cantonHolidays(kanton);
  const hasRepeating = (md: string) => list.some(f => f.repeatsYearly && f.date.slice(5, 10) === md);
  const hasDate = (ds: string) => list.some(f => f.date === ds || (f.repeatsYearly && f.date.slice(5, 10) === ds.slice(5, 10)));
  const out: Feiertag[] = defs.filter(d => d.md && !d.onlyIf && !hasRepeating(d.md))
    .sort((a, b) => a.md!.localeCompare(b.md!))
    .map(d => ({ label: d.label, date: `2000-${d.md}`, stundenDelta: d.stundenDelta, repeatsYearly: true }));
  for (let y = fromYear; y <= toYear; y++) {
    const easter = easterSunday(y);
    const yearly: Feiertag[] = [];
    for (const d of defs) {
      let date: DateStr | null = null;
      if (d.easter !== undefined) date = shiftDate(easter, d.easter);
      else if (d.rule) date = d.rule(y);
      else if (d.md && d.onlyIf) date = `${y}-${d.md}`;
      if (!date || (d.onlyIf && !d.onlyIf(date)) || hasDate(date) || yearly.some(f => f.date === date)) continue;
      yearly.push({ label: d.label, date, stundenDelta: d.stundenDelta, repeatsYearly: false });
    }
    out.push(...yearly.sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

/** Bezeichnungen aller Vorlagen-Feiertage (zum Erkennen beim Wechsel des Kantons). */
const TEMPLATE_LABELS = new Set(Object.values(HOLIDAYS).map(d => d.label));

/**
 * Feiertagsliste auf die Vorlage eines anderen Kantons umstellen: Einträge mit einer Vorlagen-Bezeichnung
 * fallen weg, eigene Feiertage (andere Bezeichnung) und einzelne Vorlagen-Tage vor `fromYear` (abgerechnete
 * Jahre) bleiben; dazu die Vorlage für `fromYear`–`toYear`. Neue Einträge ohne `id` (vergibt der Aufrufer).
 */
export function replaceHolidayTemplate(existing: Feiertag[] | undefined, fromYear: number, toYear: number, kanton: Kanton): Feiertag[] {
  const own = (existing || []).filter(f => !TEMPLATE_LABELS.has(f.label || "") || (!f.repeatsYearly && f.date < `${fromYear}-01-01`));
  return [...own, ...swissHolidayTemplate(own, fromYear, toYear, kanton)];
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
 * Feiertage eines Jahres inklusive der automatischen Vortage (−`vortagStunden` h × Pensum, Standard 1, 0 = keine;
 * `id` «vortag-…»): der Werktag direkt vor einem ganzen Feiertag, der selbst kein Feiertag ist — auch der
 * Freitag vor einem Feiertag am Samstag. Büro-Usanz, gesetzlich nicht vorgeschrieben (Einstellungen → Feiertage). Feiertage am 1./2. Januar des Folgejahrs zählen mit.
 */
export function resolveHolidays(feiertage: Feiertag[] | undefined, year: number | string, vortagStunden = 1): Feiertag[] {
  const y = Number(year);
  const fts = holidaysOfYear(feiertage, y);
  const all = [...fts, ...holidaysOfYear(feiertage, y + 1).filter(f => f.date.slice(5, 10) <= "01-07")];
  const taken = new Set(all.map(f => f.date));
  const vortage: Feiertag[] = [];
  if (!(vortagStunden > 0)) return fts;
  for (const f of all) {
    if (!isFullHoliday(f)) continue;
    const ds = shiftDate(f.date, -1);
    const dow = weekday(ds);
    if (!ds.startsWith(String(y)) || dow === 0 || dow === 6 || taken.has(ds)) continue;
    taken.add(ds);
    vortage.push({ id: `vortag-${ds}`, date: ds, label: `Vortag ${f.label || f.date}`, stundenDelta: -vortagStunden });
  }
  return [...fts, ...vortage];
}

// ── Mitarbeiter ──────────────────────────────────────────────────────────────

/** Pensum als Faktor (fehlend oder 0 → 100 %, wie überall in der App). */
export const pensumFactor = (emp: Pick<WorkEmployee, "pensum">): number => (Number(emp.pensum) || 100) / 100;

/** Pensum (%) und Wochenstunden an einem Datum (mit `pensumVerlauf`); ohne Datum die Grundwerte. */
export const workloadAt = (emp: Pick<WorkEmployee, "pensum" | "wochenstunden" | "pensumVerlauf">, ds?: DateStr) =>
  ds ? arbeitszeitAm(emp, ds) : { pensum: Number(emp.pensum) || 100, wochenstunden: Number(emp.wochenstunden) || 35 };

/** Tagessoll in Stunden ohne Feiertage: Wochenstunden × Pensum ÷ 5 (mit Datum: die dann gültigen Werte). */
export const baseDailySoll = (emp: Pick<WorkEmployee, "pensum" | "wochenstunden" | "pensumVerlauf">, ds?: DateStr): number => {
  const w = workloadAt(emp, ds);
  return (w.wochenstunden * (w.pensum / 100)) / 5;
};

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

/**
 * Stundenlohn für Überstunden: Monatslohn (100 %) × 12 bzw. 13 ÷ (Wochenstunden × 52), auf Rappen. Lohn und
 * Wochenstunden beziehen sich auf 100 %, das Pensum kürzt sich heraus; mit `ds` gelten die Wochenstunden an
 * diesem Datum (`pensumVerlauf`).
 */
export function overtimeHourlyRate(emp: Pick<Employee, "monatslohn" | "wochenstunden" | "dreizehnterLohn"> & Partial<Pick<Employee, "pensumVerlauf" | "pensum" | "lohnVerlauf">>, ds?: DateStr): number {
  const lohn = ds ? monatslohnAm(emp, ds) : (emp.monatslohn || 0);
  if (!lohn) return 0;
  const wochenstunden = ds ? arbeitszeitAm(emp, ds).wochenstunden : (emp.wochenstunden || 35);
  return roundCHF(lohn * (emp.dreizehnterLohn ? 13 : 12) / (wochenstunden * 52));
}

/** Zählt der Tag für Saldo und Ferien: angestellt und nicht vor dem Saldo-Stichtag. */
export const countsForBalance = (emp: Pick<WorkEmployee, "eintrittsdatum" | "austrittsdatum" | "saldoStichtag">, ds: DateStr): boolean =>
  isEmployed(emp, ds) && !(emp.saldoStichtag && ds < emp.saldoStichtag);

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
      for (const f of resolveHolidays(data.feiertage, year, data.settings?.vortagStunden ?? 1)) if (!m.has(f.date)) m.set(f.date, f);
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

  /** Soll eines Tages ohne Ferien (Wochenende, Ein-/Austritt, Saldo-Stichtag, Feiertage, Pensum am Tag). */
  const sollBruttoForDay = (emp: WorkEmployee, ds: DateStr): number => {
    const dow = weekday(ds);
    if (dow === 0 || dow === 6 || !countsForBalance(emp, ds)) return 0;
    const ft = holidayOn(ds);
    if (isFullHoliday(ft)) return 0;
    const w = workloadAt(emp, ds);
    const t = (w.wochenstunden * (w.pensum / 100)) / 5;
    return ft ? Math.max(0, t + (ft.stundenDelta || 0) * (w.pensum / 100)) : t;
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
    // höchstens das Tagessoll (10 h Krankheit an einem 8.4-h-Tag ergaben sonst +1.6 h Saldo, später als Überstunden auszahlbar)
    return Math.min(soll, list.reduce((s, a) => (type && a.type !== type ? s : s + (a.mins === null ? soll : a.mins / 60)), 0));
  };

  // Zeiteinträge je Person einmal gruppieren: `period` lief sonst bei jedem Aufruf über ALLE Einträge
  // (30 Personen × 60'000 Einträge × viele Perioden = mehrere Sekunden in Personal/Übersicht)
  let byEmp: Map<string, NonNullable<WorkData["timeEntries"]>> | null = null;
  const entriesOf = (empId: string) => {
    if (!byEmp) {
      byEmp = new Map();
      for (const e of data.timeEntries || []) { const l = byEmp.get(e.employeeId); if (l) l.push(e); else byEmp.set(e.employeeId, [e]); }
    }
    return byEmp.get(empId) || [];
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
    const ist = entriesOf(emp.id).reduce((s, e) =>
      // Ist wie das Soll nur bis `upTo`: vorausgeplante Einträge erschienen im laufenden Monat sonst als Plus
      e.date >= from && e.date <= last && countsForBalance(emp, e.date) ? s + (e.minutes || 0) : s, 0) / 60;
    return { sollBrutto, ferien, soll: sollBrutto - ferien, ist, absenz, saldo: ist + absenz + ferien - sollBrutto };
  };

  /** Monatssaldo (`month` 0-basiert). */
  const month = (emp: WorkEmployee, year: number, m: number, upTo: DateStr = today) => period(emp, monthStart(year, m), monthEnd(year, m), upTo);

  /**
   * Überstundensaldo seit Eintritt (bzw. Saldo-Stichtag, dann mit Übertrag) bis heute bzw. Austritt, abzüglich
   * ausbezahlter Stunden. Auszahlungen vor dem Stichtag (ohne Datum: aus einem früheren Jahr) sind im Übertrag.
   */
  const overtime = (emp: WorkEmployee, upTo: DateStr = today) => {
    const stichtag = emp.saldoStichtag || "";
    let start = emp.eintrittsdatum || `${today.slice(0, 4)}-01-01`;
    if (stichtag > start) start = stichtag;
    const end = emp.austrittsdatum && emp.austrittsdatum < upTo ? emp.austrittsdatum : upTo;
    const p = start > end ? { sollBrutto: 0, ferien: 0, soll: 0, ist: 0, absenz: 0, saldo: 0 } : period(emp, start, end, end);
    const beforeStichtag = (a: { date?: string | null; year?: number | null }) =>
      !!stichtag && (a.date ? a.date < stichtag : Number(a.year) < Number(stichtag.slice(0, 4)));
    const paidOut = (data.uberstundenAbschluss || [])
      // bis `upTo` ausbezahlt — oder für ein Jahr, das bis `upTo` abgeschlossen ist (Abschluss 2025 im Februar 2026)
      .filter(a => a.empId === emp.id && a.type === "payout" && (!a.date || a.date <= upTo || (a.year != null && `${a.year}-12-31` <= upTo)) && !beforeStichtag(a))
      .reduce((s, a) => s + (Number(a.hoursSettled) || 0), 0);
    const uebertrag = stichtag ? Number(emp.saldoUebertragStunden) || 0 : 0;
    return { ...p, uebertrag, paidOut, balance: uebertrag + p.saldo - paidOut };
  };

  /** Ferienanspruch eines Jahres in Stunden (ungerundet): Grundformel, mit Pensumwechsel/Stichtag Tag für Tag. */
  const vacationEntitlement = (emp: WorkEmployee, year: number, wochen: number): number => {
    const hasStichtag = !!emp.saldoStichtag && emp.saldoStichtag > `${year}-01-01`;
    if (!hasStichtag && !(emp.pensumVerlauf && emp.pensumVerlauf.length)) {
      return wochen * (Number(emp.wochenstunden) || 35) * pensumFactor(emp) * employedShareOfYear(emp, year);
    }
    // Je Kalendertag: Wochen × Wochenstunden × Pensum ÷ Tage des Monats ÷ 12 (= Monatsanteil wie im Lohn)
    let s = 0;
    for (let m = 0; m < 12; m++) {
      const last = monthEnd(year, m);
      const days = Number(last.slice(8, 10));
      for (let ds = monthStart(year, m); ds <= last; ds = shiftDate(ds, 1)) {
        if (!countsForBalance(emp, ds)) continue;
        const w = workloadAt(emp, ds);
        s += w.wochenstunden * (w.pensum / 100) / days;
      }
    }
    return wochen * s / 12;
  };

  /** Ferien eines Jahres: Anspruch (anteilig), Übertrag, bezogen (bis heute), geplant, beantragt, Rest. */
  const vacationYear = (emp: WorkEmployee, year: number): VacationYear => {
    const y = String(year);
    const wochen = vacationWeeks(emp, year);
    const anspruch = vacationEntitlement(emp, year, wochen);
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
