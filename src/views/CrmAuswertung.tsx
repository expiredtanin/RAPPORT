// CRM-Auswertung: wer bringt Umsatz und Aufträge? Zeigt pro Jahr (oder alle Jahre)
// Umsatz nach Kunde, Empfehler und Herkunft, Trefferquoten, Dauer bis zur Zusage und
// Zahlungsmoral. Alle Zahlen kommen aus crm.ts (netto, verrechnet = alles ausser Entwurf);
// diese Ansicht rechnet nichts selbst. Eingebettet in `Crm.tsx` (Tab «Auswertung»).
//
// Aussagekraft hängt an gepflegten Daten: Umsatz ohne Herkunft/Empfehler taucht nur in
// «pro Kunde» auf, der Hinweis unter den Kennzahlen nennt den Anteil mit Zuordnung.

import React, { useState } from "react";
import { attribution, billedInvoices, overallWinRate, paymentDaysByClient, revenueByClient, revenueByReferrer, revenueBySource, winRateBy, wonLeadAverages } from "../crm";
import type { GroupRow, WinRow } from "../crm";
import { formatCHF } from "../utils";
import { KpiCard } from "../components/UI";
import type { AppData } from "../types";

const pct = (r: number | null) => r === null ? "—" : `${Math.round(r * 100)} %`;
const num1 = (n: number | null) => n === null ? "—" : (Math.round(n * 10) / 10).toLocaleString("de-CH");

/** Karte mit Titel; `hint` erklärt die Zahl in einem Satz. */
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="card" style={{ marginBottom: 20 }}>
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>{title}</div>
    {hint && <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>{hint}</div>}
    <div style={{ marginTop: 12 }}>{children}</div>
  </div>
);

/** Zeilen mit Balken; `extra` ist eine optionale Zusatzspalte (z.B. Trefferquote). */
function BarList({ rows, extra, empty, onOpen }: { rows: GroupRow[]; extra?: (r: GroupRow) => string; empty: string; onOpen?: (key: string) => void }) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: "var(--text4)" }}>{empty}</div>;
  const max = Math.max(...rows.map(r => r.revenue), 1);
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  return (
    <div>
      {rows.slice(0, 10).map(r => (
        <div key={r.key} className="bar-row">
          <div style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: onOpen ? "pointer" : "default", textDecoration: onOpen ? "underline dotted" : "none" }} title={onOpen ? `${r.label} öffnen` : r.label} onClick={onOpen ? () => onOpen(r.key) : undefined}>{r.label}</div>
          <div style={{ background: "var(--surface3)", borderRadius: 4, height: 8 }}>
            <div style={{ width: `${Math.max((r.revenue / max) * 100, 1)}%`, height: "100%", background: "#b07848", borderRadius: 4 }} />
          </div>
          <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCHF(r.revenue)}</div>
          <div style={{ textAlign: "right", color: "var(--text4)" }}>{Math.round((r.revenue / total) * 100)} %</div>
          <div style={{ textAlign: "right", color: "var(--text3)" }}>{extra ? extra(r) : `${r.count} Rg.`}</div>
        </div>
      ))}
      {rows.length > 10 && <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 6 }}>… und {rows.length - 10} weitere</div>}
    </div>
  );
}

export default function CrmAuswertung({ data, setView }: { data: AppData; setView: (view: string) => void }) {
  /** Öffnet den Kontakt in der Kontakte-Ansicht (Hinweis `window.__openContactId`, siehe Persons.tsx). */
  const openContact = (id: string) => { window.__openContactId = id; setView("personen"); };
  const thisYear = String(new Date().getFullYear());
  const years = [...new Set([
    ...data.invoices.map(i => (i.date || "").slice(0, 4)),
    ...(data.leads || []).map(l => (l.closedAt || "").slice(0, 4)),
    thisYear,
  ].filter(Boolean))].sort().reverse();
  const [year, setYear] = useState(thisYear);

  const billed = billedInvoices(data, year);
  const revenue = billed.reduce((s, i) => s + (i.sub || 0), 0);
  const attributed = billed.filter(i => { const a = attribution(data, i); return a.referrerId || a.source; }).reduce((s, i) => s + (i.sub || 0), 0);
  const avg = wonLeadAverages(data, year);
  const srcWin = new Map<string, WinRow>(winRateBy(data, year, "source").map(r => [r.key, r]));
  const refWin = new Map<string, WinRow>(winRateBy(data, year, "referrer").map(r => [r.key, r]));
  const winText = (map: Map<string, WinRow>) => (r: GroupRow) => {
    const w = map.get(r.key);
    return w ? `${w.won}/${w.won + w.lost} · ${pct(w.rate)}` : "—";
  };
  const pay = paymentDaysByClient(data, year);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <label style={{ margin: 0 }}>Jahr</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ width: 120 }}>
          <option value="">Alle</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 8 }} className="responsive-grid-4">
        <KpiCard label="UMSATZ (NETTO)" value={formatCHF(revenue)} sub={`${billed.length} Rechnungen, ohne Entwürfe`} color="var(--positive)" />
        <KpiCard label="TREFFERQUOTE" value={pct(overallWinRate(data, year))} sub={`${avg.count} ${avg.count === 1 ? "Zusage" : "Zusagen"}`} color="var(--info)" />
        <KpiCard label="Ø BIS ZUSAGE" value={avg.avgDays === null ? "—" : `${Math.round(avg.avgDays)} Tage`} sub="von Anfrage bis Zusage" color="#b07848" />
        <KpiCard label="Ø MEETINGS PRO ZUSAGE" value={num1(avg.avgMeetings)} sub="Meeting + Besichtigung" color="var(--warning)" />
      </div>
      <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 20 }}>
        {revenue > 0
          ? `${Math.round((attributed / revenue) * 100)} % des Umsatzes haben eine Herkunft oder einen Empfehler — Herkunft/«Empfohlen von» bei Personen und Leads pflegen, damit die Auswertung aussagekräftig wird.`
          : "Keine verrechneten Rechnungen in diesem Zeitraum."}
      </div>

      <Section title="UMSATZ PRO KUNDE" hint="Verrechnet, netto. Rechnungen = Anzahl Belege.">
        <BarList rows={revenueByClient(data, year)} onOpen={openContact} empty="Keine Rechnungen." />
      </Section>
      <Section title="UMSATZ PRO EMPFEHLER" hint="Wer hat den Auftrag vermittelt? Rechts: gewonnene/entschiedene Leads und Trefferquote.">
        <BarList rows={revenueByReferrer(data, year)} extra={winText(refWin)} onOpen={openContact} empty="Noch keine Aufträge mit Empfehler." />
      </Section>
      <Section title="UMSATZ PRO HERKUNFT" hint="Woher kommen die Aufträge? Rechts: gewonnene/entschiedene Leads und Trefferquote.">
        <BarList rows={revenueBySource(data, year)} extra={winText(srcWin)} empty="Noch keine Aufträge mit Herkunft." />
      </Section>
      <Section title="ZAHLUNGSMORAL" hint="Durchschnittliche Tage von Versand bis Zahlung. Nur Rechnungen, die seit diesem Update als «bezahlt» markiert wurden, haben ein Zahldatum.">
        {pay.length === 0
          ? <div style={{ fontSize: 12, color: "var(--text4)" }}>Noch keine Rechnung mit Zahldatum.</div>
          : pay.map(r => (
            <div key={r.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderTop: "1px solid var(--border2)" }}>
              <span style={{ color: "var(--text)" }}>{r.label}</span>
              <span style={{ color: r.avgDays > 30 ? "var(--warning)" : "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(r.avgDays)} Tage · {r.count} Rg.</span>
            </div>
          ))}
      </Section>
    </div>
  );
}
