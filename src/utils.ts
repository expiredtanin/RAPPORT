// ─── UTILS ──────────────────────────────────────────────────
//
// Business-Logik-Bibliothek ohne React und ohne State: Kalkulation (SIA-Honorar,
// Lohn), Formatierung (CHF, Datum, KW), QR-Rechnung-Hilfen, Nummernformate,
// Passwort-Hashing, HTML-Sanitizing und Exporte. Fast alles sind reine
// Funktionen; Ausnahmen (DOM/Browser) sind im jeweiligen Kommentar vermerkt:
// `htmlToText`, `sanitizeHtml`. Buchhaltungs-Summen und CSV-Export: accounting.ts.
//
// Konventionen, die für alle Funktionen gelten:
//   - Geldbeträge sind CHF als `number`, auf Rappen (2 Stellen) gerundet.
//   - Zeiten sind Minuten (`formatHours`), Honorar-Stunden sind Dezimalstunden.
//   - Datumswerte sind ISO-Strings `YYYY-MM-DD` (lokal, ohne Zeitzone).
//
// Fachliche Hintergründe (SIA, MWST, Lohnabzüge): docs/FACHLOGIK.md.

import { DEFAULT_ABSENZ_TYPES, NON_BILLING_CATEGORIES } from "./constants";
import type {
  AbsenzType, AppData, ContactCategory, DashboardRow, ProtocolApproval, ProtocolParticipant, DateStr, DeliveryNote, Employee, Feiertag, Id,
  Invoice, LohnResult, ManualPhase, Person, Project, ProjectUsage, Protocol, Quote, Role, Settings, SiaItem, SiaPhase,
  TimeEntry, User, Contract,
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

/** Bandbreite einer Stichprobe: Median und unterer/oberer Wert (siehe `calcOfficeBenchmarks`). */
export interface RangeStats { n: number; median: number; low: number; high: number }

/** Ein abgeschlossenes eigenes Projekt als Erfahrungswert. */
export interface BenchmarkSample {
  projectId: Id;
  name: string;
  floorArea: number;
  /** erfasste Stunden gesamt */
  hours: number;
  hoursPerM2: number;
  /** erfasste Stunden je Phase (`TimeEntry.phaseId`); ohne Phase nicht enthalten */
  phaseHours: Record<string, number>;
}

/** Erfahrungswerte einer Nutzung. */
export interface UsageBenchmark {
  samples: BenchmarkSample[];
  /** Stunden je m² GF */
  hoursPerM2: RangeStats;
  /** mittlerer Anteil je Phase an den phasenbezogenen Stunden (Summe 1); leer, wenn nie eine Phase erfasst wurde */
  phaseShares: Record<string, number>;
}

/** Ab so vielen Projekten gilt die Bandbreite 10.–90. Perzentil, darunter kleinster bis grösster Wert. */
const BENCHMARK_PERCENTILE_MIN = 5;

/** Perzentil (p 0…1) einer aufsteigend sortierten, nicht leeren Liste, linear interpoliert. */
function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Median und Bandbreite einer Stichprobe (siehe BENCHMARK_PERCENTILE_MIN); leere Liste → alles 0. */
export function rangeStats(values: number[]): RangeStats {
  if (!values.length) return { n: 0, median: 0, low: 0, high: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const wide = sorted.length < BENCHMARK_PERCENTILE_MIN;
  return {
    n: sorted.length,
    median: percentile(sorted, 0.5),
    low: wide ? sorted[0] : percentile(sorted, 0.1),
    high: wide ? sorted[sorted.length - 1] : percentile(sorted, 0.9),
  };
}

/**
 * Erfahrungswerte des Büros je Nutzung: Stunden je m² Geschossfläche aus abgeschlossenen eigenen Projekten.
 * Gezählt wird ein Projekt mit Status «abgeschlossen», gesetzter Nutzung, Geschossfläche > 0 und erfassten
 * Stunden; nicht verrechenbare Kategorien (Wettbewerb) zählen nicht. Gleicher Aufbau wie die ETH
 * Value-Methode (Bezugsgrösse × Kennwert × Anpassungsfaktor), aber mit den eigenen Zahlen.
 *
 * @param projects alle Projekte
 * @param timeEntries alle Zeiteinträge (Minuten)
 */
export function calcOfficeBenchmarks(projects: Project[], timeEntries: TimeEntry[]): Partial<Record<ProjectUsage, UsageBenchmark>> {
  const candidates = new Map<Id, Project>();
  for (const p of projects || []) {
    if (p.status === "abgeschlossen" && p.usage && (p.floorArea || 0) > 0 && !NON_BILLING_CATEGORIES.includes(p.category || "")) {
      candidates.set(p.id, p);
    }
  }
  const totals = new Map<Id, { minutes: number; phases: Record<string, number> }>();
  for (const e of timeEntries || []) {
    if (!candidates.has(e.projectId) || !(e.minutes > 0)) continue;
    const t = totals.get(e.projectId) || { minutes: 0, phases: {} };
    t.minutes += e.minutes;
    if (e.phaseId) t.phases[e.phaseId] = (t.phases[e.phaseId] || 0) + e.minutes;
    totals.set(e.projectId, t);
  }
  const byUsage: Partial<Record<ProjectUsage, BenchmarkSample[]>> = Object.create(null);
  for (const [id, t] of totals) {
    const p = candidates.get(id)!;
    const hours = t.minutes / 60;
    const phaseHours = Object.fromEntries(Object.entries(t.phases).map(([ph, m]) => [ph, m / 60]));
    const usage = p.usage as ProjectUsage;
    (byUsage[usage] ||= []).push({ projectId: id, name: p.name, floorArea: p.floorArea!, hours, hoursPerM2: hours / p.floorArea!, phaseHours });
  }
  const result: Partial<Record<ProjectUsage, UsageBenchmark>> = Object.create(null);
  for (const [usage, samples] of Object.entries(byUsage) as [ProjectUsage, BenchmarkSample[]][]) {
    // Phasenanteile: je Projekt Anteil an seinen phasenbezogenen Stunden, dann über die Projekte gemittelt
    const shareSum: Record<string, number> = Object.create(null);
    let withPhases = 0;
    for (const s of samples) {
      const phaseTotal = Object.values(s.phaseHours).reduce((a, b) => a + b, 0);
      if (phaseTotal <= 0) continue;
      withPhases++;
      for (const [ph, h] of Object.entries(s.phaseHours)) shareSum[ph] = (shareSum[ph] || 0) + h / phaseTotal;
    }
    const phaseShares = Object.fromEntries(Object.entries(shareSum).map(([ph, sum]) => [ph, sum / withPhases]));
    result[usage] = {
      samples: samples.sort((a, b) => a.hoursPerM2 - b.hoursPerM2),
      hoursPerM2: rangeStats(samples.map(s => s.hoursPerM2)),
      phaseShares,
    };
  }
  return result;
}

/** Ergebnis von `estimateEffort`: Stunden gesamt (Bandbreite) und Aufteilung des Medians auf die Phasen. */
export interface EffortEstimate {
  total: RangeStats;
  /** ganze Stunden je Phase (Median × Phasenanteil), in der Reihenfolge der Anteile */
  phases: { id: string; hours: number }[];
}

/**
 * Schätzt den Aufwand eines neuen Projekts aus den Erfahrungswerten:
 * Stunden = Geschossfläche × Stunden je m² × Anpassungsfaktor (für Median und Bandbreite).
 *
 * @param phaseIds nur diese Phasen verteilen (z.B. die Phasen der Offerte); die Anteile werden auf sie
 *   hochgerechnet, damit Stunden eigener Projektphasen nicht verloren gehen. Fehlt = alle Phasen.
 * @returns null, wenn es für die Nutzung keine Erfahrungswerte gibt oder Fläche/Faktor fehlen
 */
export function estimateEffort(bench: UsageBenchmark | undefined, floorArea: number, factor: number, phaseIds?: string[]): EffortEstimate | null {
  if (!bench || !bench.hoursPerM2.n || !(floorArea > 0) || !(factor > 0)) return null;
  const scale = floorArea * factor;
  const { n, median, low, high } = bench.hoursPerM2;
  const total = { n, median: Math.round(median * scale), low: Math.round(low * scale), high: Math.round(high * scale) };
  const shares = Object.entries(bench.phaseShares).filter(([id]) => !phaseIds || phaseIds.includes(id));
  const shareSum = shares.reduce((s, [, share]) => s + share, 0);
  const phases = shares
    .map(([id, share]) => ({ id, hours: Math.round(total.median * share / shareSum) }))
    .filter(ph => ph.hours > 0);
  return { total, phases };
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
  /** offerierter Betrag je Phase (SIA: Phasenstunden × Stundenansatz, Aufwand: Stunden × Satz der Rolle), auf Rappen */
  phasesAmount: { id: string; amount: number }[];
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
  const phaseMap: Record<string, number> = Object.create(null); // phaseId -> hours (summed)
  const phaseAmountMap: Record<string, number> = Object.create(null); // phaseId -> offerierter Betrag (summed)
  const enabledSet = new Set<string>(); // phases enabled in quotes even with 0 hours

  quotes.forEach(q => {
    const roles = q.quoteRoles || settingsRoles || [];
    if (q.mode === "sia") {
      const calc = calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []);
      totalHours += calc.total || 0;
      totalAmount += (calc.total || 0) * (q.sia?.stundenansatz || 0);
      (calc.phases || []).forEach(ph => {
        if (ph.hours > 0) {
          phaseMap[ph.id] = (phaseMap[ph.id] || 0) + ph.hours;
          phaseAmountMap[ph.id] = (phaseAmountMap[ph.id] || 0) + ph.hours * (q.sia?.stundenansatz || 0);
        }
      });
    } else if (q.mode === "manual") {
      const calc = calcManualHours(q.manualPhases || [], roles);
      totalHours += calc.totalHours || 0;
      totalAmount += calc.totalAmount || 0;
      (q.manualPhases || []).filter(ph => ph.enabled).forEach(ph => {
        enabledSet.add(ph.id);
        const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
        if (h > 0) {
          phaseMap[ph.id] = (phaseMap[ph.id] || 0) + h;
          phaseAmountMap[ph.id] = (phaseAmountMap[ph.id] || 0) + roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0) * r.rate, 0);
        }
      });
    } else if (q.mode === "free") {
      totalAmount += (q.freeItems || []).reduce((s, it) => s + lineAmount(it.qty, it.price), 0);
    }
  });

  const phasesBudget = Object.entries(phaseMap).map(([id, hours]) => ({ id, hours: Math.round(hours * 10) / 10 }));
  const enabledPhases = [...new Set([...phasesBudget.map(p => p.id), ...enabledSet])];
  return {
    budgetHours: Math.round(totalHours * 10) / 10,
    // auf Rappen wie das Netto der Offerte (`Quote.sub`) — sonst weicht das Pauschalhonorar und damit
    // die Schlussrechnung um Rappenbeträge vom offerierten Betrag ab
    budgetAmount: roundCHF(totalAmount),
    phasesBudget,
    phasesAmount: Object.entries(phaseAmountMap).map(([id, amount]) => ({ id, amount: roundCHF(amount) })),
    enabledPhases,
    hasFreeQuotes: quotes.some(q => q.mode === "free"),
    hasHourQuotes: quotes.some(q => q.mode === "sia" || q.mode === "manual"),
  };
}

/** true, wenn das Projekt Offerten mit Auftragsvolumen verknüpft hat (Hauptofferte/Nachtrag, nicht nur Referenzen). */
export function hasQuoteBudget(project: { linkedQuotes?: { quoteId: Id; role: string }[]; sourceQuoteId?: Id }): boolean {
  return migrateLinkedQuotes(project).some(lq => lq.role !== "Referenz");
}

/**
 * Pauschalhonorar (netto) eines Projekts — die eine Quelle für Akonto %, Akonto-Planer, Schlussrechnung
 * und Anzeigen. Mit verknüpften Offerten: Summe Hauptofferte + Nachträge (`budgetAmount`, von
 * `deriveQuoteBudget` nachgeführt); ohne Offerten: der von Hand gesetzte Pauschalpreis (`budget`).
 * Fallback für alte Daten: fehlt der eine Wert, gilt der andere.
 */
export function projectFee(project: Pick<Project, "budget" | "budgetAmount" | "linkedQuotes"> & { sourceQuoteId?: Id }): number {
  if (hasQuoteBudget(project) && (project.budgetAmount || 0) > 0) return project.budgetAmount || 0;
  return project.budget || project.budgetAmount || 0;
}

/**
 * Aus den verknüpften Offerten abgeleitete Projektfelder (Stunden, Betrag, Phasenbudget) für Verknüpfen,
 * Entkoppeln und das Speichern einer verknüpften Offerte. Bei Pauschalprojekten mit Offerten wird der
 * Pauschalpreis (`budget`) mitgeführt, damit Einstellungen und Rechnungen denselben Betrag zeigen; ohne
 * verbleibende Offerte bleibt ein von Hand gesetzter Pauschalpreis stehen.
 */
export function quoteBudgetFields(
  project: Pick<Project, "billingType" | "budget">,
  linkedQuotes: { quoteId: Id; role: string }[],
  allQuotes: Quote[],
  settingsRoles?: Role[],
): Pick<Project, "budgetHours" | "budgetAmount" | "phasesBudget" | "budget"> & { enabledPhases: string[] } {
  const d = deriveQuoteBudget(linkedQuotes, allQuotes, settingsRoles);
  const withBudget = linkedQuotes.some(lq => lq.role !== "Referenz");
  return {
    budgetHours: d.budgetHours,
    budgetAmount: d.budgetAmount,
    phasesBudget: d.phasesBudget,
    enabledPhases: d.enabledPhases,
    budget: withBudget && project.billingType === "pauschal" ? d.budgetAmount : project.budget,
  };
}

/**
 * Netto einer Rechnung nach Gesamtrabatt (Basis der MWST). Aus `sub − globalDisc` statt `subAfterDisc`,
 * weil ältere bzw. aus der Cloud geladene Rechnungen `subAfterDisc` als 0 tragen können.
 */
export function invoiceNet(inv: Pick<Invoice, "sub" | "globalDisc">): number {
  return roundCHF((inv.sub || 0) - (inv.globalDisc || 0));
}

/**
 * Umsatz netto eines Jahres: alle gestellten Rechnungen (ohne Entwürfe), zugeordnet nach Rechnungsdatum.
 * Gemeinsame Regel für Buchhaltung, Übersicht und «Heute».
 */
export function yearRevenue(invoices: Pick<Invoice, "status" | "date" | "sub" | "globalDisc">[], year: string): number {
  return roundCHF(invoices.filter(i => i.status !== "entwurf" && (!year || (i.date || "").startsWith(year))).reduce((s, i) => s + invoiceNet(i), 0));
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
// 600'000 Runden (OWASP-Empfehlung für PBKDF2-SHA-256, Stand 2023). Die Rundenzahl steht im Salt («i600000:<hex>»);
// Salts ohne Präfix stammen aus der Zeit mit 100'000 Runden und werden beim nächsten Login neu gehasht.
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_LEGACY_ITERATIONS = 100_000;
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
  // gespeicherter Salt: «i<Runden>:<hex>» (neu) oder nur «<hex>» (100'000 Runden)
  const m = saltHex ? /^i(\d+):([0-9a-f]+)$/i.exec(saltHex) : null;
  const iterations = saltHex ? (m ? Number(m[1]) : PBKDF2_LEGACY_ITERATIONS) : PBKDF2_ITERATIONS;
  const salt = saltHex
    ? hexToBytes(m ? m[2] : saltHex)
    : crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password ?? ""), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH },
    baseKey, PBKDF2_KEY_BITS
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: saltHex ?? `i${iterations}:${bytesToHex(salt)}` };
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
/** true, wenn das gespeicherte Passwort nach dem Login neu gehasht werden soll (Klartext oder alte Rundenzahl). */
export function needsPasswordUpgrade(user: Pick<User, "passwordHash" | "passwordSalt" | "password"> | null | undefined): boolean {
  if (!user) return false;
  if (!user.passwordHash) return typeof user.password === "string";
  return !/^i(\d+):/.test(user.passwordSalt || "") || Number(/^i(\d+):/.exec(user.passwordSalt || "")?.[1]) < PBKDF2_ITERATIONS;
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
/** Nicht erlaubte Elemente, deren Inhalt nicht als Text stehen bleiben soll (Code, Stil, Einbettungen). */
const DROP_WITH_CONTENT = new Set([
  "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TITLE", "TEXTAREA", "SELECT",
]);
const SAFE_ATTRS = new Set([
  "style", "color", "size", "face", "align", "href", "target", "rel",
]);
/** true, wenn ein Link in bereinigtem Rich-Text bleiben darf (kein javascript:/data:/vbscript:/file:, auch nicht verschleiert). */
export function isSafeUrl(url: unknown): boolean {
  if (!url) return false;
  // Browser ignorieren Leer- und Steuerzeichen im Schema («java\tscript:» wirkt wie «javascript:») → vorher entfernen
  // eslint-disable-next-line no-control-regex
  const v = String(url).replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
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
          // Nicht erlaubtes Element: Skript-, Stil- und Einbettungs-Elemente samt Inhalt weg; sonst den Inhalt
          // ZUERST bereinigen und dann an seine Stelle setzen (früher wurden die Kinder ungeprüft hochgezogen:
          // «<form><img onerror=…></form>» kam so durch)
          if (!DROP_WITH_CONTENT.has(tag.toUpperCase())) {
            walk(el);
            while (el.firstChild) node.insertBefore(el.firstChild, el);
          }
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
      } else if (child.nodeType !== 3) {
        // Kommentare und alle übrigen Knotenarten ausser Text entfernen
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
  const x = amount || 0;
  // Kaufmännisch auf Rappen: x·100 erst auf 15 Stellen bereinigen (1.005·100 = 100.49999… → 100.5, 105 × 7.7 % =
  // 8.084999… → 8.085), dann .5 vom Nullpunkt weg runden — eine Gutschrift rundet wie die Rechnung (−0.405 → −0.41).
  const cents = Math.round(Math.abs(Number((x * 100).toPrecision(15))));
  return (Math.sign(x) * cents) / 100 || 0;
}

/** Positionsbetrag Menge × Preis abzüglich Positionsrabatt in %, auf Rappen — die Positionen ergeben so genau das Zwischentotal. */
export function lineAmount(qty?: number | null, price?: number | null, discountPct?: number | null): number {
  const line = (qty || 0) * (price || 0);
  const disc = (discountPct || 0) > 0 ? line * ((discountPct || 0) / 100) : 0;
  return roundCHF(line - disc);
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

/**
 * Creditor Reference nach ISO 11649 («RF…») aus der Rechnungsnummer, für Konten ohne QR-IBAN: Buchstaben und
 * Ziffern der Nummer (höchstens die letzten 21), davor «RF» und zwei Prüfziffern (98 − Rest modulo 97).
 * Leer, wenn die Nummer weder Buchstaben noch Ziffern enthält.
 */
export function creditorReference(invoiceNumber?: string | null): string {
  const body = (invoiceNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-21);
  if (!body) return "";
  const numeric = (body + "RF00").replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of numeric) rest = (rest * 10 + Number(d)) % 97;
  return `RF${String(98 - rest).padStart(2, "0")}${body}`;
}

/**
 * Zahlungsreferenz einer Rechnung je nach Konto: QR-IBAN → QR-Referenz (QRR, Pflicht), sonst Creditor
 * Reference (SCOR); ohne verwertbare Rechnungsnummer keine Referenz (NON). `display` ist die Schreibweise
 * auf Rechnung, Zahlteil und Mahnung — wer von Hand zahlt, braucht bei einer QR-IBAN genau diese Referenz.
 */
export function paymentReference(invoiceNumber: string | null | undefined, iban: string | null | undefined): { type: "QRR" | "SCOR" | "NON"; reference?: string; display: string } {
  if (isQRIban(iban)) {
    const reference = generateQRReference(invoiceNumber);
    return { type: "QRR", reference, display: formatReference(reference) };
  }
  const reference = creditorReference(invoiceNumber);
  if (!reference) return { type: "NON", display: invoiceNumber || "" };
  return { type: "SCOR", reference, display: reference.match(/.{1,4}/g)!.join(" ") };
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
 * Nächste laufende Projektnummer des Jahres: grösste aus `settings.lastProjectSeq` (nur im selben Jahr) und den
 * Nummern bestehender Projekte (`parseSeqFromNumber`) + 1. So entsteht keine doppelte Nummer, wenn Projekte
 * importiert, von Hand nummeriert oder in einer Offerte angelegt wurden.
 */
export function nextProjectSeq(
  settings: Pick<Settings, "lastProjectSeq" | "lastProjectYear" | "projectNumberFormat">,
  projects: Pick<Project, "number">[] | undefined,
): number {
  const fmt = settings.projectNumberFormat || "YYYY/NN";
  let max = settings.lastProjectYear === new Date().getFullYear() ? (settings.lastProjectSeq || 0) : 0;
  for (const p of projects || []) {
    const seq = parseSeqFromNumber(p.number, fmt);
    if (seq !== null && seq > max) max = seq;
  }
  return max + 1;
}

/** Was beim Löschen eines Projekts seinen Verweis verlöre (für die Rückfrage), als lesbare Teile, leer = nichts. */
export function projectReferences(
  data: Pick<AppData, "timeEntries" | "invoices" | "quotes" | "protocols" | "contracts" | "deliveryNotes" | "expenses" | "leads">,
  projectId: Id,
): string[] {
  const n = (list: { projectId?: Id | null }[] | undefined) => (list || []).filter(x => x.projectId === projectId).length;
  const parts: [number, string, string][] = [
    [n(data.timeEntries), "Zeiteintrag", "Zeiteinträge"],
    [n(data.invoices), "Rechnung", "Rechnungen"],
    [n(data.quotes), "Offerte", "Offerten"],
    [n(data.contracts), "Vertrag", "Verträge"],
    [n(data.protocols), "Protokoll", "Protokolle"],
    [n(data.deliveryNotes), "Lieferschein", "Lieferscheine"],
    [n(data.expenses), "Spesenbeleg", "Spesenbelege"],
    [n(data.leads), "Lead", "Leads"],
  ];
  return parts.filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`);
}

/** Was beim Löschen eines Kontakts seinen Verweis verlöre (Auftraggeber in Projekten, Offerten, Rechnungen …). */
export function personReferences(
  data: Pick<AppData, "projects" | "invoices" | "quotes" | "contracts" | "deliveryNotes" | "leads">,
  personId: Id,
): string[] {
  const n = (list: { clientId?: Id | null }[] | undefined) => (list || []).filter(x => x.clientId === personId).length;
  const parts: [number, string, string][] = [
    [(data.projects || []).filter(p => p.clientId === personId || (p.projectContacts || []).some(pc => pc.contactId === personId)).length, "Projekt", "Projekte"],
    [n(data.invoices), "Rechnung", "Rechnungen"],
    [n(data.quotes), "Offerte", "Offerten"],
    [n(data.contracts), "Vertrag", "Verträge"],
    [n(data.deliveryNotes), "Lieferschein", "Lieferscheine"],
    [(data.leads || []).filter(l => l.clientId === personId || l.referrerId === personId).length, "Lead", "Leads"],
  ];
  return parts.filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`);
}

/**
 * Text für Zahlungserinnerung / Mahnung.
 * @param nr 1 = Zahlungserinnerung (10 Tage), 2 = 2. Mahnung (7 Tage), ≥3 = letzte Mahnung (5 Tage, Androhung rechtlicher Schritte)
 * @param sentDate Versanddatum der Mahnung; Stichtag für die Verzugstage (fehlt: heute)
 * @param clients alle Personen; der Kunde wird über `inv.clientId` gesucht
 */
export function buildReminderLetter(
  inv: Invoice,
  nr: number,
  sentDate: DateStr | undefined,
  clients: Person[],
  settings: Pick<Settings, "iban" | "name"> & MahnSettings,
  kosten?: MahnKosten,
): { client: Person | undefined; subject: string; body: string; kosten: MahnKosten } {
  const client = clients.find(c => c.id === inv.clientId);
  // Nur die früheren Stufen: beim Nachdrucken steht die gedruckte Mahnung selbst schon in `reminders`.
  const existingReminders = (inv.reminders || []).filter((r, i) => (r.nr || i + 1) < nr);
  // Verzugstage am Versanddatum der Mahnung (Nachdruck = gleicher Text wie damals), sonst heute
  const refDate = sentDate || localISODate();
  const daysPast = Math.floor((new Date(`${refDate}T00:00:00Z`).getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400000);
  const ref = paymentReference(inv.number, settings.iban);
  const intro = nr === 1
    ? `Bei einer Überprüfung unserer Buchhaltung stellen wir fest, dass die Rechnung Nr. ${inv.number} vom ${formatDate(inv.date)} über ${formatCHF(inv.total)} ${inv.dueDate && daysPast > 0 ? `seit ${daysPast} ${daysPast === 1 ? "Tag" : "Tagen"} (Fälligkeit: ${formatDate(inv.dueDate)}) ` : ""}noch nicht beglichen ist.\n\nWir bitten Sie höflich, den offenen Betrag innert 10 Tagen zu überweisen.`
    : nr === 2
    ? `Leider mussten wir feststellen, dass unsere Zahlungserinnerung vom ${formatDate(existingReminders[0]?.sentDate || existingReminders[0]?.date)} bezüglich Rechnung Nr. ${inv.number} über ${formatCHF(inv.total)} bisher ohne Reaktion geblieben ist.\n\nWir fordern Sie hiermit auf, den ausstehenden Betrag innert 7 Tagen zu begleichen.`
    : `Trotz unserer Zahlungserinnerungen vom ${existingReminders.map(r => formatDate(r.sentDate || r.date)).join(", ").replace(/, ([^,]*)$/, " und $1")} ist die Rechnung Nr. ${inv.number} über ${formatCHF(inv.total)} nach wie vor unbeglichen.\n\nWir sehen uns gezwungen, bei weiterem Ausbleiben der Zahlung innerhalb von 5 Tagen rechtliche Schritte einzuleiten.`;
  const k = kosten || mahnKosten(inv, nr, refDate, settings);
  const kostenText = k.zins > 0 || k.gebuehr > 0
    ? `\n\nOffener Rechnungsbetrag: ${formatCHF(k.offen)}`
      + (k.zins > 0 ? `\nVerzugszins ${k.zinsSatz} % ab ${formatDate(addDaysISO(inv.dueDate || refDate, 1))} bis ${formatDate(refDate)} (${k.zinsTage} ${k.zinsTage === 1 ? "Tag" : "Tage"}): ${formatCHF(k.zins)}` : "")
      + (k.gebuehr > 0 ? `\nMahngebühr${nr > 1 ? "en" : ""}: ${formatCHF(k.gebuehr)}` : "")
      + `\nTotal zu bezahlen: ${formatCHF(k.total)}`
    : "";
  // Firma (mit Ansprechpartnern): neutrale Anrede statt «Sehr geehrte/r Baugenossenschaft …»
  const anrede = client && (client.contacts || []).length > 0 ? "Sehr geehrte Damen und Herren" : `Sehr geehrte/r ${client?.name || "[Kunde]"}`;
  const body = `${anrede}\n\n${intro}${kostenText}\n\nIBAN: ${formatIban(settings.iban)}\nReferenz: ${ref.display}\n\nFreundliche Grüsse\n${settings.name}`;
  const subject = nr === 1 ? `Zahlungserinnerung – Rechnung Nr. ${inv.number}` : `${nr}. Mahnung – Rechnung Nr. ${inv.number}`;
  return { client, subject, body, kosten: k };
}

/** Einstellungen für Verzugszins und Mahngebühren (Einstellungen → Studio → Mahnwesen). */
export type MahnSettings = Partial<Pick<Settings, "verzugszinsAktiv" | "verzugszinsSatz" | "mahngebuehrAktiv" | "mahngebuehren">>;

/** Standard-Mahngebühren je Stufe (Zahlungserinnerung gratis, 2. Mahnung 20, ab 3. Mahnung 30). */
export const DEFAULT_MAHNGEBUEHREN = [0, 20, 30];

/** Offener Betrag, Verzugszins und Mahngebühren einer Mahnung. */
export interface MahnKosten {
  /** offener Rechnungsbetrag (inkl. MWST) */
  offen: number;
  /** Verzugstage ab dem Tag nach der Fälligkeit bis zum Versanddatum */
  zinsTage: number;
  /** Zinssatz in % p.a. (0 = kein Verzugszins) */
  zinsSatz: number;
  /** Verzugszins in CHF, auf Rappen gerundet */
  zins: number;
  /** Mahngebühren bis und mit dieser Stufe */
  gebuehr: number;
  /** offen + zins + gebuehr */
  total: number;
}

/** Datum + n Tage (UTC-Arithmetik auf «YYYY-MM-DD»). */
function addDaysISO(d: DateStr, n: number): DateStr {
  const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * Verzugszins und Mahngebühren einer Mahnung (Stufe `nr`) am Versanddatum `stichtag`.
 *
 * - Verzugszins (OR 104 Abs. 1: 5 % p.a., sofern nichts anderes vereinbart): nur wenn eingeschaltet.
 *   Die Rechnung nennt ein Zahlungsziel (Verfalltag, OR 102 Abs. 2), Verzug beginnt also am Tag danach.
 *   Zins = offen × Satz × Tage / 365, kaufmännisch auf Rappen.
 * - Mahngebühren sind gesetzlich nicht geschuldet (nur Verzugsschaden, OR 106) — nur wenn mit dem Kunden
 *   vereinbart (AGB/Vertrag) einschalten. Gefordert werden die Gebühren aller Stufen bis `nr`
 *   (fehlt eine Stufe in der Liste, gilt der letzte Betrag).
 * - Zins und Gebühren sind kein Entgelt für eine Leistung: ohne MWST (MWSTG Art. 18 Abs. 2 lit. i) und
 *   nicht in der Buchhaltung gebucht (erst der Zahlungseingang wird erfasst).
 */
export function mahnKosten(inv: Pick<Invoice, "total" | "dueDate">, nr: number, stichtag: DateStr, settings: MahnSettings): MahnKosten {
  const offen = roundCHF(inv.total || 0);
  const zinsSatz = settings.verzugszinsAktiv ? (settings.verzugszinsSatz ?? 5) : 0;
  const tage = inv.dueDate ? Math.max(0, Math.round((Date.parse(`${stichtag}T00:00:00Z`) - Date.parse(`${inv.dueDate}T00:00:00Z`)) / 86400000)) : 0;
  const zinsTage = zinsSatz > 0 ? tage : 0;
  const zins = zinsSatz > 0 ? roundCHF(offen * zinsSatz / 100 * zinsTage / 365) : 0;
  let gebuehr = 0;
  if (settings.mahngebuehrAktiv) {
    const list = settings.mahngebuehren?.length ? settings.mahngebuehren : DEFAULT_MAHNGEBUEHREN;
    for (let i = 0; i < nr; i++) gebuehr += Math.max(0, list[Math.min(i, list.length - 1)] || 0);
  }
  gebuehr = roundCHF(gebuehr);
  return { offen, zinsTage, zinsSatz, zins, gebuehr, total: roundCHF(offen + zins + gebuehr) };
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

/** Datum als lokales Datum: reines «YYYY-MM-DD» würde `new Date()` als UTC lesen (westlich von UTC = Vortag). */
function localDay(date: string | number | Date): Date {
  const m = typeof date === "string" ? date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ISO-8601-Kalenderwoche (Woche beginnt Montag, KW 1 enthält den 4. Januar). */
export function getWeekNumber(date: string | number | Date): number {
  const d = localDay(date);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d.getTime() - week1.getTime()) / 86400000 + ((week1.getDay() + 6) % 7) - 2) / 7) + 1;
}

/** «KW 42 / 2026». Das Jahr ist das ISO-Wochenjahr (30.12.2019 = «KW 1 / 2020», 1.1.2021 = «KW 53 / 2020»). */
export function formatKW(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const d = localDay(dateStr);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Donnerstag derselben Woche bestimmt das Jahr
  return `KW ${getWeekNumber(dateStr)} / ${d.getFullYear()}`;
}

/**
 * Laufende Nummer aus einer Protokollnummer. Passt die Nummer auf das Format (`applyProtoNumberFormat`),
 * zählt genau die NN-Stelle — sonst würden Ziffern der Projektnummer (PP) oder von Monat/Tag mitgezählt
 * («07-BS-01» → 7 statt 1). Passt sie nicht (z.B. altes Format), gilt die letzte Zahlengruppe, die keine
 * Jahreszahl (4-stellig, 2000–2099) ist. Ohne Zahl → null.
 */
export function protoSeqOf(nummer: string | undefined, fmt?: string): number | null {
  const num = nummer || "";
  if (fmt && /NNN|NN/.test(fmt)) {
    let captured = false;
    const pattern = fmt.replace(/YYYY|YY|NNN|NN|MM|DD|PPP|PP|TT|[-/\\^$*+?.()|[\]{}]/g, t => {
      if (t === "YYYY") return "\\d{4}";
      if (t === "YY" || t === "MM" || t === "DD") return "\\d{2}";
      if (t === "PPP" || t === "PP") return ".+?";
      if (t === "TT") return ".*?";
      if (t === "NNN" || t === "NN") { if (captured) return "\\d+"; captured = true; return "(\\d+)"; }
      return "\\" + t;
    });
    const m = num.match(new RegExp(`^${pattern}$`));
    if (m) return parseInt(m[1]);
  }
  const groups = num.match(/\d+/g) || [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const n = parseInt(groups[i]);
    if (!(groups[i].length === 4 && n >= 2000 && n <= 2099)) return n;
  }
  return null;
}

/**
 * Nächste laufende Protokollnummer: grösste laufende Nummer (`protoSeqOf`) der bestehenden Protokolle + 1.
 * Jahreszahlen zählen nie, damit «2026-BS-03» → 3 zählt, nicht 2026.
 * @param fmt Nummernformat (`settings.protokollNumberFormat`); ohne Format nur die Rückfallregel
 */
export function nextProtoSeq(protocols: Pick<Protocol, "nummer">[] | undefined, fmt?: string): number {
  let max = 0;
  (protocols || []).forEach(p => {
    const n = protoSeqOf(p.nummer, fmt);
    if (n !== null && n > max) max = n;
  });
  return max + 1;
}

/** Angaben, aus denen eine Protokollnummer entsteht (ohne laufende Nummer). */
export interface ProtoNumberContext { date?: DateStr; projectNumber?: string; typKuerzel?: string }

const PROTO_SEQ_MARK = 987654;

/**
 * «Kreis» einer Protokollnummer: die formatierte Nummer mit Platzhalter statt laufender Nummer
 * (z.B. «07-BS-#»). Protokolle mit gleichem Kreis zählen gemeinsam; ohne NN/NNN im Format null.
 */
export function protoScopeKey(fmt: string | undefined, ctx: ProtoNumberContext): string | null {
  if (!fmt || !/NN/.test(fmt)) return null;
  return applyProtoNumberFormat(fmt, { ...ctx, seq: PROTO_SEQ_MARK }).replace(String(PROTO_SEQ_MARK), "#");
}

/**
 * Nächste Protokollnummer, gezählt innerhalb des Kreises, den das Format sichtbar macht: steckt die
 * Projektnummer drin (PP/PPP), pro Projekt; das Jahr (YYYY/YY), pro Jahr; das Typkürzel (TT), pro
 * Sitzungsart — z.B. «07-BS-03» für die dritte Bausitzung im Projekt 07, unabhängig von anderen
 * Projekten. So entsteht nie eine doppelte Nummer, und die Zählung passt zu dem, was man liest.
 * Ohne NN/NNN im Format: bisherige Regel über alle Protokolle (`nextProtoSeq`).
 * @param excludeId Protokoll, das nicht mitzählt (beim Umnummerieren nach Projekt-/Typwechsel)
 */
export function nextProtoNumber(
  protocols: Pick<Protocol, "id" | "nummer">[] | undefined,
  fmt: string | undefined,
  ctx: ProtoNumberContext,
  excludeId?: Id,
): { nummer: string; seq: number } {
  const list = (protocols || []).filter(p => p.id !== excludeId);
  const key = protoScopeKey(fmt, ctx);
  let seq: number;
  if (!key) {
    seq = nextProtoSeq(list, fmt);
  } else {
    const [pre, post] = key.split("#");
    const esc = (t: string) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`);
    let max = 0;
    for (const p of list) {
      const m = (p.nummer || "").match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    seq = max + 1;
  }
  return { seq, nummer: applyProtoNumberFormat(fmt, { ...ctx, seq }) };
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

/**
 * Uhrzeit auf «HH:MM» bringen («8:00», «08:00:00», «8.30» → «08:00»/«08:30»); ungültig oder leer → "".
 * Der Server nimmt nur «HH:MM» an (pb_migrations/1787890000_field_validation.js); 24:00 als Tagesende bleibt.
 */
export function normalizeTime(v: unknown): string {
  const m = /^\s*(\d{1,2})[:.](\d{2})(?::\d{2})?\s*$/.exec(String(v ?? ""));
  if (!m) return "";
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return "";
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * Eine CSV-Zelle in Anführungszeichen. Text, der mit «=», «+», «-», «@», Tab oder Zeilenumbruch beginnt, bekommt
 * ein «'» davor, damit Excel/Numbers ihn nicht als Formel ausführt (CSV-Injection, z.B. ein Kundenname
 * «=HYPERLINK(…)»). Zahlen wie «-12.50» bleiben unverändert.
 */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r\n]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Für HTML maskieren («Müller & Partner» → «Müller &amp; Partner»). */
function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Briefvorlage füllen: {{client}} und {{project}} durch die (maskierten) Namen ersetzen, ohne Auswahl «[Kunde]»/«[Projekt]». */
export function fillLetterTemplate(body: string, names: { client?: string; project?: string }): string {
  return body
    .replace(/\{\{client\}\}/g, () => escHtml(names.client || "[Kunde]"))
    .replace(/\{\{project\}\}/g, () => escHtml(names.project || "[Projekt]"));
}

/**
 * Gegenstück zu `fillLetterTemplate` beim Speichern als Vorlage: die eingesetzten Namen (und die
 * Lückenfüller «[Kunde]»/«[Projekt]») werden wieder zu {{client}}/{{project}}, damit «Speichern»
 * die Platzhalter nicht verliert. Ersetzt nur ganze Wörter; der längere Name zuerst.
 */
export function letterToTemplate(body: string, names: { client?: string; project?: string }): string {
  const reEsc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pairs: [string, string][] = [["[Kunde]", "{{client}}"], ["[Projekt]", "{{project}}"]];
  if (names.client?.trim()) pairs.push([escHtml(names.client.trim()), "{{client}}"]);
  if (names.project?.trim()) pairs.push([escHtml(names.project.trim()), "{{project}}"]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = body;
  for (const [name, ph] of pairs) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(name)}(?![\\p{L}\\p{N}])`, "gu"), (_m, pre: string) => pre + ph);
  }
  return out;
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
 * Höchstbetrag des versicherten Verdiensts für ALV und UVG (NBU) pro Jahr, CHF.
 * Gesetzlicher Wert (seit 2016 unverändert), daher keine Einstellung. Darüber kein ALV-/NBU-Abzug.
 */
export const HOECHSTLOHN_ALV_UVG = 148_200;

/**
 * Anteil des Monats, der nach dem Eintritt liegt (Kalendertage-Methode): Eintritt am 15. Mai
 * (31 Tage) → 17/31. Vor dem Eintrittsmonat 0, danach 1. Ohne Eintrittsdatum oder Monat 1.
 * @param monat `YYYY-MM`
 */
export function monatsAnteilNachEintritt(eintrittsdatum: string | undefined, monat: string | undefined, austrittsdatum?: string | null): number {
  if (!monat || !/^\d{4}-\d{2}$/.test(monat)) return 1;
  const [y, m] = monat.split("-").map(Number);
  const tage = new Date(y, m, 0).getDate();
  const tagOf = (d: string) => Math.min(Math.max(parseInt(d.slice(8, 10), 10) || 1, 1), tage);
  let von = 1, bis = tage;
  if (eintrittsdatum) {
    const em = eintrittsdatum.slice(0, 7);
    if (em > monat) return 0;
    if (em === monat) von = tagOf(eintrittsdatum);
  }
  if (austrittsdatum) {
    const am = austrittsdatum.slice(0, 7);
    if (am < monat) return 0;
    if (am === monat) bis = tagOf(austrittsdatum);
  }
  return Math.max(0, bis - von + 1) / tage;
}

// ─── Verträge ──────────────────────────────────────────────────────────────────
/**
 * Vertragssumme netto (exkl. MWST, wie SIA 1001/1 «Honorar exkl. MWST») und der MWST-Satz.
 * Bis 26.11 übernahm die App aus einer Offerte den Bruttobetrag (`q.total`): entspricht `amount`
 * genau dem Offert-Total, gilt der Nettobetrag der Offerte (`q.sub`).
 */
export function contractAmounts(c: Pick<Contract, "amount" | "quoteId">, quotes: Pick<Quote, "id" | "total" | "sub" | "mwst" | "mwstRate">[] | undefined, defaultRate: number): { net: number; rate: number; tax: number; gross: number } {
  const q = c.quoteId ? (quotes || []).find(x => x.id === c.quoteId) : undefined;
  const legacyBrutto = !!q && q.mwst !== false && Math.abs((c.amount || 0) - (q.total || 0)) < 0.005 && Math.abs((q.total || 0) - (q.sub || 0)) > 0.005;
  const net = legacyBrutto ? (q!.sub || 0) : (c.amount || 0);
  const rate = q && q.mwst === false ? 0 : (q?.mwstRate ?? defaultRate);
  const tax = roundCHF(net * rate / 100);
  return { net, rate, tax, gross: roundCHF(net + tax) };
}

// ─── Sozialversicherungen: Grenzwerte (Stand 2025/2026, BSV) ───────────────────
/** AHV-Freibetrag für erwerbstätige Rentner:innen pro Monat (Art. 6quater AHVV) */
export const AHV_RENTNER_FREIBETRAG = 1400;
/** BVG-Eintrittsschwelle pro Jahr (Art. 2 BVG, Art. 5 BVV 2) */
export const BVG_EINTRITTSSCHWELLE = 22680;
/** BVG-Koordinationsabzug pro Jahr (Art. 8 BVG) */
export const BVG_KOORDINATIONSABZUG = 26460;
/** Oberer Grenzbetrag BVG pro Jahr */
export const BVG_OBERER_GRENZBETRAG = 90720;
/** Minimaler koordinierter Lohn pro Jahr */
export const BVG_MIN_KOORDINIERT = 3780;

/**
 * AHV-Status in einem Monat aus dem Geburtsdatum: «jung» bis Ende des Jahres, in dem 17 erreicht
 * wird (keine AHV/ALV-Beiträge auf dem Lohn, Art. 3 AHVG), «rentner» ab dem Monat nach dem
 * 65. Geburtstag (Referenzalter; Übergangsjahrgänge der Frauen über `Employee.ahvRentner`).
 */
export function ahvStatus(geburtsdatum: string | undefined, monat: string | undefined, rentnerFlag?: boolean): "jung" | "aktiv" | "rentner" {
  if (rentnerFlag) return "rentner";
  if (!geburtsdatum || !monat || !/^\d{4}-\d{2}/.test(geburtsdatum) || !/^\d{4}-\d{2}$/.test(monat)) return "aktiv";
  const gy = Number(geburtsdatum.slice(0, 4)), gm = Number(geburtsdatum.slice(5, 7));
  const y = Number(monat.slice(0, 4)), m = Number(monat.slice(5, 7));
  if (y - gy < 18) return "jung";
  // Monat nach dem 65. Geburtstag
  if ((y - gy) * 12 + (m - gm) > 65 * 12) return "rentner";
  return "aktiv";
}

/** BVG-Altersgutschrift in % des koordinierten Lohns nach Alter (Kalenderjahr − Geburtsjahr, Art. 16 BVG); unter 25 nur Risiko. */
export function bvgAltersgutschriftSatz(alter: number): number {
  if (alter < 25) return 0;
  if (alter <= 34) return 7;
  if (alter <= 44) return 10;
  if (alter <= 54) return 15;
  if (alter <= 65) return 18;
  return 0;
}

/** Koordinierter Jahreslohn nach BVG (Minimum); unter der Eintrittsschwelle 0. */
export function bvgKoordinierterLohn(jahreslohn: number): number {
  if (jahreslohn < BVG_EINTRITTSSCHWELLE) return 0;
  return Math.max(BVG_MIN_KOORDINIERT, Math.min(jahreslohn, BVG_OBERER_GRENZBETRAG) - BVG_KOORDINATIONSABZUG);
}

/** Weitere Arbeitgeber-Sätze in % (aus den Einstellungen, `lohnAGSaetze`). */
export interface LohnAGSaetze {
  /** Familienausgleichskasse, % der AHV-Lohnsumme */
  fak: number;
  /** Verwaltungskosten Ausgleichskasse, % der AHV/IV/EO-Beiträge (AN + AG) */
  vk: number;
  /** Berufsunfall UVG, % der UVG-Lohnsumme (bis Höchstlohn) */
  bu: number;
  /** KTG-Anteil Arbeitgeber, % des Bruttolohns; `null` = gleich wie der AN-Satz (paritätisch) */
  ktgAG: number | null;
  /** Familienzulagen im Ein-/Austrittsmonat anteilig (sonst voll) */
  fzAnteilig?: boolean;
}

/** AG-Sätze aus den Einstellungen mit branchenüblichen Vorgaben (FAK 1.0 %, VK 3 %, BU 0.1 %, KTG paritätisch). */
export function lohnAGSaetze(settings: Partial<Pick<Settings, "lohnFakSatz" | "lohnVkSatz" | "lohnBuSatz" | "lohnKtgAGSatz" | "familienzulagenAnteilig">> | undefined): LohnAGSaetze {
  return {
    fak: settings?.lohnFakSatz ?? 1.0,
    vk: settings?.lohnVkSatz ?? 3.0,
    bu: settings?.lohnBuSatz ?? 0.1,
    ktgAG: settings?.lohnKtgAGSatz ?? null,
    ...(settings?.familienzulagenAnteilig ? { fzAnteilig: true } : {}),
  };
}

/**
 * Kumulierter ALV-/UVG-Höchstlohn vom Jahresbeginn (bzw. Eintrittsmonat) bis und mit `monat`:
 * 12'350 pro Beschäftigungsmonat; der Eintrittsmonat zählt als ganzer Monat.
 * Ohne Monat: ein Monat.
 */
export function hoechstlohnKumuliert(eintrittsdatum: string | undefined, monat: string | undefined): number {
  const proMonat = HOECHSTLOHN_ALV_UVG / 12;
  if (!monat || !/^\d{4}-\d{2}$/.test(monat)) return proMonat;
  const year = monat.slice(0, 4);
  const m = parseInt(monat.slice(5, 7), 10);
  let ab = 1;
  if (eintrittsdatum && eintrittsdatum.slice(0, 4) === year) ab = parseInt(eintrittsdatum.slice(5, 7), 10) || 1;
  else if (eintrittsdatum && eintrittsdatum.slice(0, 4) > year) return 0;
  return Math.max(0, m - ab + 1) * proMonat;
}

/** Bereits abgerechnete Lohnsummen eines Mitarbeiters im selben Jahr vor `monat` (für den kumulierten Höchstlohn). */
export interface LohnVorperioden {
  /** Σ Bruttolohn Total der früheren Monate */
  bruttoBisher: number;
  /** Σ ALV-/UVG-pflichtiger Lohn der früheren Monate */
  alvBasisBisher: number;
  /** Σ Monatslohn (`brutto`) der früheren Monate mit 13. Monatslohn (für den Rappenausgleich im Dezember) */
  dreizehnterBasisBisher?: number;
  /** Σ bereits ausbezahlter 13. Monatslohn der früheren Monate */
  dreizehnterBisher?: number;
}

/**
 * Monatliche Lohnabrechnung eines Mitarbeiters. Abzüge sind Prozente vom Gesamtbrutto
 * (inkl. 13. Lohn und Bonus); fehlen Sätze am Mitarbeiter, gelten die Standardwerte
 * (AHV 5.3, ALV 1.1, BVG 8.0, NBU 1.5, KTG 0.5, PK-AG 8.0, QST 10).
 * - Eintritt im Monat: Monatslohn anteilig nach Kalendertagen (`monatsAnteilNachEintritt`).
 * - Pensum- und Lohnwechsel im Monat (`pensumVerlauf`, `lohnVerlauf`): tagesgenau gewichtet (`lohnImMonat`);
 *   für einen Lauf mit fest übersteuertem Pensum bzw. Lohn den jeweiligen Verlauf leeren.
 * - Familienzulagen im Ein-/Austrittsmonat voll, mit `agSaetze.fzAnteilig` anteilig nach Kalendertagen.
 * - ALV und NBU nur bis zum Höchstlohn 148'200/Jahr, kumuliert über das Jahr (`vorperioden`
 *   = frühere Abrechnungen desselben Jahres); darüber kein Abzug.
 * Jeder Posten wird einzeln auf Rappen gerundet, damit die Summen auf dem Beleg aufgehen.
 *
 * @param monat `YYYY-MM` (für Eintritt und Höchstlohn)
 * @param spesen mit dem Lohn ausbezahlte Spesen (`amount` in CHF, brutto)
 * @param bonus einmalige Zulage in CHF; AHV-pflichtig, nicht anteilig
 * @param vorperioden frühere Abrechnungen desselben Jahres (Standard: keine)
 */
export function calcLohn(
  emp: Employee,
  monat: string | undefined,
  spesen?: { amount?: number }[],
  bonus?: number,
  vorperioden?: LohnVorperioden,
  agSaetze?: LohnAGSaetze,
): LohnResult {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const hinweise: string[] = [];
  // Lohn × Pensum des Monats: mit Lohn- oder Pensumwechsel tagesgenau gewichtet (lohnImMonat)
  const monatsLohn = lohnImMonat(emp, monat);
  const bruttoBase = monatslohnImMonat(emp, monat);
  const anteil = monatsAnteilNachEintritt(emp.eintrittsdatum, monat, emp.austrittsdatum);
  const brutto = r2(monatsLohn * anteil);
  if (anteil > 0 && anteil < 1) hinweise.push(`Monatslohn anteilig (${Math.round(anteil * 1000) / 10} % des Monats, Ein-/Austritt)`);
  // 13. Monatslohn: 1/12 pro Monat; der Dezember gleicht die Rappen-Rundung der Vormonate aus,
  // damit übers Jahr genau 1/12 der Monatslöhne herauskommt (11 × 1'208.33 + 1'208.37 = 14'500.00).
  // Mit Vorperioden (Lohnlauf, Budget) auf Basis der tatsächlichen Monatslöhne, damit es auch nach einem
  // Pensumwechsel aufgeht; ohne Vorperioden wie bei elf gleichen Vormonaten.
  const dzBasis = vorperioden?.dreizehnterBasisBisher, dzBisher = vorperioden?.dreizehnterBisher;
  const dreizehnter = !emp.dreizehnterLohn ? 0
    : !monat?.endsWith("-12") ? r2(brutto / 12)
    : dzBasis !== undefined && dzBisher !== undefined ? r2(r2((dzBasis + brutto) / 12) - dzBisher)
    : r2(brutto - 11 * r2(brutto / 12));
  const bonusBetrag = r2(bonus || 0);
  const bruttoTotal = r2(brutto + dreizehnter + bonusBetrag); // Bonus ist AHV-pflichtig

  const status = ahvStatus(emp.geburtsdatum, monat, emp.ahvRentner);
  // AHV-pflichtiger Lohn: Jugendliche bis 17 beitragsfrei, Rentner mit Freibetrag 1'400/Monat
  const ahvBasis = status === "jung" ? 0 : status === "rentner" ? r2(Math.max(0, bruttoTotal - AHV_RENTNER_FREIBETRAG)) : bruttoTotal;
  if (status === "rentner") hinweise.push(`AHV-Rentner:in: Freibetrag CHF ${AHV_RENTNER_FREIBETRAG.toLocaleString("de-CH")}, keine ALV`);
  if (status === "jung") hinweise.push("Unter 18: keine AHV/IV/EO- und ALV-Beiträge");

  // ALV/UVG: kumulierte Methode — Lohnsumme bis und mit diesem Monat, gedeckelt auf den Höchstlohn
  // der Beschäftigungsmonate, minus bereits abgerechnete Basis (holt Überschüsse früherer Monate nach)
  const bisher = vorperioden || { bruttoBisher: 0, alvBasisBisher: 0 };
  const cap = hoechstlohnKumuliert(emp.eintrittsdatum, monat);
  // alvBasis = UVG-/ALV-pflichtiger Teil bis Höchstlohn (bleibt für die Kumulation auch bei Rentnern erhalten)
  const uvgBasis = r2(Math.max(0, Math.min(bisher.bruttoBisher + bruttoTotal, cap) - bisher.alvBasisBisher));
  const alvBasis = uvgBasis;

  const ahv    = r2(ahvBasis    * ((emp.ahvSatz  ?? 5.3)  / 100));
  const alv    = status === "aktiv" ? r2(alvBasis * ((emp.alvSatz ?? 1.1) / 100)) : 0;
  const nbu    = r2(uvgBasis    * ((emp.nbuSatz  ?? 1.5)  / 100));
  const ktg    = r2(bruttoTotal * ((emp.ktgSatz  ?? 0.5)  / 100));
  const qst    = emp.quellensteuerPflichtig ? r2(bruttoTotal * ((emp.quellensteuerSatz ?? 10) / 100)) : 0;

  // Pensionskasse: Beträge laut PK-Ausweis haben Vorrang; sonst % vom Bruttolohn. Unter der
  // BVG-Eintrittsschwelle und für Rentner keine Pflicht (dann 0, ausser PK-Ausweis-Beträge).
  const jahreslohn = monatsLohn * (emp.dreizehnterLohn ? 13 : 12);
  const pkAusweis = (emp.pkBeitragAN ?? 0) > 0 || (emp.pkBeitragAG ?? 0) > 0;
  let bvg = 0, bvgAG = 0;
  if (pkAusweis) {
    bvg = r2((emp.pkBeitragAN || 0) * anteil);
    bvgAG = r2((emp.pkBeitragAG || 0) * anteil);
  } else if (status === "rentner") {
    hinweise.push("Keine BVG-Beiträge (Rentner:in)");
  } else if (jahreslohn > 0 && jahreslohn < BVG_EINTRITTSSCHWELLE) {
    hinweise.push(`Jahreslohn unter der BVG-Eintrittsschwelle (CHF ${BVG_EINTRITTSSCHWELLE.toLocaleString("de-CH")}): keine PK-Beiträge`);
  } else {
    bvg = r2(bruttoTotal * ((emp.bvgSatz ?? 8.0) / 100));
    bvgAG = r2(bruttoTotal * ((emp.pkAGSatz ?? 8.0) / 100));
  }
  if (bvgAG < bvg) hinweise.push("PK: Der Arbeitgeber muss mindestens gleich viel zahlen wie der Arbeitnehmer (Art. 66 BVG)");
  // Prüfung gegen das BVG-Minimum (Altersgutschriften), wenn das Geburtsdatum bekannt ist
  if (emp.geburtsdatum && monat && status === "aktiv" && anteil === 1) {
    const alter = Number(monat.slice(0, 4)) - Number(emp.geburtsdatum.slice(0, 4));
    const minMonat = r2(bvgKoordinierterLohn(jahreslohn) * bvgAltersgutschriftSatz(alter) / 100 / 12);
    if (minMonat > 0 && bvg + bvgAG + 0.005 < minMonat) hinweise.push(`PK-Beiträge unter dem BVG-Minimum (Altersgutschrift ${bvgAltersgutschriftSatz(alter)} % ≈ CHF ${minMonat.toFixed(2)}/Monat): Beträge laut PK-Ausweis erfassen`);
  }

  const totalAbzuege = r2(ahv + alv + bvg + nbu + ktg + qst);
  const netto = r2(bruttoTotal - totalAbzuege);
  // Familienzulagen: im Ein-/Austrittsmonat voll oder anteilig nach Kalendertagen, je nach Praxis der Kasse
  const familienzulagen = anteil > 0 ? r2((emp.familienzulagen || 0) * (agSaetze?.fzAnteilig ? anteil : 1)) : 0;
  const spesenTotal = r2((spesen || []).reduce((s, e) => s + (e.amount || 0), 0));
  const auszahlung = r2(netto + familienzulagen + spesenTotal);

  // Weitere Arbeitgeberkosten (nur mit Sätzen; ältere Aufrufe ohne → 0)
  const ag = agSaetze;
  const agFak = ag ? r2(ahvBasis * ag.fak / 100) : 0;
  const agVk = ag ? r2(ahv * 2 * ag.vk / 100) : 0;
  const agBu = ag ? r2(uvgBasis * ag.bu / 100) : 0;
  const agKtg = ag ? r2(bruttoTotal * (ag.ktgAG ?? (emp.ktgSatz ?? 0.5)) / 100) : 0;

  return {
    brutto, bruttoBase, dreizehnter, bonusBetrag, bruttoTotal, alvBasis, ahvBasis,
    ahv, alv, bvg, nbu, ktg, qst, totalAbzuege, netto, familienzulagen, spesenTotal, auszahlung, bvgAG,
    agFak, agVk, agBu, agKtg, ...(hinweise.length ? { hinweise } : {}),
  };
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
    "schedule": "Terminprogramm",
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

/** Tages-Soll in Stunden einer Person: Wochenstunden (Standard 35) × Pensum (Standard 100 %) ÷ 5 — gleiche Regel wie in der Zeiterfassung. */
export function dailySollHours(emp: Partial<Pick<Employee, "wochenstunden" | "pensum">>): number {
  return ((emp.wochenstunden || 35) * ((emp.pensum || 100) / 100)) / 5;
}

/** Stunden als Tage der Person, z.B. «25 T» / «20.5 T» (eine Dezimale nur, wenn nicht ganzzahlig). */
export function formatDays(hours: number, emp: Partial<Pick<Employee, "wochenstunden" | "pensum">>): string {
  const per = dailySollHours(emp);
  if (!per) return "0 T";
  const d = Math.round((hours / per) * 10) / 10;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} T`;
}

/**
 * Rechnungen, die zu einer Offerte gehören: mit `quoteId` auf sie verwiesen; bei der Hauptofferte eines
 * Projekts zusätzlich die Projekt-Rechnungen ohne Offertbezug (Akonto/Teilrechnung über den Reiter «Projekt»).
 * Rechnungen anderer Offerten desselben Projekts (Nachträge) zählen nicht.
 */
export const invoicesForQuote = (q: Pick<Quote, "id" | "projectId">, invoices: Invoice[], projects: Project[]): Invoice[] => {
  const proj = q.projectId ? projects.find(p => p.id === q.projectId) : undefined;
  const linked = proj ? migrateLinkedQuotes(proj) : [];
  const isMain = !proj || linked.length === 0 || linked.some(lq => lq.quoteId === q.id && lq.role === "Hauptofferte");
  return invoices.filter(i => i.quoteId === q.id || (isMain && !!q.projectId && i.projectId === q.projectId && !i.quoteId));
};



// ─── Pensum über die Zeit ──────────────────────────────────────────────────────

/** Felder eines Mitarbeiters, aus denen Pensum und Wochenstunden zu einem Datum folgen. */
export type ArbeitszeitFelder = Partial<Pick<Employee, "pensum" | "wochenstunden" | "pensumVerlauf">>;

/**
 * Pensum (%) und Wochenstunden (100-%-Basis) an einem Datum: der letzte Eintrag aus `pensumVerlauf` mit
 * `ab` ≤ Datum, sonst `pensum`/`wochenstunden` (Grundwerte ab Eintritt). Pensum 0/leer gilt als 100 %,
 * Wochenstunden leer als 35 — wie überall in der App; ein Wechsel ohne Wochenstunden übernimmt die bisherigen.
 * Einträge ohne gültiges Datum oder Pensum werden übergangen.
 */
export function arbeitszeitAm(emp: ArbeitszeitFelder, ds: string): { pensum: number; wochenstunden: number } {
  let pensum = Number(emp.pensum) || 100;
  let wochenstunden = Number(emp.wochenstunden) || 35;
  const verlauf = emp.pensumVerlauf;
  if (!verlauf || verlauf.length === 0) return { pensum, wochenstunden };
  const day = ds.slice(0, 10);
  const sorted = verlauf.filter(v => v && /^\d{4}-\d{2}-\d{2}/.test(v.ab || "") && Number(v.pensum) > 0)
    .slice().sort((a, b) => a.ab.localeCompare(b.ab));
  for (const v of sorted) {
    if (v.ab.slice(0, 10) > day) break;
    pensum = Number(v.pensum);
    if (Number(v.wochenstunden) > 0) wochenstunden = Number(v.wochenstunden);
  }
  return { pensum, wochenstunden };
}

/**
 * Durchschnittliches Pensum (%) eines Monats `YYYY-MM` über die angestellten Tage, tagesgenau gewichtet
 * (Kalendertage, wie Ein-/Austritt im Lohn). Ohne Wechsel im Monat genau das gültige Pensum; ohne angestellte
 * Tage das Pensum am Monatsende. `Monatslohn × Pensum ÷ 100 × monatsAnteilNachEintritt` ergibt so den
 * tagesgenau anteiligen Lohn (z.B. 1.–15. 80 %, 16.–30. 100 % → 90 %).
 */
export function pensumImMonat(emp: ArbeitszeitFelder & Partial<Pick<Employee, "eintrittsdatum" | "austrittsdatum">>, monat: string | undefined): number {
  if (!monat || !/^\d{4}-\d{2}$/.test(monat)) return Number(emp.pensum) || 100;
  const [y, m] = monat.split("-").map(Number);
  const tage = new Date(y, m, 0).getDate();
  const last = `${monat}-${String(tage).padStart(2, "0")}`;
  if (!emp.pensumVerlauf || emp.pensumVerlauf.length === 0) return arbeitszeitAm(emp, last).pensum;
  let sum = 0, n = 0;
  for (let d = 1; d <= tage; d++) {
    const ds = `${monat}-${String(d).padStart(2, "0")}`;
    if ((emp.eintrittsdatum && ds < emp.eintrittsdatum) || (emp.austrittsdatum && ds > emp.austrittsdatum)) continue;
    sum += arbeitszeitAm(emp, ds).pensum; n++;
  }
  if (n === 0) return arbeitszeitAm(emp, last).pensum;
  // Gleiches Pensum an allen Tagen → exakt dieser Wert (keine Gleitkomma-Reste in der Lohnrechnung)
  const first = arbeitszeitAm(emp, emp.eintrittsdatum && emp.eintrittsdatum > `${monat}-01` ? emp.eintrittsdatum : `${monat}-01`).pensum;
  return sum === first * n ? first : sum / n;
}

// ─── Lohn über die Zeit ────────────────────────────────────────────────────────

/** Felder eines Mitarbeiters, aus denen der Monatslohn zu einem Datum folgt. */
export type LohnFelder = Partial<Pick<Employee, "monatslohn" | "lohnVerlauf">>;

/**
 * Monatslohn (100-%-Basis) an einem Datum: der letzte Eintrag aus `lohnVerlauf` mit `ab` ≤ Datum, sonst
 * `monatslohn` (Lohn ab Eintritt). Einträge ohne gültiges Datum oder mit negativem Lohn werden übergangen.
 */
export function monatslohnAm(emp: LohnFelder, ds: string): number {
  let lohn = Number(emp.monatslohn) || 0;
  const verlauf = emp.lohnVerlauf;
  if (!verlauf || verlauf.length === 0) return lohn;
  const day = ds.slice(0, 10);
  const sorted = verlauf.filter(v => v && /^\d{4}-\d{2}-\d{2}/.test(v.ab || "") && Number.isFinite(Number(v.monatslohn)) && Number(v.monatslohn) >= 0)
    .slice().sort((a, b) => a.ab.localeCompare(b.ab));
  for (const v of sorted) {
    if (v.ab.slice(0, 10) > day) break;
    lohn = Number(v.monatslohn);
  }
  return lohn;
}

/** Letzter angestellter Tag eines Monats `YYYY-MM` (Austritt im Monat), sonst der Monatsletzte. */
function letzterTagImMonat(emp: Partial<Pick<Employee, "austrittsdatum">>, monat: string): string {
  const [y, m] = monat.split("-").map(Number);
  const last = `${monat}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  return emp.austrittsdatum && emp.austrittsdatum.startsWith(monat) && emp.austrittsdatum < last ? emp.austrittsdatum : last;
}

/** Monatslohn (100 %) am letzten angestellten Tag des Monats — Anzeige «Basis 100 %» in der Abrechnung. */
export function monatslohnImMonat(emp: LohnFelder & Partial<Pick<Employee, "austrittsdatum">>, monat: string | undefined): number {
  if (!monat || !/^\d{4}-\d{2}$/.test(monat)) return Number(emp.monatslohn) || 0;
  return monatslohnAm(emp, letzterTagImMonat(emp, monat));
}

/**
 * Monatslohn × Pensum eines Monats `YYYY-MM` (CHF, vor Ein-/Austritts-Anteil), über die angestellten Tage
 * tagesgenau gewichtet (Kalendertage). Ohne Lohnwechsel genau `monatslohn × pensumImMonat`; mit Wechsel
 * z.B. 1.–14. 7'600 × 100 %, 15.–31. 8'000 × 100 % → (14 × 7'600 + 17 × 8'000) / 31.
 */
export function lohnImMonat(emp: LohnFelder & ArbeitszeitFelder & Partial<Pick<Employee, "eintrittsdatum" | "austrittsdatum">>, monat: string | undefined): number {
  const pensum = pensumImMonat(emp, monat) / 100;
  if (!emp.lohnVerlauf || emp.lohnVerlauf.length === 0 || !monat || !/^\d{4}-\d{2}$/.test(monat)) return (Number(emp.monatslohn) || 0) * pensum;
  const [y, m] = monat.split("-").map(Number);
  const tage = new Date(y, m, 0).getDate();
  let sum = 0, n = 0;
  const lohnWerte = new Set<number>();
  for (let d = 1; d <= tage; d++) {
    const ds = `${monat}-${String(d).padStart(2, "0")}`;
    if ((emp.eintrittsdatum && ds < emp.eintrittsdatum) || (emp.austrittsdatum && ds > emp.austrittsdatum)) continue;
    const l = monatslohnAm(emp, ds);
    lohnWerte.add(l);
    sum += l * arbeitszeitAm(emp, ds).pensum / 100; n++;
  }
  if (n === 0) return monatslohnImMonat(emp, monat) * pensum;
  // Gleicher Lohn im ganzen Monat → exakt Lohn × Monatspensum (keine Gleitkomma-Reste)
  if (lohnWerte.size === 1) return [...lohnWerte][0] * pensum;
  return sum / n;
}
