// Befehlspalette (⌘K): Suchindex und Trefferliste, ohne React (components/CommandPalette.tsx zeigt sie an).
//
// Einträge: Ansichten (nur die sichtbaren), Aktionen («Neue Rechnung» …) und Datensätze (Projekte,
// Rechnungen, Offerten, Kontakte, Protokolle). Suche: alle Wörter müssen vorkommen (ohne Akzente,
// Gross/Klein egal), Treffer am Wortanfang zählen mehr. Was ein Eintrag auslöst, entscheidet App.tsx (`run`).

import type { AppData } from "./types";
import type { NavItem } from "./constants";

/** Was ein Eintrag öffnet. */
export type PaletteTarget =
  | { kind: "view"; view: string }
  | { kind: "project"; id: string }
  | { kind: "invoice"; id: string }
  | { kind: "quote"; id: string }
  | { kind: "protocol"; id: string }
  | { kind: "person"; id: string }
  | { kind: "action"; action: "newProject" | "newInvoice" | "newQuote" | "newProtocol" | "toggleDark"; projectId?: string };

/** Ein Eintrag der Palette. */
export interface PaletteEntry {
  key: string;
  group: string;
  icon: string;
  label: string;
  hint?: string;
  /** zusätzlicher Suchtext (Nummer, Kunde …), wird nicht angezeigt */
  terms?: string;
  target: PaletteTarget;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Baut alle Einträge aus den Daten und den für den Nutzer sichtbaren Ansichten. */
export function buildPaletteEntries(data: AppData, navItems: NavItem[]): PaletteEntry[] {
  const views = navItems.flatMap(i => i.children ? [i, ...i.children.map(c => ({ ...c, icon: i.icon }))] : [i]);
  const can = (id: string) => views.some(v => v.id === id);
  const personName = (id?: string | null) => (data.persons || []).find(p => p.id === id)?.name || "";
  const out: PaletteEntry[] = [];
  for (const v of views) out.push({ key: `v:${v.id}`, group: "Gehe zu", icon: v.icon || "arrow_forward", label: v.label, target: { kind: "view", view: v.id } });
  if (can("projects")) out.push({ key: "a:p", group: "Aktionen", icon: "add", label: "Neues Projekt", target: { kind: "action", action: "newProject" } });
  if (can("invoices")) out.push({ key: "a:i", group: "Aktionen", icon: "add", label: "Neue Rechnung", target: { kind: "action", action: "newInvoice" } });
  if (can("quotes")) out.push({ key: "a:q", group: "Aktionen", icon: "add", label: "Neue Offerte", target: { kind: "action", action: "newQuote" } });
  if (can("protokolle")) out.push({ key: "a:pr", group: "Aktionen", icon: "add", label: "Neues Protokoll", target: { kind: "action", action: "newProtocol" } });
  out.push({ key: "a:dark", group: "Aktionen", icon: "contrast", label: "Hell/Dunkel umschalten", terms: "dark mode dunkelmodus theme", target: { kind: "action", action: "toggleDark" } });
  if (can("projects")) for (const p of data.projects || [])
    out.push({ key: `p:${p.id}`, group: "Projekte", icon: "work", label: p.name, hint: [p.number, personName(p.clientId)].filter(Boolean).join(" · "), terms: p.description, target: { kind: "project", id: p.id } });
  if (can("invoices")) for (const i of data.invoices || [])
    out.push({ key: `i:${i.id}`, group: "Rechnungen", icon: "receipt_long", label: `Rechnung ${i.number || ""}`.trim(), hint: [personName(i.clientId), i.status].filter(Boolean).join(" · "), target: { kind: "invoice", id: i.id } });
  if (can("quotes")) for (const q of data.quotes || [])
    out.push({ key: `q:${q.id}`, group: "Offerten", icon: "request_quote", label: `Offerte ${q.number || ""}`.trim(), hint: [q.projectName, personName(q.clientId)].filter(Boolean).join(" · "), target: { kind: "quote", id: q.id } });
  if (can("protokolle")) for (const p of data.protocols || [])
    out.push({ key: `pr:${p.id}`, group: "Protokolle", icon: "description", label: p.title || "Protokoll", hint: [p.nummer, p.date].filter(Boolean).join(" · "), target: { kind: "protocol", id: p.id } });
  if (can("personen")) for (const p of data.persons || [])
  {
    out.push({ key: `c:${p.id}`, group: "Kontakte", icon: "person", label: p.name, hint: p.email || undefined, target: { kind: "person", id: p.id } });
    for (const c of p.contacts || [])
      out.push({ key: `c:${p.id}:${c.id}`, group: "Kontakte", icon: "badge", label: c.name, hint: [c.position, p.name].filter(Boolean).join(" · "), terms: c.email, target: { kind: "person", id: p.id } });
  }
  return out;
}

/** Punkte für einen Eintrag; 0 = passt nicht. Alle Wörter der Suche müssen vorkommen. */
export function scoreEntry(e: PaletteEntry, query: string): number {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const label = norm(e.label), all = norm([e.label, e.hint, e.terms, e.group].filter(Boolean).join(" "));
  let score = 0;
  for (const w of words) {
    if (!all.includes(w)) return 0;
    score += label.startsWith(w) ? 6 : new RegExp(`(^|[\\s\\-/«(])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label) ? 4 : label.includes(w) ? 2 : 1;
  }
  return score;
}

/**
 * Treffer für die Eingabe: ohne Suche Aktionen und Ansichten; mit Suche die besten Treffer
 * (Ansichten und Aktionen leicht bevorzugt), höchstens `limit`, nach Gruppe zusammengehalten.
 */
export function searchPalette(entries: PaletteEntry[], query: string, limit = 40): PaletteEntry[] {
  if (!query.trim()) return entries.filter(e => e.group === "Aktionen" || e.group === "Gehe zu");
  const scored = entries
    .map(e => ({ e, s: scoreEntry(e, query) + (e.group === "Gehe zu" || e.group === "Aktionen" ? 0.5 : 0) }))
    .filter(x => x.s > 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  const order = [...new Set(scored.map(x => x.e.group))];
  return order.flatMap(g => scored.filter(x => x.e.group === g).map(x => x.e));
}
