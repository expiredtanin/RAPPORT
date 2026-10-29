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

/** Einträge für eine Phase, die zusammen exakt `targetH` Stunden ergeben. */
function phaseEntries({ projectId, phaseId, targetH, startWeeks, weeks, employees, descPool }) {
  const out = [];
  let rest = Math.round(targetH * 60);
  const slot = Math.round(rest / weeks / 30) * 30;
  for (let i = 0; i < weeks && rest > 0; i++) {
    const mins = (i === weeks - 1) ? rest : Math.min(slot, rest);
    if (mins <= 0) break;
    out.push(te(dateAt(startWeeks + i, i % 5), employees[i % employees.length],
      projectId, phaseId, "08:00", mins, descPool[i % descPool.length]));
    rest -= mins;
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

const timeEntries = [...limHistorical, ...limCurrent, ...hardHistorical, ...rebHistorical, ...rebCurrent];

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
  ].map(withPaidDate),
  contracts: [], expenses: [], internalExpenses: [], deliveryNotes: [],
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
    { id: E_JULIAN, name: "Julian Roth", role: "Bauleiter", pensum: 100, wochenstunden: 41, ferienWochen: 5, personalNr: "101", eintrittsdatum: dateAt(-250), ferienUebertragVorjahr: {} },
    { id: E_LAURA, name: "Laura Meier", role: "Architektin", pensum: 100, wochenstunden: 41, ferienWochen: 5, personalNr: "102", eintrittsdatum: dateAt(-380), ferienUebertragVorjahr: {} },
    { id: E_NINA, name: "Nina Baumgartner", role: "Praktikantin", pensum: 80, wochenstunden: 41, ferienWochen: 5, personalNr: "103", eintrittsdatum: dateAt(-58), ferienUebertragVorjahr: {} },
  ],
  feiertage: [], absences: [], ferienEntries: [], absenzTypes: [],
  lohnEntries: [], uberstundenAbschluss: [],
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
