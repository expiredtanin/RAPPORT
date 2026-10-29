// Stammdaten-Import aus CSV/Excel (z.B. Exporte aus Archifile, bfiles oder einem
// Online-ERP) in 5 Schritten: Datentyp wählen → Datei laden → Spalten zuordnen →
// Werte zuordnen (Aufzählungen und Verweise auf Personen/Mitarbeiter/Projekte) →
// Vorschau mit Duplikat-Erkennung → Import.
//
// Aufbau:
//   - Parser: `parseCSV` (Semikolon oder Komma, Anführungszeichen) und
//     `parseSpreadsheet` (ExcelJS); beide liefern Zeilen als String-Arrays.
//   - Pro Datentyp eine Konfiguration in `ENTITY_CONFIGS`: Felder mit Aliasen für
//     die automatische Spaltenerkennung, `buildRecord` (Standardwerte + Mapping →
//     fertiger Datensatz), optional `postProcess` (abgeleitete Felder wie Minuten
//     oder Summen), `dedupKey`/`dedupAgainst` (Duplikate gegen Bestand und innerhalb
//     der Datei).
//   - Feldarten: `enum` (Auswahlwerte), `fk` (Verweis auf andere Collection, ggf.
//     mit automatisch angelegtem Stub), `boolLike`, `numeric`, `date`.
// Duplikate und Zeilen mit fehlenden Pflichtfeldern sind standardmässig übersprungen
// (pro Zeile umschaltbar). Neu hinzugefügte Datensätze werden an die bestehenden
// angehängt; nichts wird überschrieben oder gelöscht.
//
// Die Datensätze sind hier bewusst frei geformt (`ImportRecord`): welche Felder
// entstehen, hängt von der Konfiguration des gewählten Datentyps ab. Das exakte
// Datenmodell steht in types.ts; die `buildRecord`-Funktionen müssen dazu passen.

import { useMemo, useState } from "react";
import { generateId, getAbsenzTypes, roundCHF } from "../utils";
import { PROJECT_TYPES, CONTACT_TYPES, CONTACT_CATEGORIES, EXPENSE_CATEGORIES, INTERNAL_EXPENSE_CATEGORIES } from "../constants";
import { Header, FormField } from "../components/UI";
import { isCloudBackend } from "../storage/adapter";
import type { AppData, ViewProps } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImportRecord = Record<string, any>;
type Row = string[];

/** Beschreibung einer importierbaren Spalte/eines Zielfelds. */
interface ImportField {
  key: string;
  label: string;
  aliases?: string[];
  required?: boolean;
  numeric?: boolean;
  date?: boolean;
  boolLike?: boolean;
  /** Auswahlwerte (oder Funktion, die sie aus den Daten ableitet) */
  enum?: string[] | ((data: AppData) => string[]);
  /** Wandelt die gewählte Beschriftung in den gespeicherten Wert um (z.B. Absenztyp-Label → Id) */
  valueOf?: (data: AppData, label: string) => unknown;
  /** Verweis auf eine andere Collection (siehe FK_TARGETS) */
  fk?: "persons" | "employees" | "projects";
}

/** Zielcollection eines Verweisfeldes. */
interface FkTarget {
  dataKey: "persons" | "employees" | "projects";
  labelOf: (x: ImportRecord) => string;
  matchKeys: (x: ImportRecord) => string[];
  allowNew: boolean;
  buildStub?: (name: string) => ImportRecord;
}

/** Konfiguration eines Datentyps. */
interface EntityConfig {
  label: string;
  resultLabel: string;
  /** Schlüssel in `AppData`, an den angehängt wird */
  targetKey: keyof AppData;
  fields: ImportField[];
  /** Feld, das nicht zugeordnete Spalten als «Spalte: Wert» aufnimmt */
  restField?: string;
  restFieldLabel?: string;
  uploadHint?: string;
  postProcess?: (values: ImportRecord) => void;
  buildRecord: (values: ImportRecord) => ImportRecord;
  dedupKey: (record: ImportRecord) => string;
  dedupAgainst: (data: AppData) => { key: string }[];
}

/** Vergleichsform eines Spaltentitels: Kleinbuchstaben, Umlaute ausgeschrieben, nur a–z und 0–9. */
function normalizeHeader(s: unknown): string {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

// Für den lockeren Alias-Abgleich: Wort-Tokens statt einer zusammengezogenen
// Zeichenkette, sonst matcht ein kurzer Alias wie "partner" fälschlich als
// Teilstring von "Ansprechpartner".
function wordTokens(s: unknown): string[] {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/** `YYYY-MM-DD` oder `TT.MM.JJJJ` / `TT/MM/JJJJ` → ISO-Datum; sonst "". */
function parseFlexibleDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

// "08:00", "8:00:00" -> Minuten seit Mitternacht. Für die Dauer-Berechnung
// bei Zeiterfassungs-Import aus Von/Bis-Spalten.
function parseTimeToMinutesOfDay(raw: unknown): number | null {
  const m = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Einfacher RFC4180-naher CSV-Parser (quotierte Felder, "" für escaped Quotes).
// Semikolon statt Komma als Trenner, weil DE/CH-Excel-Exporte meist Semikolon
// verwenden (Komma ist dort das Dezimaltrennzeichen).
function parseCSV(text: string): Row[] {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: Row[] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/** Liest die erste Tabelle einer .csv- oder .xlsx-Datei als Zeilen von Texten. */
async function parseSpreadsheet(file: File): Promise<Row[]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCSV(await file.text());
  }
  // ExcelJS (~1 MB) erst laden, wenn wirklich eine Excel-Datei kommt
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    rows.push((row.values as unknown[]).slice(1).map((v: unknown) => {
      if (v == null) return "";
      if (v instanceof Date) {
        // Excel legt reine Uhrzeit-Zellen (z.B. eine Von/Bis-Spalte) als Datum auf
        // seinem internen Epoch-Tag (30.12.1899) ab — sonst würde daraus fälschlich
        // ein Datum statt einer Uhrzeit "HH:MM".
        const isPureTime = v.getUTCFullYear() === 1899 && v.getUTCMonth() === 11 && v.getUTCDate() === 30;
        return isPureTime
          ? `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`
          : v.toISOString().slice(0, 10);
      }
      if (typeof v === "object") return String((v as { text?: unknown; result?: unknown }).text ?? (v as { result?: unknown }).result ?? "");
      return String(v);
    }));
  });
  return rows;
}

// Ziel-Collections für fk-Felder: welche Daten-Collection, wie beschriftet man
// einen Treffer, darf bei fehlendem Treffer ein Stub neu angelegt werden.
const FK_TARGETS: Record<string, FkTarget> = {
  persons: {
    dataKey: "persons",
    labelOf: p => p.name,
    matchKeys: p => [p.name],
    allowNew: true,
    buildStub: name => ({
      id: generateId(), name, type: "", street: "", zip: "", city: "", country: "CH",
      email: "", phone: "", website: "", note: "", contacts: [], honorarOffers: [],
      isAuftraggeber: true, isPartner: true, // Altflags, filtern nichts mehr (siehe Person in types.ts)
    }),
  },
  employees: {
    dataKey: "employees",
    labelOf: e => e.name,
    matchKeys: e => [e.name],
    allowNew: true,
    buildStub: name => ({
      id: generateId(), name, personalNr: "", pensum: 100, wochenstunden: 35, ferienWochen: 5,
      ferienUebertragVorjahr: {}, active: true,
    }),
  },
  projects: {
    dataKey: "projects",
    labelOf: p => `${p.number ? p.number + " – " : ""}${p.name}`,
    // Anzeige-Label ("Nummer – Name") ist etwas anderes als das, wonach eine externe
    // Datei üblicherweise referenziert (nur Nummer ODER nur Name) — deshalb eigene
    // Match-Kandidaten statt gegen das kombinierte Label zu vergleichen.
    matchKeys: p => [p.number, p.name, `${p.number} ${p.name}`].filter(Boolean),
    allowNew: false, // bewusst kein Stub — ein leeres Projekt anzulegen bringt mehr Verwirrung als Nutzen
  },
};

function resolveEnumOptions(field: ImportField, data: AppData): string[] {
  return typeof field.enum === "function" ? field.enum(data) : (field.enum || []);
}
function resolveEnumValue(field: ImportField, data: AppData, label: string): unknown {
  // Object.hasOwn statt "field.valueOf ? ..." — jedes Objekt erbt sonst
  // Object.prototype.valueOf() (gibt nur `field` selbst zurück), das wäre
  // immer wahrheitswertig und würde Felder ohne eigenes valueOf kaputt machen.
  return Object.hasOwn(field, "valueOf") ? field.valueOf!(data, label) : label;
}

const PERSON_FIELDS: ImportField[] = [
  { key: "name", label: "Name / Firma", required: true, aliases: ["name", "firma", "firmenname", "kundenname", "company", "companyname", "client", "kunde"] },
  { key: "street", label: "Strasse", aliases: ["strasse", "street", "adresse", "address"] },
  { key: "zip", label: "PLZ", aliases: ["plz", "zip", "postleitzahl", "postcode"] },
  { key: "city", label: "Ort", aliases: ["ort", "city", "stadt"] },
  { key: "country", label: "Land", aliases: ["land", "country"] },
  { key: "email", label: "E-Mail", aliases: ["email", "mail", "emailadresse"] },
  { key: "phone", label: "Telefon", aliases: ["telefon", "phone", "tel", "telefonnummer"] },
  { key: "website", label: "Website", aliases: ["website", "web", "url"] },
  { key: "note", label: "Notiz", aliases: ["notiz", "note", "bemerkung", "kommentar"] },
  // Kategorie wie im Kontakte-Dialog; die Excel-Zelle enthält die Bezeichnung (z.B. «Unternehmer»), gespeichert wird die Id.
  { key: "category", label: "Kategorie", aliases: ["kategorie", "category", "kontaktart"], enum: CONTACT_CATEGORIES.map(c => c.label),
    valueOf: (_data, label) => CONTACT_CATEGORIES.find(c => c.label === label)?.id },
  { key: "type", label: "Typ / Branche", aliases: ["typ", "branche", "type", "art"], enum: CONTACT_TYPES },
  { key: "contactName", label: "Ansprechpartner (Name)", aliases: ["ansprechpartner", "kontaktperson"] },
  { key: "contactPosition", label: "Ansprechpartner (Position)", aliases: ["ansprechpartner position", "kontaktperson position"] },
  { key: "contactPhone", label: "Ansprechpartner (Telefon)", aliases: ["ansprechpartner telefon", "kontakt telefon"] },
  { key: "contactEmail", label: "Ansprechpartner (E-Mail)", aliases: ["ansprechpartner email", "kontakt email"] },
];

const PROJECT_FIELDS: ImportField[] = [
  { key: "number", label: "Projektnummer", aliases: ["nummer", "number", "projektnummer", "projectnumber", "nr"] },
  { key: "name", label: "Projektname", required: true, aliases: ["name", "projektname", "projectname", "titel", "title", "bezeichnung"] },
  { key: "clientId", label: "Kunde/Auftraggeber", aliases: ["kunde", "auftraggeber", "client", "kundenname"], fk: "persons" },
  { key: "category", label: "Kategorie", aliases: ["kategorie", "category", "art"], enum: PROJECT_TYPES },
  { key: "billingType", label: "Abrechnungsart", aliases: ["abrechnungsart", "billingtype", "verrechnung"], enum: ["stundensatz", "pauschal"] },
  { key: "hourlyRate", label: "Stundensatz", aliases: ["stundensatz", "hourlyrate", "rate"], numeric: true },
  { key: "budget", label: "Budget", aliases: ["budget"], numeric: true },
  { key: "status", label: "Status", aliases: ["status"], enum: ["aktiv", "abgeschlossen", "pausiert"] },
  { key: "description", label: "Beschreibung", aliases: ["beschreibung", "description", "notiz"] },
  { key: "startDate", label: "Startdatum", aliases: ["startdatum", "startdate", "beginn", "datum"], date: true },
];

const EMPLOYEE_FIELDS: ImportField[] = [
  { key: "name", label: "Name", required: true, aliases: ["name", "mitarbeiter", "mitarbeitername"] },
  { key: "role", label: "Rolle", aliases: ["rolle", "funktion", "position", "role"] },
  { key: "personalNr", label: "Personalnummer", aliases: ["personalnummer", "personalnr", "mitarbeiternummer"] },
  { key: "eintrittsdatum", label: "Eintrittsdatum", required: true, aliases: ["eintrittsdatum", "eintritt", "startdatum", "beginn"], date: true },
  { key: "geburtsdatum", label: "Geburtsdatum", aliases: ["geburtsdatum", "geburtstag", "geboren"], date: true },
  { key: "email", label: "E-Mail", aliases: ["email", "mail"] },
  { key: "adresse", label: "Adresse", aliases: ["adresse", "strasse", "address"] },
  { key: "ort", label: "Ort", aliases: ["ort", "stadt", "city"] },
  { key: "ahvNr", label: "AHV-Nr.", aliases: ["ahvnr", "ahvnummer", "ahv"] },
  { key: "pensum", label: "Pensum (%)", aliases: ["pensum", "beschaeftigungsgrad"], numeric: true },
  { key: "wochenstunden", label: "Wochenstunden", aliases: ["wochenstunden"], numeric: true },
  { key: "ferienWochen", label: "Ferienwochen", aliases: ["ferienwochen"], numeric: true },
  { key: "monatslohn", label: "Monatslohn", aliases: ["monatslohn", "lohn", "gehalt"], numeric: true },
  { key: "lohnIban", label: "IBAN (Lohn)", aliases: ["iban", "lohniban"] },
  { key: "dreizehnterLohn", label: "13. Monatslohn", aliases: ["13lohn", "dreizehnterlohn"], boolLike: true },
  { key: "ahvSatz", label: "AHV/IV/EO-Satz AN (%)", aliases: ["ahvsatz"], numeric: true },
  { key: "alvSatz", label: "ALV-Satz AN (%)", aliases: ["alvsatz"], numeric: true },
  { key: "bvgSatz", label: "BVG-Satz AN (%)", aliases: ["bvgsatz"], numeric: true },
  { key: "pkAGSatz", label: "PK/BVG-Satz AG (%)", aliases: ["pkagsatz"], numeric: true },
  { key: "nbuSatz", label: "NBU-Satz (%)", aliases: ["nbusatz"], numeric: true },
  { key: "ktgSatz", label: "KTG-Satz (%)", aliases: ["ktgsatz"], numeric: true },
  { key: "quellensteuerPflichtig", label: "Quellensteuerpflichtig", aliases: ["quellensteuerpflichtig"], boolLike: true },
  { key: "quellensteuerSatz", label: "Quellensteuer-Satz (%)", aliases: ["quellensteuersatz"], numeric: true },
];

const TIME_FIELDS: ImportField[] = [
  { key: "date", label: "Datum", required: true, aliases: ["datum", "date", "tag"], date: true },
  { key: "projectId", label: "Projekt", required: true, aliases: ["projekt", "projektnummer", "project"], fk: "projects" },
  { key: "employeeId", label: "Mitarbeiter", aliases: ["mitarbeiter", "mitarbeitername", "name", "employee"], fk: "employees" },
  { key: "hoursDecimal", label: "Stunden (Dezimal, z.B. 7.5)", aliases: ["stunden", "std", "hours", "dauer"], numeric: true },
  { key: "minutesRaw", label: "Minuten", aliases: ["minuten", "minutes"], numeric: true },
  { key: "startTime", label: "Von (HH:MM)", aliases: ["von", "start", "beginn", "startzeit"] },
  { key: "endTime", label: "Bis (HH:MM)", aliases: ["bis", "ende", "endzeit", "end"] },
  { key: "description", label: "Beschreibung", aliases: ["beschreibung", "taetigkeit", "text"] },
];

const FERIEN_FIELDS: ImportField[] = [
  { key: "employeeId", label: "Mitarbeiter", required: true, aliases: ["mitarbeiter", "name", "employee"], fk: "employees" },
  { key: "dateFrom", label: "Von", required: true, aliases: ["von", "datumvon", "start", "beginn"], date: true },
  { key: "dateTo", label: "Bis", required: true, aliases: ["bis", "datumbis", "ende", "end"], date: true },
  { key: "note", label: "Notiz", aliases: ["notiz", "bemerkung", "note"] },
];

const ABSENCE_FIELDS: ImportField[] = [
  { key: "employeeId", label: "Mitarbeiter", required: true, aliases: ["mitarbeiter", "name", "employee"], fk: "employees" },
  {
    key: "type", label: "Typ", required: true, aliases: ["typ", "art", "grund", "type"],
    enum: data => getAbsenzTypes(data).map(t => t.label),
    valueOf: (data, label) => getAbsenzTypes(data).find(t => t.label === label)?.id || "",
  },
  { key: "dateFrom", label: "Von", required: true, aliases: ["von", "datumvon", "start", "beginn"], date: true },
  { key: "dateTo", label: "Bis", required: true, aliases: ["bis", "datumbis", "ende", "end"], date: true },
  { key: "note", label: "Notiz", aliases: ["notiz", "bemerkung", "note"] },
];

const EXPENSE_FIELDS: ImportField[] = [
  { key: "date", label: "Datum", required: true, aliases: ["datum", "date"], date: true },
  { key: "category", label: "Kategorie", aliases: ["kategorie", "category", "art"], enum: data => data.settings?.expenseCategories || EXPENSE_CATEGORIES },
  { key: "employeeId", label: "Mitarbeiter", aliases: ["mitarbeiter", "name", "employee"], fk: "employees" },
  { key: "projectId", label: "Projekt (optional)", aliases: ["projekt", "projektnummer", "project"], fk: "projects" },
  { key: "description", label: "Beschreibung", aliases: ["beschreibung", "text", "notiz"] },
  { key: "amount", label: "Betrag", required: true, aliases: ["betrag", "amount", "summe"], numeric: true },
  { key: "mwstRate", label: "MwSt.-Satz (%)", aliases: ["mwst", "mwstsatz", "vatrate"], numeric: true },
  { key: "inclMwst", label: "Betrag inkl. MwSt.", aliases: ["inklmwst", "inklusive", "brutto"], boolLike: true },
  { key: "status", label: "Status", aliases: ["status"], enum: ["offen", "genehmigt", "auf nächsten Lohn", "ausbezahlt"] },
];

const INTERNAL_EXPENSE_FIELDS: ImportField[] = [
  { key: "date", label: "Datum", required: true, aliases: ["datum", "date"], date: true },
  { key: "category", label: "Kategorie", aliases: ["kategorie", "category", "art"], enum: data => data.settings?.internalExpenseCategories || INTERNAL_EXPENSE_CATEGORIES },
  { key: "description", label: "Beschreibung", aliases: ["beschreibung", "text", "notiz"] },
  { key: "amount", label: "Betrag", required: true, aliases: ["betrag", "amount", "summe"], numeric: true },
  { key: "mwstRate", label: "MwSt.-Satz (%)", aliases: ["mwst", "mwstsatz"], numeric: true },
  { key: "inclMwst", label: "Betrag inkl. MwSt.", aliases: ["inklmwst", "inklusive", "brutto"], boolLike: true },
  { key: "recurring", label: "Wiederkehrend", aliases: ["wiederkehrend", "recurring"], boolLike: true },
];

const CONTRACT_FIELDS: ImportField[] = [
  { key: "number", label: "Vertragsnummer", aliases: ["nummer", "number", "vertragsnummer"] },
  { key: "clientId", label: "Kunde/Auftraggeber", required: true, aliases: ["kunde", "auftraggeber", "client"], fk: "persons" },
  { key: "projectId", label: "Projekt (optional)", aliases: ["projekt", "projektnummer", "project"], fk: "projects" },
  { key: "contractType", label: "Vertragsart", aliases: ["vertragsart", "typ"], enum: ["haupt", "unterauftrag"] },
  { key: "legalBasis", label: "Rechtsgrundlage", aliases: ["rechtsgrundlage"] },
  { key: "billingType", label: "Abrechnungsart", aliases: ["abrechnungsart", "verrechnung"], enum: ["pauschal", "stundensatz"] },
  { key: "amount", label: "Betrag", aliases: ["betrag", "amount", "summe", "pauschale"], numeric: true },
  { key: "hourlyRate", label: "Stundensatz", aliases: ["stundensatz", "hourlyrate"], numeric: true },
  { key: "paymentTerms", label: "Zahlungsbedingungen", aliases: ["zahlungsbedingungen"] },
  { key: "date", label: "Datum", aliases: ["datum", "date"], date: true },
  { key: "signedDate", label: "Unterzeichnet am", aliases: ["unterzeichnetam", "unterschriftsdatum"], date: true },
  { key: "status", label: "Status", aliases: ["status"], enum: ["entwurf", "unterzeichnet", "beendet"] },
  { key: "notes", label: "Notizen", aliases: ["notizen", "notiz", "bemerkung"] },
];

const INVOICE_FIELDS: ImportField[] = [
  { key: "number", label: "Rechnungsnummer", aliases: ["nummer", "number", "rechnungsnummer"] },
  { key: "clientId", label: "Kunde/Auftraggeber", required: true, aliases: ["kunde", "auftraggeber", "client"], fk: "persons" },
  { key: "projectId", label: "Projekt (optional)", aliases: ["projekt", "projektnummer", "project"], fk: "projects" },
  { key: "date", label: "Rechnungsdatum", aliases: ["datum", "date", "rechnungsdatum"], date: true },
  { key: "dueDate", label: "Fälligkeitsdatum", aliases: ["faelligkeitsdatum", "zahlungsziel", "duedate"], date: true },
  { key: "description", label: "Position/Beschreibung", aliases: ["beschreibung", "position", "leistung", "text"] },
  { key: "amount", label: "Betrag (netto)", required: true, aliases: ["betrag", "amount", "summe", "nettobetrag"], numeric: true },
  { key: "mwst", label: "MwSt. anwenden", aliases: ["mwst", "mehrwertsteuer"], boolLike: true },
  { key: "mwstRate", label: "MwSt.-Satz (%)", aliases: ["mwstsatz", "mwstrate"], numeric: true },
  { key: "status", label: "Status", aliases: ["status"], enum: ["entwurf", "gesendet", "bezahlt", "überfällig"] },
  { key: "invoiceKind", label: "Rechnungsart", aliases: ["rechnungsart", "art"], enum: ["akonto", "teilrechnung", "schluss", "voll"] },
  { key: "notes", label: "Notizen", aliases: ["notizen", "notiz", "bemerkung"] },
];

const HOLIDAY_FIELDS: ImportField[] = [
  { key: "date", label: "Datum", required: true, aliases: ["datum", "date"], date: true },
  { key: "label", label: "Bezeichnung", required: true, aliases: ["bezeichnung", "label", "name", "feiertag"] },
  { key: "repeatsYearly", label: "Jährlich wiederkehrend", aliases: ["jaehrlich", "wiederkehrend", "repeatsyearly"], boolLike: true },
  { key: "stundenDelta", label: "Stunden-Korrektur (Halbtag)", aliases: ["stundendelta", "stundenkorrektur"], numeric: true },
];

const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  persons: {
    label: "Personen / Kunden",
    resultLabel: "Personen",
    targetKey: "persons",
    fields: PERSON_FIELDS,
    restField: "note",
    restFieldLabel: "Notiz",
    // Ansprechpartner-Zwischenfelder (contactName/-Position/-Phone/-Email) zu
    // einem einzelnen contacts[]-Eintrag zusammenführen, statt sie einzeln als
    // Personen-Felder zu behandeln (Persons.jsx-Shape: { id, name, position, phone, email }).
    postProcess: (values) => {
      if (values.contactName) {
        values.contacts = [{
          id: generateId(), name: values.contactName, position: values.contactPosition || "",
          phone: values.contactPhone || "", email: values.contactEmail || "",
        }];
      }
      // contactName/-Position/-Phone/-Email bleiben hier bewusst erhalten (nicht
      // gelöscht) — sie werden in der Vorschau-Tabelle noch angezeigt und erst in
      // buildRecord() beim finalen Zusammenbau herausgefiltert.
    },
    buildRecord: (m) => {
      const rest = { ...m };
      delete rest.contactName; delete rest.contactPosition; delete rest.contactPhone; delete rest.contactEmail;
      return {
        id: generateId(), name: "", type: "", street: "", zip: "", city: "", country: "CH",
        email: "", phone: "", website: "", note: "", contacts: [], honorarOffers: [],
        isAuftraggeber: true, isPartner: true, ...rest, // Altflags, filtern nichts mehr
      };
    },
    dedupKey: (rec) => normalizeHeader(rec.name),
    dedupAgainst: (data) => (data.persons || []).map(p => ({ key: normalizeHeader(p.name) })),
  },
  projects: {
    label: "Projekte",
    resultLabel: "Projekte",
    targetKey: "projects",
    fields: PROJECT_FIELDS,
    restField: "description",
    restFieldLabel: "Beschreibung",
    buildRecord: (m) => ({
      id: generateId(), number: "", name: "", clientId: "", category: "Direktauftrag",
      billingType: "stundensatz", hourlyRate: 0, budget: 0, status: "aktiv", description: "", startDate: "",
      enabledPhases: [], budgetHours: 0, linkedQuotes: [], positions: [], customPhases: [],
      projectContacts: [], internalMembers: [], createdAt: new Date().toISOString(), ...m,
    }),
    dedupKey: (rec) => `${(rec.number || "").trim()}::${normalizeHeader(rec.name)}`,
    dedupAgainst: (data) => (data.projects || []).map(p => ({ key: `${(p.number || "").trim()}::${normalizeHeader(p.name)}` })),
  },
  employees: {
    label: "Mitarbeiter",
    resultLabel: "Mitarbeiter",
    targetKey: "employees",
    fields: EMPLOYEE_FIELDS,
    buildRecord: (m) => ({
      id: generateId(), name: "", role: "", personalNr: "", eintrittsdatum: "", geburtsdatum: "",
      email: "", adresse: "", ort: "", ahvNr: "", pensum: 100, wochenstunden: 35, ferienWochen: 5,
      monatslohn: 0, lohnIban: "", dreizehnterLohn: false, ferienUebertragVorjahr: {}, active: true, ...m,
    }),
    dedupKey: (rec) => (rec.personalNr || "").trim() ? `pnr:${rec.personalNr.trim()}` : `name:${normalizeHeader(rec.name)}`,
    dedupAgainst: (data) => (data.employees || []).map(e => ({
      key: (e.personalNr || "").trim() ? `pnr:${(e.personalNr as string).trim()}` : `name:${normalizeHeader(e.name)}`,
    })),
  },
  timeEntries: {
    label: "Zeiterfassung",
    resultLabel: "Zeiteinträge",
    targetKey: "timeEntries",
    fields: TIME_FIELDS,
    restField: "description",
    restFieldLabel: "Beschreibung",
    uploadHint: "Phasen und Positionen werden nicht übernommen — nur Datum, Projekt, Mitarbeiter und Dauer.",
    // Eigene buildRecord (statt Blind-Spread) — hoursDecimal/minutesRaw sind nur
    // Zwischenwerte für die Dauer-Berechnung, keine echten Zielfelder.
    buildRecord: (m) => ({
      id: generateId(), date: m.date || "", projectId: m.projectId || "", employeeId: m.employeeId || "",
      phaseId: "", positionId: "", minutes: m.minutes ?? 0, startTime: m.startTime || "", endTime: m.endTime || "",
      description: m.description || "", createdAt: new Date().toISOString(),
    }),
    postProcess: (values) => {
      if (values.minutesRaw !== undefined) {
        values.minutes = Math.round(values.minutesRaw);
      } else if (values.hoursDecimal !== undefined) {
        values.minutes = Math.round(values.hoursDecimal * 60);
      } else if (values.startTime && values.endTime) {
        const a = parseTimeToMinutesOfDay(values.startTime);
        const b = parseTimeToMinutesOfDay(values.endTime);
        if (a != null && b != null) values.minutes = Math.max(0, b - a);
      }
    },
    dedupKey: (rec) => [rec.employeeId || "", rec.projectId || "", rec.date || "", rec.minutes || 0].join("::"),
    dedupAgainst: (data) => (data.timeEntries || []).map(t => ({
      key: [t.employeeId || "", t.projectId || "", t.date || "", t.minutes || 0].join("::"),
    })),
  },
  ferienEntries: {
    label: "Ferien",
    resultLabel: "Ferieneinträge",
    targetKey: "ferienEntries",
    fields: FERIEN_FIELDS,
    restField: "note",
    restFieldLabel: "Notiz",
    uploadHint: "Importierte Ferien werden direkt als genehmigt markiert (kein Antrags-Workflow).",
    buildRecord: (m) => ({
      id: generateId(), employeeId: "", dateFrom: "", dateTo: "", note: "", status: "approved", originalData: null, ...m,
    }),
    dedupKey: (rec) => [rec.employeeId || "", rec.dateFrom || "", rec.dateTo || ""].join("::"),
    dedupAgainst: (data) => (data.ferienEntries || []).map(f => ({
      key: [f.employeeId || "", f.dateFrom || "", f.dateTo || ""].join("::"),
    })),
  },
  absences: {
    label: "Absenzen",
    resultLabel: "Absenzen",
    targetKey: "absences",
    fields: ABSENCE_FIELDS,
    restField: "note",
    restFieldLabel: "Notiz",
    buildRecord: (m) => ({
      id: generateId(), employeeId: "", type: "", dateFrom: "", dateTo: "", note: "", status: "pending", ...m,
    }),
    dedupKey: (rec) => [rec.employeeId || "", rec.type || "", rec.dateFrom || "", rec.dateTo || ""].join("::"),
    dedupAgainst: (data) => (data.absences || []).map(a => ({
      key: [a.employeeId || "", a.type || "", a.dateFrom || "", a.dateTo || ""].join("::"),
    })),
  },
  expenses: {
    label: "Spesen",
    resultLabel: "Spesen",
    targetKey: "expenses",
    fields: EXPENSE_FIELDS,
    restField: "description",
    restFieldLabel: "Beschreibung",
    buildRecord: (m) => ({
      id: generateId(), date: "", category: "", projectId: "", employeeId: "", description: "",
      amount: 0, mwstRate: 8.1, inclMwst: true, status: "offen", receiptData: "", receiptName: "", lohnEntryId: null, ...m,
    }),
    dedupKey: (rec) => [rec.employeeId || "", rec.projectId || "", rec.date || "", rec.amount || 0, rec.category || ""].join("::"),
    dedupAgainst: (data) => (data.expenses || []).map(e => ({
      key: [e.employeeId || "", e.projectId || "", e.date || "", e.amount || 0, e.category || ""].join("::"),
    })),
  },
  internalExpenses: {
    label: "Interne Ausgaben",
    resultLabel: "Interne Ausgaben",
    targetKey: "internalExpenses",
    fields: INTERNAL_EXPENSE_FIELDS,
    restField: "description",
    restFieldLabel: "Beschreibung",
    buildRecord: (m) => ({
      id: generateId(), date: "", category: "", description: "", amount: 0, mwstRate: 8.1, inclMwst: true,
      recurring: false, recurringInterval: "monatlich", ...m,
    }),
    dedupKey: (rec) => [rec.date || "", rec.category || "", rec.amount || 0, rec.description || ""].join("::"),
    dedupAgainst: (data) => (data.internalExpenses || []).map(e => ({
      key: [e.date || "", e.category || "", e.amount || 0, e.description || ""].join("::"),
    })),
  },
  contracts: {
    label: "Verträge",
    resultLabel: "Verträge",
    targetKey: "contracts",
    fields: CONTRACT_FIELDS,
    restField: "notes",
    restFieldLabel: "Notizen",
    buildRecord: (m) => ({
      id: generateId(), number: "", date: "", signedDate: "", clientId: "", projectId: "", quoteId: "",
      contractType: "haupt", legalBasis: "", billingType: "pauschal", amount: 0, hourlyRate: 120,
      paymentTerms: "", status: "entwurf", notes: "", ...m,
    }),
    dedupKey: (rec) => (rec.number || "").trim() ? `num:${rec.number.trim()}` : `adhoc:${rec.clientId || ""}::${rec.projectId || ""}::${rec.date || ""}`,
    dedupAgainst: (data) => (data.contracts || []).map(c => ({
      key: (c.number || "").trim() ? `num:${c.number.trim()}` : `adhoc:${c.clientId || ""}::${c.projectId || ""}::${c.date || ""}`,
    })),
  },
  invoices: {
    label: "Rechnungen",
    resultLabel: "Rechnungen",
    targetKey: "invoices",
    fields: INVOICE_FIELDS,
    restField: "notes",
    restFieldLabel: "Notizen",
    uploadHint: "Jede Zeile wird als eigene Rechnung mit einer einzelnen Sammelposition importiert — keine Einzelpositionen, keine QR-Referenz (wird beim Drucken automatisch erzeugt).",
    // Eigene buildRecord (statt Blind-Spread) — sub/tax/total müssen wie beim
    // manuellen Speichern in Invoices.jsx vorab berechnet und persistiert werden,
    // sonst zeigt die Rechnung nach einem Reload "CHF 0.00".
    postProcess: (values) => {
      const price = values.amount ?? 0;
      const mwstOn = values.mwst !== false;
      const rate = values.mwstRate ?? 8.1;
      values.sub = price;
      values.tax = mwstOn ? price * (rate / 100) : 0;
      values.total = roundCHF(values.sub + values.tax);
    },
    buildRecord: (m) => ({
      id: generateId(), number: m.number || "", clientId: m.clientId || "", contactId: null,
      projectId: m.projectId || "", quoteId: null, date: m.date || "", dueDate: m.dueDate || "",
      sentDate: "", paidDate: "",
      items: [{ id: generateId(), desc: m.description || (m.number ? `Rechnung ${m.number}` : "Position"), qty: 1, price: m.amount ?? 0, discount: 0 }],
      mwst: m.mwst !== false, mwstRate: m.mwstRate ?? 8.1, notes: m.notes || "", status: m.status || "entwurf",
      invoiceKind: m.invoiceKind || "", discountType: "none", discountValue: 0, discountLabel: "",
      qrReference: "", reminders: [],
      sub: m.sub ?? 0, tax: m.tax ?? 0, total: m.total ?? 0, subAfterDisc: m.sub ?? 0, globalDisc: 0,
    }),
    dedupKey: (rec) => (rec.number || "").trim() ? `num:${rec.number.trim()}` : `adhoc:${rec.clientId || ""}::${rec.date || ""}::${rec.total || 0}`,
    dedupAgainst: (data) => (data.invoices || []).map(i => ({
      key: (i.number || "").trim() ? `num:${i.number.trim()}` : `adhoc:${i.clientId || ""}::${i.date || ""}::${i.total || 0}`,
    })),
  },
  feiertage: {
    label: "Feiertage",
    resultLabel: "Feiertage",
    targetKey: "feiertage",
    fields: HOLIDAY_FIELDS,
    buildRecord: (m) => ({
      id: generateId(), date: "", label: "", halfDay: false, stundenDelta: 0, repeatsYearly: true, ...m,
    }),
    // Bei jährlich wiederkehrenden Feiertagen ist nur der Monat-Tag-Teil relevant
    // (das Jahr in `date` ist nur ein Platzhalter, siehe getFeiertageForYear()).
    dedupKey: (rec) => rec.repeatsYearly ? `yearly:${(rec.date || "").slice(5, 10)}` : `once:${rec.date || ""}`,
    dedupAgainst: (data) => (data.feiertage || []).map(f => ({
      key: f.repeatsYearly ? `yearly:${(f.date || "").slice(5, 10)}` : `once:${f.date || ""}`,
    })),
  },
};

/** Passt ein Spaltentitel zu einem Feld? `exact` = identisch nach Normalisierung, `loose` = alle Alias-Wörter kommen als eigene Wörter im Titel vor. */
function aliasMatch(field: ImportField, header: string, mode: "exact" | "loose"): boolean {
  if (mode === "exact") {
    const n = normalizeHeader(header);
    if (!n) return false;
    return (field.aliases || []).some(a => normalizeHeader(a) === n);
  }
  // Locker: jedes Wort des Alias muss als eigenständiges Token im Header
  // vorkommen (nicht als Teilstring) — vermeidet Fehltreffer wie
  // "Ansprechpartner" -> Alias "partner".
  const headerToks = wordTokens(header);
  if (!headerToks.length) return false;
  return (field.aliases || []).some(a => {
    const aliasToks = wordTokens(a);
    return aliasToks.length > 0 && aliasToks.every(t => headerToks.includes(t));
  });
}

/** Ordnet Spalten automatisch Feldern zu (erst exakt, dann locker); Ergebnis: Feld-Key → Spaltenindex. */
function autoGuessMap(fields: ImportField[], headers: string[]): Record<string, number> {
  const used = new Set<number>();
  const map: Record<string, number> = {};
  for (const mode of ["exact", "loose"]) {
    for (const f of fields) {
      if (map[f.key] !== undefined) continue;
      const idx = headers.findIndex((h, i) => !used.has(i) && aliasMatch(f, h, mode as "exact" | "loose"));
      if (idx !== -1) { map[f.key] = idx; used.add(idx); }
    }
  }
  return map;
}

/** Vorschlagswert für einen Rohwert aus der Datei: passender Auswahlwert, passender Verweis oder `__new__`/`__none__`. */
function defaultValueFor(field: ImportField, raw: string, data: AppData): string {
  if (field.enum) {
    const options = resolveEnumOptions(field, data);
    const n = normalizeHeader(raw);
    const hit = options.find(v => normalizeHeader(v) === n);
    return hit || options[0];
  }
  if (field.fk) {
    const target = FK_TARGETS[field.fk];
    const n = normalizeHeader(raw);
    const hit = (data[target.dataKey] as ImportRecord[] || []).find(x => target.matchKeys(x).some(k => normalizeHeader(k) === n));
    if (hit) return hit.id;
    return target.allowNew ? "__new__" : "__none__";
  }
  return raw;
}

/**
 * Baut aus einer Datenzeile die Feldwerte gemäss Spaltenzuordnung und Wertzuordnung.
 * @returns `values` (Feld-Key → Wert, ggf. mit `__newStub` für neu anzulegende Verweisziele)
 *   und `missingRequired` (Keys fehlender Pflichtfelder)
 */
function buildMappedValues(
  fields: ImportField[],
  colMap: Record<string, number | "" | undefined>,
  valueMaps: Record<string, Record<string, string>>,
  rawRow: Row,
  data: AppData,
  opts: { appendRest?: boolean; restField?: string; headers?: string[]; postProcess?: (values: ImportRecord) => void } = {},
): { values: ImportRecord; missingRequired: string[] } {
  const values: ImportRecord = {};
  const missingRequired: string[] = [];
  for (const f of fields) {
    const idx = colMap[f.key];
    const raw = (idx === undefined || idx === "" || idx == null) ? "" : String(rawRow[idx] ?? "").trim();
    if (f.required && !raw) missingRequired.push(f.key);
    if (!raw) continue;
    if (f.enum) {
      const label = valueMaps[f.key]?.[raw] ?? defaultValueFor(f, raw, data);
      values[f.key] = resolveEnumValue(f, data, label);
    } else if (f.fk) {
      const target = FK_TARGETS[f.fk];
      const sel = valueMaps[f.key]?.[raw] ?? defaultValueFor(f, raw, data);
      if (sel === "__new__" && target.allowNew) {
        values.__newStub = { fieldKey: f.key, target: f.fk, rawName: raw };
      } else if (sel !== "__none__" && sel !== "__new__") {
        values[f.key] = sel;
      }
    } else if (f.boolLike) {
      values[f.key] = /^(ja|yes|true|1|x)$/i.test(raw);
    } else if (f.numeric) {
      const n = parseFloat(raw.replace(/'/g, "").replace(",", "."));
      values[f.key] = isNaN(n) ? 0 : n;
    } else if (f.date) {
      values[f.key] = parseFlexibleDate(raw);
    } else {
      values[f.key] = raw;
    }
  }

  // Required-FK ohne Neuanlage-Option, das nach Auflösung leer blieb ("nicht
  // zuordnen" gewählt oder kein Treffer), zählt ebenfalls als fehlend — sonst
  // würde z.B. ein Zeiterfassungs-Eintrag ohne aufgelöstes Projekt durchrutschen.
  for (const f of fields) {
    if (f.required && f.fk && !values[f.key] && values.__newStub?.fieldKey !== f.key && !missingRequired.includes(f.key)) {
      missingRequired.push(f.key);
    }
  }

  // Nicht zugeordnete Spalten (kein Zielfeld) auf Wunsch statt Datenverlust ins
  // "Rest"-Feld (Notiz/Beschreibung) hängen — als "Spalte: Wert"-Paare.
  if (opts.appendRest && opts.restField && opts.headers) {
    const usedIdx = new Set(Object.values(colMap).filter(v => v !== undefined && v !== ""));
    const leftovers = opts.headers
      .map((h, i) => ({ h, v: String(rawRow[i] ?? "").trim(), used: usedIdx.has(i) }))
      .filter(x => x.h && x.v && !x.used)
      .map(x => `${x.h}: ${x.v}`);
    if (leftovers.length) {
      values[opts.restField] = [values[opts.restField], leftovers.join("; ")].filter(Boolean).join("\n");
    }
  }

  if (opts.postProcess) opts.postProcess(values);

  return { values, missingRequired };
}

function fkDisplayValue(field: ImportField, row: { values: ImportRecord }, data: AppData): string {
  const target = FK_TARGETS[field.fk as string];
  if (row.values[field.key]) {
    const match = (data[target.dataKey] as ImportRecord[] || []).find(x => x.id === row.values[field.key]);
    return match ? target.labelOf(match) : "—";
  }
  if (row.values.__newStub?.fieldKey === field.key) return `${row.values.__newStub.rawName} (neu)`;
  return "—";
}

export default function DataImport({ data, saveAll, setView }: Pick<ViewProps, "data" | "saveAll" | "setView">) {
  const [step, setStep] = useState<"entity" | "upload" | "mapping" | "valueMapping" | "preview" | "result">("entity");
  const [entity, setEntity] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<Row[]>([]);
  const [colMap, setColMap] = useState<Record<string, number | "" | undefined>>({});
  const [valueMaps, setValueMaps] = useState<Record<string, Record<string, string>>>({});
  const [rowSkips, setRowSkips] = useState<Record<number, boolean>>({});
  const [appendRestToNote, setAppendRestToNote] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const cfg = entity ? ENTITY_CONFIGS[entity] : null;

  const reset = () => {
    setStep("entity"); setEntity(null); setFileName(""); setHeaders([]); setDataRows([]);
    setColMap({}); setValueMaps({}); setRowSkips({}); setAppendRestToNote(true); setError(""); setResult(null);
  };

  const chooseEntity = (key: string) => { setEntity(key); setStep("upload"); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const rows = await parseSpreadsheet(file);
      if (!rows.length) { setError("Datei enthält keine Daten."); return; }
      const hdrs = rows[0].map(h => String(h ?? ""));
      setHeaders(hdrs);
      setDataRows(rows.slice(1));
      setColMap(autoGuessMap(cfg!.fields, hdrs));
      setFileName(file.name);
      setStep("mapping");
    } catch (err) {
      setError("Datei konnte nicht gelesen werden: " + ((err as Error)?.message || String(err)));
    }
  };

  const unmappedHeaders = useMemo(() => {
    if (!headers.length) return [];
    const usedIdx = new Set(Object.values(colMap).filter(v => v !== undefined && v !== ""));
    return headers.filter((h, i) => h && !usedIdx.has(i));
  }, [headers, colMap]);

  const valueMappingFields = useMemo(() => {
    if (!cfg) return [];
    return cfg.fields.filter(f => (f.enum || f.fk) && colMap[f.key] !== undefined && colMap[f.key] !== "");
  }, [cfg, colMap]);

  const distinctValuesByField = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of valueMappingFields) {
      const idx = colMap[f.key];
      const set = new Set<string>();
      dataRows.forEach(r => { const v = String(r[idx as number] ?? "").trim(); if (v) set.add(v); });
      out[f.key] = Array.from(set);
    }
    return out;
  }, [valueMappingFields, colMap, dataRows]);

  const mappedRows = useMemo(() => {
    if (!cfg || !dataRows.length) return [];
    const existingKeys = new Set(cfg.dedupAgainst(data).map(x => x.key));
    const seenBatch = new Set();
    const opts = { appendRest: appendRestToNote, restField: cfg.restField, headers, postProcess: cfg.postProcess };
    return dataRows.map(raw => {
      const { values, missingRequired } = buildMappedValues(cfg.fields, colMap, valueMaps, raw, data, opts);
      const previewRecord = cfg.buildRecord(values);
      const key = cfg.dedupKey(previewRecord);
      const dupExisting = !!key && existingKeys.has(key);
      const dupBatch = !!key && seenBatch.has(key);
      if (key) seenBatch.add(key);
      return { values, missingRequired, dupExisting, dupBatch };
    });
  }, [cfg, dataRows, colMap, valueMaps, data, appendRestToNote, headers]);

  const effectiveSkip = (row: { missingRequired: string[]; dupExisting: boolean; dupBatch: boolean }, i: number) =>
    rowSkips[i] !== undefined ? rowSkips[i] : (row.missingRequired.length > 0 || row.dupExisting || row.dupBatch);

  const requiredMapped = cfg
    ? cfg.fields.filter(f => f.required).every(f => colMap[f.key] !== undefined && colMap[f.key] !== "")
    : false;

  const mappedFieldsForDisplay = cfg
    ? [
        ...cfg.fields.filter(f =>
          (colMap[f.key] !== undefined && colMap[f.key] !== "") ||
          (f.key === cfg.restField && appendRestToNote && unmappedHeaders.length > 0)),
        ...(cfg.targetKey === "timeEntries" ? [{ key: "minutes", label: "Minuten (berechnet)" }] : []),
        ...(cfg.targetKey === "invoices" ? [{ key: "total", label: "Total CHF (berechnet)" }] : []),
      ]
    : [];

  const commit = () => {
    const newStubsByCollection: Record<string, Map<string, ImportRecord>> = {}; // dataKey -> Map<normName, stub>
    const finalRecords: ImportRecord[] = [];
    mappedRows.forEach((row, i) => {
      if (effectiveSkip(row, i)) return;
      const values = { ...row.values };
      if (values.__newStub) {
        const { fieldKey, target, rawName } = values.__newStub;
        const fkTarget = FK_TARGETS[target];
        const key = normalizeHeader(rawName);
        newStubsByCollection[fkTarget.dataKey] = newStubsByCollection[fkTarget.dataKey] || new Map();
        if (!newStubsByCollection[fkTarget.dataKey].has(key)) {
          newStubsByCollection[fkTarget.dataKey].set(key, fkTarget.buildStub!(rawName));
        }
        values[fieldKey] = newStubsByCollection[fkTarget.dataKey].get(key)!.id;
      }
      delete values.__newStub;
      finalRecords.push(cfg!.buildRecord(values));
    });

    const patch: Record<string, unknown[]> = { [cfg!.targetKey]: [...((data[cfg!.targetKey] as unknown[]) || []), ...finalRecords] };
    for (const [dataKey, map] of Object.entries(newStubsByCollection)) {
      patch[dataKey] = [...((data[dataKey as keyof AppData] as unknown[]) || []), ...Array.from(map.values())];
    }

    saveAll({ ...data, ...patch } as AppData);
    setResult({ imported: finalRecords.length, skipped: mappedRows.length - finalRecords.length });
    setStep("result");
  };

  return (
    <div>
      <Header title="Stammdaten importieren" />

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--negative-bg)", border: "1px solid #e0b0b0", borderRadius: 8, fontSize: 12, color: "var(--negative)", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {step === "entity" && (
        <div className="card">
          <div className="section-label">WAS MÖCHTEST DU IMPORTIEREN?</div>
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16, lineHeight: 1.6 }}>
            Aus einer CSV- oder Excel-Datei — z.B. ein Export aus Archifile, bfiles oder einem Online-ERP.
          </p>
          {Object.entries(ENTITY_CONFIGS).map(([key, c]) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => chooseEntity(key)}>{c.label}</button>
            </div>
          ))}
        </div>
      )}

      {step === "upload" && cfg && (
        <div className="card">
          <div className="section-label">{cfg.label.toUpperCase()} — DATEI WÄHLEN</div>
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 8, lineHeight: 1.6 }}>
            CSV oder Excel (.xlsx). Es wird nur das erste Tabellenblatt verwendet — die erste Zeile muss die Spaltenüberschriften enthalten.
          </p>
          {cfg.uploadHint && (
            <p style={{ fontSize: 12, color: "var(--warning)", marginBottom: 16, lineHeight: 1.6 }}>{cfg.uploadHint}</p>
          )}
          <label className="btn btn-primary" style={{ display: "inline-block", cursor: "pointer", marginTop: cfg.uploadHint ? 0 : 8 }}>
            Datei auswählen…
            <input type="file" accept=".csv,.xlsx" onChange={handleFile} style={{ display: "none" }} />
          </label>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setStep("entity")}>← Zurück</button>
          </div>
        </div>
      )}

      {step === "mapping" && cfg && (
        <div className="card">
          <div className="section-label">SPALTEN ZUORDNEN</div>
          <p style={{ fontSize: 12, color: "var(--text4)", marginBottom: 16 }}>{fileName} — {dataRows.length} Zeilen erkannt</p>
          {cfg.fields.map(f => (
            <FormField key={f.key} label={f.label + (f.required ? " *" : "")}>
              <select
                value={colMap[f.key] ?? ""}
                onChange={e => setColMap({ ...colMap, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
              >
                <option value="">— nicht importieren —</option>
                {headers.map((h, i) => <option key={i} value={i}>{h || `Spalte ${i + 1}`}</option>)}
              </select>
            </FormField>
          ))}
          {unmappedHeaders.length > 0 && (
            <div style={{ padding: "10px 14px", background: "var(--surface2)", borderRadius: 8, fontSize: 12, color: "var(--text3)", marginTop: 6, marginBottom: 16 }}>
              {unmappedHeaders.length} Spalte{unmappedHeaders.length === 1 ? "" : "n"} aus der Datei {unmappedHeaders.length === 1 ? "wird" : "werden"} nicht importiert: {unmappedHeaders.join(", ")}
              {cfg.restField && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={appendRestToNote} onChange={e => setAppendRestToNote(e.target.checked)} style={{ width: "auto" }} />
                  In {cfg.restFieldLabel} übernehmen (als "Spalte: Wert")
                </label>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setStep("upload")}>← Zurück</button>
            <button
              className="btn btn-primary"
              disabled={!requiredMapped}
              onClick={() => setStep(valueMappingFields.length ? "valueMapping" : "preview")}
            >
              Weiter
            </button>
          </div>
        </div>
      )}

      {step === "valueMapping" && cfg && (
        <div className="card">
          <div className="section-label">WERTE ZUORDNEN</div>
          {valueMappingFields.map(f => (
            <div key={f.key} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{f.label}</div>
              {distinctValuesByField[f.key].map(raw => (
                <div key={raw} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text3)", flex: 1 }}>{raw}</span>
                  <span style={{ color: "var(--text5)" }}>→</span>
                  <select
                    style={{ flex: 1 }}
                    value={valueMaps[f.key]?.[raw] ?? defaultValueFor(f, raw, data)}
                    onChange={e => setValueMaps({ ...valueMaps, [f.key]: { ...(valueMaps[f.key] || {}), [raw]: e.target.value } })}
                  >
                    {f.enum && resolveEnumOptions(f, data).map(v => <option key={v} value={v}>{v}</option>)}
                    {f.fk && <>
                      <option value="__none__">— nicht zuordnen —</option>
                      {FK_TARGETS[f.fk].allowNew && <option value="__new__">→ neu anlegen</option>}
                      {((data[FK_TARGETS[f.fk as string].dataKey] as ImportRecord[]) || []).map(x => <option key={x.id} value={x.id}>{FK_TARGETS[f.fk as string].labelOf(x)}</option>)}
                    </>}
                  </select>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep("mapping")}>← Zurück</button>
            <button className="btn btn-primary" onClick={() => setStep("preview")}>Weiter</button>
          </div>
        </div>
      )}

      {step === "preview" && cfg && (
        <div className="card">
          <div className="section-label">VORSCHAU — {mappedRows.length} ZEILEN</div>
          {isCloudBackend && (
            <p style={{ fontSize: 12, color: "var(--text4)", marginBottom: 12 }}>
              Cloud-Modus: Der Import wird im Hintergrund mit dem Server synchronisiert — bei vielen Zeilen kann das einen Moment dauern.
            </p>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ tableLayout: "auto" }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  {mappedFieldsForDisplay.map(f => <th key={f.key}>{f.label}</th>)}
                  <th>Prüfung</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 50).map((row, i) => {
                  const skip = effectiveSkip(row, i);
                  const forced = row.missingRequired.length > 0;
                  return (
                    <tr key={i}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!skip}
                          disabled={forced}
                          onChange={e => setRowSkips({ ...rowSkips, [i]: !e.target.checked })}
                        />
                      </td>
                      {mappedFieldsForDisplay.map(f => (
                        <td key={f.key} style={{ fontSize: 12 }}>
                          {f.fk ? fkDisplayValue(f, row, data) : String(row.values[f.key] ?? "")}
                        </td>
                      ))}
                      <td style={{ fontSize: 11 }}>
                        {forced ? <span style={{ color: "var(--negative)" }}>fehlender Pflichtwert</span>
                          : row.dupExisting ? <span style={{ color: "var(--warning)" }}>bereits vorhanden</span>
                          : row.dupBatch ? <span style={{ color: "var(--warning)" }}>Duplikat in Datei</span>
                          : <span style={{ color: "var(--positive)" }}>neu</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mappedRows.length > 50 && (
            <p style={{ fontSize: 11, color: "var(--text5)", marginTop: 8 }}>… und {mappedRows.length - 50} weitere (werden beim Import berücksichtigt).</p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setStep(valueMappingFields.length ? "valueMapping" : "mapping")}>← Zurück</button>
            <button className="btn btn-primary" onClick={commit}>Importieren</button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="card">
          <div className="section-label">IMPORT ABGESCHLOSSEN</div>
          <p style={{ fontSize: 14, marginBottom: 20 }}>
            {result.imported} {cfg?.resultLabel} importiert, {result.skipped} übersprungen.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={reset}>Weiteren Import starten</button>
            <button className="btn btn-primary" onClick={() => setView("settings")}>Zurück zu Einstellungen</button>
          </div>
        </div>
      )}
    </div>
  );
}
