// ─── CONSTANTS ──────────────────────────────────────────────────
//
// Statische Konfiguration und Startwerte der App:
//   - Auswahllisten (SIA-Phasen, Projekt-/Kontakt-/Spesen-Kategorien)
//   - Navigation (NAV_ITEMS) und Dashboard-Kacheln (DASHBOARD_WIDGETS)
//   - Status-Farben
//   - `defaultData`: Shape-Referenz und Startzustand des gesamten Datenmodells.
//
// Wer hier ein Feld in `defaultData` ändert, muss auch `types.ts` (AppData) und —
// falls bestehende Daten betroffen sind — `storage/migrations.js` anpassen.
// Keine Logik in dieser Datei; Funktionen gehören nach `utils.js`.

import type { AppData, LeadStage, ActivityType, ContactCategory } from "./types";

/** localStorage-Key für den gesamten App-State. Nicht ändern ohne Migration (ARCHITECTURE §4). */
export const STORAGE_KEY = "studio_data_v1";

/** SIA-Phasen nach SIA 102/103 (Architektur). `id` ist die SIA-Phasennummer als String. */
export const SIA_PHASES: { id: string; label: string }[] = [
  { id: "11", label: "11 Strategische Planung" },
  { id: "21", label: "21 Vorstudien" },
  { id: "22", label: "22 Machbarkeitsstudie" },
  { id: "31", label: "31 Vorprojekt" },
  { id: "32", label: "32 Bauprojekt" },
  { id: "33", label: "33 Bewilligungsverfahren" },
  { id: "41", label: "41 Ausschreibung" },
  { id: "51", label: "51 Ausführungsprojekt" },
  { id: "52", label: "52 Ausführung" },
  { id: "53", label: "53 Inbetriebnahme / Abschluss" },
];

/** SIA 102 Teilleistungen mit Standard-Prozentanteilen (`pct` = Anteil am Gesamthonorar, in %). */
export const SIA_PHASE_WEIGHTS: { id: string; label: string; items: { label: string; pct: number }[] }[] = [
  { id: "31", label: "Vorprojekt", items: [
    { label: "Lösungsstudien / Grobschätzung", pct: 3 },
    { label: "Vorprojekt / Kostenschätzung", pct: 6 },
  ]},
  { id: "32", label: "Bauprojekt", items: [
    { label: "Bauprojekt", pct: 13 },
    { label: "Detailstudien", pct: 4 },
    { label: "Kostenvoranschlag", pct: 4 },
  ]},
  { id: "33", label: "Bewilligungsverfahren", items: [
    { label: "Bewilligungsverfahren", pct: 2.5 },
  ]},
  { id: "41", label: "Ausschreibung", items: [
    { label: "Ausschreibungspläne", pct: 10 },
    { label: "Ausschreibung / Offertvergleich", pct: 8 },
  ]},
  { id: "51", label: "Ausführungsplanung", items: [
    { label: "Ausführungspläne", pct: 15 },
    { label: "Werkverträge", pct: 1 },
  ]},
  { id: "52", label: "Ausführung", items: [
    { label: "Gestalterische Leitung", pct: 6 },
    { label: "Bauleitung / Kostenkontrolle", pct: 23 },
  ]},
  { id: "53", label: "Inbetriebnahme / Abschluss", items: [
    { label: "Inbetriebnahme", pct: 1 },
    { label: "Dokumentation", pct: 1 },
    { label: "Garantiearbeiten", pct: 1.5 },
    { label: "Schlussabrechnung", pct: 1 },
  ]},
];

/** Projekte dieser Kategorien werden erfasst, aber nicht fakturiert. */
export const NON_BILLING_CATEGORIES = ["Wettbewerb"];

// Projekt-Typen
export const PROJECT_TYPES = [
  "Wettbewerb",
  "Studienauftrag",
  "Direktauftrag",
  "Machbarkeitsstudie",
  "Gutachten",
  "Grafik",
  "Sonstiges",
];

// Typ/Branche für Personen mit Partner-Rolle (Fachplaner etc.) — siehe Persons.jsx.
export const CONTACT_TYPES = [
  "Elektroplaner", "HLKSE-Planer", "Statiker", "Tragwerksplaner",
  "Kostenplaner", "Landschaftsarchitekt", "Bauphysiker",
  "Vermessungsingenieur", "Brandschutzspezialist", "Geologe",
  "Generalunternehmer", "Fachplaner", "Sonstiges",
];

/** Kategorien beim Erstellen eines Kontakts (Reihenfolge = Auswahl); `color`/`bg` für das Abzeichen in der Liste. */
export const CONTACT_CATEGORIES: { id: ContactCategory; label: string; color: string; bg: string }[] = [
  { id: "person",      label: "Person",          color: "#1a4e8a", bg: "#e8f0fa" },
  { id: "unternehmer", label: "Unternehmer",     color: "#2d6a4f", bg: "#e8f5ee" },
  { id: "oeffentlich", label: "Öffentliche",     color: "#7a6a00", bg: "#fffbe6" },
  { id: "auslober",    label: "Auslober",        color: "#b5621e", bg: "#fdf0e8" },
  { id: "wbw",         label: "WBW-Beteiligte",  color: "#555",    bg: "#f0f0ee" },
];

export const EXPENSE_CATEGORIES = [
  "Reise / Fahrt", "Drucken / Reprografie", "Modellbau / Material",
  "Büromaterial", "Weiterbildung",
  "Unterauftrag / Freelancer", "Verpflegung / Geschäftsessen",
  "Sonstiges",
];

export const INTERNAL_EXPENSE_CATEGORIES = [
  "Miete / Raumkosten", "Software / Lizenzen", "Hardware / IT",
  "Telefon / Internet", "Versicherung", "Steuern / Abgaben",
  "Büromaterial", "Marketing / Werbung", "Weiterbildung",
  "Unterauftrag / Freelancer", "Bankgebühren", "Sonstiges",
];

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  children?: NavItem[];
}

/** Seitenleiste. `id` dient zugleich als Permission-Id in `AppRole.permissions`. Kinder haben kein Icon. */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Übersicht", icon: "grid_view" },
  { id: "pinnwand", label: "Pinnwand", icon: "campaign" },
  { id: "projects", label: "Projekte", icon: "work" },
  { id: "time", label: "Zeiterfassung", icon: "schedule" },
  { id: "crm", label: "Akquise", icon: "leaderboard" },
  { id: "quotes", label: "Offerten", icon: "request_quote" },
  { id: "contracts", label: "Verträge", icon: "handshake" },
  { id: "buchhaltung", label: "Buchhaltung", icon: "account_balance", children: [
    { id: "invoices", label: "Rechnungen" },
    { id: "internal-expenses", label: "Ausgaben" },
    { id: "expenses", label: "Spesen" },
    { id: "loehne", label: "Löhne" },
    { id: "studio-budget", label: "Budget" },
  ]},
  { id: "dokumente", label: "Dokumente", icon: "folder", children: [
    { id: "protokolle", label: "Protokolle" },
    { id: "lieferscheine", label: "Lieferscheine" },
    { id: "letters", label: "Briefe" },
  ]},
  { id: "personen", label: "Kontakte", icon: "group" },
  { id: "mitarbeiter", label: "Mitarbeiter", icon: "badge" },
  { id: "settings", label: "Einstellungen", icon: "settings" },
];

/** Textfarbe pro Status (Projekt, Rechnung, Offerte, Spesen). Schlüssel = Status-String wie in den Daten. */
export const STATUS_COLORS: Record<string, string> = {
  aktiv: "#2d6a4f", abgeschlossen: "#555", pausiert: "#b5621e",
  entwurf: "#7a6a00", gesendet: "#1a4e8a", bezahlt: "#2d6a4f", überfällig: "#8a1a1a",
  offen: "#7a6a00", angenommen: "#2d6a4f", abgelehnt: "#8a1a1a", abgelaufen: "#888",
  genehmigt: "#1a4e8a", "auf nächsten Lohn": "#b5621e", ausbezahlt: "#2d6a4f",
  anfrage: "#555", besichtigung: "#1a4e8a", offerte: "#7a6a00", verhandlung: "#b5621e", gewonnen: "#2d6a4f", verloren: "#8a1a1a",
};

/** Hintergrundfarbe pro Status; Gegenstück zu STATUS_COLORS. */
export const STATUS_BG: Record<string, string> = {
  aktiv: "#e8f5ee", abgeschlossen: "#f0f0ee", pausiert: "#fdf0e8",
  entwurf: "#fffbe6", gesendet: "#e8f0fa", bezahlt: "#e8f5ee", überfällig: "#fdf2f2",
  offen: "#fffbe6", angenommen: "#e8f5ee", abgelehnt: "#fdf2f2", abgelaufen: "#f2f2f2",
  genehmigt: "#e8f0fa", "auf nächsten Lohn": "#fdf0e8", ausbezahlt: "#e8f5ee",
  anfrage: "#f0f0ee", besichtigung: "#e8f0fa", offerte: "#fffbe6", verhandlung: "#fdf0e8", gewonnen: "#e8f5ee", verloren: "#fdf2f2",
};

/** Textfarbe pro Status im Dark Mode: gleiche Töne, aber aufgehellt für dunklen Grund. */
export const STATUS_COLORS_DARK: Record<string, string> = {
  aktiv: "#6fcf97", abgeschlossen: "#b0aca4", pausiert: "#e8a068",
  entwurf: "#e6d36a", gesendet: "#7ab3ee", bezahlt: "#6fcf97", überfällig: "#f08080",
  offen: "#e6d36a", angenommen: "#6fcf97", abgelehnt: "#f08080", abgelaufen: "#8c8880",
  genehmigt: "#7ab3ee", "auf nächsten Lohn": "#e8a068", ausbezahlt: "#6fcf97",
  anfrage: "#b0aca4", besichtigung: "#7ab3ee", offerte: "#e6d36a", verhandlung: "#e8a068", gewonnen: "#6fcf97", verloren: "#f08080",
};

/** Hintergrund pro Status im Dark Mode: dunkel getönt statt Pastell. */
export const STATUS_BG_DARK: Record<string, string> = {
  aktiv: "#1f3a2c", abgeschlossen: "#2e2e28", pausiert: "#3d2c1c",
  entwurf: "#3a3618", gesendet: "#1c3048", bezahlt: "#1f3a2c", überfällig: "#401f1f",
  offen: "#3a3618", angenommen: "#1f3a2c", abgelehnt: "#401f1f", abgelaufen: "#2a2a26",
  genehmigt: "#1c3048", "auf nächsten Lohn": "#3d2c1c", ausbezahlt: "#1f3a2c",
  anfrage: "#2e2e28", besichtigung: "#1c3048", offerte: "#3a3618", verhandlung: "#3d2c1c", gewonnen: "#1f3a2c", verloren: "#401f1f",
};

/** CSS-tauglicher Schlüssel für einen Status ("überfällig" → "uberfallig"), Teil der Variablennamen `--st-c-*`/`--st-bg-*`. */
export const statusVar = (status: string): string =>
  status.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** CSS-Variablen `--st-c-*`/`--st-bg-*` für alle Status; Dark Mode überschreibt mit den *_DARK-Tabellen. Wird in App.tsx ins <style> eingebettet. */
export const statusCssVars = (): string => {
  const block = (colors: Record<string, string>, bgs: Record<string, string>) =>
    Object.keys(colors).map(k => `--st-c-${statusVar(k)}: ${colors[k]}; --st-bg-${statusVar(k)}: ${bgs[k]};`).join(" ");
  return `:root, [data-theme=light] { ${block(STATUS_COLORS, STATUS_BG)} } [data-theme=dark] { ${block(STATUS_COLORS_DARK, STATUS_BG_DARK)} }`;
};

/** Pipeline-Stufen mit Anzeigename; Reihenfolge = Spalten im Board. */
export const LEAD_STAGES: { id: LeadStage; label: string }[] = [
  { id: "anfrage", label: "Anfrage" },
  { id: "besichtigung", label: "Besichtigung" },
  { id: "offerte", label: "Offerte" },
  { id: "verhandlung", label: "Verhandlung" },
  { id: "gewonnen", label: "Gewonnen" },
  { id: "verloren", label: "Verloren" },
];

/** Aktivitätsarten im Kontaktverlauf; `meeting` und `besichtigung` zählen als «Meetings» in der Auswertung. */
export const ACTIVITY_TYPES: { id: ActivityType; label: string; icon: string }[] = [
  { id: "anruf", label: "Anruf", icon: "call" },
  { id: "mail", label: "E-Mail", icon: "mail" },
  { id: "meeting", label: "Meeting", icon: "groups" },
  { id: "besichtigung", label: "Besichtigung", icon: "home_work" },
  { id: "karte", label: "Karte / Geschenk", icon: "redeem" },
  { id: "sonstiges", label: "Sonstiges", icon: "edit_note" },
];

/** Vorgabe für `settings.leadSources`, solange das Studio keine eigene Liste gepflegt hat. */
export const DEFAULT_LEAD_SOURCES: string[] = [
  "Empfehlung Kunde", "Empfehlung Partner", "Wettbewerb", "Website",
  "Wiederkehrender Kunde", "Direktanfrage", "Netzwerk / Event",
];

/**
 * Startzustand eines neuen Studios und Shape-Referenz des Datenmodells.
 * Achtung: enthält Demo-Login `admin`/`admin` — wird beim Setup überschrieben.
 */
export const defaultData: AppData = {
  settings: {
    setupCompleted: false,
    name: "Mein Studio",
    address: "Musterstrasse 1\n8001 Zürich",
    street: "",
    zip: "",
    city: "",
    country: "CH",
    email: "mail@studio.ch",
    phone: "+41 79 000 00 00",
    iban: "CH00 0000 0000 0000 0000 0",
    ibanType: "qr", // "qr" | "normal"
    mwst: "CHE-000.000.000 MWST",
    mwstRate: 8.1,
    defaultHourlyRate: 120,
    autoPrint: false,
    logoSize: 60,
    expenseCategories: [...EXPENSE_CATEGORIES],
    internalExpenseCategories: [...INTERNAL_EXPENSE_CATEGORIES],
    projectNumberFormat: "YYYY/NN",
    invoiceNumberFormat: "YYYY-NNN",
    vertragNumberFormat: "V-YYYY-NNN",
    protokollNumberFormat: "YYYY-TT-NN",
    protokollTypeAbbreviations: {
      "Bausitzung": "BS",
      "Planungssitzung": "PS",
      "Baubesprechung": "BB",
      "Jour fixe": "JF",
      "Interne Sitzung": "IS",
      "Kundensitzung": "KS",
      "Abnahme": "AB",
      "Sonstiges": "SO",
    },
    pdfNameFormat: "{studio}_{typ}_{nummer}",
    qrNewPage: true,
    pageMarginTop: 20,
    pageMarginBottom: 20,
    pageMarginLeft: 20,
    pageMarginRight: 20,
    defaultWochenstunden: 35,
    defaultFerienWochen: 5,
    closedMonths: [],
    blockMaiTag: true,
    roles: [
      { id: "PL", label: "Projektleiter/in", rate: 140 },
      { id: "TS", label: "Technischer Support", rate: 120 },
      { id: "BL", label: "Bauleiter/in", rate: 135 },
      { id: "AS", label: "Administrativer Support", rate: 120 },
    ],
  },
  persons: [],
  projects: [],
  timeEntries: [],
  invoices: [],
  quotes: [],
  contracts: [],
  expenses: [],
  internalExpenses: [],
  deliveryNotes: [],
  protocols: [],
  employees: [],
  feiertage: [],
  absences: [],
  ferienEntries: [],
  absenzTypes: [],
  lohnEntries: [],
  uberstundenAbschluss: [],
  dashboardTemplates: [
    { id: "tpl-admin", name: "Administrator", isPublic: true, layout: [
      { id: "dw-a1", cols: 4, minH: 0, widgets: ["kpi-projekte","kpi-stunden","kpi-ausstehend","kpi-umsatz"] },
      { id: "dw-a2", cols: 1, minH: 0, widgets: ["warnungen"] },
      { id: "dw-a3", cols: 2, minH: 0, widgets: ["aktive-projekte","unverrechnete-stunden"] },
      { id: "dw-a4", cols: 2, minH: 0, widgets: ["umsatz-sparkline","offene-offerten"] },
      { id: "dw-a5", cols: 1, minH: 0, widgets: ["letzte-zeiteintraege"] },
    ]},
    { id: "tpl-projektleiter", name: "Projektleiter", isPublic: true, layout: [
      { id: "dw-p1", cols: 2, minH: 0, widgets: ["kpi-projekte","kpi-stunden"] },
      { id: "dw-p2", cols: 1, minH: 0, widgets: ["warnungen"] },
      { id: "dw-p3", cols: 3, minH: 0, widgets: ["meine-projekte","team-auslastung","offene-offerten"] },
      { id: "dw-p4", cols: 1, minH: 0, widgets: ["letzte-zeiteintraege"] },
    ]},
    { id: "tpl-mitarbeiter", name: "Mitarbeiter", isPublic: true, layout: [
      { id: "dw-m1", cols: 3, minH: 0, widgets: ["kpi-stunden","ueberstunden","meine-ferien"] },
      { id: "dw-m2", cols: 2, minH: 0, widgets: ["meine-projekte","stunden-woche"] },
      { id: "dw-m3", cols: 1, minH: 0, widgets: ["meine-zeiteintraege"] },
    ]},
  ],
  appRoles: [
    { id: "r-admin", name: "Administrator", permissions: null, dashboardTemplateId: "tpl-admin" },
    { id: "r-projektleiter", name: "Projektleiter", permissions: ["dashboard","projects","time","quotes","personen","mitarbeiter","settings"], dashboardTemplateId: "tpl-projektleiter" },
    { id: "r-mitarbeiter", name: "Mitarbeiter", permissions: ["dashboard","projects","time","personen","settings"], dashboardTemplateId: "tpl-mitarbeiter" },
  ],
  users: [
    { id: "admin", username: "admin", password: "admin", role: "admin", displayName: "Administrator", appRoleId: "r-admin" },
  ],
  blogPosts: [],
  leads: [],
  activities: [],
  docAssets: [],
  letterTemplates: [
    { id: "offer", name: "Offerte", body: "Sehr geehrte/r {{client}}\n\nGerne unterbreiten wir Ihnen die Offerte für das Projekt «{{project}}».\n\n[Leistungsumfang]\n\nHonorar: CHF [Betrag]\n\nWir freuen uns auf die Zusammenarbeit.\n\nFreundliche Grüsse" },
    { id: "reminder", name: "Zahlungserinnerung", body: "Sehr geehrte/r {{client}}\n\nBei einer Überprüfung unserer Buchhaltung stellen wir fest, dass die Rechnung [Nr.] vom [Datum] über CHF [Betrag] noch nicht beglichen ist.\n\nWir bitten Sie höflich, den offenen Betrag innert 10 Tagen zu überweisen.\n\nFreundliche Grüsse" },
  ],
};

export const PROTOKOLL_TYPES = ["Bausitzung", "Planungssitzung", "Baubesprechung", "Jour fixe", "Interne Sitzung", "Kundensitzung", "Abnahme", "Sonstiges"];

export const PROTOKOLL_ENTRY_TYPES: { id: string; label: string; color: string; bg: string; icon: string }[] = [
  { id: "beschluss", label: "Beschluss", color: "#1a4e8a", bg: "#e8f0fa", icon: "⬡" },
  { id: "info",      label: "Info",      color: "#2d6a4f", bg: "#e8f5ee", icon: "ℹ" },
  { id: "aufgabe",   label: "Aufgabe",   color: "#b5621e", bg: "#fdf0e8", icon: "◎" },
];

// `perm`: Nav-Permission-Id, die diese Kachel voraussetzt (siehe NAV_ITEMS) —
// ungesetzt = für jede Rolle sichtbar (rein persönliche Daten wie "meine ...").
export interface DashboardWidget {
  id: string;
  label: string;
  /** Breite im 12-Spalten-Raster */
  span: number;
  perm?: string;
}

export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "kpi-projekte",           label: "Aktive Projekte (KPI)",      span: 3, perm: "projects" },
  { id: "kpi-stunden",            label: "Stunden diesen Monat (KPI)", span: 3, perm: "time" },
  { id: "kpi-ausstehend",         label: "Ausstehend (KPI)",           span: 3, perm: "invoices" },
  { id: "kpi-umsatz",             label: "Jahresumsatz (KPI)",         span: 3, perm: "invoices" },
  { id: "warnungen",              label: "Warnungen",                  span: 12 },
  { id: "aktive-projekte",        label: "Projektliste mit Budget",    span: 4, perm: "projects" },
  { id: "unverrechnete-stunden",  label: "Unverrechnete Stunden",      span: 4, perm: "projects" },
  { id: "umsatz-sparkline",       label: "Umsatz Sparkline",           span: 4, perm: "invoices" },
  { id: "offene-offerten",        label: "Offene Offerten",            span: 4, perm: "quotes" },
  { id: "crm-wiedervorlagen",     label: "Wiedervorlagen (Akquise)",   span: 4, perm: "crm" },
  { id: "crm-pipeline",           label: "Akquise-Pipeline",           span: 4, perm: "crm" },
  { id: "letzte-zeiteintraege",   label: "Letzte Zeiteinträge",        span: 12, perm: "mitarbeiter" },
  { id: "meine-zeiteintraege",    label: "Meine Zeiteinträge",         span: 12 },
  { id: "meine-projekte",         label: "Meine Projekte",             span: 6 },
  { id: "meine-ferien",           label: "Ferienstand",                span: 4 },
  { id: "ueberstunden",           label: "Stundensaldo",               span: 4 },
  { id: "stunden-woche",          label: "Stunden pro Woche",          span: 6, perm: "time" },
  { id: "team-auslastung",        label: "Team-Auslastung",            span: 6, perm: "mitarbeiter" },
  { id: "interner-blog",          label: "Pinnwand",                   span: 6, perm: "pinnwand" },
];

/** Vorgabe-Absenzarten; Studios können eigene in `data.absenzTypes` ergänzen. */
export const DEFAULT_ABSENZ_TYPES: { id: string; label: string; color: string }[] = [
  { id: "krankheit", label: "Krankheit", color: "#8a1a1a" },
  { id: "unfall", label: "Unfall", color: "#b5621e" },
  { id: "intern", label: "Intern", color: "#1a4e8a" },
  { id: "informatik", label: "Informatik", color: "#555" },
  { id: "rechnungswesen", label: "Rechnungswesen", color: "#7a6a00" },
  { id: "weiterbildung", label: "Weiterbildung", color: "#2d6a4f" },
  { id: "militaer", label: "Militär / Zivildienst", color: "#3d3d38" },
];
