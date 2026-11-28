// Debitorenliste (offene Posten per Stichtag): reine Rechenregeln. Eine Quelle für die Ansicht
// (views/Debitoren.tsx), das PDF (print/docs/DebitorenPrint.tsx) und den CSV-Export.
//
// Regeln (Stand 26.11):
//   - Offen per Stichtag = Rechnungsdatum ≤ Stichtag, Status nicht «entwurf» (die Status sind entwurf,
//     gesendet, überfällig, bezahlt; «storniert» gibt es nicht) und nicht bezahlt per Stichtag.
//   - Bezahlt per Stichtag = Status «bezahlt» und Zahlungsdatum ≤ Stichtag; fehlt das Zahlungsdatum, gilt
//     das Rechnungsdatum — dieselbe Regel wie `accounting.ts` (`paidDate || date`, vereinnahmte MWST).
//     Eine heute bezahlte Rechnung war per früherem Stichtag also noch offen.
//   - Betrag = `total` inkl. MWST. Das Datenmodell kennt keine Teilzahlungen: es zählt immer der ganze Betrag.
//   - Gutschriften (Total < 0) sind Minusposten und nie «fällig»: Tage überfällig 0, Klasse «nicht fällig».
//     Rechnungen mit Total 0 erscheinen nicht. Ohne Fälligkeitsdatum: nicht fällig.
//   - Tage überfällig = Stichtag − Fälligkeit in Kalendertagen (0, wenn nicht überfällig). Klassen:
//     nicht fällig (0), 1–30, 31–60, 61–90, über 90 Tage; die Klassen ergeben immer das Gesamttotal.
//   - Mahnstufe = Anzahl Erinnerungen/Mahnungen, deren Versand-/Erfassungsdatum ≤ Stichtag ist.
//   - Gleiche Definition wie die Kennzahl «Offen» der Buchhaltung (gesendet + überfällig, Summe `total`):
//     per heute stimmen beide überein, ausser eine Rechnung ist auf ein Datum nach heute datiert oder mit
//     einem Zahlungsdatum nach heute bezahlt (dann ist sie hier noch offen bzw. noch gar nicht gestellt).

import { csvCell, formatDate, roundCHF } from "./utils";
import type { AppData, Invoice } from "./types";

export type DebitorBucketId = "notDue" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

/** Klassen in Anzeigereihenfolge mit Beschriftung. */
export const DEBITOR_BUCKETS: { id: DebitorBucketId; label: string }[] = [
  { id: "notDue", label: "Nicht fällig" },
  { id: "d1_30", label: "1–30 Tage" },
  { id: "d31_60", label: "31–60 Tage" },
  { id: "d61_90", label: "61–90 Tage" },
  { id: "d90plus", label: "über 90 Tage" },
];

export interface DebitorRow {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  projectName: string;
  date: string;
  dueDate: string;
  /** Betrag inkl. MWST (Gutschrift negativ) */
  amount: number;
  daysOverdue: number;
  bucket: DebitorBucketId;
  /** 0 = keine, 1 = Erinnerung, 2+ = n. Mahnung */
  mahnstufe: number;
}

export interface DebitorGroup {
  clientId: string;
  clientName: string;
  rows: DebitorRow[];
  total: number;
  count: number;
}

export interface DebitorenResult {
  asOf: string;
  onlyOverdue: boolean;
  rows: DebitorRow[];
  groups: DebitorGroup[];
  total: number;
  count: number;
  buckets: Record<DebitorBucketId, { amount: number; count: number }>;
  /** Summe/Anzahl aller überfälligen Posten (Klassen 1–30 bis über 90) */
  overdueTotal: number;
  overdueCount: number;
}

const DAY_MS = 86400000;
const utcDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Rechnung per Stichtag bezahlt? (Regel im Dateikopf) */
function paidAt(inv: Pick<Invoice, "status" | "paidDate" | "date">, asOf: string): boolean {
  return inv.status === "bezahlt" && (inv.paidDate || inv.date || "") <= asOf;
}

/** Ist die Rechnung per Stichtag ein offener Posten? (Regel im Dateikopf) */
export function isOpenAt(inv: Pick<Invoice, "status" | "paidDate" | "date">, asOf: string): boolean {
  if (inv.status === "entwurf" || !inv.date || inv.date > asOf) return false;
  return !paidAt(inv, asOf);
}

/** Tage, die eine Rechnung per Stichtag überfällig ist (0, wenn nicht fällig oder ohne Fälligkeit). */
export function daysOverdue(dueDate: string | undefined | null, asOf: string): number {
  if (!dueDate) return 0;
  const d = Math.round((utcDay(asOf) - utcDay(dueDate)) / DAY_MS);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Fälligkeitsklasse zu «Tage überfällig». */
export function agingBucket(days: number): DebitorBucketId {
  if (days <= 0) return "notDue";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

/** Mahnstufe per Stichtag: Anzahl Erinnerungen/Mahnungen, deren Versand- bzw. Erfassungsdatum ≤ Stichtag ist. */
export function mahnstufeAt(inv: Pick<Invoice, "reminders">, asOf: string): number {
  return (inv.reminders || []).filter(r => (r.sentDate || r.date || "") <= asOf).length;
}

/** Beschriftung der Mahnstufe (wie in der Buchhaltung): 1 = Erinnerung, n = «n. Mahnung», 0 = leer. */
export function mahnLabel(stufe: number): string {
  return stufe <= 0 ? "" : stufe === 1 ? "Erinnerung" : `${stufe}. Mahnung`;
}

/**
 * Debitorenliste per Stichtag: Zeilen, je Kunde gruppiert (nach Name, innerhalb nach Fälligkeit),
 * Summen und Fälligkeitsklassen. Ansicht, PDF und CSV lesen alle dieses Ergebnis.
 * @param asOf Stichtag `YYYY-MM-DD`
 * @param opts.onlyOverdue nur Posten mit mindestens einem Tag Verzug
 */
export function debitoren(data: Pick<AppData, "invoices" | "persons" | "projects">, asOf: string, opts: { onlyOverdue?: boolean } = {}): DebitorenResult {
  const onlyOverdue = !!opts.onlyOverdue;
  const clients = new Map((data.persons || []).map(p => [p.id, p.name || ""]));
  const projects = new Map((data.projects || []).map(p => [p.id, p.name || ""]));
  let rows: DebitorRow[] = [];
  for (const inv of data.invoices || []) {
    const amount = roundCHF(inv.total || 0);
    if (amount === 0 || !isOpenAt(inv, asOf)) continue;
    const days = amount < 0 ? 0 : daysOverdue(inv.dueDate, asOf);
    rows.push({
      id: inv.id, number: inv.number || "", clientId: inv.clientId || "",
      clientName: clients.get(inv.clientId) || "Ohne Kunde",
      projectName: (inv.projectId && projects.get(inv.projectId)) || "",
      date: inv.date, dueDate: inv.dueDate || "", amount,
      daysOverdue: days, bucket: agingBucket(days),
      mahnstufe: amount < 0 ? 0 : mahnstufeAt(inv, asOf),
    });
  }
  if (onlyOverdue) rows = rows.filter(r => r.daysOverdue > 0);
  // Fälligkeit aufsteigend (ohne Fälligkeit zuletzt), dann Rechnungsdatum und Nummer
  const byDue = (a: DebitorRow, b: DebitorRow) =>
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "de", { numeric: true });
  const byClient = new Map<string, DebitorGroup>();
  for (const r of rows) {
    // Gruppe nach Kunden-Id; Altdaten mit gleichem Namen unter verschiedenen Ids bleiben getrennt
    let g = byClient.get(r.clientId);
    if (!g) byClient.set(r.clientId, g = { clientId: r.clientId, clientName: r.clientName, rows: [], total: 0, count: 0 });
    g.rows.push(r);
  }
  const groups = [...byClient.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "de", { sensitivity: "base" }) || a.clientId.localeCompare(b.clientId));
  for (const g of groups) {
    g.rows.sort(byDue);
    g.total = roundCHF(g.rows.reduce((s, r) => s + r.amount, 0));
    g.count = g.rows.length;
  }
  const sorted = groups.flatMap(g => g.rows);
  const buckets = Object.fromEntries(DEBITOR_BUCKETS.map(b => [b.id, { amount: 0, count: 0 }])) as DebitorenResult["buckets"];
  for (const r of sorted) { buckets[r.bucket].amount += r.amount; buckets[r.bucket].count++; }
  for (const b of DEBITOR_BUCKETS) buckets[b.id].amount = roundCHF(buckets[b.id].amount);
  const overdue = DEBITOR_BUCKETS.filter(b => b.id !== "notDue").map(b => buckets[b.id]);
  return {
    asOf, onlyOverdue, rows: sorted, groups,
    total: roundCHF(sorted.reduce((s, r) => s + r.amount, 0)),
    count: sorted.length,
    buckets,
    overdueTotal: roundCHF(overdue.reduce((s, b) => s + b.amount, 0)),
    overdueCount: overdue.reduce((s, b) => s + b.count, 0),
  };
}

/** Titel von Ansicht, PDF und CSV: «Debitorenliste per 31.12.2026» (Datumsformat wie überall über `formatDate`). */
export function debitorenTitle(asOf: string): string {
  return `Debitorenliste per ${formatDate(asOf)}`;
}

/**
 * CSV-Text der Debitorenliste (`;`-getrennt, das BOM für Excel hängt `exportDebitorenCSV` an). Zellen über `csvCell`
 * (Formel-Injection). Zahlen = die der Ansicht (`debitoren`).
 */
export function buildDebitorenCSV(data: Pick<AppData, "invoices" | "persons" | "projects">, asOf: string, opts: { onlyOverdue?: boolean } = {}): string {
  const r = debitoren(data, asOf, opts);
  const line = (cells: unknown[]) => cells.map(csvCell).join(";");
  const f = (n: number) => roundCHF(n).toFixed(2);
  const out: string[] = [];
  out.push(line(["DEBITORENLISTE", "Stichtag", asOf]));
  if (r.onlyOverdue) out.push(line(["Filter", "nur überfällige"]));
  out.push("");
  out.push(line(["Kunde", "Rechnungs-Nr.", "Projekt", "Datum", "Fällig", "Betrag CHF", "Tage überfällig", "Mahnstufe"]));
  for (const g of r.groups) {
    for (const x of g.rows) out.push(line([x.clientName, x.number, x.projectName, x.date, x.dueDate, f(x.amount), x.daysOverdue, mahnLabel(x.mahnstufe)]));
    out.push(line([`Zwischensumme ${g.clientName}`, `${g.count} Posten`, "", "", "", f(g.total), "", ""]));
  }
  out.push(line(["TOTAL", `${r.count} Posten`, "", "", "", f(r.total), "", ""]));
  out.push("");
  out.push(line(["FÄLLIGKEITSSTRUKTUR", "Anzahl", "", "", "", "Betrag CHF", "", ""]));
  for (const b of DEBITOR_BUCKETS) out.push(line([b.label, r.buckets[b.id].count, "", "", "", f(r.buckets[b.id].amount), "", ""]));
  out.push(line(["Überfällig (Summe 1–30 bis über 90 Tage)", r.overdueCount, "", "", "", f(r.overdueTotal), "", ""]));
  return out.join("\n");
}

/** Löst den CSV-Download aus (UTF-8 mit BOM für Excel); Inhalt aus `buildDebitorenCSV`. */
export function exportDebitorenCSV(data: Pick<AppData, "invoices" | "persons" | "projects">, asOf: string, opts: { onlyOverdue?: boolean } = {}): void {
  const blob = new Blob(["\uFEFF" + buildDebitorenCSV(data, asOf, opts)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `debitoren-${asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
