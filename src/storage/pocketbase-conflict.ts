// Optimistische Sperre im Cloud-Betrieb: Verrechnen nach einer Ablehnung «inzwischen geändert» (409).
//
// Regel: Ein Update, das auf einem veralteten Stand beruht, überschreibt einen inzwischen geänderten Datensatz nicht
// still. Der Adapter schickt bei jedem Update den `updated`-Zeitstempel des Stands mit, auf dem die Änderung beruht
// (Header `X-Rapport-If-Updated`); pb/pb_hooks/concurrency.pb.js lehnt mit 409 ab, wenn der Datensatz auf dem Server
// neuer ist. Dann lädt der Adapter den Datensatz frisch und verrechnet hier drei Stände (alle in Datenbankform, durch
// dieselben Mapper wie der Abgleichsstand):
//   before = Abgleichsstand (worauf meine Änderung beruht)
//   mine   = mein neuer Stand
//   server = jetzt auf dem Server
// Was nur eine Seite geändert hat, gilt; Listen mit `id` (Rechnungspositionen, Ansprechpartner …) pro Eintrag
// (merge.ts). Haben beide dasselbe Feld bzw. denselben Listeneintrag verschieden geändert, gilt meine Fassung wie
// bisher — aber der Konflikt wird gemeldet (Hinweis in der App, `conflictMessage`). Abgeleitete Werte (Summen von
// Rechnungen/Offerten, Budget aus verknüpften Offerten) werden danach neu berechnet, wenn sich ihre Grundlage aus
// beiden Fassungen zusammensetzt. Reine Funktionen, ohne Netz.

import { mergeValue } from "./merge";
import { fieldEqual, type SyncRow } from "./pocketbase-sync";
import { calcTotal, invoiceBillingSummary } from "../views/invoices/invoiceHelpers";
import { deriveQuoteBudget, quoteTotals } from "../utils";
import type { AppData, Invoice, Quote } from "../types";

/** Ergebnis von `mergeRow`: zusammengeführte Zeile und die Pfade, an denen beide Seiten verschieden geändert haben. */
export interface RowMerge { row: SyncRow; conflicts: string[] }

/**
 * Drei-Wege-Merge einer Zeile (Datenbankform). Felder, die nur `server` kennt (System-Felder), bleiben weg; fehlt
 * `before` (Zeile nicht im Abgleichsstand), zählt jede Abweichung als Konflikt zugunsten von `mine`. Felder in
 * `quiet` (abgeleitete Werte, `derivedFields`) melden keinen Konflikt — sie werden danach neu berechnet.
 */
export function mergeRow(before: SyncRow | undefined, mine: SyncRow, server: SyncRow, quiet: readonly string[] = []): RowMerge {
  const conflicts: string[] = [];
  const row: SyncRow = {};
  for (const k of Object.keys(mine)) {
    if (!(k in server)) { row[k] = mine[k]; continue; }
    if (fieldEqual(mine[k], server[k])) { row[k] = mine[k]; continue; }
    const b = before ? before[k] : undefined;
    if (before && fieldEqual(mine[k], b)) { row[k] = server[k]; continue; }   // nur der Server hat geändert
    if (before && fieldEqual(server[k], b)) { row[k] = mine[k]; continue; }   // nur ich habe geändert
    row[k] = mergeValue(b ?? undefined, mine[k], server[k], quiet.includes(k) ? undefined : p => conflicts.push(p), k);
  }
  return { row, conflicts };
}

/** Was die Neuberechnung braucht: Büro-Einstellungen (Rollen, MWST-Satz) und die übrigen Daten (Abrechnungsblock). */
export type DeriveContext = Pick<AppData, "settings" | "projects" | "quotes" | "invoices">;

type Derive = { inputs: string[]; outputs: string[]; compute: (row: SyncRow, ctx: DeriveContext) => SyncRow };

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

/** Abgeleitete Felder je Collection (Datenbankform) und wie sie aus den Grundlagen berechnet werden. */
const DERIVED: Record<string, Derive> = {
  // Wie Invoices.tsx beim Speichern: calcTotal, MWST-Satz der Rechnung oder Büro-Standard, Rundung auf 5 Rappen nach Büro-Einstellung
  invoices: {
    inputs: ["items", "mwst", "mwstRate", "discountType", "discountValue"],
    outputs: ["sub", "globalDisc", "subAfterDisc", "tax", "total"],
    compute: (r, ctx) => {
      const rate = r.mwst !== false && num(r.mwstRate) ? num(r.mwstRate) : (ctx.settings?.mwstRate ?? 8.1);
      const t = calcTotal(Array.isArray(r.items) ? r.items as Invoice["items"] : [], r.mwst !== false, rate, String(r.discountType || "none"), num(r.discountValue), !!ctx.settings?.rechnungRunden5);
      const out: SyncRow = { sub: t.sub, globalDisc: t.globalDisc, subAfterDisc: t.subAfterDisc, tax: t.tax, total: t.total };
      // Abrechnungsblock (Akonto/Teilrechnung) folgt dem Netto, wie beim Speichern im Editor
      if (r.billingSummary) {
        out.billingSummary = invoiceBillingSummary({
          id: String(r.id), number: String(r.number || ""), date: String(r.date || ""), projectId: (r.project as string) || null,
          quoteId: (r.quote as string) || null, invoiceKind: (r.invoiceKind as Invoice["invoiceKind"]) || undefined, sub: t.sub, globalDisc: t.globalDisc,
        } as Parameters<typeof invoiceBillingSummary>[0], ctx) ?? null;
      }
      return out;
    },
  },
  // Wie Quotes.tsx: quoteTotals mit den Rollen der Offerte bzw. des Büros
  quotes: {
    inputs: ["mode", "siaConfig", "manualPhases", "freeItems", "quoteRoles", "mwst", "mwstRate"],
    outputs: ["sub", "totalHours", "tax", "total"],
    compute: (r, ctx) => {
      const q = {
        mode: r.mode || "", sia: r.siaConfig || null, manualPhases: r.manualPhases || [], freeItems: r.freeItems || [],
        quoteRoles: r.quoteRoles || [], mwst: r.mwst !== false, mwstRate: r.mwst !== false && !num(r.mwstRate) ? null : (r.mwstRate ?? null),
      } as unknown as Quote;
      const t = quoteTotals(q, ctx.settings?.roles || [], ctx.settings?.mwstRate, !!ctx.settings?.rechnungRunden5);
      return { sub: t.sub, totalHours: t.totalHours, tax: t.tax, total: t.total };
    },
  },
  // Wie ProjectDetail.tsx beim Verknüpfen/Entfernen: Budget aus den verknüpften Offerten
  projects: {
    inputs: ["linkedQuotes"],
    outputs: ["budgetHours", "budgetAmount", "phasesBudget"],
    compute: (r, ctx) => {
      const linked = Array.isArray(r.linkedQuotes) ? r.linkedQuotes as { quoteId: string; role: string }[] : [];
      if (!linked.length) return { budgetHours: 0, budgetAmount: 0, phasesBudget: [] };
      const d = deriveQuoteBudget(linked, ctx.quotes || [], ctx.settings?.roles || []);
      return { budgetHours: d.budgetHours, budgetAmount: d.budgetAmount, phasesBudget: d.phasesBudget };
    },
  },
};

/** Abgeleitete Felder einer Collection (Summen, Abrechnungsblock, Budget) — für `mergeRow(…, quiet)`. */
export function derivedFields(table: string): string[] {
  const d = DERIVED[table];
  return d ? [...d.outputs, ...(table === "invoices" ? ["billingSummary"] : [])] : [];
}

/**
 * Abgeleitete Felder einer zusammengeführten Zeile nachführen: stimmen ihre Grundlagen mit einer der beiden Fassungen
 * überein, gelten deren Werte (keine Neuberechnung mit evtl. anderen Büro-Vorgaben); setzen sie sich aus beiden
 * zusammen, wird neu gerechnet. Gibt eine neue Zeile zurück.
 */
export function deriveMerged(table: string, merged: SyncRow, mine: SyncRow, server: SyncRow, ctx: DeriveContext): SyncRow {
  const d = DERIVED[table];
  if (!d) return merged;
  const sameInputs = (a: SyncRow) => d.inputs.every(k => fieldEqual(merged[k], a[k]));
  const out: SyncRow = { ...merged };
  const take = (src: SyncRow) => { for (const k of d.outputs) if (k in src) out[k] = src[k]; if (table === "invoices" && "billingSummary" in src) out.billingSummary = src.billingSummary; };
  if (sameInputs(mine)) take(mine);
  else if (sameInputs(server)) take(server);
  else Object.assign(out, d.compute(merged, ctx));
  return out;
}

/** App-Felder, die beim Speichern aus anderen berechnet werden: ein «Konflikt» dort ist keiner (Bearbeiten-Fenster). */
const DERIVED_APP: Record<string, string[]> = {
  invoices: ["sub", "globalDisc", "subAfterDisc", "tax", "total", "billingSummary", "mwstRate"],
  quotes: ["sub", "totalHours", "tax", "total", "mwstRate"],
};

/**
 * true, wenn unter den gemeldeten Pfaden eines Bearbeiten-Fensters (`applyEdit(…, onConflict)`) eine echte
 * Überschneidung ist — dasselbe Feld bzw. derselbe Listeneintrag wurde inzwischen anders geändert. Abgeleitete
 * Summen zählen nicht.
 */
export function editConflict(table: string, paths: string[]): boolean {
  const skip = DERIVED_APP[table] || [];
  return paths.some(p => !skip.includes(p.split(/[.[]/)[0]));
}

const NOUN: Record<string, [string, string]> = {
  invoices: ["die Rechnung", "diese Rechnung"], quotes: ["die Offerte", "diese Offerte"], contracts: ["den Vertrag", "diesen Vertrag"],
  deliveryNotes: ["den Lieferschein", "diesen Lieferschein"], projects: ["das Projekt", "dieses Projekt"], persons: ["den Kontakt", "diesen Kontakt"],
  protocols: ["das Protokoll", "dieses Protokoll"], employees: ["den Mitarbeiter-Datensatz", "diesen Mitarbeiter-Datensatz"],
  timeEntries: ["den Zeiteintrag", "diesen Zeiteintrag"], expenses: ["die Spese", "diese Spese"], internalExpenses: ["die Ausgabe", "diese Ausgabe"],
  blogPosts: ["den Beitrag", "diesen Beitrag"], resourcePlans: ["die Ressourcenplanung", "diese Ressourcenplanung"],
};

/**
 * Hinweistext für einen gemeldeten Konflikt: «Jemand anders hat die Rechnung R-2026-001 inzwischen ebenfalls geändert;
 * deine Änderung wurde übernommen, bitte prüfen.» `lost` = nach allen Versuchen nicht gespeichert.
 */
export function conflictMessage(table: string, row: SyncRow, lost = false): string {
  const label = String(row.number || row.name || row.title || "").trim();
  const [withName, plain] = NOUN[table] || ["den Eintrag", "diesen Eintrag"];
  const what = label ? `${withName} ${label}` : plain;
  return lost
    ? `Jemand anders hat ${what} gleichzeitig mehrfach geändert — deine Änderung ist nicht gespeichert, bitte nochmals versuchen.`
    : `Jemand anders hat ${what} inzwischen ebenfalls geändert; deine Änderung wurde übernommen, bitte prüfen.`;
}
