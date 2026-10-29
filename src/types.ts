// Datenmodell von RAPPORT — Shape-Referenz bleibt `defaultData` in constants.js.
// Typen sind bewusst locker (viele optionale Felder), weil ältere Datensätze in
// localStorage / PocketBase nicht alle Felder haben. Verschärfen, sobald Migrationen typisiert sind.

export type Id = string;
/** ISO-Datum "YYYY-MM-DD" */
export type DateStr = string;
/** ISO-Zeitstempel */
export type Timestamp = string;

export type BillingType = "pauschal" | "stundensatz" | (string & {});

export interface Role {
  id: string;
  label: string;
  /** Stundensatz in CHF */
  rate: number;
  /** Reihenfolge (Cloud) */
  sort?: number;
}

export interface Settings {
  setupCompleted: boolean;
  name: string;
  address: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  iban: string;
  ibanType: "qr" | "normal";
  mwst: string;
  mwstRate: number;
  defaultHourlyRate: number;
  autoPrint: boolean;
  logoSize: number;
  logo?: string | null;
  expenseCategories: string[];
  internalExpenseCategories: string[];
  projectNumberFormat: string;
  invoiceNumberFormat: string;
  vertragNumberFormat: string;
  protokollNumberFormat: string;
  protokollTypeAbbreviations: Record<string, string>;
  pdfNameFormat: string;
  qrNewPage: boolean;
  pageMarginTop: number;
  pageMarginBottom: number;
  pageMarginLeft: number;
  pageMarginRight: number;
  defaultWochenstunden: number;
  defaultFerienWochen: number;
  closedMonths: string[];
  blockMaiTag: boolean;
  roles: Role[];
  defaultPkAGSatz?: number;
  quoteNumberFormat?: string;
  /** Vorgabe für den Genehmigungsvermerk im Protokolldruck (pro Protokoll übersteuerbar). Standard «unterschrift». */
  protokollApproval?: ProtocolApproval;
  /** Frist in Stunden für die stillschweigende Genehmigung. Standard 24. */
  protokollApprovalHours?: number;
  /** CRM: wählbare Herkunftsquellen für Leads/Personen; Rückfall `DEFAULT_LEAD_SOURCES` (constants.ts). */
  leadSources?: string[];
  deliveryNoteNumberFormat?: string;
  /** Zähler für Projektnummern (Jahr + letzte laufende Nummer); verhindert doppelte Nummern. */
  lastProjectSeq?: number;
  lastProjectYear?: number | null;
  /** Aktueller Studio-Budget-Stand und archivierte Versionen (StudioBudget.jsx), frei wachsende Struktur. */
  studioBudget?: Partial<StudioBudgetState>;
  studioBudgetVersions?: StudioBudgetVersion[];
  /** Erscheinungsbild der gedruckten Dokumente (Einstellungen → Erscheinungsbild). Fehlt es, gelten die Standardschriften. */
  docDesign?: DocDesign;
  [key: string]: unknown;
}

/**
 * Erscheinungsbild der Dokumente. Schriften sind CSS-Familiennamen: mitgelieferte
 * (`DOC_FONTS` in print/docDesign.ts) oder hochgeladene (`DocAsset.family`).
 * Leere Felder = Standard des Druckmoduls.
 */
export interface DocDesign {
  /** Titel, Dokumentnummern, Totale. Standard «Playfair Display». */
  headingFont?: string;
  /** Fliesstext aller Dokumente. Standard «DM Mono»; das Protokoll bleibt dann bei «Inter». */
  bodyFont?: string;
  /** Textfarbe (#rrggbb). Standard #1a1a18. */
  inkColor?: string;
  /** Farbe für Titel und kräftige Linien. Standard = Textfarbe. */
  accentColor?: string;
  /** Briefpapier aus `docAssets` (letterheadFirst/letterheadFollow) hinterlegen. */
  letterhead?: boolean;
  /** Bei Briefpapier: Logo und Absender im Dokumentkopf ausblenden (stehen schon auf dem Papier). Standard true. */
  letterheadHideSender?: boolean;
  /** Ränder auf Folgeseiten in mm; fehlen sie, gelten pageMarginTop/pageMarginBottom. */
  followMarginTop?: number;
  followMarginBottom?: number;
  /** Eigenes CSS, wird nach allen anderen Regeln in die Druckansicht eingefügt. */
  customCss?: string;
}

/** Datei für das Dokument-Design: Schrift oder Briefpapier, als Data-URL (Cloud: Collection docAssets). */
export interface DocAsset {
  id: Id;
  kind: "font" | "letterheadFirst" | "letterheadFollow";
  /** Ursprünglicher Dateiname (Anzeige). */
  name: string;
  /** Nur Schriften: CSS-Familienname, Gewicht und Stil des Schnitts. */
  family?: string;
  weight?: number;
  style?: "normal" | "italic";
  data: string;
}

/** Kategorie eines Kontakts; ersetzt die frühere Unterscheidung Auftraggeber/Partner. */
export type ContactCategory = "person" | "unternehmer" | "oeffentlich" | "auslober" | "wbw";

export interface Contact {
  id: Id;
  name: string;
  position?: string;
  phone?: string;
  email?: string;
}

export interface Person {
  id: Id;
  name: string;
  type: string;
  /** Altes Feld (Firmenname getrennt vom Namen); wird nur noch in der Offerten-Suche gelesen. */
  company?: string;
  /** Altes Freitext-Adressfeld (mehrzeilig); neue Personen nutzen street/zip/city. */
  address?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
  website?: string;
  note?: string;
  contacts: Contact[];
  honorarOffers?: unknown[];
  /** Altes Flag aus der Zeit vor «Kontakte»: wird nirgends mehr zum Filtern benutzt, neue Kontakte setzen es weiter auf true. */
  isAuftraggeber?: boolean;
  /** Wie `isAuftraggeber`: nur noch Altlast (auch die Cloud-Zuordnung schreibt es). */
  isPartner?: boolean;
  /** Art des Kontakts (Auswahl beim Erstellen). Fehlt bei Altdaten, siehe `contactCategory()` in utils.ts. */
  category?: ContactCategory;
  /** CRM: woher der Kontakt kommt (Eintrag aus `settings.leadSources`); für Bestandskunden ohne Lead. */
  source?: string;
  /** CRM: Person, die diesen Kontakt vermittelt hat (`Person.id`); Fallback, wenn kein Lead mit Empfehler existiert. */
  referredById?: Id;
  /** CRM: freie Schlagworte, z.B. «Weihnachtskarte»; Grundlage für die spätere Kundenpflege-Liste. */
  tags?: string[];
  /** Cloud: Person ist über mehrere Studios geteilt (gehört keinem Studio allein) */
  isShared?: boolean;
}

/** Position eines Projekts (Hauptauftrag oder Nachtrag), mit der Zeiteinträge verknüpft werden (`TimeEntry.positionId` = `code`). */
export interface ProjectPosition {
  quoteId?: Id;
  code?: string;
  label?: string;
  enabledPhases?: string[];
  [key: string]: unknown;
}

export interface Project {
  id: Id;
  number: string;
  name: string;
  clientId: Id;
  category?: string;
  billingType: BillingType;
  /** Altes Feld: früherer Name von `billingType` (siehe storage/migrations.ts). */
  type?: string;
  hourlyRate?: number;
  budget?: number;
  budgetAmount?: number;
  budgetHours?: number;
  status: string;
  description?: string;
  startDate?: DateStr;
  enabledPhases?: string[];
  linkedQuotes?: { quoteId: Id; role: string }[];
  /** Leistungspositionen des Projekts (aus Offerten abgeleitet, siehe Projects.tsx `buildPositions`) */
  positions?: ProjectPosition[];
  /** Eigene Projektphasen zusätzlich zu den SIA-Phasen */
  customPhases?: { id: Id; label: string }[];
  phasesBudget?: { id: string; hours: number }[];
  /** Beteiligte Firmen; `personIds` schränkt auf bestimmte Ansprechpartner der Firma ein */
  projectContacts?: { contactId?: Id; personIds?: Id[]; [key: string]: unknown }[];
  internalMembers?: Id[];
  createdAt?: Timestamp;
}

export interface TimeEntry {
  id: Id;
  date: DateStr;
  employeeId: Id;
  projectId: Id;
  phaseId?: string;
  positionId?: string;
  minutes: number;
  startTime?: string;
  endTime?: string;
  description?: string;
  /** gesetzt = bereits auf einer Rechnung (Bearbeitungssperre, nicht mehr «unverrechnet») */
  invoiceId?: Id | null;
  createdAt?: Timestamp;
}

/** Eine versendete Zahlungserinnerung bzw. Mahnung. */
export interface InvoiceReminder {
  /** 1 = Zahlungserinnerung, 2 = 2. Mahnung, … */
  nr: number;
  /** Erfassungsdatum */
  date: DateStr;
  /** Versanddatum (kann vom Erfassungsdatum abweichen) */
  sentDate?: DateStr;
  /** Tage, die die Rechnung beim Auslösen überfällig war */
  daysPast?: number;
}

export interface InvoiceItem {
  id: Id;
  desc: string;
  qty: number;
  price: number;
  discount?: number;
}

export interface Invoice {
  id: Id;
  number: string;
  clientId: Id;
  projectId?: Id;
  contactId?: Id;
  quoteId?: Id;
  date: DateStr;
  dueDate?: DateStr;
  sentDate?: DateStr;
  paidDate?: DateStr;
  items: InvoiceItem[];
  mwst: boolean;
  mwstRate: number;
  notes?: string;
  status: string;
  sub: number;
  tax: number;
  total: number;
  subAfterDisc?: number;
  globalDisc?: number;
  /** z.B. "akonto" — MWST erst bei Schlussrechnung steuerrelevant */
  invoiceKind?: string;
  discountType?: string;
  discountValue?: number;
  discountLabel?: string;
  /** Beim Bearbeiten: welche Zeiteinträge auf der Rechnung stehen (Schlüssel = Zeiteintrag-Id) und mit wie vielen Minuten */
  entrySelections?: Record<string, { selected: boolean; billedMinutes?: number; [key: string]: unknown }>;
  qrReference?: string;
  /** Zahlungserinnerungen/Mahnungen in der Reihenfolge ihres Versands */
  reminders?: InvoiceReminder[];
  createdAt?: Timestamp;
}

/** Teilleistung einer SIA-Phase; `r` = Faktor (Standard 1), `pct` = Anteil in %. */
export interface SiaItem {
  label: string;
  pct: number;
  enabled?: boolean;
  r?: number;
}

export interface SiaPhase {
  id: string;
  label: string;
  items: SiaItem[];
}

/** Manuell geschätzte Phase: Stunden pro Rolle. */
export interface ManualPhase {
  id: string;
  label: string;
  enabled: boolean;
  hoursByRole?: Record<string, number>;
}

export interface Quote {
  id: Id;
  number: string;
  clientId: Id;
  projectId?: Id | null;
  projectName?: string;
  date: DateStr;
  validUntil?: DateStr;
  /** gesetzt, sobald die Offerte in eine Rechnung umgewandelt wurde */
  convertedToInvoiceId?: Id;
  /** "sia" | "manual" | "free" */
  mode: string;
  status: string;
  mwst: boolean;
  mwstRate?: number | null;
  manualPhases?: ManualPhase[];
  quoteRoles?: Role[];
  sia?: {
    baukosten: number;
    schwierigkeit: number;
    stundenansatz: number;
    phases: SiaPhase[];
  };
  freeItems?: { id: Id; desc: string; qty: number; price: number }[];
  notes?: string;
  sub: number;
  totalHours?: number;
  tax: number;
  total: number;
  createdAt?: Timestamp;
}

export interface Contract {
  id: Id;
  number: string;
  clientId?: Id;
  projectId?: Id;
  quoteId?: Id;
  /** z.B. "haupt" */
  contractType?: string;
  legalBasis?: string;
  billingType?: BillingType;
  amount?: number;
  hourlyRate?: number;
  paymentTerms?: string;
  date?: DateStr;
  signedDate?: DateStr;
  status: string;
  notes?: string;
}

export interface Expense {
  id: Id;
  date: DateStr;
  category: string;
  projectId?: Id;
  employeeId?: Id;
  description: string;
  amount: number;
  mwstRate: number;
  inclMwst: boolean;
  status: string;
  /** Beleg als Base64-Data-URL (kein Datei-Upload) */
  receiptData?: string | null;
  receiptName?: string | null;
  lohnEntryId?: Id | null;
}

export interface InternalExpense {
  id: Id;
  date: DateStr;
  category: string;
  description: string;
  amount: number;
  mwstRate: number;
  inclMwst: boolean;
  recurring?: boolean;
  recurringInterval?: string;
  receiptData?: string | null;
  receiptName?: string | null;
}

export interface DeliveryNote {
  id: Id;
  date: DateStr;
  number: string;
  projectId?: Id;
  clientId?: Id;
  clientManual?: string;
  projectManual?: string;
  deliveryAddress?: string;
  notes?: string;
  items: { id: Id; desc: string; qty: number; unit: string; note?: string }[];
  createdAt?: Timestamp;
}

/** Eintrag unter einem Traktandum: Information, Beschluss oder Aufgabe (dann mit Verantwortlichem und Frist). */
export interface ProtocolEntry {
  id: Id;
  type: "beschluss" | "info" | "aufgabe" | (string & {});
  /** HTML aus dem Rich-Text-Editor */
  text: string;
  /** Beschlussdatum (nur Beschluss) */
  date?: DateStr;
  /** Verantwortliche/r (nur Aufgabe) */
  responsible?: string;
  /** Frist als Kalenderwoche ("kw", mit dueKW/dueYear) oder Datum ("datum", mit dueDate) */
  dueDateType?: "kw" | "datum" | (string & {});
  dueKW?: string | number;
  dueYear?: number;
  dueDate?: DateStr;
  /** "offen" | "in Arbeit" | "erledigt" */
  status?: string;
}

export interface ProtocolParticipant {
  id: Id;
  name: string;
  role?: string;
  /** "intern" | "extern" | "manuell" */
  source?: string;
  /** z.B. "anwesend" */
  status?: string;
  /** Kürzel im Protokoll (z.B. «JR»), erscheint in der Spalte «Wer». Fehlt es, gelten die Initialen (`participantKuerzel`). */
  kuerzel?: string;
}

export interface ProtocolTraktandum {
  id: Id;
  /** Nummer als Text ("1", "2", …) */
  nr: string;
  title: string;
  items: ProtocolEntry[];
}

export interface Protocol {
  id: Id;
  title: string;
  type: string;
  date: DateStr;
  time?: string;
  endTime?: string;
  location?: string;
  projectId?: Id;
  projectManual?: string;
  nummer?: string;
  participants: ProtocolParticipant[];
  traktanden: ProtocolTraktandum[];
  nextDate?: DateStr;
  verteiler?: string;
  /** Genehmigungsvermerk im Druck; fehlt er, gilt die Vorgabe `settings.protokollApproval`. */
  approval?: ProtocolApproval;
  /** Frist in Stunden für «stillschweigend»; fehlt sie, gilt `settings.protokollApprovalHours` (Standard 24). */
  approvalHours?: number;
  createdAt?: Timestamp;
}

/** Wie ein Protokoll genehmigt wird: Unterschriftenfelder, stillschweigend nach Frist, oder gar kein Vermerk. */
export type ProtocolApproval = "unterschrift" | "stillschweigend" | "keine";

export interface Employee {
  id: Id;
  name: string;
  role: string;
  personalNr?: string;
  adresse?: string;
  ort?: string;
  ahvNr?: string;
  geburtsdatum?: DateStr;
  email?: string;
  eintrittsdatum?: DateStr;
  pensum: number;
  wochenstunden: number;
  ferienWochen: number;
  monatslohn?: number;
  lohnIban?: string;
  dreizehnterLohn?: boolean;
  ahvSatz?: number;
  alvSatz?: number;
  bvgSatz?: number;
  nbuSatz?: number;
  ktgSatz?: number;
  pkAGSatz?: number;
  quellensteuerPflichtig?: boolean;
  quellensteuerSatz?: number;
  ferienUebertragVorjahr?: Record<string, number>;
  /** Cloud-User, der diesem Mitarbeiter entspricht (Self-Service-Ansichten) */
  appUserId?: Id | null;
  active?: boolean;
  /** Adresse (Self-Service unter «Mein Profil»; getrennt von `adresse`/`ort` der Personalstammdaten) */
  street?: string;
  zip?: string;
  city?: string;
}

export interface Absence {
  id: Id;
  employeeId: Id;
  type: string;
  /** Eintrag für einen einzelnen Tag (Zeiterfassung); mehrtägige Absenzen nutzen dateFrom/dateTo */
  date?: DateStr;
  dateFrom?: DateStr;
  dateTo?: DateStr;
  startTime?: string;
  endTime?: string;
  hours?: number;
  minutes?: number;
  note?: string;
  status: string;
  createdAt?: Timestamp;
}

export interface FerienEntry {
  id: Id;
  employeeId: Id;
  dateFrom: DateStr;
  dateTo: DateStr;
  note?: string;
  status: string;
  /** true = von der Verwaltung gesehen (Hinweis «neu» entfällt) */
  seen?: boolean;
  /** Bei einem Änderungsantrag (status "pending"): die zuvor genehmigten Werte */
  originalData?: { dateFrom: DateStr; dateTo: DateStr; note?: string } | null;
  createdAt?: Timestamp;
}

export interface AbsenzType {
  id: string;
  label: string;
  color: string;
  /** true = Standard-Typ wurde vom Studio ausgeblendet */
  deleted?: boolean;
}

export interface Feiertag {
  id?: Id;
  /** `YYYY-MM-DD`; bei `repeatsYearly` zählt nur `MM-DD` */
  date: DateStr;
  name?: string;
  /** Bezeichnung, z.B. «Nationalfeiertag» */
  label?: string;
  halfDay?: boolean;
  /** Stundenanpassung an diesem Tag (z.B. halber Feiertag) */
  stundenDelta?: number | null;
  repeatsYearly?: boolean;
  [key: string]: unknown;
}

/** Ergebnis der Lohnberechnung (`calcLohn` in utils.ts); alle Beträge in CHF. */
export interface LohnResult {
  /** Monatslohn × Pensum */
  brutto: number;
  bruttoBase: number;
  /** 1/12 des Bruttos pro Monat, wenn 13. Monatslohn vereinbart */
  dreizehnter: number;
  bonusBetrag: number;
  /** Brutto + 13. + Bonus — Basis aller Abzüge */
  bruttoTotal: number;
  ahv: number; alv: number; bvg: number; nbu: number; ktg: number; qst: number;
  totalAbzuege: number;
  netto: number;
  spesenTotal: number;
  /** Netto + Spesen */
  auszahlung: number;
  /** Arbeitgeberanteil Pensionskasse (nicht Teil der Abzüge) */
  bvgAG: number;
}

/** Zum Abschluss eingefrorene Sätze: spätere Änderungen am Mitarbeiter ändern alte Abrechnungen nicht. */
export interface SaetzeSnapshot {
  ahvSatz: number; alvSatz: number; bvgSatz: number; nbuSatz: number; ktgSatz: number;
  quellensteuerPflichtig: boolean;
  quellensteuerSatz: number;
  dreizehnterLohn: boolean;
  /** Pensum in % in diesem Monat */
  pensum: number;
  eintrittsdatum: DateStr;
  pkAGSatz: number;
}

/** Abgeschlossene Lohnabrechnung (ein Monat, ein Mitarbeiter): Berechnung plus eingefrorene Stamm- und Satzdaten. */
export interface LohnEntry extends LohnResult {
  id: Id;
  employeeId: Id;
  /** `YYYY-MM` */
  monat: string;
  empSnapshot?: { name?: string; role?: string; adresse?: string; ort?: string; ahvNr?: string; personalNr?: string; lohnIban?: string };
  saetzeSnapshot?: SaetzeSnapshot;
  /** true = Monatslohn wurde für diesen Lauf manuell angepasst */
  bruttoWasOverridden?: boolean;
  bonusBeschrieb?: string;
  /** Spesen, die mit diesem Lohn ausbezahlt wurden */
  spesenIds?: Id[];
  createdAt?: Timestamp;
}

export interface DashboardRow {
  id: Id;
  cols: number;
  minH: number;
  widgets: string[];
}

export interface DashboardTemplate {
  id: Id;
  name: string;
  isPublic: boolean;
  layout: DashboardRow[];
  createdBy?: Id | null;
}

export interface AppRole {
  id: Id;
  name: string;
  /** null = alle Rechte (Administrator) */
  permissions: string[] | null;
  dashboardTemplateId?: Id | null;
  /** Altes Feld (vor den Vorlagen): feste Widget-Liste der Rolle. */
  dashboardWidgets?: string[] | DashboardRow[];
}

export interface User {
  id: Id;
  username: string;
  /** Nur Altbestand (Klartext); neue Logins nutzen passwordHash/passwordSalt. */
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  role: string;
  displayName: string;
  appRoleId?: Id;
  /** Persönliches Dashboard-Layout; überschreibt das Template der Rolle. */
  dashboardWidgets?: DashboardRow[] | null;
  /** Profilbild als Base64-Data-URL (JPEG, max. 256 px) */
  avatar?: string | null;
  /** Verknüpfter Mitarbeiter (Cloud: aus employees.appUserId abgeleitet) */
  employeeId?: Id | null;
}

/** Überstunden-Auszahlung (Employees.jsx), nicht ein Saldo-Snapshot. */
export interface OvertimeClosing {
  id: Id;
  /** Mitarbeiter-Id (heisst hier `empId`, nicht `employeeId`) */
  empId: Id | null;
  year: number | null;
  date: DateStr;
  type: string;
  hoursSettled: number;
  zuschlagPercent: number;
  stundenlohn: number;
  auszahlungBetrag: number;
}

/** Studio-Budget (StudioBudget.tsx): Annahmen für die Selbstkosten- und Honorarberechnung. Gespeichert in `settings.studioBudget`. */
export interface StudioBudgetState {
  /** Arbeitgeber-Zuschlag auf den Bruttolohn in % (Sozialabgaben, Standard 20) */
  agZuschlag: number;
  /** pro Mitarbeiter: Auto-Werte aus den Stammdaten oder manuell übersteuert */
  empRows: { id: Id; aktiv: boolean; kostenOverride: boolean; kostenManual: number; stundenOverride: boolean; stundenManual: number }[];
  /** pro interner Ausgabe (aus `internalExpenses` abgeleitet) */
  fixRows: { id: Id; aktiv: boolean; amountOverride: boolean; amountManual: number }[];
  /** zusätzliche manuelle Kostenposten pro Jahr */
  extraRows: { id: Id; label: string; amount: number; aktiv: boolean }[];
  /** zusätzliche manuelle Einnahmen */
  extraIncome: { id: Id; label: string; amount: number; aktiv: boolean }[];
  inkludiereRechnungen: boolean;
  inkludiereEntwuerfe: boolean;
  inkludiereOfferten: boolean;
  inkludiereOffertEntwuerfe: boolean;
  /** Reserve auf die Gesamtkosten in % */
  reserve: number;
  /** Anteil verrechenbarer Stunden an den Jahresstunden in % */
  produktivQuote: number;
  /** Zielmarge auf das Honorar in % */
  zielMarge: number;
  rateOverride: boolean;
  rateManual: number;
}

/** Archivierte Budgetversion («Szenario»), erzeugt mit «Als Version speichern». */
export interface StudioBudgetVersion {
  id: Id;
  name: string;
  savedAt: Timestamp;
  /** Eingabewerte (zum Wiederherstellen) */
  b: Partial<StudioBudgetState>;
  /** Ergebniszahlen zum Zeitpunkt des Speicherns (für PDF/Vergleich) */
  results: Record<string, number>;
  empSnapshot: { name: string; kosten: number; stunden: number; aktiv: boolean }[];
  fixSnapshot: { label: string; amount: number }[];
}

/** Umfrage an einem Pinnwand-Beitrag. `votes` bildet User-Id → gewählte Option-Id ab (eine Stimme pro Person). */
export interface Poll {
  question: string;
  options: { id: Id; label: string }[];
  votes: Record<Id, Id>;
}

/** Beitrag auf der Pinnwand. */
export interface BlogPost {
  id: Id;
  authorId?: Id | null;
  authorName: string;
  /** "beitrag" | "ankuendigung" | "event" */
  type: string;
  title: string;
  body: string;
  pinned: boolean;
  /** "published" | "entwurf" */
  status: string;
  poll?: Poll | null;
  /** Bild als Base64-Data-URL (JPEG, max. 1200 px breit) */
  image?: string;
  eventDate?: DateStr;
  createdAt: Timestamp;
}

export interface LetterTemplate {
  id: Id;
  name: string;
  body: string;
}

/** Stufen der Akquise-Pipeline in Reihenfolge; «gewonnen»/«verloren» sind abgeschlossen. */
export type LeadStage = "anfrage" | "besichtigung" | "offerte" | "verhandlung" | "gewonnen" | "verloren";

/** CRM: ein Akquise-Vorgang von der Anfrage bis zur Zusage oder Absage. */
export interface Lead {
  id: Id;
  title: string;
  /** Interessent/Auftraggeber (`Person.id`); darf anfangs fehlen. */
  clientId?: Id;
  stage: LeadStage;
  /** Herkunft, Eintrag aus `settings.leadSources`. */
  source?: string;
  /** Wer den Auftrag vermittelt hat (`Person.id`) — Basis der Auswertung «welcher Empfehler bringt mehr». */
  referrerId?: Id;
  /** Geschätztes Honorar in CHF **netto** (wie `Quote.sub`). */
  estimatedValue?: number;
  /** Erwarteter Entscheid. */
  expectedDecision?: DateStr;
  quoteId?: Id;
  projectId?: Id;
  /** Nur bei Stufe «verloren». */
  lostReason?: string;
  createdAt: DateStr;
  /** Datum der Zusage/Absage; wird beim Wechsel auf «gewonnen»/«verloren» gesetzt. */
  closedAt?: DateStr;
  note?: string;
}

export type ActivityType = "anruf" | "mail" | "meeting" | "besichtigung" | "karte" | "sonstiges";

/** CRM: ein Eintrag im Kontaktverlauf einer Person. Mit `followUpDate` dient er zugleich als Wiedervorlage. */
export interface Activity {
  id: Id;
  personId: Id;
  leadId?: Id;
  type: ActivityType;
  date: DateStr;
  note: string;
  followUpDate?: DateStr;
  followUpDone?: boolean;
}

/** Gesamt-State, wie er in `localStorage["studio_data_v1"]` liegt. */
export interface AppData {
  settings: Settings;
  persons: Person[];
  projects: Project[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  quotes: Quote[];
  contracts: Contract[];
  expenses: Expense[];
  internalExpenses: InternalExpense[];
  deliveryNotes: DeliveryNote[];
  protocols: Protocol[];
  employees: Employee[];
  feiertage: Feiertag[];
  absences: Absence[];
  ferienEntries: FerienEntry[];
  absenzTypes: AbsenzType[];
  lohnEntries: LohnEntry[];
  uberstundenAbschluss: OvertimeClosing[];
  dashboardTemplates: DashboardTemplate[];
  appRoles: AppRole[];
  users: User[];
  blogPosts: BlogPost[];
  letterTemplates: LetterTemplate[];
  leads: Lead[];
  activities: Activity[];
  /** Schriften und Briefpapier für das Dokument-Design (siehe `Settings.docDesign`). */
  docAssets: DocAsset[];
}

/**
 * `update(key, value)` — Top-Level-Field-Update. `value` darf auch eine Funktion des bisherigen
 * Werts sein (`update("invoices", prev => …)`); die sieht immer den neuesten Stand, auch nach einem `await`.
 */
export type UpdateFn = <K extends keyof AppData>(key: K, value: AppData[K] | ((prev: AppData[K]) => AppData[K])) => void;
/** `saveAll(newData)` — atomares Multi-Field-Update; ebenfalls mit Funktion `prev => next` möglich. */
export type SaveAllFn = (newData: AppData | ((prev: AppData) => AppData)) => void;

/** Angemeldeter Nutzer in der Session: ein `User` ohne Zugangsdaten (siehe `stripCredentials`). */
export type CurrentUser = Omit<User, "password" | "passwordHash" | "passwordSalt"> & {
  /** Nur Altbestand ohne Rolle: direkte Rechte-Liste */
  permissions?: string[] | null;
};

/** Offener Dialog, den App.jsx für Views hält (`modal`/`setModal`). `type` bestimmt, welcher Dialog es ist. */
export type ModalState = { type: string; [key: string]: unknown } | null;

/** Auftrag für die Druckansicht (`setPrintContent`); `type` wählt das Dokument in print/PrintComponents. */
// Die weiteren Felder hängen vom Dokumenttyp ab (inv, client, quote, … — siehe PrintView in print/PrintComponents.tsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrintContent = { type: string; [key: string]: any } | null;

/**
 * Props, die App.jsx den Views übergibt. Nicht jede View bekommt alle — jede
 * View deklariert, welche sie braucht (`Pick<ViewProps, "data" | "update">`).
 */
export interface ViewProps {
  data: AppData;
  update: UpdateFn;
  saveAll: SaveAllFn;
  modal: ModalState;
  setModal: (modal: ModalState) => void;
  setPrintContent: (content: PrintContent) => void;
  /** Navigation zu einer anderen Ansicht (View-Id aus NAV_ITEMS) */
  setView: (view: string) => void;
  currentUser: CurrentUser;
  /** null = alle Rechte */
  userPermissions: string[] | null;
}
