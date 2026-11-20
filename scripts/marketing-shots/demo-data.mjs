// Fiktive, in sich konsistente Demo-Daten für die Marketing-Screenshots der
// Website. Erfundene Namen, aber Zahlen nach Schweizer Büropraxis.
//
// Leitprojekt "Sanierung Verwaltungsgebäude Limmatfeld" trägt die ganze Kette
// Offerte → Projekt → Zeit → Kontrolle → Akonto → Schluss → Abschluss.
//
// Zahlenbasis (von der App selbst gerechnet, siehe calcSIAHours in utils.js):
//   Baukosten 650'000 · Schwierigkeit 1.0 · Ansatz 155.–
//   → p = 0.1841 %, Total 1197.1 h, Honorar netto 185'550.50
//
// WICHTIG: alle Daten relativ zum Montag dieser Woche. Mit fixen Daten zeigt
// die Wochenansicht nach wenigen Tagen eine leere Woche.

const rateReb = 165;
const rateLim = 155;
const mwstRate = 8.1;
const round2 = n => Math.round(n * 100) / 100;

export const P_LIM = "proj-limmatfeld";
export const P_REB = "proj-rebweg";
export const P_HARD = "proj-hardau";
const CL_LIM = "firma-limmatfeld";
const CL_REB = "firma-rebweg";
const CL_ING = "firma-meiersteiner";
const CL_HARD = "firma-stadt";
const CL_KELLER = "firma-keller";
const CL_HAAS = "firma-haas";
export const E_JULIAN = "emp-julian";
export const E_LAURA = "emp-laura";
export const E_NINA = "emp-nina";
export const E_MARC = "emp-marc";
export const E_PETER = "emp-peter";
export const E_SARA = "emp-sara";
export const P_WIE = "proj-wiedikon";
export const P_LETZI = "proj-letzi";
export const P_BINZ = "proj-binz";
export const P_ZOLL = "proj-zollikon";
const CL_ZOLL = "firma-wyss";
const CL_SIHL = "firma-sihltal";
const CL_BINZ = "firma-binz";

let n = 0;
const id = (p) => `${p}-${(n++).toString(36)}`;
const INV_LIM_1 = id("inv"), INV_LIM_2 = id("inv"), INV_REB = id("inv");
const INV_HARD_1 = id("inv"), INV_HARD_2 = id("inv"), INV_HARD_S = id("inv");
const Q_LIM = "quote-limmatfeld", Q_AUFWAND = "quote-aufwand", Q_FREI = "quote-frei";

const MONDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
})();
function dateAt(weeks, days = 0) {
  const d = new Date(MONDAY);
  d.setDate(d.getDate() + weeks * 7 + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function te(date, employeeId, projectId, phaseId, startTime, durationMin, description) {
  const [h, m] = startTime.split(":").map(Number);
  const end = h * 60 + m + durationMin;
  return {
    id: id("te"), date, employeeId, projectId, phaseId, positionId: "",
    minutes: durationMin, startTime,
    endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    description, createdAt: new Date(`${date}T${startTime}:00`).toISOString(),
  };
}

/**
 * Einträge für eine Phase, die zusammen exakt `targetH` Stunden ergeben: je Woche gleich viel, auf
 * Halbtage (≤ 4 h) über die Wochentage verteilt. Uhrzeiten setzt `layoutDays` am Schluss.
 */
function phaseEntries({ projectId, phaseId, targetH, startWeeks, weeks, employees, descPool }) {
  const out = [];
  let rest = Math.round(targetH * 60);
  const slot = Math.round(rest / weeks / 30) * 30;
  for (let i = 0; i < weeks && rest > 0; i++) {
    let week = (i === weeks - 1) ? rest : Math.min(slot, rest);
    rest -= week;
    for (let k = 0; week > 0; k++) {
      const mins = Math.min(240, week);
      out.push(te(dateAt(startWeeks + i, (i + k) % 5), employees[(i + k) % employees.length],
        projectId, phaseId, "08:00", mins, descPool[(i + k) % descPool.length]));
      week -= mins;
    }
  }
  return out;
}
const sumH = (a) => a.reduce((s, e) => s + e.minutes, 0) / 60;

// ── Limmatfeld: Phasen der Reihe nach, 93–114 %, Ausführung läuft ─────────
const LIM_BUDGETS = { "31": 107.7, "32": 251.4, "33": 29.9, "41": 215.5, "51": 191.5, "52": 347.1, "53": 54 };
const limHistorical = [
  { phaseId: "31", targetH: 100, startWeeks: -74, weeks: 6,
    descPool: ["Bestandsaufnahme Fassade und Fenster", "Vorprojekt Sanierungsvarianten", "Variantenvergleich mit Bauherrschaft"] },
  { phaseId: "32", targetH: 286, startWeeks: -66, weeks: 16,
    descPool: ["Bauprojekt Fassadenaufbau ausgearbeitet", "Unvorhergesehene Altlasten in der Fassade abgeklärt",
               "Zusatzauflagen Denkmalschutz eingearbeitet", "Detailpläne Fensteranschlüsse revidiert",
               "Kostenvoranschlag nach Zusatzabklärungen angepasst"] },
  { phaseId: "33", targetH: 31, startWeeks: -49, weeks: 3,
    descPool: ["Baugesuch eingereicht", "Rückfragen der Bewilligungsbehörde beantwortet"] },
  { phaseId: "41", targetH: 200, startWeeks: -45, weeks: 11,
    descPool: ["Leistungsverzeichnis Fassadenarbeiten erstellt", "Ausschreibung Fenster versandt",
               "Offertvergleich Baumeisterarbeiten ausgewertet", "Vergabeantrag zuhanden Bauherrschaft"] },
  { phaseId: "51", targetH: 180, startWeeks: -33, weeks: 10,
    descPool: ["Ausführungspläne Fassade erarbeitet", "Detailanschlüsse mit Fensterbauer abgestimmt",
               "Werkverträge mit Unternehmern koordiniert"] },
  { phaseId: "52", targetH: 140, startWeeks: -22, weeks: 21,
    descPool: ["Bauleitung vor Ort, Baubesprechung", "Baustellenbegehung, Mängelliste nachgeführt",
               "Abnahme Teiletappe mit Bauherrschaft", "Koordination Unternehmer auf der Baustelle"] },
].flatMap(p => phaseEntries({ projectId: P_LIM, employees: [E_JULIAN, E_LAURA], ...p }));

const limCurrent = [
  te(dateAt(0, 0), E_JULIAN, P_LIM, "52", "07:30", 270, "Baustellenbegehung Fenstermontage, Mängelliste"),
  te(dateAt(0, 0), E_JULIAN, P_LIM, "52", "13:00", 180, "Mängelliste mit Fassadenbauer durchgegangen"),
  te(dateAt(0, 1), E_JULIAN, P_LIM, "52", "08:00", 240, "Bauleitung vor Ort, Baubesprechung Haustechnik"),
  te(dateAt(0, 1), E_JULIAN, P_LIM, "52", "13:00", 210, "Abnahme Fenstermontage 3. OG"),
  te(dateAt(0, 2), E_JULIAN, P_LIM, "52", "08:00", 300, "Koordination Gerüstabbau mit Unternehmer"),
  te(dateAt(0, 2), E_JULIAN, P_LIM, "33", "13:30", 150, "Baugesuchsnachtrag Balkonverglasung eingereicht"),
  te(dateAt(0, 3), E_JULIAN, P_LIM, "52", "07:30", 480, "Bauleitung, Kontrolle Anschlussdetails Attika"),
  te(dateAt(0, 4), E_JULIAN, P_LIM, "52", "08:00", 240, "Bautagebuch und Fotodokumentation nachgeführt"),
];

// ── Hardau: abgeschlossenes Projekt mit Akonti + Schlussrechnung ──────────
const hardHistorical = [
  { phaseId: "31", targetH: 55,  startWeeks: -150, weeks: 4, descPool: ["Vorprojekt Erweiterungsbau", "Machbarkeit Aufstockung geprüft"] },
  { phaseId: "32", targetH: 128, startWeeks: -144, weeks: 8, descPool: ["Bauprojekt ausgearbeitet", "Kostenvoranschlag erstellt"] },
  { phaseId: "33", targetH: 16,  startWeeks: -134, weeks: 2, descPool: ["Baugesuch eingereicht"] },
  { phaseId: "41", targetH: 110, startWeeks: -130, weeks: 7, descPool: ["Ausschreibung Baumeister", "Offertvergleich ausgewertet"] },
  { phaseId: "51", targetH: 98,  startWeeks: -121, weeks: 6, descPool: ["Ausführungspläne erstellt", "Werkverträge vorbereitet"] },
  { phaseId: "52", targetH: 175, startWeeks: -113, weeks: 12, descPool: ["Bauleitung vor Ort", "Abnahmen mit Bauherrschaft"] },
  { phaseId: "53", targetH: 28,  startWeeks: -99,  weeks: 3, descPool: ["Inbetriebnahme und Übergabe", "Schlussabrechnung erstellt"] },
].flatMap(p => phaseEntries({ projectId: P_HARD, employees: [E_LAURA, E_JULIAN], ...p }));

// ── Rebweg: früh im Prozess, Stundensatz-Projekt ──────────────────────────
const rebHistorical = [
  { phaseId: "31", targetH: 45, startWeeks: -17, weeks: 3, descPool: ["Vorprojektvarianten entwickelt", "Vorprojekt mit Bauherrschaft bereinigt"] },
  { phaseId: "32", targetH: 76, startWeeks: -13, weeks: 5, descPool: ["Bauprojekt Grundrisse EG/OG", "Fassadenansichten gezeichnet", "Kostenvoranschlag erarbeitet"] },
  { phaseId: "33", targetH: 26, startWeeks: -7,  weeks: 3, descPool: ["Baugesuchsunterlagen zusammengestellt", "Rückfragen der Baubehörde beantwortet"] },
].flatMap(p => phaseEntries({ projectId: P_REB, employees: [E_LAURA, E_NINA], ...p }));
rebHistorical.forEach(e => { e.invoiceId = INV_REB; });
export const rebBilledH = sumH(rebHistorical);

const rebCurrent = [
  te(dateAt(0, 0), E_LAURA, P_REB, "32", "08:00", 240, "Grundrisse 2. OG mit Bauherrschaft bereinigt"),
  te(dateAt(0, 1), E_NINA,  P_REB, "32", "09:00", 300, "3D-Modell Fassade für Visualisierung aufbereitet"),
  te(dateAt(0, 3), E_LAURA, P_REB, "32", "08:00", 300, "Kostenvoranschlag mit Kostenplaner abgeglichen"),
];

// ── Weitere laufende Mandate (damit Umsatz und Auslastung zu einem 6-Personen-Büro passen) ──────────
// Ein Büro mit rund 5 Vollzeitstellen setzt in der Schweiz etwa CHF 130–160k pro Stelle um. Ohne diese
// Mandate zeigte das Budget nur ~87k Einnahmen gegen ~700k Lohn- und Fixkosten.
// Stunden: höchstens 4 h pro Eintrag; Uhrzeiten und Tagesverteilung macht `layoutDays` für alle Projekte gemeinsam.

/** Wochenweise Einträge mit `hPerWeek` Stunden, auf Halbtage (≤ 4 h) verteilt; Uhrzeiten setzt `layoutDays`. */
function weeklyEntries({ projectId, phaseId, hPerWeek, startWeeks, weeks, employee, descPool, dayOffset = 0 }) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    let rest = Math.round(hPerWeek * 60);
    for (let k = 0; rest > 0 && k < 10; k++) {
      const mins = Math.min(240, rest);
      out.push(te(dateAt(startWeeks + w, (dayOffset + w + k) % 5), employee, projectId, phaseId, "08:00", mins, descPool[(w + k) % descPool.length]));
      rest -= mins;
    }
  }
  return out;
}

// Neubau MFH Wiedikon (Pauschalhonorar SIA, Marc und Sara): Bauprojekt bis Ausschreibung im laufenden Jahr
const WIE_SUB = 412000;
const wieEntries = [
  ...weeklyEntries({ projectId: P_WIE, phaseId: "32", hPerWeek: 20, startWeeks: -46, weeks: 18, employee: E_SARA,
    descPool: ["Bauprojekt Grundrisse Regelgeschoss", "Fassadenstudie Strassenseite", "Kostenvoranschlag ±10 % erarbeitet"] }),
  ...weeklyEntries({ projectId: P_WIE, phaseId: "33", hPerWeek: 16, startWeeks: -28, weeks: 4, employee: E_SARA,
    descPool: ["Baugesuchspläne 1:100 bereinigt", "Brandschutzkonzept mit Fachplaner abgestimmt"] }),
  ...weeklyEntries({ projectId: P_WIE, phaseId: "41", hPerWeek: 24, startWeeks: -24, weeks: 18, employee: E_SARA,
    descPool: ["Ausschreibung Baumeister und Rohbau", "Leistungsverzeichnisse NPK", "Offertvergleich Fenster"] }),
  ...weeklyEntries({ projectId: P_WIE, phaseId: "32", hPerWeek: 8, startWeeks: -46, weeks: 22, employee: E_MARC, dayOffset: 1,
    descPool: ["Projektleitung, Sitzung mit Bauherrschaft", "Entwurfsbesprechung im Team"] }),
  ...weeklyEntries({ projectId: P_WIE, phaseId: "41", hPerWeek: 8, startWeeks: -24, weeks: 23, employee: E_MARC, dayOffset: 1,
    descPool: ["Vergabegespräche mit Unternehmern", "Projektleitung, Kostenkontrolle"] }),
];

// Gesamtsanierung Schulhaus Letzi (Stadt, Pauschalhonorar, Peter Kostenplanung, Julian nachmittags)
const LETZI_SUB = 356000;
const letziEntries = [
  ...weeklyEntries({ projectId: P_LETZI, phaseId: "31", hPerWeek: 12, startWeeks: -44, weeks: 12, employee: E_PETER,
    descPool: ["Grobkostenschätzung Sanierungsvarianten", "Zustandsanalyse Gebäudetechnik"] }),
  ...weeklyEntries({ projectId: P_LETZI, phaseId: "32", hPerWeek: 12, startWeeks: -30, weeks: 28, employee: E_PETER,
    descPool: ["Kostenvoranschlag nach eBKP-H", "Mengenermittlung Fassade und Dach"] }),
  ...weeklyEntries({ projectId: P_LETZI, phaseId: "32", hPerWeek: 8, startWeeks: -30, weeks: 28, employee: E_JULIAN,
    descPool: ["Bauprojekt Etappierung im laufenden Schulbetrieb", "Provisorien Schulbetrieb geplant"] }),
];

// Umbau Gewerbehaus Binz (Stundensatz, Nina und Laura nachmittags), quartalsweise nach Aufwand verrechnet
const rateBinz = 160;
const binzQuarter = (q, startWeeks) => [
  ...weeklyEntries({ projectId: P_BINZ, phaseId: "51", hPerWeek: 10, startWeeks, weeks: 12, employee: E_NINA,
    descPool: ["Ausführungspläne Mieterausbau", "Detailpläne Sanitärkern"] }),
  ...weeklyEntries({ projectId: P_BINZ, phaseId: "52", hPerWeek: 8, startWeeks, weeks: 12, employee: E_LAURA, dayOffset: 2,
    descPool: ["Bauleitung Mieterausbau, Baubesprechung", "Abnahme Etappe mit Mieterschaft"] }),
].map(e => ({ ...e, _q: q }));
const binzEntries = [...binzQuarter(1, -46), ...binzQuarter(2, -33), ...binzQuarter(3, -20)];
const INV_BINZ = [id("inv"), id("inv"), id("inv")];
binzEntries.forEach(e => { e.invoiceId = INV_BINZ[e._q - 1]; delete e._q; });
const binzH = (q) => sumH(binzEntries.filter(e => e.invoiceId === INV_BINZ[q - 1]));

// Umbau und Erweiterung Villa Zollikon (Pauschal, Ausführung; Julian nachmittags, Marc Gestaltung)
const ZOLL_SUB = 214000;
const zollEntries = [
  ...weeklyEntries({ projectId: P_ZOLL, phaseId: "51", hPerWeek: 12, startWeeks: -46, weeks: 14, employee: E_JULIAN, dayOffset: 1,
    descPool: ["Ausführungspläne Anbau", "Werkverträge Holzbau vorbereitet"] }),
  ...weeklyEntries({ projectId: P_ZOLL, phaseId: "52", hPerWeek: 12, startWeeks: -32, weeks: 31, employee: E_JULIAN, dayOffset: 1,
    descPool: ["Bauleitung Villa, Baubesprechung", "Kostenkontrolle und Rechnungsprüfung", "Abnahme Holzbau"] }),
  ...weeklyEntries({ projectId: P_ZOLL, phaseId: "52", hPerWeek: 4, startWeeks: -32, weeks: 31, employee: E_MARC, dayOffset: 3,
    descPool: ["Gestalterische Leitung, Materialbemusterung", "Bemusterung Küche mit Bauherrschaft"] }),
];

// ── Arbeitstage: Projektzeit ordnen, Rest mit interner Zeit bis zum Soll auffüllen ─────────────────
// Ohne das zeigte die Demo Saldi von −1'000 h und mehr. Soll je Tag = Wochenstunden × Pensum / 5;
// eine leichte Schwankung ergibt ein kleines Plus über das Jahr. Nur vergangene Wochen, Feiertage hat
// die Demo keine. Diese Woche bleibt von Hand gesetzt (Wochenansicht der Screenshots).
// ── Kalender des Jahres: Feiertage ZH, Ferien, Absenzen, Pensumwechsel, Stichtage ─────────────────
// Sonderfälle zum Nachrechnen (Lohn, Soll, Saldo, Ferien): Pensumwechsel mitten im Monat (Laura 15.8.),
// im Austrittsmonat (Sara 1.11., Austritt 15.11.), über dem ALV-Höchstlohn (Marc 1.4.), mit neuen
// Wochenstunden (Nina 1.3.); Umstieg mitten im Jahr (Peter, Stichtag 1.6.) mit Ferien über den Stichtag.
const Y = MONDAY.getFullYear();
function easter(y) {   // Gauss/Meeus, gregorianisch
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const isoUTC = d => d.toISOString().slice(0, 10);
const plusDays = (ds, n) => { const d = new Date(`${ds}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); };
const FEIERTAGE = [Y - 1, Y, Y + 1].flatMap(y => {
  const e = isoUTC(easter(y));
  return [
    ["Neujahr", `${y}-01-01`, 0], ["Berchtoldstag", `${y}-01-02`, 0], ["Karfreitag", plusDays(e, -2), 0], ["Ostermontag", plusDays(e, 1), 0],
    ["Tag der Arbeit", `${y}-05-01`, 0], ["Auffahrt Vortag (Halbtag)", plusDays(e, 38), -3.5], ["Auffahrt", plusDays(e, 39), 0],
    ["Pfingstmontag", plusDays(e, 50), 0], ["Nationalfeiertag", `${y}-08-01`, 0], ["Heiligabend (Halbtag)", `${y}-12-24`, -3.5],
    ["Weihnachten", `${y}-12-25`, 0], ["Stephanstag", `${y}-12-26`, 0], ["Silvester (Halbtag)", `${y}-12-31`, -3.5],
  ].map(([label, date, stundenDelta], i) => ({ id: `ft-${y}-${i}`, label, date, stundenDelta, repeatsYearly: false }));
});
const FERIEN = [
  [E_JULIAN, `${Y}-02-16`, `${Y}-02-20`, "approved"], [E_JULIAN, `${Y}-07-20`, `${Y}-08-07`, "approved"], [E_JULIAN, `${Y}-12-21`, `${Y}-12-31`, "approved"],
  [E_LAURA, `${Y}-04-07`, `${Y}-04-17`, "approved"], [E_LAURA, `${Y}-07-13`, `${Y}-07-24`, "approved"], [E_LAURA, `${Y}-10-12`, `${Y}-10-16`, "approved"],
  [E_NINA, `${Y}-05-18`, `${Y}-05-22`, "approved"], [E_NINA, `${Y}-08-10`, `${Y}-08-21`, "approved"],
  [E_MARC, `${Y}-03-02`, `${Y}-03-06`, "approved"], [E_MARC, `${Y}-08-03`, `${Y}-08-21`, "approved"], [E_MARC, `${Y}-12-28`, `${Y}-12-31`, "pending"],
  [E_PETER, `${Y}-05-25`, `${Y}-06-05`, "approved"], [E_PETER, `${Y}-09-14`, `${Y}-09-25`, "approved"],   // über den Stichtag 1.6.
  [E_SARA, `${Y}-06-22`, `${Y}-07-03`, "approved"], [E_SARA, `${Y}-10-05`, `${Y}-10-09`, "approved"],
].map(([employeeId, dateFrom, dateTo, status], i) => ({ id: `fe-${i}`, employeeId, dateFrom, dateTo, status, seen: true }));
const ABSENZEN = [
  { id: "ab-1", employeeId: E_JULIAN, type: "krankheit", dateFrom: `${Y}-03-10`, dateTo: `${Y}-03-12`, status: "approved" },
  { id: "ab-2", employeeId: E_LAURA, type: "militaer", dateFrom: `${Y}-06-15`, dateTo: `${Y}-06-19`, status: "approved" },
  { id: "ab-3", employeeId: E_NINA, type: "intern", date: `${Y}-09-08`, startTime: "13:00", endTime: "17:00", status: "approved" },
  { id: "ab-4", employeeId: E_SARA, type: "unfall", dateFrom: `${Y}-02-23`, dateTo: `${Y}-02-24`, status: "approved" },
  { id: "ab-5", employeeId: E_MARC, type: "weiterbildung", date: `${Y}-05-06`, startTime: "08:00", endTime: "12:00", status: "approved" },
];
const PENSUM_VERLAUF = {
  [E_LAURA]: [{ ab: `${Y}-08-15`, pensum: 80 }],
  [E_SARA]: [{ ab: `${Y}-11-01`, pensum: 60 }],
  [E_MARC]: [{ ab: `${Y}-04-01`, pensum: 90 }],
  [E_NINA]: [{ ab: `${Y}-03-01`, pensum: 100, wochenstunden: 42 }],
};
const STICHTAG = { [E_PETER]: `${Y}-06-01` };
const BASIS = { [E_JULIAN]: [100, 41], [E_LAURA]: [100, 41], [E_NINA]: [80, 41], [E_MARC]: [100, 42], [E_PETER]: [40, 42], [E_SARA]: [90, 42] };
/** Soll in Stunden an einem Werktag (Pensum am Tag, Halbfeiertage anteilig; Ferien, ganze Absenzen, Feiertage 0). */
function sollAm(emp, date) {
  let [pensum, wh] = BASIS[emp];
  for (const v of PENSUM_VERLAUF[emp] || []) if (date >= v.ab) { pensum = v.pensum; wh = v.wochenstunden ?? wh; }
  const ft = FEIERTAGE.find(f => f.date === date);
  if (ft && ft.stundenDelta === 0) return 0;
  if (FERIEN.some(f => f.employeeId === emp && f.status === "approved" && date >= f.dateFrom && date <= f.dateTo)) return 0;
  if (ABSENZEN.some(a => a.employeeId === emp && a.dateFrom && date >= a.dateFrom && date <= a.dateTo)) return 0;
  let h = wh / 5 * pensum / 100;
  if (ft) h += ft.stundenDelta * pensum / 100;
  const teil = ABSENZEN.find(a => a.employeeId === emp && a.date === date);
  if (teil) h -= (parseInt(teil.endTime) - parseInt(teil.startTime)) * pensum / 100;
  return Math.max(0, h);
}
const DAY_SOLL = BASIS;
const TEAM = { [P_LIM]: [E_JULIAN, E_LAURA], [P_HARD]: [E_LAURA, E_JULIAN], [P_REB]: [E_LAURA, E_NINA], [P_WIE]: [E_MARC, E_SARA],
  [P_LETZI]: [E_PETER, E_JULIAN], [P_BINZ]: [E_NINA, E_LAURA], [P_ZOLL]: [E_JULIAN, E_MARC] };
const INTERN_DESC = ["Akquise und Offertwesen", "Büroorganisation", "Teamsitzung", "Weiterbildung, Normen", "Wettbewerbsvorbereitung", "Administration Projekte"];
const SARA_END = `${MONDAY.getFullYear()}-11-15`;
function layoutDays(entries) {
  const thisWeek = dateAt(0);
  const yearStart = `${MONDAY.getFullYear() - 1}-12-29`;
  const byDay = new Map();
  for (const e of entries) {
    if (e.date >= thisWeek) continue;
    const k = `${e.employeeId}|${e.date}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  // Projektzeit an Ferien-, Feier- und Absenztagen auf den nächsten Arbeitstag verschieben (nach dem Austritt
  // auf den letzten davor), damit Phasen- und Rechnungsstunden gleich bleiben
  const workday = (emp, ds) => { const wd = new Date(`${ds}T00:00:00Z`).getUTCDay(); return wd >= 1 && wd <= 5 && sollAm(emp, ds) > 0 && !(emp === E_SARA && ds > SARA_END); };
  for (const [k, list] of [...byDay]) {
    const [emp, date] = k.split("|");
    if (workday(emp, date)) continue;
    const back = emp === E_SARA && date > SARA_END;
    byDay.delete(k);
    for (const e of list) {
      // zuerst übernimmt jemand aus dem Projektteam am selben Tag, sonst …
      const load0 = (em, d) => (byDay.get(`${em}|${d}`) || []).reduce((s2, x) => s2 + x.minutes, 0);
      const mate = (TEAM[e.projectId] || []).find(m => m !== emp && workday(m, date) && load0(m, date) + e.minutes <= 540);
      if (mate) { e.employeeId = mate; byDay.set(`${mate}|${date}`, [...(byDay.get(`${mate}|${date}`) || []), e]); continue; }
      // … erster Arbeitstag mit Platz (≤ 9 h), vorwärts; nach dem Austritt oder ab dieser Woche rückwärts
      const cands = [];
      for (let i = 1; i <= 40 && cands.length < 15; i++) {
        const d = plusDays(date, back ? -i : i);
        if (!back && d >= thisWeek) break;
        if (workday(emp, d)) cands.push(d);
      }
      if (!cands.length) for (let i = 1; i <= 40 && cands.length < 15; i++) { const d = plusDays(date, -i); if (workday(emp, d)) cands.push(d); }
      const load = d => (byDay.get(`${emp}|${d}`) || []).reduce((s2, x) => s2 + x.minutes, 0);
      const d = cands.find(c => load(c) + e.minutes <= 540) || cands.sort((a, b2) => load(a) - load(b2))[0];
      e.date = d;
      byDay.set(`${emp}|${d}`, [...(byDay.get(`${emp}|${d}`) || []), e]);
    }
  }
  // Tage über 9.5 h: überzählige Einträge auf den Wochentag mit der kleinsten Last verschieben
  for (const [k, list] of [...byDay]) {
    const [emp, date] = k.split("|");
    let total = list.reduce((s, e) => s + e.minutes, 0);
    while (total > 570 && list.length > 1) {
      const e = list.pop(); total -= e.minutes;
      const monday = new Date(`${date}T00:00:00`); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const days = [0, 1, 2, 3, 4].map(i => { const d = new Date(monday); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
      const load = d => (byDay.get(`${emp}|${d}`) || []).reduce((s, x) => s + x.minutes, 0);
      const target = days.filter(d => d !== date && (d < yearStart || workday(emp, d))).sort((a, b) => load(a) - load(b))[0] || date;
      if (target === date) { list.push(e); total += e.minutes; break; }
      e.date = target;
      if (!byDay.has(`${emp}|${target}`)) byDay.set(`${emp}|${target}`, []);
      byDay.get(`${emp}|${target}`).push(e);
    }
  }
  // Interne Zeit bis zum Soll, ab Jahresbeginn (frühere Jahre: Saldo-Übertrag per Stichtag)
  const filler = [];
  let f = 0;
  for (const emp of Object.keys(DAY_SOLL)) {
    for (let w = -60; w < 0; w++) for (let day = 0; day < 5; day++) {
      const date = dateAt(w, day);
      if (date < yearStart || (emp === E_SARA && date > SARA_END) || (STICHTAG[emp] && date < STICHTAG[emp])) continue;
      const soll = sollAm(emp, date);
      if (soll === 0) continue;
      const k = `${emp}|${date}`;
      const booked = (byDay.get(k) || []).reduce((s, e) => s + e.minutes, 0);
      const target = Math.round((soll * 60 + [0, 15, -15, 30, 0][(((day + w + emp.length) % 5) + 5) % 5]) / 15) * 15;
      if (target - booked < 30) continue;
      const e = te(date, emp, "", "", "08:00", target - booked, INTERN_DESC[f++ % INTERN_DESC.length]);
      filler.push(e);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
  }
  // Uhrzeiten: ab 08:00 der Reihe nach, Mittag 12:00–13:00 frei
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  for (const list of byDay.values()) {
    let t = 8 * 60;
    for (const e of list) {
      if (t < 12 * 60 && t + e.minutes > 12 * 60 && e.minutes <= 240) t = 13 * 60;   // nicht über Mittag
      else if (t >= 12 * 60 && t < 13 * 60) t = 13 * 60;
      e.startTime = hm(t); t += e.minutes; e.endTime = hm(t);
      e.createdAt = new Date(`${e.date}T${e.startTime}:00`).toISOString();
    }
  }
  return [...entries, ...filler];
}

const timeEntries = layoutDays([...limHistorical, ...limCurrent, ...hardHistorical, ...rebHistorical, ...rebCurrent, ...wieEntries, ...letziEntries, ...binzEntries, ...zollEntries]);

// ── Honorare ──────────────────────────────────────────────────────────────
const SIA_HOURS = 1197.1;
const SIA_SUB = round2(SIA_HOURS * rateLim);          // 185'550.50
const HARD_SUB = 96000;                                // Pauschalhonorar Hardau

/** Belegnummer JJJJ-NNN aus dem tatsächlichen Belegdatum. */
function docNo(weeks, seq, prefix = "") {
  return `${prefix}${dateAt(weeks, 2).slice(0, 4)}-${String(seq).padStart(3, "0")}`;
}

function invoice({ invId, seq, weeks, clientId, projectId, kind, amount, desc, status, quoteId }) {
  const tax = round2(amount * mwstRate / 100);
  return {
    id: invId, number: docNo(weeks, seq), date: dateAt(weeks, 2), dueDate: dateAt(weeks + 4, 2),
    clientId, projectId, quoteId, invoiceKind: kind,
    items: [{ id: id("it"), desc, qty: 1, price: amount, discount: 0 }],
    mwst: true, mwstRate, notes: "Zahlbar innert 30 Tagen netto.", status,
    sub: amount, tax, total: round2(amount + tax), subAfterDisc: amount, globalDisc: 0,
  };
}
function hourInvoice({ invId, seq, weeks, clientId, projectId, qty, rate, desc, status }) {
  const sub = round2(qty * rate), tax = round2(sub * mwstRate / 100);
  return {
    id: invId, number: docNo(weeks, seq), date: dateAt(weeks, 2), dueDate: dateAt(weeks + 4, 2),
    clientId, projectId, invoiceKind: "teilrechnung",
    items: [{ id: id("it"), desc, qty, price: rate, discount: 0 }],
    mwst: true, mwstRate, notes: "Zahlbar innert 30 Tagen netto.", status,
    sub, tax, total: round2(sub + tax), subAfterDisc: sub, globalDisc: 0,
  };
}

const SIA_PHASES_ALL = [
  { id: "31", label: "Vorprojekt", items: [
    { label: "Lösungsstudien / Grobschätzung", pct: 3, enabled: true, r: 1 },
    { label: "Vorprojekt / Kostenschätzung", pct: 6, enabled: true, r: 1 }]},
  { id: "32", label: "Bauprojekt", items: [
    { label: "Bauprojekt", pct: 13, enabled: true, r: 1 },
    { label: "Detailstudien", pct: 4, enabled: true, r: 1 },
    { label: "Kostenvoranschlag", pct: 4, enabled: true, r: 1 }]},
  { id: "33", label: "Bewilligungsverfahren", items: [
    { label: "Bewilligungsverfahren", pct: 2.5, enabled: true, r: 1 }]},
  { id: "41", label: "Ausschreibung", items: [
    { label: "Ausschreibungspläne", pct: 10, enabled: true, r: 1 },
    { label: "Ausschreibung / Offertvergleich", pct: 8, enabled: true, r: 1 }]},
  { id: "51", label: "Ausführungsplanung", items: [
    { label: "Ausführungspläne", pct: 15, enabled: true, r: 1 },
    { label: "Werkverträge", pct: 1, enabled: true, r: 1 }]},
  { id: "52", label: "Ausführung", items: [
    { label: "Gestalterische Leitung", pct: 6, enabled: true, r: 1 },
    { label: "Bauleitung / Kostenkontrolle", pct: 23, enabled: true, r: 1 }]},
  { id: "53", label: "Inbetriebnahme / Abschluss", items: [
    { label: "Inbetriebnahme", pct: 1, enabled: true, r: 1 },
    { label: "Dokumentation", pct: 1, enabled: true, r: 1 },
    { label: "Garantiearbeiten", pct: 1.5, enabled: true, r: 1 },
    { label: "Schlussabrechnung", pct: 1, enabled: true, r: 1 }]},
];

const QUOTE_ROLES = [
  { id: "PL", label: "Projektleiter/in", rate: 165 },
  { id: "BL", label: "Bauleiter/in", rate: 155 },
  { id: "TS", label: "Technischer Support", rate: 130 },
  { id: "AS", label: "Administrativer Support", rate: 120 },
];

// Offerte nach Aufwand: Stunden je Rolle × Ansatz
const AUFWAND_ROWS = { PL: 80, BL: 60, TS: 150, AS: 30 };
const AUFWAND_SUB = QUOTE_ROLES.reduce((s, r) => s + (AUFWAND_ROWS[r.id] || 0) * r.rate, 0); // 45'600
const FREI_ITEMS = [
  { id: id("fi"), desc: "Machbarkeitsstudie Arealentwicklung, Grundlagenanalyse", qty: 1, price: 8500 },
  { id: id("fi"), desc: "Volumenstudie mit drei Varianten inkl. Modell", qty: 1, price: 7200 },
  { id: id("fi"), desc: "Bericht und Präsentation vor Behörde", qty: 1, price: 2800 },
];
const FREI_SUB = FREI_ITEMS.reduce((s, i) => s + i.qty * i.price, 0); // 18'500

function quoteTotals(sub) {
  const tax = round2(sub * mwstRate / 100);
  return { sub, tax, total: round2(sub + tax) };
}

/**
 * Rechnungsnummern JJJJ-NNN fortlaufend nach Datum (≈ 40 Rechnungen im Jahr), weil die Demo relativ zu
 * heute datiert ist. Hardau behält seine Nummern (die Schlussrechnung nennt sie im Text).
 */
const numberUsed = new Set(), numberLast = {};
const numberByDate = (inv) => {
  if ([INV_HARD_1, INV_HARD_2, INV_HARD_S].includes(inv.id)) return inv;
  const y = inv.date.slice(0, 4);
  const dayOfYear = (Date.parse(`${inv.date}T00:00:00Z`) - Date.parse(`${y}-01-01T00:00:00Z`)) / 86400000;
  let seq = Math.max((numberLast[y] || 0) + 1, Math.round(dayOfYear / 365 * 40) + 1);
  while (numberUsed.has(`${y}-${seq}`) || ["2024-41", "2024-90", "2024-112", "2025-112"].includes(`${y}-${seq}`)) seq++;
  numberUsed.add(`${y}-${seq}`); numberLast[y] = seq;
  return { ...inv, number: `${y}-${String(seq).padStart(3, "0")}` };
};

/** Bezahlte Rechnungen bekommen ein Zahldatum (wie die App es seit dem CRM-Update setzt). */
const withPaidDate = (inv, i) => {
  if (inv.status !== "bezahlt") return inv;
  const d = new Date(inv.date + "T00:00:00");
  d.setDate(d.getDate() + 21 + (i * 5) % 14);
  return { ...inv, paidDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
};

export const demoData = {
  settings: {
    setupCompleted: true,
    name: "Amrein Partner Architektur AG",
    address: "Konradstrasse 12\n8005 Zürich",
    street: "Konradstrasse 12", zip: "8005", city: "Zürich", country: "CH",
    email: "info@amrein-partner.example", phone: "+41 00 000 12 34",
    iban: "CH4431999123000889012", ibanType: "qr",
    mwst: "CHE-123.456.789 MWST", mwstRate,
    defaultHourlyRate: 155, autoPrint: false, logoSize: 60,
    expenseCategories: ["Reise / Fahrt", "Drucken / Reprografie", "Modellbau / Material", "Büromaterial", "Weiterbildung", "Unterauftrag / Freelancer", "Verpflegung / Geschäftsessen", "Sonstiges"],
    internalExpenseCategories: ["Miete / Raumkosten", "Software / Lizenzen", "Hardware / IT", "Telefon / Internet", "Versicherung", "Steuern / Abgaben", "Büromaterial", "Marketing / Werbung", "Weiterbildung", "Unterauftrag / Freelancer", "Bankgebühren", "Sonstiges"],
    projectNumberFormat: "YYYY/NN", invoiceNumberFormat: "YYYY-NNN",
    vertragNumberFormat: "V-YYYY-NNN", protokollNumberFormat: "YYYY-TT-NN",
    protokollTypeAbbreviations: { "Bausitzung": "BS", "Planungssitzung": "PS", "Baubesprechung": "BB", "Jour fixe": "JF", "Interne Sitzung": "IS", "Kundensitzung": "KS", "Abnahme": "AB", "Sonstiges": "SO" },
    pdfNameFormat: "{studio}_{typ}_{nummer}", qrNewPage: false,
    pageMarginTop: 20, pageMarginBottom: 20, pageMarginLeft: 20, pageMarginRight: 20,
    defaultWochenstunden: 41, defaultFerienWochen: 5, closedMonths: [], blockMaiTag: true,
    roles: QUOTE_ROLES,
  },
  persons: [
    { id: CL_LIM, name: "Pensionskasse Limmatfeld", type: "", street: "Bahnhofstrasse 22", zip: "8001", city: "Zürich", country: "CH",
      email: "immobilien@pk-limmatfeld.example", phone: "+41 00 000 60 00", website: "", note: "",
      contacts: [{ id: id("c"), name: "Corinne Egli", position: "Leiterin Immobilien", phone: "+41 00 000 09 55", email: "c.egli@pk-limmatfeld.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer",
      source: "Empfehlung Partner", referredById: CL_ING, tags: ["Weihnachtskarte"] },
    { id: CL_REB, name: "Baugenossenschaft Rebweg", type: "", street: "Rebbergstrasse 44", zip: "8037", city: "Zürich", country: "CH",
      email: "verwaltung@bg-rebweg.example", phone: "+41 00 000 88 40", website: "", note: "",
      contacts: [{ id: id("c"), name: "Thomas Bühler", position: "Präsident", phone: "+41 00 000 44 12", email: "t.buehler@bg-rebweg.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer",
      source: "Wiederkehrender Kunde", tags: ["Weihnachtskarte", "Stammkunde"] },
    { id: CL_HARD, name: "Stadt Zürich, Amt für Hochbauten", type: "", street: "Amtshaus III", zip: "8021", city: "Zürich", country: "CH",
      email: "hochbau@zuerich.example", phone: "+41 00 000 20 00", website: "", note: "",
      contacts: [{ id: id("c"), name: "Andrea Frei", position: "Projektleiterin", phone: "+41 00 000 11 92", email: "a.frei@zuerich.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "oeffentlich",
      source: "Wettbewerb" },
    { id: CL_ING, name: "Meier + Steiner Bauingenieure AG", type: "Tragwerksplaner", street: "Industriestrasse 9", zip: "8304", city: "Wallisellen", country: "CH",
      email: "info@meiersteiner.example", phone: "+41 00 000 15 20", website: "meiersteiner.example", note: "",
      contacts: [{ id: id("c"), name: "Reto Steiner", position: "Projektleiter", phone: "+41 00 000 22 18", email: "r.steiner@meiersteiner.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer", tags: ["Weihnachtskarte"] },
    { id: CL_KELLER, name: "Familie Keller", type: "", street: "Seestrasse 118", zip: "8700", city: "Küsnacht", country: "CH",
      email: "keller@privat.example", phone: "+41 00 000 01 22", website: "", note: "",
      contacts: [{ id: id("c"), name: "Markus Keller", position: "", phone: "+41 00 000 01 22", email: "keller@privat.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "person", source: "Empfehlung Kunde", referredById: CL_LIM },
    { id: CL_HAAS, name: "Praxisgemeinschaft Dr. Haas", type: "", street: "Seefeldstrasse 61", zip: "8008", city: "Zürich", country: "CH",
      email: "praxis@haas.example", phone: "+41 00 000 14 14", website: "", note: "",
      contacts: [{ id: id("c"), name: "Dr. Sabine Haas", position: "Praxisinhaberin", phone: "+41 00 000 14 14", email: "praxis@haas.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer", source: "Website" },
    { id: CL_SIHL, name: "Sihltal Immobilien AG", type: "", street: "Manessestrasse 85", zip: "8045", city: "Zürich", country: "CH",
      email: "bau@sihltal-immo.example", phone: "+41 00 000 31 70", website: "sihltal-immo.example", note: "",
      contacts: [{ id: id("c"), name: "Daniel Frick", position: "Leiter Bau", phone: "+41 00 000 31 72", email: "d.frick@sihltal-immo.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer", source: "Wiederkehrender Kunde", tags: ["Weihnachtskarte"] },
    { id: CL_ZOLL, name: "Andreas und Claudia Wyss", type: "", street: "Rietstrasse 7", zip: "8702", city: "Zollikon", country: "CH",
      email: "wyss@privat.example", phone: "+41 00 000 52 30", website: "", note: "",
      contacts: [{ id: id("c"), name: "Claudia Wyss", position: "", phone: "+41 00 000 52 30", email: "wyss@privat.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "person", source: "Empfehlung Kunde", referredById: CL_KELLER },
    { id: CL_BINZ, name: "Gewerbehaus Binz AG", type: "", street: "Binzstrasse 23", zip: "8045", city: "Zürich", country: "CH",
      email: "verwaltung@binz-gewerbe.example", phone: "+41 00 000 46 10", website: "", note: "",
      contacts: [{ id: id("c"), name: "Monika Arnold", position: "Bewirtschafterin", phone: "+41 00 000 46 11", email: "m.arnold@binz-gewerbe.example" }],
      honorarOffers: [], isAuftraggeber: true, isPartner: true, category: "unternehmer", source: "Empfehlung Partner", referredById: CL_ING },
  ],
  // Drei Offerten in drei Modi — die Liste zeigt SIA 102 / Aufwand / Freie Positionen
  quotes: [
    { id: Q_LIM, number: docNo(-78, 4, "O"), clientId: CL_LIM, projectId: P_LIM,
      projectName: "Sanierung Verwaltungsgebäude Limmatfeld",
      date: dateAt(-78, 1), validUntil: dateAt(-70, 1),
      mode: "sia", status: "angenommen", mwst: true,
      notes: "Honorar nach SIA 102, Baukostenanteil gemäss Kostenschätzung.",
      sia: { baukosten: 650000, schwierigkeit: 1, stundenansatz: rateLim, phases: SIA_PHASES_ALL },
      quoteRoles: QUOTE_ROLES, manualPhases: [], freeItems: [],
      ...quoteTotals(SIA_SUB) },
    { id: Q_AUFWAND, number: docNo(-5, 11, "O"), clientId: CL_REB, projectId: "",
      projectName: "Umbau Ladenlokal Rebbergstrasse",
      date: dateAt(-5, 1), validUntil: dateAt(4, 1),
      mode: "manual", status: "gesendet", mwst: true,
      notes: "Aufwandschätzung nach Rollen, Abrechnung nach effektivem Aufwand.",
      manualPhases: [{ id: "32", label: "Bauprojekt", enabled: true, hoursByRole: AUFWAND_ROWS }],
      quoteRoles: QUOTE_ROLES, sia: null, freeItems: [],
      ...quoteTotals(AUFWAND_SUB) },
    { id: Q_FREI, number: docNo(-2, 15, "O"), clientId: CL_HARD, projectId: "",
      projectName: "Machbarkeitsstudie Areal Sihlfeld",
      date: dateAt(-2, 3), validUntil: dateAt(7, 3),
      mode: "free", status: "gesendet", mwst: true,
      notes: "Pauschalpositionen gemäss Besprechung.",
      freeItems: FREI_ITEMS, quoteRoles: QUOTE_ROLES, sia: null, manualPhases: [],
      ...quoteTotals(FREI_SUB) },
  ],
  projects: [
    { id: P_LIM, number: "2025/12", name: "Sanierung Verwaltungsgebäude Limmatfeld", clientId: CL_LIM,
      // SIA-/Pauschalhonorar: die App führt solche Projekte als Kostenkontrolle.
      category: "Direktauftrag", billingType: "pauschal", hourlyRate: rateLim,
      budget: SIA_SUB, budgetHours: 1197, status: "aktiv",
      description: "Energetische Fassadensanierung und Erneuerung der Fenster, bewohnter Betrieb.",
      startDate: dateAt(-76), enabledPhases: ["31", "32", "33", "41", "51", "52", "53"],
      linkedQuotes: [{ quoteId: Q_LIM, role: "Hauptofferte" }],
      positions: [], customPhases: [],
      projectContacts: [{ contactId: CL_ING, role: "Tragwerksplaner" }],
      internalMembers: [E_JULIAN, E_LAURA] },
    { id: P_REB, number: "2026/07", name: "Wohnüberbauung Rebweg", clientId: CL_REB,
      category: "Direktauftrag", billingType: "stundensatz", hourlyRate: rateReb,
      budget: 0, budgetHours: 2545, status: "aktiv",
      description: "Neubau von 24 Genossenschaftswohnungen mit gemeinschaftlicher Tiefgarage.",
      startDate: dateAt(-22), enabledPhases: ["31", "32", "33"],
      phasesBudget: [{ id: "31", hours: 229 }, { id: "32", hours: 534 }, { id: "33", hours: 64 }],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [E_LAURA, E_NINA] },
    { id: P_HARD, number: "2024/03", name: "Erweiterung Doppelkindergarten Hardau", clientId: CL_HARD,
      category: "Direktauftrag", billingType: "pauschal", hourlyRate: rateLim,
      budget: HARD_SUB, budgetHours: 610, status: "abgeschlossen",
      description: "Erweiterungsbau mit zwei zusätzlichen Gruppenräumen, abgeschlossen.",
      startDate: dateAt(-152), enabledPhases: ["31", "32", "33", "41", "51", "52", "53"],
      phasesBudget: [{ id: "31", hours: 55 }, { id: "32", hours: 128 }, { id: "33", hours: 15 },
                     { id: "41", hours: 110 }, { id: "51", hours: 98 }, { id: "52", hours: 177 }, { id: "53", hours: 27 }],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [E_LAURA, E_JULIAN] },
    { id: P_WIE, number: `${dateAt(-46).slice(0, 4)}/04`, name: "Neubau Mehrfamilienhaus Wiedikon", clientId: CL_SIHL,
      category: "Direktauftrag", billingType: "pauschal", hourlyRate: rateLim,
      budget: WIE_SUB, budgetHours: 2650, status: "aktiv",
      description: "Ersatzneubau mit 18 Mietwohnungen und Gewerbe im Erdgeschoss.",
      startDate: dateAt(-48), enabledPhases: ["31", "32", "33", "41", "51", "52", "53"],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [{ contactId: CL_ING, role: "Tragwerksplaner" }], internalMembers: [E_MARC, E_SARA] },
    { id: P_LETZI, number: `${dateAt(-44).slice(0, 4)}/05`, name: "Gesamtsanierung Schulhaus Letzi", clientId: CL_HARD,
      category: "Wettbewerb", billingType: "pauschal", hourlyRate: rateLim,
      budget: LETZI_SUB, budgetHours: 2300, status: "aktiv",
      description: "Sanierung und Erdbebenertüchtigung im laufenden Schulbetrieb, drei Etappen.",
      startDate: dateAt(-45), enabledPhases: ["31", "32", "33", "41", "51", "52", "53"],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [E_PETER, E_JULIAN] },
    { id: P_ZOLL, number: `${dateAt(-50).slice(0, 4)}/09`, name: "Umbau und Erweiterung Villa Zollikon", clientId: CL_ZOLL,
      category: "Direktauftrag", billingType: "pauschal", hourlyRate: rateLim,
      budget: ZOLL_SUB, budgetHours: 1350, status: "aktiv",
      description: "Sanierung Villa von 1932 mit Anbau in Holzbauweise, Ausführung läuft.",
      startDate: dateAt(-70), enabledPhases: ["51", "52", "53"],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [E_JULIAN, E_MARC] },
    { id: P_BINZ, number: `${dateAt(-47).slice(0, 4)}/02`, name: "Umbau Gewerbehaus Binz", clientId: CL_BINZ,
      category: "Direktauftrag", billingType: "stundensatz", hourlyRate: rateBinz,
      budget: 0, budgetHours: 900, status: "aktiv",
      description: "Mieterausbauten in drei Etappen, Abrechnung nach Aufwand.",
      startDate: dateAt(-47), enabledPhases: ["51", "52"],
      linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [E_NINA, E_LAURA] },
  ],
  timeEntries,
  invoices: [
    // Limmatfeld — laufend: zwei bezahlte Akonti nach Phasenanteil
    invoice({ invId: INV_LIM_1, seq: 118, weeks: -48, clientId: CL_LIM, projectId: P_LIM,
      kind: "akonto", amount: round2(SIA_SUB * 0.325), status: "bezahlt", quoteId: Q_LIM,
      desc: "Akontorechnung 32.5 % – Vorprojekt bis Bewilligungsverfahren (Phasen 31–33)" }),
    invoice({ invId: INV_LIM_2, seq: 6, weeks: -24, clientId: CL_LIM, projectId: P_LIM,
      kind: "akonto", amount: round2(SIA_SUB * 0.34), status: "bezahlt", quoteId: Q_LIM,
      desc: "Akontorechnung 34 % – Ausschreibung und Ausführungsplanung (Phasen 41–51)" }),
    // Hardau — abgeschlossen: zwei Akonti + Schlussrechnung (Rest des Honorars)
    invoice({ invId: INV_HARD_1, seq: 41, weeks: -140, clientId: CL_HARD, projectId: P_HARD,
      kind: "akonto", amount: round2(HARD_SUB * 0.30), status: "bezahlt",
      desc: "Akontorechnung 30 % – Vorprojekt und Bauprojekt" }),
    invoice({ invId: INV_HARD_2, seq: 90, weeks: -120, clientId: CL_HARD, projectId: P_HARD,
      kind: "akonto", amount: round2(HARD_SUB * 0.40), status: "bezahlt",
      desc: "Akontorechnung 40 % – Ausschreibung und Ausführung" }),
    invoice({ invId: INV_HARD_S, seq: 112, weeks: -97, clientId: CL_HARD, projectId: P_HARD,
      kind: "schluss", amount: round2(HARD_SUB * 0.30), status: "bezahlt",
      desc: "Schlussrechnung – Gesamthonorar CHF 96'000.00 abzüglich Akonto 2024-041 und 2024-090" }),
    // Rebweg — Stundensatz: unverrechnete Stunden werden direkt fakturiert
    hourInvoice({ invId: INV_REB, seq: 14, weeks: -3, clientId: CL_REB, projectId: P_REB,
      qty: rebBilledH, rate: rateReb, status: "gesendet",
      desc: "Teilrechnung – Architekturleistungen Vorprojekt bis Baubewilligung" }),
    // Wiedikon — Akonto nach Leistungsstand, etwa alle 6 Wochen 7 % des Pauschalhonorars
    ...[-44, -38, -32, -26, -20, -14, -8, -2].map((weeks, i) => invoice({ invId: id("inv"), seq: 20 + i * 9, weeks, clientId: CL_SIHL, projectId: P_WIE,
      kind: "akonto", amount: round2(WIE_SUB * 0.07), status: weeks > -6 ? "gesendet" : "bezahlt",
      desc: `Akontorechnung ${i + 1} – 7 % des Pauschalhonorars (Leistungsstand ${i < 4 ? "Bauprojekt" : "Ausschreibung"})` })),
    // Letzi — Akonto nach Phasenabschluss
    invoice({ invId: id("inv"), seq: 31, weeks: -32, clientId: CL_HARD, projectId: P_LETZI, kind: "akonto",
      amount: round2(LETZI_SUB * 0.09), status: "bezahlt", desc: "Akontorechnung 9 % – Vorprojekt (Phase 31)" }),
    ...[-24, -16, -8, -1].map((weeks, i) => invoice({ invId: id("inv"), seq: 52 + i * 11, weeks, clientId: CL_HARD, projectId: P_LETZI,
      kind: "akonto", amount: round2(LETZI_SUB * 0.08), status: weeks > -4 ? "gesendet" : "bezahlt",
      desc: `Akontorechnung ${i + 2} – 8 % Bauprojekt nach Leistungsstand` })),
    // Binz — quartalsweise nach Aufwand
    ...[[1, -34], [2, -21], [3, -8]].map(([q, weeks]) => hourInvoice({ invId: INV_BINZ[q - 1], seq: 24 + q * 13, weeks, clientId: CL_BINZ, projectId: P_BINZ,
      qty: binzH(q), rate: rateBinz, status: weeks > -6 ? "gesendet" : "bezahlt",
      desc: `Architekturleistungen Mieterausbau, Etappe ${q} (nach Aufwand)` })),
    // Zollikon — Akonto nach Baufortschritt
    ...[-40, -30, -20, -11, -2].map((weeks, i) => invoice({ invId: id("inv"), seq: 1, weeks, clientId: CL_ZOLL, projectId: P_ZOLL,
      kind: "akonto", amount: round2(ZOLL_SUB * 0.14), status: weeks > -6 ? "gesendet" : "bezahlt",
      desc: `Akontorechnung ${i + 1} – 14 % des Pauschalhonorars nach Baufortschritt` })),
    // Kleinmandate: Gutachten und Bauberatung
    invoice({ invId: id("inv"), seq: 47, weeks: -29, clientId: CL_KELLER, projectId: "", kind: "voll", amount: 6800, status: "bezahlt",
      desc: "Zustandsgutachten Wohnhaus Seestrasse, inkl. Begehung und Bericht" }),
    invoice({ invId: id("inv"), seq: 88, weeks: -15, clientId: CL_HAAS, projectId: "", kind: "voll", amount: 9400, status: "bezahlt",
      desc: "Bauberatung Mietvertrag und Ausbauvarianten Praxisräume" }),
  ].sort((a, b) => a.date.localeCompare(b.date)).map(numberByDate).map(withPaidDate),
  contracts: [], deliveryNotes: [],
  // Spesen und Büroausgaben, damit die Buchhaltung (Vorsteuer, Jahresergebnis, Budget-Fixkosten) etwas zeigt
  expenses: [
    { id: "exp-1", date: dateAt(-1, 1), category: "Reise / Fahrt", projectId: P_LIM, employeeId: E_JULIAN, description: "Bahn Zürich–Limmatfeld, Bausitzung", amount: 18.4, mwstRate: 8.1, inclMwst: true, status: "offen" },
    { id: "exp-2", date: dateAt(-2, 3), category: "Drucken / Reprografie", projectId: P_LIM, employeeId: E_JULIAN, description: "Plotts Ausführungspläne A0 (12 Stk.)", amount: 186.0, mwstRate: 8.1, inclMwst: true, status: "genehmigt" },
    { id: "exp-3", date: dateAt(-3, 2), category: "Modellbau / Material", projectId: P_REB, employeeId: E_NINA, description: "Karton und Plexi für Arbeitsmodell 1:200", amount: 74.9, mwstRate: 8.1, inclMwst: true, status: "ausbezahlt" },
    { id: "exp-4", date: dateAt(-5, 0), category: "Verpflegung / Geschäftsessen", projectId: P_REB, employeeId: E_LAURA, description: "Mittagessen mit Bauherrschaft", amount: 132.5, mwstRate: 8.1, inclMwst: true, status: "ausbezahlt" },
    { id: "exp-5", date: dateAt(-8, 4), category: "Weiterbildung", employeeId: E_LAURA, description: "Kurs SIA 118 (Werkvertrag)", amount: 420.0, mwstRate: 8.1, inclMwst: true, status: "ausbezahlt" },
  ],
  internalExpenses: [
    { id: "iex-1", date: dateAt(-46, 0), category: "Miete / Raumkosten", description: "Büromiete Konradstrasse", amount: 3800, mwstRate: 0, inclMwst: true, recurring: true, recurringInterval: "monatlich" },
    { id: "iex-2", date: dateAt(-44, 0), category: "Software / Lizenzen", description: "CAD-Lizenzen (3 Plätze)", amount: 7920, mwstRate: 8.1, inclMwst: true, recurring: true, recurringInterval: "jährlich" },
    { id: "iex-3", date: dateAt(-40, 0), category: "Telefon / Internet", description: "Glasfaser und Mobile", amount: 189, mwstRate: 8.1, inclMwst: true, recurring: true, recurringInterval: "monatlich" },
    { id: "iex-4", date: dateAt(-30, 2), category: "Versicherung", description: "Berufshaftpflicht", amount: 2650, mwstRate: 0, inclMwst: true, recurring: true, recurringInterval: "jährlich" },
    { id: "iex-5", date: dateAt(-6, 1), category: "Hardware / IT", description: "Monitor 32\" für Arbeitsplatz Laura", amount: 649, mwstRate: 8.1, inclMwst: true },
    { id: "iex-6", date: dateAt(-2, 4), category: "Büromaterial", description: "Skizzenrollen, Stifte, Ordner", amount: 86.3, mwstRate: 8.1, inclMwst: true },
  ],
  // Zwei Sitzungen, damit die Protokoll-Ansicht (Liste, Detail, Druck) etwas zeigt
  protocols: [
    { id: "proto-bs3", title: "Bausitzung 3", type: "Bausitzung", date: dateAt(-1, 2), time: "09:00", endTime: "10:30", location: "Baustelle Limmatfeld, Container",
      projectId: P_LIM, nummer: `${new Date().getFullYear()}-BS-03`, nextDate: dateAt(1, 2),
      verteiler: "Pensionskasse Limmatfeld, Meier + Steiner Bauingenieure AG, Bauleitung",
      approval: "stillschweigend", approvalHours: 48,
      participants: [
        { id: "pp1", name: "Julian Roth", role: "Bauleiter", source: "intern", status: "anwesend" },
        { id: "pp2", name: "Laura Meier", role: "Architektin", source: "intern", status: "anwesend" },
        { id: "pp3", name: "Corinne Egli", role: "Bauherrschaft", source: "extern", status: "anwesend" },
        { id: "pp4", name: "Reto Steiner", role: "Tragwerksplaner", source: "extern", status: "entschuldigt" },
      ],
      traktanden: [
        { id: "t1", nr: "1", title: "Terminprogramm", items: [
          { id: "e1", type: "info", text: "<p>Rohbau Attika liegt <b>zwei Tage</b> hinter dem Plan. Gerüstabbau Südfassade ist für KW 44 bestellt.</p>" },
          { id: "e2", type: "beschluss", text: "<p>Der Schlusstermin <b>Fassade</b> wird auf KW 47 verschoben, Übergabe an die Mieter bleibt unverändert.</p>", date: dateAt(-1, 2) },
        ]},
        { id: "t2", nr: "2", title: "Anschlussdetails Attika", items: [
          { id: "e3", type: "info", text: "<p>Detail A-07 (Attikaanschluss) wurde mit dem Spengler besprochen, Musterfläche ist abgenommen.</p>" },
          { id: "e4", type: "aufgabe", text: "<p>Statische Bestätigung für die Attikaverstärkung nachreichen.</p>", responsible: "Meier + Steiner", dueDateType: "datum", dueDate: dateAt(0, 3), status: "in Arbeit" },
          { id: "e5", type: "aufgabe", text: "<p>Bemusterung Fensterbänke vorbereiten und Muster bestellen.</p>", responsible: "Laura Meier", dueDateType: "kw", dueKW: 45, dueYear: new Date().getFullYear(), status: "offen" },
        ]},
        { id: "t3", nr: "3", title: "Nachträge und Kosten", items: [
          { id: "e6", type: "info", text: "<p>Nachtrag Brandschutzanstrich liegt vor (CHF 6'800), Prüfung durch Bauleitung läuft.</p>" },
          { id: "e7", type: "aufgabe", text: "<p>Nachtragsofferte prüfen und Stellungnahme an die Bauherrschaft senden.</p>", responsible: "Julian Roth", dueDateType: "datum", dueDate: dateAt(0, -2), status: "offen" },
        ]},
      ] },
    { id: "proto-ks1", title: "Kundensitzung Rebweg", type: "Kundensitzung", date: dateAt(-3, 1), time: "17:30", endTime: "18:45", location: "Genossenschaftslokal Rebweg",
      projectId: P_REB, nummer: `${new Date().getFullYear()}-KS-01`, verteiler: "Vorstand Baugenossenschaft Rebweg",
      participants: [
        { id: "pp5", name: "Laura Meier", role: "Architektin", source: "intern", status: "anwesend" },
        { id: "pp6", name: "Thomas Bühler", role: "Präsident", source: "extern", status: "anwesend" },
      ],
      traktanden: [
        { id: "t4", nr: "1", title: "Raumprogramm", items: [
          { id: "e8", type: "beschluss", text: "<p>Zusätzlicher Gemeinschaftsraum im Erdgeschoss wird ins Vorprojekt aufgenommen.</p>", date: dateAt(-3, 1) },
          { id: "e9", type: "aufgabe", text: "<p>Variantenstudie Erdgeschoss bis zur nächsten Sitzung.</p>", responsible: "Laura Meier", dueDateType: "kw", dueKW: 46, dueYear: new Date().getFullYear(), status: "offen" },
        ]},
      ] },
  ],
  employees: [
    { id: E_JULIAN, saldoStichtag: `${MONDAY.getFullYear()}-01-01`, saldoUebertragStunden: 14.5, name: "Julian Roth", role: "Bauleiter", pensum: 100, monatslohn: 8200, wochenstunden: 41, ferienWochen: 5, personalNr: "101", geburtsdatum: "1990-04-18", eintrittsdatum: dateAt(-250), ferienUebertragVorjahr: {} },
    { id: E_LAURA, pensumVerlauf: PENSUM_VERLAUF[E_LAURA], saldoStichtag: `${MONDAY.getFullYear()}-01-01`, saldoUebertragStunden: -6, name: "Laura Meier", role: "Architektin", pensum: 100, monatslohn: 7600, wochenstunden: 41, ferienWochen: 5, personalNr: "102", geburtsdatum: "1984-09-03", eintrittsdatum: dateAt(-380), ferienUebertragVorjahr: {} },
    { id: E_NINA, pensumVerlauf: PENSUM_VERLAUF[E_NINA], saldoStichtag: `${MONDAY.getFullYear()}-01-01`, saldoUebertragStunden: 3.5, name: "Nina Baumgartner", role: "Praktikantin", pensum: 80, monatslohn: 3800, wochenstunden: 41, ferienWochen: 5, personalNr: "103", geburtsdatum: "2000-02-11", eintrittsdatum: dateAt(-58), ferienUebertragVorjahr: {} },
    // Saldo-Übertrag per 1.1.: Überstunden aus der Zeit vor RAPPORT (frühere Jahre sind nicht erfasst)
    // Sonderfälle für Buchhaltung/Löhne (Nachrechnung in scripts/demo-check): Partner über dem ALV-Höchstlohn
    // mit 13. Monatslohn und PK laut Ausweis, Rentner mit Freibetrag, Austritt im laufenden Monat mit Familienzulagen
    { id: E_MARC, pensumVerlauf: PENSUM_VERLAUF[E_MARC], saldoStichtag: `${MONDAY.getFullYear()}-01-01`, saldoUebertragStunden: 42, name: "Marc Amrein", role: "Partner", pensum: 100, monatslohn: 14500, dreizehnterLohn: true, pkBeitragAN: 1180, pkBeitragAG: 1420, wochenstunden: 42, ferienWochen: 5, personalNr: "100", geburtsdatum: "1968-05-30", eintrittsdatum: "2010-01-01", ferienUebertragVorjahr: {} },
    { id: E_PETER, saldoStichtag: STICHTAG[E_PETER], saldoUebertragStunden: -4.5, name: "Peter Keller", role: "Kostenplaner", pensum: 40, monatslohn: 9000, wochenstunden: 42, ferienWochen: 5, personalNr: "104", geburtsdatum: "1958-03-12", eintrittsdatum: "2024-01-01", ferienUebertragVorjahr: {} },
    { id: E_SARA, pensumVerlauf: PENSUM_VERLAUF[E_SARA], saldoStichtag: `${MONDAY.getFullYear()}-01-01`, saldoUebertragStunden: 8, name: "Sara Weber", role: "Architektin", pensum: 90, monatslohn: 8400, familienzulagen: 215, wochenstunden: 42, ferienWochen: 5, personalNr: "105", geburtsdatum: "1991-06-02", eintrittsdatum: "2023-04-01", austrittsdatum: `${new Date().getFullYear()}-11-15`, ferienUebertragVorjahr: {} },
  ],
  feiertage: FEIERTAGE, absences: ABSENZEN, ferienEntries: FERIEN, absenzTypes: [],
  lohnEntries: [],
  // Marc: 20 Überstunden aus dem Vorjahr ausbezahlt (nach dem Stichtag → mindert den Saldo)
  uberstundenAbschluss: [{ id: "ua-1", empId: E_MARC, year: Y - 1, date: `${Y}-01-30`, type: "payout", hoursSettled: 20, zuschlagPercent: 25, stundenlohn: 80, auszahlungBetrag: 2000 }],
  dashboardTemplates: [
    { id: "tpl-admin", name: "Administrator", isPublic: true, layout: [
      { id: "dw-a1", cols: 4, minH: 0, widgets: ["kpi-projekte", "kpi-stunden", "kpi-ausstehend", "kpi-umsatz"] },
      { id: "dw-a2", cols: 1, minH: 0, widgets: ["warnungen"] },
      { id: "dw-a3", cols: 2, minH: 0, widgets: ["aktive-projekte", "unverrechnete-stunden"] },
      { id: "dw-a4", cols: 2, minH: 0, widgets: ["umsatz-sparkline", "offene-offerten"] },
      { id: "dw-a6", cols: 2, minH: 0, widgets: ["crm-wiedervorlagen", "crm-pipeline"] },
      { id: "dw-a5", cols: 1, minH: 0, widgets: ["letzte-zeiteintraege"] },
    ]},
  ],
  appRoles: [{ id: "r-admin", name: "Administrator", permissions: null, dashboardTemplateId: "tpl-admin" }],
  users: [{ id: "admin", username: "admin", password: "admin", role: "admin", displayName: "Administrator", appRoleId: "r-admin" }],
  blogPosts: [], letterTemplates: [],
  // CRM: Pipeline über alle Stufen, zwei Absagen, Herkunft/Empfehler gemischt
  leads: [
    { id: "lead-lim", title: "Sanierung Verwaltungsgebäude Limmatfeld", clientId: CL_LIM, stage: "gewonnen", source: "Empfehlung Partner", referrerId: CL_ING,
      estimatedValue: 185000, quoteId: Q_LIM, projectId: P_LIM, createdAt: dateAt(-84), closedAt: dateAt(-78) },
    { id: "lead-hard", title: "Erweiterung Doppelkindergarten Hardau", clientId: CL_HARD, stage: "gewonnen", source: "Wettbewerb",
      estimatedValue: 96000, projectId: P_HARD, createdAt: dateAt(-170), closedAt: dateAt(-160) },
    { id: "lead-reb", title: "Wohnüberbauung Rebweg", clientId: CL_REB, stage: "gewonnen", source: "Wiederkehrender Kunde",
      estimatedValue: 410000, projectId: P_REB, createdAt: dateAt(-34), closedAt: dateAt(-30) },
    { id: "lead-quartier", title: "Wettbewerb Quartierzentrum Altstetten", stage: "verloren", source: "Wettbewerb",
      estimatedValue: 150000, lostReason: "Anderes Büro gewählt", createdAt: dateAt(-20), closedAt: dateAt(-9) },
    { id: "lead-mfh", title: "MFH Altstetten, Aufstockung", clientId: CL_HAAS, stage: "verloren", source: "Empfehlung Partner", referrerId: CL_ING,
      estimatedValue: 60000, lostReason: "Honorar zu hoch", createdAt: dateAt(-16), closedAt: dateAt(-6) },
    { id: "lead-schul", title: "Schulhaus-Erweiterung Oberstrass", clientId: CL_HARD, stage: "verhandlung", source: "Wiederkehrender Kunde",
      estimatedValue: 240000, expectedDecision: dateAt(3), createdAt: dateAt(-8) },
    { id: "lead-efh", title: "Einfamilienhaus Küsnacht", clientId: CL_KELLER, stage: "offerte", source: "Empfehlung Kunde", referrerId: CL_LIM,
      estimatedValue: 38000, expectedDecision: dateAt(2), createdAt: dateAt(-5) },
    { id: "lead-praxis", title: "Umbau Arztpraxis Seefeld", clientId: CL_HAAS, stage: "besichtigung", source: "Website",
      estimatedValue: 22000, createdAt: dateAt(-2) },
    { id: "lead-dach", title: "Anfrage Dachausbau", stage: "anfrage", source: "Direktanfrage", estimatedValue: 12000, createdAt: dateAt(0, -2) },
  ],
  activities: [
    { id: "act-1", personId: CL_LIM, leadId: "lead-lim", type: "besichtigung", date: dateAt(-83), note: "Begehung Verwaltungsgebäude mit Frau Egli" },
    { id: "act-2", personId: CL_LIM, leadId: "lead-lim", type: "meeting", date: dateAt(-80), note: "Honorarbesprechung, Offerte nach SIA 102" },
    { id: "act-3", personId: CL_KELLER, leadId: "lead-efh", type: "besichtigung", date: dateAt(-5), note: "Besichtigung Grundstück, Wünsche aufgenommen" },
    { id: "act-4", personId: CL_KELLER, leadId: "lead-efh", type: "meeting", date: dateAt(-3), note: "Vorstellung erste Skizzen", followUpDate: dateAt(0, -1) },
    { id: "act-5", personId: CL_HARD, leadId: "lead-schul", type: "meeting", date: dateAt(-7), note: "Erstgespräch Schulhaus" },
    { id: "act-6", personId: CL_HARD, leadId: "lead-schul", type: "meeting", date: dateAt(-4), note: "Kostenrahmen und Termine", followUpDate: dateAt(1) },
    { id: "act-7", personId: CL_HAAS, leadId: "lead-praxis", type: "anruf", date: dateAt(-2), note: "Anfrage über Website, Termin vereinbart" },
    { id: "act-8", personId: CL_HAAS, leadId: "lead-praxis", type: "besichtigung", date: dateAt(0, -3), note: "Praxisräume angeschaut", followUpDate: dateAt(1, 1) },
    { id: "act-11", personId: CL_REB, leadId: "lead-reb", type: "meeting", date: dateAt(-33), note: "Besprechung Raumprogramm mit Vorstand" },
    { id: "act-12", personId: CL_REB, leadId: "lead-reb", type: "meeting", date: dateAt(-31), note: "Honorar und Terminplan" },
    { id: "act-9", personId: CL_REB, type: "karte", date: dateAt(-52), note: "Weihnachtskarte verschickt" },
    { id: "act-10", personId: CL_ING, type: "mail", date: dateAt(-1), note: "Danke für die Vermittlung Limmatfeld", followUpDate: dateAt(2) },
  ],
};

export const initScript = (data) => {
  localStorage.setItem("studio_data_v1", JSON.stringify(data));
  localStorage.setItem("rapport_v0_5_migrated", "1");
  localStorage.setItem("rapport_backend_chosen", "1");
  localStorage.setItem("rapport_backend", "local");
  localStorage.setItem("rapport_changelog_seen", "0.8.3");
  localStorage.setItem("rapport_dark", "0");
  sessionStorage.setItem("rapport_user", JSON.stringify({
    id: "admin", username: "admin", role: "admin", displayName: "Administrator", appRoleId: "r-admin",
  }));
};

/** Selbstkontrolle: Phasenverbrauch und Rechnungssummen ausgeben. */
export function report() {
  const byPhase = {};
  for (const e of timeEntries.filter(e => e.projectId === P_LIM)) {
    byPhase[e.phaseId] = (byPhase[e.phaseId] || 0) + e.minutes / 60;
  }
  console.log("Limmatfeld — Phasen (Ist / Soll):");
  for (const [ph, b] of Object.entries(LIM_BUDGETS)) {
    const ist = byPhase[ph] || 0;
    console.log(`  ${ph}: ${ist.toFixed(1).padStart(6)}h / ${String(b).padStart(6)}h = ${(ist / b * 100).toFixed(0).padStart(3)}%`);
  }
  const lim = sumH([...limHistorical, ...limCurrent]);
  console.log(`  Total ${lim.toFixed(1)}h / 1197h = ${(lim / 1197 * 100).toFixed(0)}%`);
  console.log(`Hardau (abgeschlossen): ${sumH(hardHistorical).toFixed(1)}h / 610h`);
  console.log(`  Akonto 30% + 40% + Schluss 30% = ${(HARD_SUB * 0.3 + HARD_SUB * 0.4 + HARD_SUB * 0.3).toLocaleString("de-CH")} von ${HARD_SUB.toLocaleString("de-CH")}`);
  console.log(`Rebweg verrechnet: ${rebBilledH}h × ${rateReb}.- `);
  console.log(`Offerten: SIA ${SIA_SUB.toLocaleString("de-CH")} · Aufwand ${AUFWAND_SUB.toLocaleString("de-CH")} · Frei ${FREI_SUB.toLocaleString("de-CH")}`);
}
