// CRM-Auswertungen: reine Funktionen über `AppData`, nichts wird gespeichert.
//
// Beantwortet: Welcher Kunde, Empfehler oder welche Quelle bringt wie viel Umsatz und
// wie viele Aufträge? Wie gut ist die Trefferquote? Wer muss nachgefasst werden?
// Wird von CrmPipeline, CrmAuswertung, Persons und dem Dashboard benutzt.
//
// Konventionen:
//  - Beträge sind **netto** (`Invoice.sub`, `Lead.estimatedValue`), wie in Dashboard/Accounting.
//  - «Umsatz» = verrechnet, also jede Rechnung ausser Entwurf (gesendet, bezahlt, überfällig).
//    Das Dashboard zählt dagegen nur «bezahlt»; hier zählt der Auftrag, nicht der Zahlungseingang.
//  - Jahresfilter wie überall: `date.startsWith("2026")`; leerer Filter = alle Jahre.
//  - Datumsangaben sind `YYYY-MM-DD`-Strings (`DateStr`).

import type { Activity, AppData, Id, Invoice, Lead, LeadStage, Person } from "./types";

/** Gewichtung der offenen Stufen für den gewichteten Pipeline-Wert (Schätzung, keine Statistik). */
export const STAGE_WEIGHT: Record<LeadStage, number> = {
  anfrage: 0.1, besichtigung: 0.25, offerte: 0.5, verhandlung: 0.75, gewonnen: 1, verloren: 0,
};

/** Aktivitätsarten, die in der Auswertung als «Meeting» zählen. */
const MEETING_TYPES = new Set(["meeting", "besichtigung"]);

/** Ein Lead ist offen, solange er weder gewonnen noch verloren ist. */
export const isOpenLead = (l: Lead): boolean => l.stage !== "gewonnen" && l.stage !== "verloren";

const inYear = (date: string | undefined, year: string): boolean => !year || (date || "").startsWith(year);

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

const nameOf = (persons: Person[], id: Id | undefined): string =>
  (id && persons.find(p => p.id === id)?.name) || "—";

/** Zeile einer Gruppierung (Kunde, Empfehler oder Quelle). `key` ist Person-ID bzw. Quellenname. */
export interface GroupRow { key: string; label: string; revenue: number; count: number }

/**
 * Lead, zu dem eine Rechnung gehört: über Projekt (`Lead.projectId`), sonst über die
 * Offerte (`Invoice.quoteId` oder Hauptofferte des Projekts). `undefined` bei Bestandsaufträgen ohne Lead.
 */
export function leadOfInvoice(data: AppData, inv: Invoice): Lead | undefined {
  const leads = data.leads || [];
  if (inv.projectId) {
    const byProject = leads.find(l => l.projectId === inv.projectId);
    if (byProject) return byProject;
  }
  const project = inv.projectId ? data.projects.find(p => p.id === inv.projectId) : undefined;
  const quoteIds = new Set<Id>([inv.quoteId, ...(project?.linkedQuotes || []).filter(q => q.role !== "Referenz").map(q => q.quoteId)].filter((x): x is Id => !!x));
  return leads.find(l => l.quoteId && quoteIds.has(l.quoteId));
}

/**
 * Herkunft einer Rechnung: Angaben des Leads haben Vorrang, sonst die an der Person
 * hinterlegten (`Person.referredById` / `Person.source`) — so zählen auch Altaufträge.
 */
export function attribution(data: AppData, inv: Invoice): { referrerId?: Id; source?: string } {
  const lead = leadOfInvoice(data, inv);
  const client = data.persons.find(p => p.id === inv.clientId);
  return { referrerId: lead?.referrerId ?? client?.referredById, source: lead?.source ?? client?.source };
}

/** Verrechnete Rechnungen (alles ausser Entwurf) des Jahres. */
export function billedInvoices(data: AppData, year: string): Invoice[] {
  return data.invoices.filter(i => i.status !== "entwurf" && inYear(i.date, year));
}

function group(data: AppData, year: string, keyOf: (inv: Invoice) => string | undefined, labelOf: (key: string) => string): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const inv of billedInvoices(data, year)) {
    const key = keyOf(inv);
    if (!key) continue;
    const row = rows.get(key) || { key, label: labelOf(key), revenue: 0, count: 0 };
    row.revenue += inv.sub || 0;
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Umsatz pro Auftraggeber, absteigend. `count` = Anzahl Rechnungen. */
export const revenueByClient = (data: AppData, year: string): GroupRow[] =>
  group(data, year, i => i.clientId, k => nameOf(data.persons, k));

/** Umsatz pro Empfehler (Person, die den Auftrag vermittelt hat), absteigend. Ohne Empfehler = nicht enthalten. */
export const revenueByReferrer = (data: AppData, year: string): GroupRow[] =>
  group(data, year, i => attribution(data, i).referrerId, k => nameOf(data.persons, k));

/** Umsatz pro Herkunftsquelle, absteigend. Ohne Quelle = nicht enthalten. */
export const revenueBySource = (data: AppData, year: string): GroupRow[] =>
  group(data, year, i => attribution(data, i).source, k => k);

/** Anzahl der Leads, die über diesen Empfehler kamen (alle Stufen). */
export function referredLeadCount(data: AppData, personId: Id): number {
  return (data.leads || []).filter(l => l.referrerId === personId).length;
}

/** Summe des netto verrechneten Umsatzes, der über `personId` vermittelt wurde (alle Jahre oder `year`). */
export function referredRevenue(data: AppData, personId: Id, year = ""): number {
  return billedInvoices(data, year).filter(i => attribution(data, i).referrerId === personId).reduce((s, i) => s + (i.sub || 0), 0);
}

/** Gesamter verrechneter Netto-Umsatz eines Auftraggebers (alle Jahre oder `year`). */
export function clientRevenue(data: AppData, personId: Id, year = ""): number {
  return billedInvoices(data, year).filter(i => i.clientId === personId).reduce((s, i) => s + (i.sub || 0), 0);
}

/** Trefferquote einer Gruppe; `rate` ist `null`, solange noch nichts entschieden wurde. */
export interface WinRow { key: string; label: string; won: number; lost: number; rate: number | null }

/**
 * Trefferquote = gewonnen / (gewonnen + verloren), nur entschiedene Leads des Jahres
 * (nach `closedAt`). Offene Leads zählen nicht — sonst würde die Quote künstlich sinken.
 */
export function winRateBy(data: AppData, year: string, by: "source" | "referrer"): WinRow[] {
  const rows = new Map<string, WinRow>();
  for (const l of data.leads || []) {
    if (isOpenLead(l) || !inYear(l.closedAt, year)) continue;
    const key = by === "source" ? l.source : l.referrerId;
    if (!key) continue;
    const row = rows.get(key) || { key, label: by === "source" ? key : nameOf(data.persons, key), won: 0, lost: 0, rate: null };
    if (l.stage === "gewonnen") row.won += 1; else row.lost += 1;
    row.rate = row.won / (row.won + row.lost);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (b.won + b.lost) - (a.won + a.lost));
}

/** Gesamte Trefferquote aller entschiedenen Leads des Jahres; `null` ohne Entscheidungen. */
export function overallWinRate(data: AppData, year: string): number | null {
  const closed = (data.leads || []).filter(l => !isOpenLead(l) && inYear(l.closedAt, year));
  return closed.length ? closed.filter(l => l.stage === "gewonnen").length / closed.length : null;
}

/** Anzahl Meetings (Meeting + Besichtigung) eines Leads, abgeleitet aus dem Kontaktverlauf. */
export function meetingCount(data: AppData, leadId: Id): number {
  return (data.activities || []).filter(a => a.leadId === leadId && MEETING_TYPES.has(a.type)).length;
}

/** Durchschnitt über gewonnene Leads des Jahres; Felder sind `null`, wenn es keine gibt. */
export function wonLeadAverages(data: AppData, year: string): { count: number; avgDays: number | null; avgMeetings: number | null } {
  const won = (data.leads || []).filter(l => l.stage === "gewonnen" && inYear(l.closedAt, year));
  const withDates = won.filter(l => l.closedAt && l.createdAt);
  return {
    count: won.length,
    avgDays: withDates.length ? withDates.reduce((s, l) => s + daysBetween(l.createdAt, l.closedAt as string), 0) / withDates.length : null,
    avgMeetings: won.length ? won.reduce((s, l) => s + meetingCount(data, l.id), 0) / won.length : null,
  };
}

/** Wert der offenen Pipeline in CHF netto. `weighted` multipliziert mit `STAGE_WEIGHT` der Stufe. */
export function pipelineValue(leads: Lead[], weighted = false): number {
  return leads.filter(isOpenLead).reduce((s, l) => s + (l.estimatedValue || 0) * (weighted ? STAGE_WEIGHT[l.stage] : 1), 0);
}

/** Datum des letzten Kontakts mit einer Person (jüngste Aktivität) oder `null`. */
export function lastContact(data: AppData, personId: Id): string | null {
  const dates = (data.activities || []).filter(a => a.personId === personId).map(a => a.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** Offene Wiedervorlagen, früheste zuerst. `overdue` = Termin liegt vor `today`. */
export function dueFollowUps(data: AppData, today: string): (Activity & { overdue: boolean })[] {
  return (data.activities || [])
    .filter(a => a.followUpDate && !a.followUpDone)
    .sort((a, b) => (a.followUpDate as string).localeCompare(b.followUpDate as string))
    .map(a => ({ ...a, overdue: (a.followUpDate as string) < today }));
}

/**
 * Zahlungsmoral: durchschnittliche Tage von Versand (sonst Rechnungsdatum) bis Zahlung, nur für
 * Rechnungen mit `paidDate`. Ältere Rechnungen haben keins (wurde früher nie gesetzt) und fehlen hier.
 */
export function paymentDaysByClient(data: AppData, year: string): { key: string; label: string; avgDays: number; count: number }[] {
  const rows = new Map<string, { key: string; label: string; total: number; count: number }>();
  for (const inv of data.invoices) {
    if (inv.status !== "bezahlt" || !inv.paidDate || !inYear(inv.date, year)) continue;
    const days = daysBetween(inv.sentDate || inv.date, inv.paidDate);
    if (days < 0) continue;
    const row = rows.get(inv.clientId) || { key: inv.clientId, label: nameOf(data.persons, inv.clientId), total: 0, count: 0 };
    row.total += days;
    row.count += 1;
    rows.set(inv.clientId, row);
  }
  return [...rows.values()].map(r => ({ key: r.key, label: r.label, avgDays: r.total / r.count, count: r.count })).sort((a, b) => b.avgDays - a.avgDays);
}
