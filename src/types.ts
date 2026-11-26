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

/** Kantonskürzel (Feiertags-Vorlagen in worktime.ts). */
export type Kanton = "AG" | "AI" | "AR" | "BE" | "BL" | "BS" | "FR" | "GE" | "GL" | "GR" | "JU" | "LU" | "NE" | "NW" | "OW" | "SG" | "SH" | "SO" | "SZ" | "TG" | "TI" | "UR" | "VD" | "VS" | "ZG" | "ZH";

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
  /** Logo als data:-URL (Cloud: Dateifeld studioSettings.logoFile, beim Laden zur data:-URL). */
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
  /** MWST-Abrechnungsmethode (Art. 36/37 MWSTG): effektiv (Vorsteuerabzug, vierteljährlich) oder Saldosteuersatz (halbjährlich, ohne Vorsteuer). Ohne Angabe: effektiv. */
  mwstMethode?: "effektiv" | "saldo";
  /** Saldosteuersatz in % (von der ESTV bewilligt), nur bei `mwstMethode: "saldo"` */
  mwstSaldoSatz?: number;
  /** Abrechnungsart (Art. 39 MWSTG): nach vereinbarten (Rechnungsdatum, Standard) oder vereinnahmten Entgelten (Zahlungseingang) */
  mwstAbrechnungsart?: "vereinbart" | "vereinnahmt";
  /** Weitere Arbeitgeberbeiträge in % der AHV-Lohnsumme: Familienausgleichskasse (kantonal) */
  lohnFakSatz?: number;
  /** Verwaltungskosten der AHV-Ausgleichskasse in % der AHV/IV/EO-Beiträge (AN + AG) */
  lohnVkSatz?: number;
  /** Berufsunfallversicherung (UVG-BU, trägt der AG) in % der UVG-Lohnsumme */
  lohnBuSatz?: number;
  /** Anteil des Arbeitgebers an der Krankentaggeldprämie in % (bei paritätischer Teilung = AN-Satz) */
  lohnKtgAGSatz?: number;
  /** Auszahlung des 13. Monatslohns im Betrieb: monatlich 1/12 (Standard), mit dem Novemberlohn oder mit dem Dezemberlohn. Pro Person übersteuerbar (`Employee.dreizehnterModus`). */
  dreizehnterModus?: DreizehnterModus;
  /** Lohnauszahlung auf 5 Rappen runden (nur der Auszahlungsbetrag; Abzüge bleiben rappengenau). Standard aus. */
  lohnAuszahlungRunden5?: boolean;
  /** Rechnungs- und Offert-Total (inkl. MWST) auf 5 Rappen runden; MWST bleibt rappengenau, Differenz als Zeile «Rundung». Standard aus. */
  rechnungRunden5?: boolean;
  quoteNumberFormat?: string;
  /** Vorgabe für den Genehmigungsvermerk im Protokolldruck (pro Protokoll übersteuerbar). Standard «unterschrift». */
  protokollApproval?: ProtocolApproval;
  /** Frist in Stunden für die stillschweigende Genehmigung. Standard 24. */
  protokollApprovalHours?: number;
  /** Familienzulagen im Ein-/Austrittsmonat anteilig nach Kalendertagen (Praxis der Kasse); Standard voll. */
  familienzulagenAnteilig?: boolean;
  /** Stunden weniger Soll am Werktag vor einem ganzen Feiertag (Büro-Usanz, nicht gesetzlich); Standard 1, 0 = aus. */
  vortagStunden?: number;
  /** Welcher Tag den Vortag-Abzug trägt: «direkt» (Werktag unmittelbar vor dem Feiertag, Standard), «werktag» (nur bei Feiertagen Mo–Fr), «letzter» (letzter Arbeitstag davor, auch Freitag vor Montagsfeiertag). */
  vortagModus?: VortagModus;
  /** Mahnwesen: Verzugszins in Mahnungen ausweisen (OR 104). Standard aus. */
  verzugszinsAktiv?: boolean;
  /** Verzugszins in % p.a.; Standard 5 (gesetzlicher Satz). */
  verzugszinsSatz?: number;
  /** Mahnwesen: Mahngebühren verlangen (nur wenn mit dem Kunden vereinbart). Standard aus. */
  mahngebuehrAktiv?: boolean;
  /** Mahngebühr je Stufe in CHF (Index 0 = Zahlungserinnerung); Standard [0, 20, 30]. */
  mahngebuehren?: number[];
  /** Kanton für die Feiertags-Vorlage (Einstellungen → Feiertage); ohne Angabe Zürich. */
  kanton?: Kanton;
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
  /** Datei als data:-URL (Cloud: Dateifeld docAssets.file, beim Laden zur data:-URL). */
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

/**
 * Nutzung eines Projekts für die Aufwandschätzung aus eigenen Projekten (utils `calcOfficeBenchmarks`).
 * Gleiche sechs Gruppen wie die Grundmodelle der ETH Value-Methode, damit Zahlen vergleichbar bleiben.
 */
export type ProjectUsage = "wohnen" | "arbeiten" | "industrie" | "lager" | "bildung" | "gesundheit";

/** In einer Offerte festgehaltene Grundlage der Schätzung aus eigenen Projekten (Nachvollziehbarkeit). */
export interface QuoteEstimate {
  usage: ProjectUsage;
  /** Geschossfläche GF nach SIA 416 in m² */
  floorArea: number;
  /** Anpassungsfaktor für Komplexität/Kontext (1 = übliches Projekt) */
  factor: number;
  /** Anzahl abgeschlossener eigener Projekte, auf denen die Schätzung beruht */
  sampleCount: number;
  /** Median Stunden je m² GF zum Zeitpunkt der Schätzung */
  hoursPerM2: number;
}

/** Terminprogramm: «planung» = Planungsterminprogramm (SIA-Phasen), «bau» = Bauprogramm (BKP-Arbeiten). */
export type ScheduleTrack = "planung" | "bau";

/** Abhängigkeit «beginnt nach»: das Element startet frühestens `lagDays` Tage nach dem Ende von `fromId`. */
export interface ScheduleDependency {
  fromId: Id;
  /** Abstand in Kalendertagen nach dem Ende des Vorgängers (Standard 0, negativ = Überlappung) */
  lagDays?: number;
  /** false = Nachfolger rutscht beim Verschieben nicht automatisch mit (nur Hinweis bei Konflikt) */
  auto?: boolean;
}

/**
 * Symbol eines Termins (Meilenstein-Zeile), siehe `SCHEDULE_MARKERS` in schedule.ts:
 * ◆ meilenstein · ▼ abgabe · ◇ entscheid · ● sitzung · ■ lieferung · ★ abnahme · ▲ vertrag.
 */
export type ScheduleMarker = "meilenstein" | "abgabe" | "entscheid" | "sitzung" | "lieferung" | "abnahme" | "vertrag";

/**
 * Darstellung eines Balkens: leer = eigene Leistung, «extern» = durch Dritte (Behörde, Bauherr; nur umrandet),
 * «reserve» = Reserve/Puffer (schraffiert), «serie» = wiederkehrender Termin (Symbol alle `repeatDays` Tage).
 */
export type ScheduleVariant = "extern" | "reserve" | "serie";

/** Eine Zeile im Terminprogramm: Aufgabe (Balken) oder Meilenstein/Termin (Symbol, Start = Ende). */
export interface ScheduleItem {
  id: Id;
  label: string;
  kind: "task" | "milestone";
  /** Termin: Symbol (fehlt = Meilenstein ◆); Terminserie: Symbol der einzelnen Termine (fehlt = Sitzung ●) */
  marker?: ScheduleMarker;
  /** Balken: Darstellung (fehlt = eigene Leistung) */
  variant?: ScheduleVariant;
  /** Terminserie: Abstand der Termine in Tagen (Standard 14) */
  repeatDays?: number;
  track: ScheduleTrack;
  /** Gruppe für die Darstellung, z.B. «31 Vorprojekt» oder «Rohbau»; leer = ohne Gruppe */
  group?: string;
  /** Planung: zugehörige SIA-Phase (für Soll/Ist der Stunden) */
  phaseId?: string;
  /** Bau: BKP-Nummer, z.B. «211» */
  bkp?: string;
  /** erster Tag (inklusive) */
  start: DateStr;
  /** letzter Tag (inklusive); bei Meilensteinen = start */
  end: DateStr;
  /** verantwortliche Person im Büro (Employee.id) */
  assigneeId?: Id | null;
  /** ausführende Firma (Person.id), v.a. im Bauprogramm */
  contractorId?: Id | null;
  /** Fortschritt 0–100 % */
  progress?: number;
  note?: string;
  deps?: ScheduleDependency[];
  /** übernommen aus einem Protokoll (Aufgabe, Beschluss oder nächste Sitzung), siehe schedule.ts `protocolSuggestions` */
  source?: ScheduleSource;
}

/** Herkunft eines Eintrags aus einem Protokoll. `text` hält Art+Text der Stelle, damit Kopien in Folgeprotokollen gefunden werden. */
export interface ScheduleSource {
  protocolId: Id;
  /** Eintrag im Protokoll; fehlt bei «nächste Sitzung» */
  entryId?: Id;
  kind: "aufgabe" | "beschluss" | "sitzung";
  /** normalisierter Text der Stelle (Erkennung in Folgeprotokollen) */
  text?: string;
}

/** Eingefrorener Stand eines Terminprogramms zum Vergleich (Soll) mit dem aktuellen Stand. */
export interface ScheduleBaseline {
  savedAt: Timestamp;
  items: { id: Id; start: DateStr; end: DateStr }[];
}

/** Unterbruch im Programm (Bauferien, Betriebsferien): schraffiert über alle Zeilen, verschiebt nichts. */
export interface ScheduleBreak {
  id: Id;
  label: string;
  start: DateStr;
  end: DateStr;
  /** nur in diesem Programm; fehlt = in Planung und Bau */
  track?: ScheduleTrack;
}

/** Terminprogramm eines Projekts (beide Programme in einer Liste, getrennt über `track`). */
export interface ProjectSchedule {
  items: ScheduleItem[];
  baselines?: Partial<Record<ScheduleTrack, ScheduleBaseline>>;
  /** Bauferien/Unterbrüche */
  breaks?: ScheduleBreak[];
  /** ausgeblendete Vorschläge aus Protokollen (Schlüssel aus `protocolSuggestions`) */
  dismissed?: string[];
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
  /** Nutzung (für die Aufwandschätzung aus eigenen Projekten) */
  usage?: ProjectUsage | "";
  /** Geschossfläche GF nach SIA 416 in m² (für die Aufwandschätzung) */
  floorArea?: number | null;
  /** Terminprogramm (Planung und Bau), siehe schedule.ts */
  schedule?: ProjectSchedule | null;
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
  /** Verzugszins im Schreiben (CHF), Zinstage und Satz — damit ein Nachdruck denselben Betrag zeigt */
  zins?: number;
  zinsTage?: number;
  zinsSatz?: number;
  /** Mahngebühren bis und mit dieser Stufe (CHF) */
  gebuehr?: number;
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
  /**
   * Abrechnungsblock einer Akonto-/Teilrechnung (Honorar, bisher gestellt, diese Rechnung, Rest), beim
   * Speichern und beim Wechsel aus dem Entwurf festgehalten, damit ein Nachdruck dieselben Zahlen zeigt
   * (`invoiceBillingSummary`, views/invoices/invoiceHelpers.ts). Fehlt bei anderen Rechnungsarten.
   */
  billingSummary?: InvoiceBillingSummary | null;
  createdAt?: Timestamp;
}

/** Stand der Honorarabrechnung auf einer Akonto-/Teilrechnung; alle Beträge netto exkl. MWST, auf Rappen. */
export interface InvoiceBillingSummary {
  /** Honorar total: Pauschalhonorar des Projekts oder Netto der Offerte (`quoteNumber`) */
  fee: number;
  quoteNumber?: string;
  /** frühere gestellte Rechnungen desselben Projekts bzw. derselben Offerte (ohne Entwürfe, ohne diese) */
  prior: number;
  priorNumbers: string[];
  /** diese Rechnung, netto nach Rabatt */
  thisNet: number;
  /** offen nach dieser Rechnung = fee − prior − thisNet (negativ = über dem Honorar) */
  rest: number;
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
  /** Modus "manual": Grundlage, falls die Stunden aus eigenen Projekten geschätzt wurden */
  estimate?: QuoteEstimate | null;
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
  /**
   * Beleg: data:-URL (frisch hochgeladen, lokal) oder Verweis auf die Datei — Datenordner
   * «rapport-datei:…», Cloud «rapport-pb:expenses/<id>/<Datei>». Anzeigen über useAttachment.
   */
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
  /** Letzter Monat einer wiederkehrenden Ausgabe (leer = läuft weiter) */
  recurringUntil?: DateStr | null;
  /**
   * Frühere Beträge einer wiederkehrenden Ausgabe (Betragsänderung «gültig ab»): bis (ausschliesslich) Monat `before`
   * («YYYY-MM») galt `amount`; ab dem letzten `before` gilt das Feld `amount` der Ausgabe. Cloud: JSON-Spalte.
   */
  amountHistory?: { before: string; amount: number }[];
  /** Beleg wie `Expense.receiptData` (Cloud: «rapport-pb:internalExpenses/<id>/<Datei>»). */
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
  /** Austritt: der letzte Monat wird anteilig nach Kalendertagen abgerechnet */
  austrittsdatum?: DateStr;
  /** Pensionskasse laut PK-Ausweis, CHF pro Monat (Arbeitnehmer); gesetzt → ersetzt den %-Satz */
  pkBeitragAN?: number | null;
  /** Pensionskasse laut PK-Ausweis, CHF pro Monat (Arbeitgeber) */
  pkBeitragAG?: number | null;
  /** Familienzulagen (Kinder-/Ausbildungszulagen) CHF pro Monat; nicht AHV-pflichtig, von der FAK rückvergütet */
  familienzulagen?: number | null;
  /** AHV-Rentner:in (Referenzalter erreicht): Freibetrag CHF 1'400/Monat, keine ALV, keine BVG-Pflicht. Wird ab 65 auch aus dem Geburtsdatum erkannt. */
  ahvRentner?: boolean;
  /**
   * Ferien-Übertrag in Stunden je Jahr (Schlüssel = Jahr, in das übertragen wird). Mit `saldoStichtag`
   * gilt der Wert des Stichtag-Jahres als Ferienguthaben per Stichtag (Anspruch und Bezug zählen ab dann).
   */
  ferienUebertragVorjahr?: Record<string, number>;
  /**
   * Stichtag für den Saldo-Übertrag (Umstieg von Excel o.ä.): Soll, Ist, Ferien und Absenzen vor diesem
   * Datum zählen nicht; der Überstundensaldo startet mit `saldoUebertragStunden`.
   */
  saldoStichtag?: DateStr;
  /** Überstundensaldo per `saldoStichtag` in Stunden (negativ = Minusstunden). */
  saldoUebertragStunden?: number | null;
  /** Pensumwechsel: ab einem Datum gilt ein anderes Pensum (und ggf. andere Wochenstunden). Vor dem ersten Eintrag gelten `pensum`/`wochenstunden`. */
  pensumVerlauf?: PensumWechsel[];
  /** Lohnänderungen über die Zeit (`monatslohn` = Lohn ab Eintritt); im Wechselmonat tagesgenau anteilig. */
  lohnVerlauf?: LohnWechsel[];
  /** 13. Monatslohn: Auszahlung nur für diese Person übersteuern (sonst gilt die Büro-Einstellung). */
  dreizehnterModus?: DreizehnterModus;
  /** Umstieg mitten im Jahr: Lohnsummen aus dem Vorsystem, die in den kumulierten Höchstlohn und den 13. Monatslohn einfliessen. */
  lohnVorsystem?: LohnVorsystem[];
  /** Cloud-User, der diesem Mitarbeiter entspricht (Self-Service-Ansichten) */
  appUserId?: Id | null;
  active?: boolean;
  /** Adresse (Self-Service unter «Mein Profil»; getrennt von `adresse`/`ort` der Personalstammdaten) */
  street?: string;
  zip?: string;
  city?: string;
}

/** Auszahlung des 13. Monatslohns: monatlich 1/12, mit dem Novemberlohn oder mit dem Dezemberlohn (bei Austritt immer anteilig im Austrittsmonat). */
export type DreizehnterModus = "monatlich" | "november" | "dezember";

/** Welcher Tag vor einem ganzen Feiertag weniger Soll bekommt (Einstellungen → Feiertage, `vortagModus`). */
export type VortagModus = "direkt" | "werktag" | "letzter";

/**
 * Lohnsummen aus dem Vorsystem für einen Umstieg mitten im Jahr: gelten für die Abrechnungen im Jahr `jahr`
 * nach dem Monat `bisMonat` (die Monate bis und mit `bisMonat` ersetzt das Vorsystem).
 */
export interface LohnVorsystem {
  jahr: number;
  /** letzter Monat, den das Vorsystem abgerechnet hat (`YYYY-MM`) */
  bisMonat: string;
  /** Σ AHV-pflichtiger Lohn bisher (Bruttolohn Total inkl. bezahltem 13. Monatslohn und Boni) */
  brutto: number;
  /** Σ ALV-/NBU-pflichtiger Lohn bisher (bis Höchstlohn); leer = AHV-Lohn, höchstens der anteilige Höchstlohn bis `bisMonat` */
  alvBasis?: number | null;
  /** Σ bereits ausbezahlter 13. Monatslohn */
  dreizehnter?: number | null;
  /** Σ Monatslöhne (ohne 13. und Boni) bisher, Basis des 13.; leer = AHV-Lohn minus bezahlter 13. */
  monatslohnSumme?: number | null;
}

/** Eine Zeile der Nachzahlung: Differenz des Monatslohns eines abgeschlossenen Monats (und Anteil 13. Monatslohn). */
export interface NachzahlungMonat {
  monat: string;
  /** Differenz Monatslohn neu − abgerechnet */
  betrag: number;
  /** Anteil 13. Monatslohn (1/12), wenn er mit dieser Nachzahlung ausbezahlt wird */
  dreizehnter?: number;
}

/** Lohnänderung: ab `ab` gilt dieser Monatslohn (100-%-Basis). */
export interface LohnWechsel {
  ab: DateStr;
  monatslohn: number;
}

export interface PensumWechsel {
  ab: DateStr;
  pensum: number;
  /** leer = Wochenstunden laufen weiter wie zuvor */
  wochenstunden?: number | null;
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
  /** Ausbezahlte Überstunden (Jahresabschluss), mit diesem Lohn abgerechnet; AHV-/ALV-/UVG-/QST-pflichtig, nicht PK */
  ueberstundenBetrag?: number;
  /** Brutto + 13. + Bonus + Überstunden — Basis aller Abzüge */
  bruttoTotal: number;
  /** ALV-/UVG-pflichtiger Teil (Höchstlohn kumuliert); fehlt bei Abrechnungen vor 26.11 (dort = bruttoTotal) */
  alvBasis?: number;
  ahv: number; alv: number; bvg: number; nbu: number; ktg: number; qst: number;
  totalAbzuege: number;
  netto: number;
  spesenTotal: number;
  /** Netto + Spesen */
  auszahlung: number;
  /** Arbeitgeberanteil Pensionskasse (nicht Teil der Abzüge) */
  bvgAG: number;
  /** AHV-pflichtiger Lohn nach Rentnerfreibetrag (fehlt bei Abrechnungen vor 26.11 = bruttoTotal) */
  ahvBasis?: number;
  /** Familienzulagen (in der Auszahlung, nicht AHV-pflichtig) */
  familienzulagen?: number;
  /** Weitere AG-Kosten (ab 26.11; fehlen bei älteren Abrechnungen): FAK, AHV-Verwaltungskosten, UVG-BU, KTG-AG */
  agFak?: number;
  agVk?: number;
  agBu?: number;
  agKtg?: number;
  /** Hinweise zur Abrechnung (z.B. BVG unter Eintrittsschwelle, Rentnerfreibetrag) */
  hinweise?: string[];
  /** Wie der 13. Monatslohn in diesem Monat ausbezahlt wurde: monatlich 1/12, einmal (Novemberlohn/Dezemberlohn) oder anteilig bei Austritt */
  dreizehnterArt?: "monatlich" | "einmal" | "austritt";
  /** Nachzahlung für rückwirkende Lohnänderungen (sozialversicherungspflichtig, im Bruttolohn Total); negativ = Rückforderung */
  nachzahlung?: number;
  /** Differenz der Monatslöhne in der Nachzahlung, die den 13. Monatslohn des Jahres erst bei der Auszahlung erhöht (Auszahlung Nov/Dez) */
  nachzahlungBasis?: number;
  /** Rundung des Auszahlungsbetrags auf 5 Rappen (Einstellung), in `auszahlung` enthalten */
  rundung?: number;
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
  /** ab 26.11 */
  austrittsdatum?: DateStr;
  pkBeitragAN?: number | null;
  pkBeitragAG?: number | null;
  ahvRentner?: boolean;
  agSaetze?: { fak: number; vk: number; bu: number; ktgAG: number | null };
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
  /** true = Pensum wurde für diesen Lauf manuell angepasst (dann keine Nachzahlung-Prüfung für diesen Monat) */
  pensumWasOverridden?: boolean;
  bonusBeschrieb?: string;
  /** Bezeichnung der Nachzahlung («Nachzahlung Lohn 03.2026–05.2026») */
  nachzahlungBeschrieb?: string;
  /** Monate, für die diese Abrechnung nachzahlt (Differenz je Monat) */
  nachzahlungMonate?: NachzahlungMonat[];
  /** Spesen, die mit diesem Lohn ausbezahlt wurden */
  spesenIds?: Id[];
  /** Überstunden-Auszahlungen (uberstundenAbschluss), die mit diesem Lohn abgerechnet wurden */
  ueberstundenIds?: Id[];
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
  /** wird mit dem Lohn ausbezahlt (Lohnlauf übernimmt sie als Posten); fehlt bei früher separat bezahlten */
  imLohn?: boolean;
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
  /** Bild als Base64-Data-URL (JPEG, max. 1200 px breit; Cloud: Dateifeld blogPosts.imageFile, beim Laden zur data:-URL) */
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
  /** Interner Ressourcenplan (Terminplanung → «Auslastung»): wer an was bis wann, unabhängig von den Projekten. */
  resourcePlan: ResourceEntry[];
}

/**
 * Eintrag im internen Ressourcenplan: wer arbeitet an was, von–bis, zu wie viel Prozent der verfügbaren Zeit.
 * Bewusst ohne Verknüpfung mit den Terminprogrammen der Projekte (nur internes Rechnen).
 */
export interface ResourceEntry {
  id: Id;
  employeeId: Id;
  /** «an was» (Freitext, z.B. «Wettbewerb Schulhaus») */
  label: string;
  /** optional: Projekt — nur für Name/Farbe in der Ansicht */
  projectId?: Id | null;
  dateFrom: DateStr;
  dateTo: DateStr;
  /** Anteil der verfügbaren Zeit in Prozent (1–100) */
  pensum: number;
  note?: string;
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
