// Kundenpflege (CRM): wer wurde lange nicht kontaktiert, und wer bekommt eine Karte?
//
// Listet alle Kontakte mit letztem Kontakt (jüngste Aktivität, siehe crm.ts) und Gesamtumsatz,
// filterbar nach Tag (z.B. «Weihnachtskarte») und «seit N Monaten nicht kontaktiert». Ein Klick
// auf «Karte verschickt» trägt eine Aktivität der Art `karte` ein (damit gilt der Kontakt als
// gepflegt); die gefilterte Liste lässt sich als CSV-Adressliste für Serienbriefe/Etiketten laden.
// Eingebettet in `Crm.tsx` (Tab «Kundenpflege»). Tags pflegt man im Kontakte-Dialog.

import React, { useState } from "react";
import { CONTACT_CATEGORIES } from "../constants";
import { clientRevenue, lastContact } from "../crm";
import { formatCHF, formatDate, generateId, contactCategory, localISODate } from "../utils";
import type { AppData, Person, UpdateFn } from "../types";

const today = () => localISODate();

/** Ganze Monate zwischen zwei Datumsstrings (`YYYY-MM-DD`), mindestens 0. */
const monthsBetween = (from: string, to: string): number => {
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0));
};

/** Löst den Download einer Adressliste aus (Semikolon, UTF-8 mit BOM wie der Buchhaltungs-Export). */
function downloadAddressCSV(persons: Person[]): void {
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["Name", "Ansprechpartner", "Strasse", "PLZ", "Ort", "Land", "E-Mail", "Tags"];
  const rows = persons.map(p => [p.name, p.contacts?.[0]?.name || "", p.street, p.zip, p.city, p.country, p.email, (p.tags || []).join(", ")].map(q).join(";"));
  const blob = new Blob(["﻿" + [head.map(q).join(";"), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `adressen-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CrmKundenpflege({ data, update }: { data: AppData; update: UpdateFn }) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [since, setSince] = useState("");
  const persons = data.persons || [];
  const allTags = [...new Set(persons.flatMap(p => p.tags || []))].sort();
  const q = search.toLowerCase();

  const rows = persons.map(p => ({ p, last: lastContact(data, p.id), revenue: clientRevenue(data, p.id) }))
    .filter(r => !q || [r.p.name, r.p.city, ...(r.p.contacts || []).map(c => c.name)].some(v => v?.toLowerCase().includes(q)))
    .filter(r => !tag || (r.p.tags || []).includes(tag))
    // «seit N Monaten»: zeigt auch Kontakte ohne jeden Eintrag (nie kontaktiert)
    .filter(r => !since || !r.last || monthsBetween(r.last, today()) >= Number(since))
    .sort((a, b) => (a.last || "").localeCompare(b.last || "") || a.p.name.localeCompare(b.p.name));

  const logCard = (p: Person) =>
    update("activities", [...(data.activities || []), { id: generateId(), personId: p.id, type: "karte", date: today(), note: "Karte / Gruss verschickt" }]);

  return (
    <div>
      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Kontakt, Ort …)" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select className="pill" value={tag} onChange={e => setTag(e.target.value)}>
          <option value="">Alle Tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="pill" value={since} onChange={e => setSince(e.target.value)}>
          <option value="">Egal wann zuletzt</option>
          <option value="3">seit 3+ Monaten nicht kontaktiert</option>
          <option value="6">seit 6+ Monaten nicht kontaktiert</option>
          <option value="12">seit 12+ Monaten nicht kontaktiert</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" disabled={rows.length === 0} onClick={() => downloadAddressCSV(rows.map(r => r.p))} title="Adressliste der gefilterten Kontakte">
          <span className="msr" style={{ fontSize: 16 }}>download</span> Adressen (CSV)
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 10 }}>
        <strong style={{ color: "var(--text)" }}>{rows.length}</strong> {rows.length === 1 ? "Kontakt" : "Kontakte"}
        {allTags.length === 0 && " · Tags (z.B. «Weihnachtskarte») pflegst du im Kontakte-Dialog, dann lässt sich hier danach filtern."}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? <div className="empty-state">Keine Treffer.</div> : (
          <table>
            <thead><tr>
              <th>Kontakt</th><th className="hide-compact">Kategorie</th><th>Letzter Kontakt</th>
              <th style={{ textAlign: "right" }}>Umsatz (netto)</th><th style={{ width: 150 }} />
            </tr></thead>
            <tbody>
              {rows.map(({ p, last, revenue }) => {
                const cat = CONTACT_CATEGORIES.find(c => c.id === contactCategory(p));
                const months = last ? monthsBetween(last, today()) : null;
                return (
                  <tr key={p.id}>
                    <td>
                      <strong style={{ color: "var(--text)" }}>{p.name}</strong>
                      {(p.tags || []).length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                        {(p.tags || []).map(t => <span key={t} style={{ fontSize: 10, color: "var(--text3)", border: "1px solid var(--border)", borderRadius: 20, padding: "0 7px" }}>{t}</span>)}
                      </div>}
                    </td>
                    <td className="hide-compact" style={{ color: cat?.color || "var(--text4)", fontSize: 12 }}>{cat?.label || "—"}</td>
                    <td style={{ fontSize: 12, color: months === null || months >= 12 ? "var(--warning)" : "var(--text2)" }}>
                      {last ? <>{formatDate(last)} <span style={{ color: "var(--text4)" }}>· vor {months === 0 ? "< 1 Monat" : `${months} Mt.`}</span></> : "nie"}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{revenue > 0 ? formatCHF(revenue) : "—"}</td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => logCard(p)}>Karte verschickt</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
