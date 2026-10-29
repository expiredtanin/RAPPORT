// ─── UTILS ──────────────────────────────────────────────────
//
// Business-Logik-Bibliothek ohne React und ohne State: Kalkulation (SIA-Honorar,
// Lohn), Formatierung (CHF, Datum, KW), QR-Rechnung-Hilfen, Nummernformate,
// Passwort-Hashing, HTML-Sanitizing und Exporte. Fast alles sind reine
// Funktionen; Ausnahmen (DOM/Browser) sind im jeweiligen Kommentar vermerkt:
// `exportBuchhaltungCSV` (löst einen Download aus), `htmlToText`, `sanitizeHtml`.
//
// Konventionen, die für alle Funktionen gelten:
//   - Geldbeträge sind CHF als `number`, auf Rappen (2 Stellen) gerundet.
//   - Zeiten sind Minuten (`formatHours`), Honorar-Stunden sind Dezimalstunden.
//   - Datumswerte sind ISO-Strings `YYYY-MM-DD` (lokal, ohne Zeitzone).
//
// Fachliche Hintergründe (SIA, MWST, Lohnabzüge): docs/FACHLOGIK.md.

import { DEFAULT_ABSENZ_TYPES } from "./constants";
import type {
  AbsenzType, AppData, ContactCategory, DashboardRow, ProtocolApproval, ProtocolParticipant, DateStr, DeliveryNote, Employee, Feiertag, Id,
  Invoice, LohnResult, ManualPhase, Person, Protocol, Quote, Role, Settings, SiaItem, SiaPhase, User,
} from "./types";

export interface SiaCalcItem extends SiaItem { hours: number }
export interface SiaCalcPhase extends Omit<SiaPhase, "items"> { items: SiaCalcItem[]; hours: number }
export interface SiaCalcResult {
  /** Honorarsatz in % der Baukosten (auf 3 Stellen gerundet) */
  p: number;
  /** Kubikwurzel der Baukosten; fehlt, wenn keine Baukosten */
  cbrtB?: number;
  total: number;
  phases: SiaCalcPhase[];
}

/**
 * Stundenaufwand nach SIA-Honorarformel: p = Z1 + Z2 / ∛B (hier Z1 = 0.062, Z2 = 10.58),
 * Stunden = Baukosten × p/100 × Schwierigkeitsgrad × Teilleistungs-% × Faktor r.
 * Je Teilleistung auf 0.1 h gerundet; deaktivierte Teilleistungen (`enabled === false`) zählen 0.
 *
 * @param baukosten anrechenbare Baukosten in CHF; ≤ 0 oder fehlend → alles 0
 * @param schwierigkeit Schwierigkeitsgrad n (z.B. 1.0)
 * @param phasen SIA-Phasen mit Teilleistungen (siehe `SIA_PHASE_WEIGHTS`)
 */
export function calcSIAHours(
  baukosten: number | undefined,
  schwierigkeit: number | undefined,
  phasen: SiaPhase[],
): SiaCalcResult {
  if (!baukosten || baukosten <= 0) return { p: 0, total: 0, phases: [] };
  const cbrtB = Math.cbrt(baukosten);
  const p = 0.062 + 10.58 / cbrtB;
  const results = phasen.map(ph => {
    const items: SiaCalcItem[] = ph.items.map(it => {
      if (it.enabled === false) return { ...it, hours: 0 };
      const r = it.r ?? 1;
      // TODO(types): schwierigkeit kann undefined sein → NaN (Verhalten unverändert aus JS übernommen)
      const hours = baukosten * (p / 100) * (schwierigkeit as number) * (it.pct / 100) * r;
      return { ...it, hours: Math.round(hours * 10) / 10 };
    });
    const phaseHours = items.reduce((s, it) => s + it.hours, 0);
    return { ...ph, items, hours: phaseHours };
  });
  const total = results.reduce((s, ph) => s + ph.hours, 0);
  return { p: Math.round(p * 1000) / 1000, cbrtB, total, phases: results };
}

export interface ManualCalcPhase extends ManualPhase {
  roleDetails: (Role & { hours: number })[];
  totalHours: number;
  totalAmount: number;
}

/**
 * Manuelle Aufwandschätzung: Stunden pro Rolle × Stundensatz der Rolle.
 * Nur aktivierte Phasen (`enabled`) werden berücksichtigt.
 */
export function calcManualHours(phases: ManualPhase[], roles?: Role[]): {
  phases: ManualCalcPhase[];
  totalHours: number;
  totalAmount: number;
} {
  const results = phases.filter(ph => ph.enabled).map(ph => {
    const roleDetails = (roles || []).map(r => ({
      ...r, hours: ph.hoursByRole?.[r.id] || 0,
    }));
    const totalHours = roleDetails.reduce((s, r) => s + r.hours, 0);
    const totalAmount = roleDetails.reduce((s, r) => s + r.hours * r.rate, 0);
    return { ...ph, roleDetails, totalHours, totalAmount };
  });
  return {
    phases: results,
    totalHours: results.reduce((s, p) => s + p.totalHours, 0),
    totalAmount: results.reduce((s, p) => s + p.totalAmount, 0),
  };
}

/**
 * Liefert die verknüpften Offerten eines Projekts. Alte Projekte kannten nur
 * `sourceQuoteId` (eine Offerte); die wird zur «Hauptofferte» umgedeutet.
 */
export function migrateLinkedQuotes(
  project: { linkedQuotes?: { quoteId: Id; role: string }[]; sourceQuoteId?: Id },
): { quoteId: Id; role: string }[] {
  if (project.linkedQuotes) return project.linkedQuotes;
  if (project.sourceQuoteId) return [{ quoteId: project.sourceQuoteId, role: "Hauptofferte" }];
  return [];
}

/**
 * Leitet das Projekt-Sollbudget (Stunden, Betrag, Budget je Phase) aus den
 * verknüpften Offerten ab. Offerten-Modi: "sia" (Honorarformel), "manual"
 * (Stunden × Rolle), "free" (Freie Positionen, nur Betrag, keine Stunden).
 *
 * @param settingsRoles Fallback-Rollen, wenn die Offerte keine eigenen `quoteRoles` hat
 */
export function deriveQuoteBudget(
  linkedQuotes: { quoteId: Id; role: string }[] | undefined,
  allQuotes: Quote[],
  settingsRoles?: Role[],
): {
  budgetHours: number;
  budgetAmount: number;
  phasesBudget: { id: string; hours: number }[];
  enabledPhases: string[];
  hasFreeQuotes: boolean;
  hasHourQuotes: boolean;
} {
  // "Referenz" ist laut der übrigen Verknüpfungslogik (Projects.jsx
  // buildPositions/buildNachtragPositions/Budget-Modal) bewusst rein
  // informativ und nie Teil des tatsächlichen Auftragsvolumens — sie darf
  // hier nicht ins offizielle Projekt-Sollbudget einfliessen.
  const quotes = (linkedQuotes || []).filter(lq => lq.role !== "Referenz").map(lq => allQuotes.find(q => q.id === lq.quoteId)).filter((q): q is Quote => !!q);
  let totalHours = 0;
  let totalAmount = 0;
  const phaseMap: Record<string, number> = {}; // phaseId -> hours (summed)
  const enabledSet = new Set<string>(); // phases enabled in quotes even with 0 hours

  quotes.forEach(q => {
    const roles = q.quoteRoles || settingsRoles || [];
    if (q.mode === "sia") {
      const calc = calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []);
      totalHours += calc.total || 0;
      totalAmount += (calc.total || 0) * (q.sia?.stundenansatz || 0);
      (calc.phases || []).forEach(ph => {
        if (ph.hours > 0) phaseMap[ph.id] = (phaseMap[ph.id] || 0) + ph.hours;
      });
    } else if (q.mode === "manual") {
      const calc = calcManualHours(q.manualPhases || [], roles);
      totalHours += calc.totalHours || 0;
      totalAmount += calc.totalAmount || 0;
      (q.manualPhases || []).filter(ph => ph.enabled).forEach(ph => {
        enabledSet.add(ph.id);
        const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
        if (h > 0) phaseMap[ph.id] = (phaseMap[ph.id] || 0) + h;
      });
    } else if (q.mode === "free") {
      totalAmount += (q.freeItems || []).reduce((s, it) => s + (it.qty * it.price), 0);
    }
  });

  const phasesBudget = Object.entries(phaseMap).map(([id, hours]) => ({ id, hours: Math.round(hours * 10) / 10 }));
  const enabledPhases = [...new Set([...phasesBudget.map(p => p.id), ...enabledSet])];
  return {
    budgetHours: Math.round(totalHours * 10) / 10,
    budgetAmount: Math.round(totalAmount),
    phasesBudget,
    enabledPhases,
    hasFreeQuotes: quotes.some(q => q.mode === "free"),
    hasHourQuotes: quotes.some(q => q.mode === "sia" || q.mode === "manual"),
  };
}

/** Neue eindeutige ID (UUID; Fallbacks für Umgebungen ohne `crypto.randomUUID`). */
/**
 * Kalenderdatum «YYYY-MM-DD» in lokaler Zeit (Standard: heute). Nicht `toISOString().slice(0, 10)`
 * verwenden: das rechnet in UTC und liefert zwischen Mitternacht und 1–2 Uhr (Zürich) noch den Vortag.
 */
export function localISODate(d: Date = new Date()): DateStr {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old environments — uses crypto.getRandomValues if available
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Date.now().toString(36) + "-" + Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ─── PASSWORT-HASHING (PBKDF2 via Web Crypto) ──────────────────────────────
// Gespeicherte Form am User: { passwordHash, passwordSalt } (beide Hex-Strings).
// Alte User mit Klartext-`password` werden einmalig akzeptiert und nach
// erfolgreichem Login transparent auf Hash umgestellt (siehe App.jsx).
// Die Hashes liegen im lokalen/Cloud-Datenbestand; das ist App-interne
// Zugriffskontrolle, kein Ersatz für Server-seitige Auth.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/**
 * PBKDF2-SHA-256-Hash (100'000 Iterationen) eines Passworts.
 * @param saltHex vorhandener Salt zum Verifizieren; ohne Angabe wird ein neuer Salt erzeugt
 * @returns Hash und verwendeter Salt, beide als Hex
 */
export async function hashPassword(password: string | null | undefined, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password ?? ""), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    baseKey, PBKDF2_KEY_BITS
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}
// Constant-time string compare to avoid timing leaks
function constantTimeEq(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Prüft ein Passwort gegen den gespeicherten Hash (oder den Klartext-Altbestand). */
export async function verifyPassword(
  password: string | null | undefined,
  user: Pick<User, "passwordHash" | "passwordSalt" | "password"> | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  if (user.passwordHash && user.passwordSalt) {
    const { hash } = await hashPassword(password, user.passwordSalt);
    return constantTimeEq(hash, user.passwordHash);
  }
  // Legacy plaintext fallback (transitional only)
  if (typeof user.password === "string") {
    return constantTimeEq(password ?? "", user.password);
  }
  return false;
}
/** Kopie des Users mit gehashtem Passwort; das Klartextfeld `password` wird entfernt. */
export async function withHashedPassword<T extends { password?: string }>(
  user: T,
  password: string,
): Promise<Omit<T, "password"> & { passwordHash: string; passwordSalt: string }> {
  const { hash, salt } = await hashPassword(password);
  const { password: _legacy, ...rest } = user;
  return { ...rest, passwordHash: hash, passwordSalt: salt };
}
/** Entfernt alle Zugangsdaten-Felder (für sessionStorage und Props, damit Hashes nicht in die UI wandern). */
export function stripCredentials<T extends Partial<User>>(user: T | null | undefined): Omit<T, "password" | "passwordHash" | "passwordSalt"> | null | undefined {
  if (!user) return user as null | undefined;
  const { password, passwordHash, passwordSalt, ...safe } = user;
  return safe;
}

// HTML sanitizer for rich-text content (letter bodies, etc.).
// Allowlist of tags + attributes; strips script, event handlers, javascript: URLs.
const SAFE_TAGS = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE",
  "FONT", "A", "HR", "SUB", "SUP",
]);
const SAFE_ATTRS = new Set([
  "style", "color", "size", "face", "align", "href", "target", "rel",
]);
function isSafeUrl(url: unknown): boolean {
  if (!url) return false;
  const v = String(url).trim().toLowerCase();
  // block javascript:, data:text/html, vbscript:, etc. — allow http(s), mailto, tel, relative
  return !/^(javascript|data|vbscript|file):/i.test(v);
}
/**
 * Bereinigt Rich-Text-HTML (Briefe u.ä.): erlaubt nur Whitelist-Tags/-Attribute,
 * entfernt Event-Handler und `javascript:`-URLs. Nicht erlaubte Tags werden durch
 * ihren Inhalt ersetzt. Braucht `DOMParser`; ohne DOM (z.B. SSR) wird "" geliefert.
 * Immer verwenden, bevor fremdes/gespeichertes HTML per `dangerouslySetInnerHTML` gerendert wird.
 */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  if (typeof DOMParser === "undefined") return ""; // SSR/safe fallback
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return "";
  const walk = (node: Node): void => {
    // Iterate over a snapshot — children may be removed during walk
    const kids = Array.from(node.childNodes);
    for (const child of kids) {
      if (child.nodeType === 1) {
        const el = child as Element;
        const tag = el.tagName;
        if (!SAFE_TAGS.has(tag)) {
          // Replace disallowed tag with its sanitized children (drops <script>, <iframe>, etc.)
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
          continue;
        }
        // Strip disallowed attributes; sanitize hrefs
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on") || !SAFE_ATTRS.has(name)) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (name === "href" && !isSafeUrl(attr.value)) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (name === "style" && /expression\s*\(|javascript:|url\s*\(\s*['"]?\s*javascript:/i.test(attr.value)) {
            el.removeAttribute(attr.name);
          }
        }
        if (tag === "A" && el.getAttribute("target") === "_blank" && !el.getAttribute("rel")) {
          el.setAttribute("rel", "noopener noreferrer");
        }
        walk(el);
      } else if (child.nodeType !== 3 && child.nodeType !== 8) {
        // Drop comments and other node types except text
        node.removeChild(child);
      }
    }
  };
  walk(root);
  return root.innerHTML;
}

/** Betrag als «CHF 1’234.50» (de-CH); fehlender Wert zählt als 0. */
export function formatCHF(amount?: number | null): string {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" }).format(amount || 0);
}

/** ISO-Datum als «17.10.2026»; leer → «—». */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("de-CH");
}

/**
 * Rundet auf Rappen (2 Dezimalstellen).
 * Achtung, der Name ist historisch: es ist KEINE 5-Rappen-Bargeldrundung.
 * RAPPORT-Rechnungen sind QR-Rechnungen (elektronisch beglichen, nicht bar), und
 * nur rappengenaue Rundung setzt sich mit den unabhängig davon in sub/tax
 * gespeicherten Werten zu Netto + MWST = Total zusammen.
 */
export function roundCHF(amount?: number | null): number {
  return Math.round((amount || 0) * 100) / 100;
}

/** Absenderadresse (mehrzeilig) aus Strasse/PLZ/Ort; Fallback auf das alte Freitext-Feld `address`. */
export function formatSenderAddress(settings: Pick<Settings, "street" | "zip" | "city" | "address">): string {
  const parts: string[] = [];
  if (settings.street) parts.push(settings.street);
  const line2 = [settings.zip, settings.city].filter(Boolean).join(" ");
  if (line2) parts.push(line2);
  if (parts.length > 0) return parts.join("\n");
  return settings.address || "";
}

// ─── QR-BILL HELPERS ──────────────────────────────────────────

/**
 * true, wenn die IBAN eine QR-IBAN ist (CH/LI mit Institutsnummer 30000–31999).
 * Nur bei QR-IBAN ist eine QR-Referenz (27 Stellen) zulässig, sonst Creditor Reference.
 */
export function isQRIban(iban?: string | null): boolean {
  const clean = (iban || "").replace(/\s/g, "").toUpperCase();
  if (!clean.startsWith("CH") && !clean.startsWith("LI")) return false;
  const iid = parseInt(clean.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

/** IBAN in 4er-Gruppen («CH00 0000 …»), Grossbuchstaben. */
export function formatIban(iban?: string | null): string {
  const clean = (iban || "").replace(/\s/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join(" ") || "";
}

/** Prüfziffer nach Modulo 10 rekursiv (Schweizer Zahlungsverkehr, QR-Referenz). Nicht-Ziffern werden ignoriert. */
export function mod10(input: string): string {
  const table = [[0,9,4,6,8,2,7,1,3,5],[9,4,6,8,2,7,1,3,5,0],[4,6,8,2,7,1,3,5,0,9],[6,8,2,7,1,3,5,0,9,4],[8,2,7,1,3,5,0,9,4,6],[2,7,1,3,5,0,9,4,6,8],[7,1,3,5,0,9,4,6,8,2],[1,3,5,0,9,4,6,8,2,7],[3,5,0,9,4,6,8,2,7,1],[5,0,9,4,6,8,2,7,1,3]];
  let carry = 0;
  for (const ch of input) {
    const digit = parseInt(ch);
    if (isNaN(digit)) continue;
    carry = table[carry][digit];
  }
  return ((10 - carry) % 10).toString();
}

/**
 * 27-stellige QR-Referenz aus der Rechnungsnummer: nur Ziffern, links mit 0 auf
 * 26 Stellen aufgefüllt (zu lange Nummern: die letzten 26 Ziffern), plus Prüfziffer.
 */
export function generateQRReference(invoiceNumber?: string | null): string {
  // Nur Ziffern extrahieren, links mit Nullen auf 26 Stellen auffüllen, dann Prüfziffer
  const digits = (invoiceNumber || "").replace(/\D/g, "").padStart(26, "0").slice(-26);
  return digits + mod10(digits);
}

/** Referenz in 5er-Blöcken von rechts gruppiert (Anzeige auf dem Zahlteil). */
export function formatReference(ref?: string | null): string {
  const clean = (ref || "").replace(/\s/g, "");
  const reversed = clean.split("").reverse().join("");
  const blocks = reversed.match(/.{1,5}/g) || [];
  return blocks.map(b => b.split("").reverse().join("")).reverse().join(" ");
}

/** Minuten als «2h 30m» (bzw. «2h», wenn volle Stunden). */
export function formatHours(minutes?: number | null): string {
  const h = Math.floor((minutes || 0) / 60);
  const m = (minutes || 0) % 60;
  return `${h}h${m > 0 ? " " + m + "m" : ""}`;
}

/**
 * Projektnummer nach konfigurierbarem Format (Einstellungen → Nummernformate).
 * Platzhalter: YYYY=2025, YY=25, MM=Monat, N+ (beliebig viele N, z.B. NN oder NNN) = laufende Nummer.
 * Es zählt das aktuelle Datum, nicht das Projektdatum.
 * @param seq laufende Nummer; wird auf die Anzahl N im Format aufgefüllt
 */
export function applyProjectNumberFormat(fmt: string | undefined, seq: number | string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const f = fmt || "YYYY/NN";
  const padLen = (f.match(/N+/) || ["NN"])[0].length;
  const nn = String(seq).padStart(padLen, "0");
  return f.replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, mm).replace(/N+/, nn);
}

/**
 * Gegenstück zu `applyProjectNumberFormat`: liest die laufende Nummer aus einer
 * gespeicherten Projektnummer. Nummern aus anderen Jahren passen nicht auf das
 * Muster und liefern null (die Zählung beginnt jährlich neu).
 */
export function parseSeqFromNumber(num: string | null | undefined, fmt: string | null | undefined): number | null {
  if (!num || !fmt) return null;
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(2);
  // Escape regex special chars, then replace placeholders with capture groups
  const pattern = (fmt || "YYYY/NN")
    .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    .replace(/YYYY/g, yyyy)
    .replace(/YY/g, yy)
    .replace(/MM/g, "\\d{2}")
    .replace(/N+/, "(\\d+)");
  const match = num.match(new RegExp("^" + pattern + "$"));
  return match ? parseInt(match[1]) : null;
}

/**
 * Löst den Download eines Buchhaltungs-Exports (CSV, `;`-getrennt, UTF-8 mit BOM
 * für Excel) aus: Einnahmen, Spesen, interne Ausgaben, Löhne und Zusammenfassung.
 * Seiteneffekt: erzeugt ein `<a download>` im DOM. Summenzeilen gehen auf die
 * sichtbaren Zeilen auf; die Zusammenfassung zählt über Lohn ausbezahlte Spesen
 * nicht doppelt und trennt Akonto-MWST (erst bei Schlussrechnung steuerrelevant).
 * @param year `YYYY` zum Filtern; leer = alle Jahre
 */
export function exportBuchhaltungCSV(data: AppData, year = ""): void {
  const sep = ";";
  // s ?? "" statt s || "" — sonst wird ein echter Zahlenwert 0 (z.B. MWST-
  // Satz-Spalte bei einer 0%-Rechnung) zu einer leeren Zelle statt "0".
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const rows: string[] = [];

  // Einnahmen
  rows.push(["EINNAHMEN", "", "", "", "", "", "", ""].map(q).join(sep));
  rows.push(["Datum", "Rechnungs-Nr.", "Kunde", "Beschreibung", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"].map(q).join(sep));
  const paidInvoices = [...data.invoices].filter(i => !year || (i.date || "").startsWith(year)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  paidInvoices.forEach(inv => {
    const client = (data.persons||[]).find(c => c.id === inv.clientId);
    const desc = (inv.items || []).map(it => it.desc).filter(Boolean).join(", ");
    // Den tatsächlich bei dieser Rechnung verwendeten Satz nutzen, nicht den
    // aktuellen Studio-Default — sonst zeigt der Export nach einer künftigen
    // MWST-Satzänderung rückwirkend für alle historischen Rechnungen den
    // falschen (aktuellen) Satz, obwohl die MWST-Spalte daneben (inv.tax)
    // korrekt den damals berechneten Betrag zeigt.
    const taxRate = inv.mwst ? (inv.mwstRate ?? mwstRate) : 0;
    rows.push([inv.date, inv.number, client?.name || "", desc, (inv.sub || 0).toFixed(2), taxRate, (inv.tax || 0).toFixed(2), (inv.total || 0).toFixed(2)].map(q).join(sep));
  });
  const totalNet = paidInvoices.reduce((s, i) => s + (i.sub || 0), 0);
  // Roh-Summe über exakt die oben aufgelisteten Zeilen (inkl. Entwürfe) —
  // die TOTAL-Zeile muss auf die sichtbaren Zeilen aufgehen.
  const tableTax = paidInvoices.reduce((s, i) => s + (i.tax || 0), 0);
  const totalGross = paidInvoices.reduce((s, i) => s + (i.total || 0), 0);
  rows.push(["", "", "", "TOTAL", totalNet.toFixed(2), "", tableTax.toFixed(2), totalGross.toFixed(2)].map(q).join(sep));
  rows.push([""].join(sep));
  // Entwürfe sind noch nicht ausgestellt — es entsteht noch keine MWST-Schuld
  // (analog Accounting.jsx totalTax). Nur für die MWST-Schuld-Kennzahl in der
  // Zusammenfassung relevant, nicht für die TOTAL-Zeile oben.
  const totalTax = paidInvoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + (i.tax || 0), 0);

  // Ausgaben
  rows.push(["SPESEN (MITARBEITERBEZOGEN)", "", "", "", "", "", "", ""].map(q).join(sep));
  rows.push(["Datum", "Kategorie", "Projekt", "Beschreibung", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"].map(q).join(sep));
  const sortedExp = [...(data.expenses || [])].filter(e => !year || (e.date || "").startsWith(year)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  sortedExp.forEach(exp => {
    const proj = data.projects.find(p => p.id === exp.projectId);
    const net = exp.inclMwst ? (exp.amount / (1 + (exp.mwstRate || 0) / 100)) : exp.amount;
    const taxAmt = exp.amount - net;
    rows.push([exp.date, exp.category, proj?.name || "", exp.description, net.toFixed(2), exp.mwstRate || 0, taxAmt.toFixed(2), exp.amount.toFixed(2)].map(q).join(sep));
  });
  // Roh-Summe über exakt die oben aufgelisteten Zeilen (inkl. über Lohn
  // ausbezahlte) — die TOTAL-Zeile muss auf die sichtbaren Zeilen aufgehen.
  const tableExpTotal = sortedExp.reduce((s, e) => s + (e.amount || 0), 0);
  const tableExpTax = sortedExp.reduce((s, e) => { const net = e.inclMwst ? (e.amount / (1 + (e.mwstRate || 0) / 100)) : e.amount; return s + (e.amount - net); }, 0);
  rows.push(["", "", "", "TOTAL", (tableExpTotal - tableExpTax).toFixed(2), "", tableExpTax.toFixed(2), tableExpTotal.toFixed(2)].map(q).join(sep));
  rows.push([""].join(sep));
  // Über Lohnabrechnung ausbezahlte Spesen (lohnEntryId gesetzt) stecken
  // bereits in l.auszahlung (Personalaufwand-Block unten) und dürfen für die
  // ZUSAMMENFASSUNG nicht nochmals mitgezählt werden (analog Accounting.jsx
  // expensesForTotals) — nur hier, nicht für die TOTAL-Zeile oben.
  const expForTotals = sortedExp.filter(e => !e.lohnEntryId);
  const expTotal = expForTotals.reduce((s, e) => s + (e.amount || 0), 0);
  const expTax = expForTotals.reduce((s, e) => { const net = e.inclMwst ? (e.amount / (1 + (e.mwstRate || 0) / 100)) : e.amount; return s + (e.amount - net); }, 0);

  // Interne Ausgaben
  rows.push(["INTERNE AUSGABEN", "", "", "", "", "", "", ""].map(q).join(sep));
  rows.push(["Datum", "Kategorie", "Beschreibung", "Wiederkehrend", "Netto CHF", "MWST-Satz %", "MWST CHF", "Brutto CHF"].map(q).join(sep));
  const sortedIntExp = [...(data.internalExpenses || [])].filter(e => !year || (e.date || "").startsWith(year)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  sortedIntExp.forEach(exp => {
    const net = exp.inclMwst ? (exp.amount / (1 + (exp.mwstRate || 0) / 100)) : exp.amount;
    const taxAmt = exp.amount - net;
    rows.push([exp.date, exp.category, exp.description, exp.recurring ? (exp.recurringInterval || "monatlich") : "", net.toFixed(2), exp.mwstRate || 0, taxAmt.toFixed(2), exp.amount.toFixed(2)].map(q).join(sep));
  });
  const intExpTotal = sortedIntExp.reduce((s, e) => s + (e.amount || 0), 0);
  const intExpTax = sortedIntExp.reduce((s, e) => { const net = e.inclMwst ? (e.amount / (1 + (e.mwstRate || 0) / 100)) : e.amount; return s + (e.amount - net); }, 0);
  rows.push(["", "", "", "TOTAL", (intExpTotal - intExpTax).toFixed(2), "", intExpTax.toFixed(2), intExpTotal.toFixed(2)].map(q).join(sep));
  rows.push([""].join(sep));

  // Personalaufwand (Löhne)
  const sortedLoehne = [...(data.lohnEntries || [])].filter(l => !year || l.monat.startsWith(year)).sort((a, b) => a.monat.localeCompare(b.monat));
  if (sortedLoehne.length > 0) {
    rows.push(["PERSONALAUFWAND / LÖHNE", "", "", "", "", "", "", "", ""].map(q).join(sep));
    rows.push(["Monat", "Mitarbeiter", "Brutto", "Abzüge AN", "Netto", "Spesen", "Auszahlung AN", "PK AG-Anteil", "Gesamtlohnkosten"].map(q).join(sep));
    sortedLoehne.forEach(l => {
      const name = l.empSnapshot?.name || "";
      const bvgAG = l.bvgAG || 0;
      const gesamt = (l.auszahlung || 0) + bvgAG;
      rows.push([l.monat, name, (l.bruttoTotal || 0).toFixed(2), (l.totalAbzuege || 0).toFixed(2), (l.netto || 0).toFixed(2), (l.spesenTotal || 0).toFixed(2), (l.auszahlung || 0).toFixed(2), bvgAG.toFixed(2), gesamt.toFixed(2)].map(q).join(sep));
    });
    const lohnTotal = sortedLoehne.reduce((s, l) => s + (l.auszahlung || 0) + (l.bvgAG || 0), 0);
    rows.push(["", "", "", "", "", "", "", "TOTAL", lohnTotal.toFixed(2)].map(q).join(sep));
    rows.push([""].join(sep));
  }

  // Zusammenfassung
  const lohnTotalAll = sortedLoehne.reduce((s, l) => s + (l.auszahlung || 0) + (l.bvgAG || 0), 0);
  // Akonto-MwSt ist erst bei Schlussrechnung steuerrelevant (analog Accounting.jsx taxWithoutAkonto).
  const akontoTax = paidInvoices.filter(i => i.invoiceKind === "akonto" && i.status !== "entwurf").reduce((s, i) => s + (i.tax || 0), 0);
  const taxWithoutAkonto = totalTax - akontoTax;
  rows.push(["ZUSAMMENFASSUNG", "", "", "", "", "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "Einnahmen (Netto)", totalNet.toFixed(2), "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "Spesen (Netto)", (expTotal - expTax).toFixed(2), "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "Interne Ausgaben (Netto)", (intExpTotal - intExpTax).toFixed(2), "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "Personalaufwand (Löhne)", lohnTotalAll.toFixed(2), "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "Ergebnis (Netto)", (totalNet - (expTotal - expTax) - (intExpTotal - intExpTax) - lohnTotalAll).toFixed(2), "", "", ""].map(q).join(sep));
  rows.push(["", "", "", "MWST auf Einnahmen (excl. Akonto)", "", "", taxWithoutAkonto.toFixed(2), ""].map(q).join(sep));
  if (akontoTax > 0) rows.push(["", "", "", "↳ Akonto-MWST ausstehend (bei Schlussrechnung)", "", "", akontoTax.toFixed(2), ""].map(q).join(sep));
  rows.push(["", "", "", "Vorsteuer (Spesen + Ausgaben)", "", "", (expTax + intExpTax).toFixed(2), ""].map(q).join(sep));
  rows.push(["", "", "", "MWST-Schuld (excl. Akonto)", "", "", (taxWithoutAkonto - expTax - intExpTax).toFixed(2), ""].map(q).join(sep));

  const bom = "﻿";
  const blob = new Blob([bom + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `buchhaltung-${year || "gesamt"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Text für Zahlungserinnerung / Mahnung.
 * @param nr 1 = Zahlungserinnerung (10 Tage), 2 = 2. Mahnung (7 Tage), ≥3 = letzte Mahnung (5 Tage, Androhung rechtlicher Schritte)
 * @param sentDate (derzeit ungenutzt) Versanddatum
 * @param clients alle Personen; der Kunde wird über `inv.clientId` gesucht
 */
export function buildReminderLetter(
  inv: Invoice,
  nr: number,
  sentDate: DateStr | undefined,
  clients: Person[],
  settings: Pick<Settings, "iban" | "name">,
): { client: Person | undefined; subject: string; body: string } {
  const client = clients.find(c => c.id === inv.clientId);
  const existingReminders = inv.reminders || [];
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const daysPast = Math.floor((new Date(`${todayLocal}T00:00:00Z`).getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400000);
  const intro = nr === 1
    ? `Bei einer Überprüfung unserer Buchhaltung stellen wir fest, dass die Rechnung Nr. ${inv.number} vom ${formatDate(inv.date)} über ${formatCHF(inv.total)} seit ${daysPast} Tagen (Fälligkeit: ${formatDate(inv.dueDate)}) noch nicht beglichen ist.\n\nWir bitten Sie höflich, den offenen Betrag innert 10 Tagen zu überweisen.`
    : nr === 2
    ? `Leider mussten wir feststellen, dass unsere Zahlungserinnerung vom ${formatDate(existingReminders[0]?.sentDate || existingReminders[0]?.date)} bezüglich Rechnung Nr. ${inv.number} über ${formatCHF(inv.total)} bisher ohne Reaktion geblieben ist.\n\nWir fordern Sie hiermit auf, den ausstehenden Betrag innert 7 Tagen zu begleichen.`
    : `Trotz unserer Zahlungserinnerungen vom ${existingReminders.map(r => formatDate(r.sentDate || r.date)).join(" und ")} ist die Rechnung Nr. ${inv.number} über ${formatCHF(inv.total)} nach wie vor unbeglichen.\n\nWir sehen uns gezwungen, bei weiterem Ausbleiben der Zahlung innerhalb von 5 Tagen rechtliche Schritte einzuleiten.`;
  const body = `Sehr geehrte/r ${client?.name || "[Kunde]"}\n\n${intro}\n\nIBAN: ${settings.iban}\nReferenz: ${inv.number}\n\nFreundliche Grüsse\n${settings.name}`;
  const subject = nr === 1 ? `Zahlungserinnerung – Rechnung Nr. ${inv.number}` : `${nr}. Mahnung – Rechnung Nr. ${inv.number}`;
  return { client, subject, body };
}

/** Kalenderwoche als «KW 42» (ISO 8601). */
export function getKW(dateStr?: string | null): string {
  if (!dateStr) return "—";
  // Eigene Berechnung war auf jedem Sonntag und rund um den Jahreswechsel
  // falsch (falsches ISO-Jahr über d.getFullYear()) — getWeekNumber() weiter
  // unten ist die korrekt verifizierte ISO-8601-Implementierung, beide
  // sollten nie divergieren.
  return `KW ${getWeekNumber(dateStr)}`;
}

/**
 * Kunde eines Lieferscheins: verknüpfte Person oder, bei manueller Eingabe,
 * ein Ersatzobjekt mit `name`/`address`. null, wenn keiner angegeben ist.
 */
export function linkedClientForNote(
  n: DeliveryNote,
  data: Pick<AppData, "persons">,
): Person | { name: string; address: string } | null {
  if (n.clientId) return (data.persons||[]).find(c => c.id === n.clientId) || null;
  return n.clientManual ? { name: n.clientManual, address: n.deliveryAddress || "" } : null;
}

/** ISO-8601-Kalenderwoche (Woche beginnt Montag, KW 1 enthält den 4. Januar). */
export function getWeekNumber(date: string | number | Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d.getTime() - week1.getTime()) / 86400000 + ((week1.getDay() + 6) % 7) - 2) / 7) + 1;
}

/** «KW 42 / 2026». Das Jahr ist das Kalenderjahr des Datums, nicht das ISO-Wochenjahr. */
export function formatKW(dateStr?: string | null): string {
  if (!dateStr) return "—";
  return `KW ${getWeekNumber(dateStr)} / ${new Date(dateStr).getFullYear()}`;
}

/** @deprecated Altes Nummernschema («<Projekt>-P01»); neu: `applyProtoNumberFormat` + `nextProtoSeq`. */
export function nextProtoNumber(
  protocols: { nummer?: string; number?: string }[] | undefined,
  projectNumber?: string,
): string {
  const prefix = projectNumber ? `${projectNumber}-P` : "P";
  const existing = (protocols || []).map(p => {
    const m = (p.nummer || p.number || "").match(/(\d+)$/);
    return m ? parseInt(m[1]) : 0;
  });
  const max = existing.length ? Math.max(...existing) : 0;
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

/**
 * Nächste laufende Protokollnummer: grösste Zahl in den bestehenden Nummern + 1.
 * Jahreszahlen (4-stellig, 2000–2099) werden ignoriert, damit «2026-BS-03» → 3 zählt, nicht 2026.
 */
export function nextProtoSeq(protocols: Pick<Protocol, "nummer">[] | undefined): number {
  let max = 0;
  (protocols || []).forEach(p => {
    const groups = (p.nummer || "").match(/\d+/g) || [];
    groups.forEach(n => {
      const num = parseInt(n);
      if (n.length <= 3 || !(num >= 2000 && num <= 2099)) {
        if (num > max) max = num;
      }
    });
  });
  return max + 1;
}

/**
 * Protokollnummer nach konfigurierbarem Format (Standard «PP-TT-NN»).
 * Platzhalter: YYYY YY MM DD, PP (Projektnr. ohne führendes Jahr, damit kein
 * doppeltes Jahr entsteht), PPP (Projektnr. vollständig), TT (Typkürzel), NN/NNN (Sequenz).
 * Trenner `/`, Leerzeichen und `.` in der Projektnummer werden zu `-`.
 */
export function applyProtoNumberFormat(
  fmt: string | undefined,
  { date, projectNumber, seq, typKuerzel }: { date?: DateStr; projectNumber?: string; seq: number; typKuerzel?: string },
): string {
  const d = date ? new Date(date + "T12:00:00") : new Date();
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  // Normalize separators in project number, then strip a leading year segment
  // so PP can be combined with YYYY/YY without producing a double year.
  const ppNorm = (projectNumber || "")
    .replace(/[/\s.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const pp4 = ppNorm.replace(/^\d{4}-/, "");
  const pp2 = ppNorm.replace(/^\d{2}-/, "");
  const ppStripped = pp4 !== ppNorm ? pp4 : pp2 !== ppNorm ? pp2 : ppNorm;
  const pp = ppStripped || ppNorm || "P";
  const tt = typKuerzel || "SO";
  const tokens: Record<string, string> = {
    YYYY: yyyy, YY: yy, MM: mm, DD: dd,
    PPP: ppNorm || "P", PP: pp, TT: tt,
    NNN: String(seq).padStart(3, "0"),
    NN: String(seq).padStart(2, "0"),
  };
  return (fmt || "PP-TT-NN").replace(/YYYY|YY|NNN|NN|MM|DD|PPP|PP|TT/g, m => tokens[m] ?? m);
}

/** Wandelt Klartext (alte Vorlagen) in HTML: Leerzeile → Absatz, Zeilenumbruch → `<br>`. Bereits HTML bleibt unverändert. */
export function textToHtml(text?: string | null): string {
  if (!text) return "";
  if (text.trim().startsWith("<")) return text; // already HTML
  return text
    .split("\n\n")
    .map(para => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML zurück in Klartext (Druck-Fallback). Braucht das DOM. */
export function htmlToText(html: string): string {
  // DOMParser statt innerHTML auf einem losen Element: parst, ohne Bilder zu laden oder Handler auszuführen.
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent || "";
}

/**
 * Feiertage eines Jahres. Jährlich wiederkehrende (`repeatsYearly`) werden auf
 * das gewünschte Jahr umgeschrieben (nur `MM-DD` zählt), die übrigen nach Jahr gefiltert.
 */
export function getFeiertageForYear(feiertage: Feiertag[] | undefined, year: number | string): Feiertag[] {
  return (feiertage || []).filter(f => {
    if (f.repeatsYearly) return true;
    return f.date.startsWith(String(year));
  }).map(f => {
    if (f.repeatsYearly) return { ...f, date: `${year}-${f.date.slice(5, 10)}` };
    return f;
  });
}

/**
 * Alle Absenzarten: Standardtypen (mit Überschreibungen des Studios, ausgeblendete
 * entfernt) plus eigene Typen. Einträge mit `deleted` sind ausgeblendet.
 */
export function getAbsenzTypes(data: Pick<AppData, "absenzTypes">): AbsenzType[] {
  const custom = data.absenzTypes || [];
  const overrideMap = new Map<string, AbsenzType>(custom.map(t => [t.id, t] as [string, AbsenzType]));
  const defaultIds = new Set(DEFAULT_ABSENZ_TYPES.map(t => t.id));
  const defaults = DEFAULT_ABSENZ_TYPES
    .map(t => overrideMap.get(t.id) || t)
    .filter(t => !overrideMap.get(t.id)?.deleted);
  const newCustom = custom.filter(t => !defaultIds.has(t.id) && !t.deleted);
  return [...defaults, ...newCustom];
}

/**
 * Alle Werktage (Mo–Fr) eines Monats, jeweils mit zugehörigem Feiertag oder null.
 * Feiertage werden NICHT abgezogen, nur markiert. `month` ist 0-basiert (0 = Januar).
 */
export function getWorkdaysInMonth(
  year: number,
  month: number,
  feiertage: Feiertag[] | undefined,
): { date: DateStr; feiertag: Feiertag | null }[] {
  // month: 0-based. Reine UTC-Arithmetik (Date.UTC/getUTCDay/setUTCDate)
  // statt lokaler Date-Methoden gemischt mit toISOString() (UTC) — die
  // Mischung driftete beim Wechsel auf Sommerzeit um einen Tag auseinander
  // (lokal 01:00 CET → UTC 00:00, aber lokal 01:00 CEST → UTC 23:00 des
  // Vortags), was im März einen zusätzlichen Phantom-Wochentag erzeugte.
  // UTC kennt keine Zeitumstellung, also bleibt reine UTC-Arithmetik stabil.
  const days: { date: DateStr; feiertag: Feiertag | null }[] = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    const ds = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const ft = (feiertage || []).find(f => f.date === ds);
      days.push({ date: ds, feiertag: ft || null });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

// ─── LOHNBERECHNUNG HELPER ──────────────────────────────────────

export type { LohnResult };

/**
 * Monatliche Lohnabrechnung eines Mitarbeiters. Alle Abzüge sind Prozente vom
 * Gesamtbrutto (inkl. 13. Lohn und Bonus); fehlen Sätze am Mitarbeiter, gelten
 * die Standardwerte (AHV 5.3, ALV 1.1, BVG 8.0, NBU 1.5, KTG 0.5, PK-AG 8.0, QST 10).
 * Jeder Posten wird einzeln auf Rappen gerundet, damit die Summen auf dem Beleg aufgehen.
 *
 * @param monat (derzeit ungenutzt) `YYYY-MM`
 * @param spesen mit dem Lohn ausbezahlte Spesen (`amount` in CHF)
 * @param bonus einmalige Zulage in CHF; AHV-pflichtig
 */
export function calcLohn(
  emp: Employee,
  monat: string | undefined,
  spesen?: { amount?: number }[],
  bonus?: number,
): LohnResult {
  const pensumFactor = (emp.pensum || 100) / 100;
  const bruttoBase = emp.monatslohn || 0;
  const brutto = Math.round(bruttoBase * pensumFactor * 100) / 100;
  // 13. Monatslohn: 1/12 pro Monat
  const dreizehnter = emp.dreizehnterLohn ? Math.round(brutto / 12 * 100) / 100 : 0;
  const bonusBetrag = Math.round((bonus || 0) * 100) / 100;
  const bruttoTotal = brutto + dreizehnter + bonusBetrag; // Bonus ist AHV-pflichtig

  const ahv    = Math.round(bruttoTotal * ((emp.ahvSatz  ?? 5.3)  / 100) * 100) / 100;
  const alv    = Math.round(bruttoTotal * ((emp.alvSatz  ?? 1.1)  / 100) * 100) / 100;
  const bvg    = Math.round(bruttoTotal * ((emp.bvgSatz  ?? 8.0)  / 100) * 100) / 100;
  const nbu    = Math.round(bruttoTotal * ((emp.nbuSatz  ?? 1.5)  / 100) * 100) / 100;
  const ktg    = Math.round(bruttoTotal * ((emp.ktgSatz  ?? 0.5)  / 100) * 100) / 100;
  const qst    = emp.quellensteuerPflichtig
    ? Math.round(bruttoTotal * ((emp.quellensteuerSatz ?? 10) / 100) * 100) / 100 : 0;
  const bvgAG  = Math.round(bruttoTotal * ((emp.pkAGSatz ?? 8.0)  / 100) * 100) / 100;

  const totalAbzuege = ahv + alv + bvg + nbu + ktg + qst;
  const netto = Math.round((bruttoTotal - totalAbzuege) * 100) / 100;
  const spesenTotal = Math.round((spesen || []).reduce((s, e) => s + (e.amount || 0), 0) * 100) / 100;
  const auszahlung = Math.round((netto + spesenTotal) * 100) / 100;

  return { brutto, bruttoBase, dreizehnter, bonusBetrag, bruttoTotal, ahv, alv, bvg, nbu, ktg, qst, totalAbzuege, netto, spesenTotal, auszahlung, bvgAG };
}

// ─── Dashboard layout helpers ──────────────────────────────────────────────────

const KPI_IDS = ["kpi-projekte","kpi-stunden","kpi-ausstehend","kpi-umsatz"];
const MID_IDS = ["aktive-projekte","unverrechnete-stunden","umsatz-sparkline","offene-offerten"];
const FULL_IDS = ["warnungen","letzte-zeiteintraege","meine-zeiteintraege"];

/** Altes Dashboard-Format (flache Widget-Liste) in Zeilen umwandeln: KPIs oben, mittlere Kacheln in 3er-Zeilen, breite Kacheln einzeln. */
export function widgetsToRows(widgetIds: string[]): DashboardRow[] {
  const uid = () => generateId().replace(/-/g, "").slice(0, 8);
  const kpi  = widgetIds.filter(w => KPI_IDS.includes(w));
  const mid  = widgetIds.filter(w => MID_IDS.includes(w));
  const full = widgetIds.filter(w => FULL_IDS.includes(w));
  const rows: DashboardRow[] = [];
  if (kpi.length)  rows.push({ id: uid(), cols: Math.min(4, Math.max(2, kpi.length)), minH: 0, widgets: kpi });
  for (let i = 0; i < mid.length; i += 3) {
    const chunk = mid.slice(i, i + 3);
    rows.push({ id: uid(), cols: Math.max(2, chunk.length), minH: 0, widgets: chunk });
  }
  full.forEach(w => rows.push({ id: uid(), cols: 1, minH: 0, widgets: [w] }));
  return rows;
}

/** Bringt ein gespeichertes Dashboard-Layout ins Zeilenformat; leer/ungültig → null. */
export function migrateDashboardLayout(val: unknown): DashboardRow[] | null {
  if (!val || !Array.isArray(val) || val.length === 0) return null;
  if (typeof val[0] === "object" && "widgets" in val[0]) return val as DashboardRow[];
  return widgetsToRows(val as string[]);
}

type NamedParty = { company?: string; name?: string };

/** Inhalt eines Druckauftrags, soweit für den PDF-Dateinamen relevant (siehe print/PrintComponents). */
export interface PdfNameContent {
  type?: string;
  inv?: { number?: string; date?: DateStr };
  quote?: { number?: string; date?: DateStr };
  vertrag?: { number?: string; date?: DateStr };
  note?: { number?: string };
  protokoll?: { date?: DateStr; nummer?: string };
  emp?: { name?: string };
  monatLabel?: string;
  filterYear?: string | number;
  client?: NamedParty;
}

/**
 * PDF-Dateiname aus dem Format der Einstellungen (Standard `{studio}_{typ}_{nummer}`).
 * Platzhalter: {studio} {typ} {nummer} {kunde} {datum}. Sonderzeichen werden zu `-`;
 * ist das Ergebnis leer, heisst die Datei «RAPPORT».
 */
export function buildPdfName(
  format: string | undefined,
  content: PdfNameContent | null | undefined,
  settings: Pick<Settings, "name"> | null | undefined,
): string {
  const studio = (settings?.name || "RAPPORT").replace(/\s+/g, "-");
  const typeLabels: Record<string, string> = {
    "invoice": "Rechnung", "invoice+qr": "Rechnung", "qrbill": "QR-Rechnung",
    "quote": "Offerte", "vertrag": "Vertrag", "lieferschein": "Lieferschein", "protokoll": "Protokoll",
    "lohn": "Lohnabrechnung", "letter": "Brief", "projectDetail": "Projekt",
    "projectsOverview": "Projekte", "buchhaltung": "Buchhaltung", "studioBudget": "Budget",
  };
  const typ = (content?.type && typeLabels[content.type]) || content?.type || "Dokument";
  let nummer = "";
  let kunde = "";
  let datum = localISODate();
  if (content?.inv) {
    nummer = content.inv.number || "";
    datum = content.inv.date || datum;
    kunde = content.client?.company || content.client?.name || "";
  } else if (content?.quote) {
    nummer = content.quote.number || "";
    datum = content.quote.date || datum;
    kunde = content.client?.company || content.client?.name || "";
  } else if (content?.vertrag) {
    nummer = content.vertrag.number || "";
    datum = content.vertrag.date || datum;
    kunde = content.client?.company || content.client?.name || "";
  } else if (content?.note) {
    nummer = content.note.number || "";
    kunde = content.client?.company || content.client?.name || "";
  } else if (content?.protokoll) {
    datum = content.protokoll.date || datum;
    nummer = content.protokoll.nummer || "";
  } else if (content?.emp) {
    kunde = content.emp.name || "";
    nummer = content.monatLabel || "";
  } else if (content?.filterYear) {
    nummer = String(content.filterYear);
  }
  const sanitize = (s?: string) => (s || "").replace(/[^a-zA-Z0-9äöüÄÖÜ_\-.]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const fmt = format || "{studio}_{typ}_{nummer}";
  const result = fmt
    .replace("{studio}", sanitize(studio))
    .replace("{typ}", sanitize(typ))
    .replace("{nummer}", sanitize(nummer))
    .replace("{kunde}", sanitize(kunde))
    .replace("{datum}", sanitize(datum));
  return result.replace(/-+/g, "-").replace(/^-|-$/g, "") || "RAPPORT";
}

/**
 * Kategorie eines Kontakts. Altdaten haben keine `category`: ehemalige Partner (Fachplaner usw.)
 * gelten als «Unternehmer», alle anderen bleiben ohne Kategorie (`undefined`) bis sie gesetzt wird.
 */
export function contactCategory(p: Person): ContactCategory | undefined {
  return p.category ?? (p.isPartner ? "unternehmer" : undefined);
}

/** Initialen eines Namens in Grossbuchstaben: «Julian Roth» -> «JR», «Meier + Steiner AG» -> «MSA», max. 3 Zeichen. */
export function initialsOf(name: string): string {
  return (name || "").split(/[\s+&,/-]+/).filter(w => /^[A-Za-zÀ-ÿ]/.test(w)).map(w => w[0].toUpperCase()).join("").slice(0, 3);
}

/** Kürzel eines Protokoll-Teilnehmers: gesetztes `kuerzel`, sonst die Initialen. */
export function participantKuerzel(p: ProtocolParticipant): string {
  return (p.kuerzel || "").trim() || initialsOf(p.name);
}

/**
 * Anzeige für «Wer» einer Aufgabe: Ist der Eintrag der volle Name oder das Kürzel eines Teilnehmers,
 * erscheint dessen Kürzel; sonst der Text, wie er erfasst wurde (z.B. eine Firma, die nicht teilnahm).
 */
export function responsibleLabel(responsible: string | undefined, participants: ProtocolParticipant[]): string {
  const r = (responsible || "").trim();
  if (!r) return "";
  const hit = participants.find(p => p.name.trim().toLowerCase() === r.toLowerCase() || participantKuerzel(p).toLowerCase() === r.toLowerCase());
  return hit ? participantKuerzel(hit) : r;
}

/**
 * Genehmigungsart und Frist eines Protokolls: Angabe am Protokoll vor der Büro-Vorgabe;
 * ohne beides Unterschriftenfelder und 24 Stunden.
 */
export function protocolApproval(p: { approval?: ProtocolApproval; approvalHours?: number }, s: Settings): { mode: ProtocolApproval; hours: number } {
  return { mode: p.approval || s.protokollApproval || "unterschrift", hours: p.approvalHours ?? s.protokollApprovalHours ?? 24 };
}

/** Frist als Text: volle Tage ab 48 h als «2 Tagen», sonst «24 Stunden» (Dativ, für «innert …»). */
export function approvalDeadlineText(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} Tagen` : `${hours} Stunden`;
}

// ── Dateien (Belege, Bilder) ───────────────────────────────────────────────────
// Dateien werden als Data-URL im Datenstand gespeichert (Belege, Logo, Pinnwand, Dokument-Design).
// Lokal liegt das im selben localStorage-Eintrag wie alle anderen Daten; WKWebView erlaubt dort
// insgesamt nur ~5,2 Mio. Zeichen (gemessen). Vor dem Hinzufügen grosser Dateien `checkLocalBudget`.

/** Obergrenze für den gesamten localStorage-Eintrag (gemessen ~5,24 Mio. Zeichen, mit Reserve). */
export const LOCAL_STORAGE_BUDGET = 4_800_000;

/** Lesbare Grösse («1,4 MB»); gemessen in Zeichen, wie sie im Speicher landen. */
export function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} B`;
  if (chars < 1_000_000) return `${Math.round(chars / 1000)} KB`;
  return `${(chars / 1_000_000).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Lokaler Modus: ob `added` Zeichen noch in den Speicher passen, wenn `removed` gleichzeitig wegfallen.
 * Ein voller Speicher liesse sonst JEDES weitere Speichern scheitern.
 * @returns null = passt, sonst eine Meldung für den Nutzer.
 */
export function checkLocalBudget(data: AppData, added: number, removed = 0): string | null {
  const used = JSON.stringify(data).length;
  if (used - removed + added <= LOCAL_STORAGE_BUDGET) return null;
  const free = Math.max(0, LOCAL_STORAGE_BUDGET - used + removed);
  return `Nicht genug lokaler Speicher: Die Datei braucht ${formatSize(added)}, frei sind noch ${formatSize(free)}. `
    + "Kleinere Datei verwenden (z.B. SVG oder komprimiertes Bild) — mit einem Datenordner oder im Cloud-Modus gibt es diese Grenze nicht.";
}

/** Liest eine Datei als Data-URL. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Bild verkleinern und als JPEG-Data-URL liefern. `fit: "width"` begrenzt nur die Breite
 * (Belege bleiben hoch genug für die Texterkennung), `"longest"` die längere Seite (Avatare).
 */
export async function imageFileToJpeg(file: Blob, max: number, quality: number, fit: "width" | "longest" = "width"): Promise<string> {
  const img = new Image();
  img.src = await readAsDataUrl(file);
  await img.decode().catch(() => { throw new Error("Das Bild konnte nicht gelesen werden."); });
  const side = fit === "width" ? img.naturalWidth : Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, max / side);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Beleg als Data-URL: PDFs unverändert, Bilder auf 1600 px Breite verkleinert. */
export function receiptToDataUrl(file: File): Promise<string> {
  return file.type === "application/pdf" ? readAsDataUrl(file) : imageFileToJpeg(file, 1600, 0.82);
}
