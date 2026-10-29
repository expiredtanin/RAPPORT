// Druckvorlage Buchhaltung (`buchhaltung`): Jahresübersicht Einnahmen/Ausgaben.

import React from "react";
import { STATUS_COLORS } from "../../constants";
import { formatCHF, formatDate, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Settings } from "../../types";
import { HEADING } from "./shared";

export function BuchhaltungPrint({ data, filterYear, settings }: { data: AppData; filterYear?: string; settings: Settings }) {
  const mwstRate = settings.mwstRate ?? 8.1;
  const invoices = [...data.invoices]
    .filter(i => !filterYear || (i.date || "").startsWith(filterYear))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const expenses = [...(data.expenses || [])]
    .filter(e => !filterYear || (e.date || "").startsWith(filterYear))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const internalExpenses = [...(data.internalExpenses || [])]
    .filter(e => !filterYear || (e.date || "").startsWith(filterYear))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const loehne = [...(data.lohnEntries || [])]
    .filter(l => !filterYear || l.monat.startsWith(filterYear))
    .sort((a, b) => a.monat.localeCompare(b.monat));

  const totalInvoicedNet = invoices.reduce((s, i) => s + (i.sub || 0), 0);
  // Roh-Summe über exakt die Zeilen, die die RECHNUNGEN-Tabelle unten
  // rendert (inkl. Entwürfe) — deren Fusszeile muss auf die sichtbaren
  // Zeilen aufgehen, sonst wirkt es wie ein Rechenfehler beim Nachprüfen.
  const tableInvoicedTax = invoices.reduce((s, i) => s + (i.tax || 0), 0);
  // Entwürfe sind noch nicht ausgestellt, Akonto-MwSt erst bei Schlussrechnung
  // steuerrelevant (analog Accounting.jsx totalTax/taxWithoutAkonto) — nur
  // für die MWST-Schuld-Kennzahl in der Zusammenfassung relevant, nicht für
  // die Tabellen-Fusszeile.
  const totalInvoicedTax = invoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + (i.tax || 0), 0);
  const akontoTax = invoices.filter(i => i.invoiceKind === "akonto" && i.status !== "entwurf").reduce((s, i) => s + (i.tax || 0), 0);
  const taxWithoutAkonto = totalInvoicedTax - akontoTax;
  // Über Lohnabrechnung ausbezahlte Spesen (lohnEntryId gesetzt) stecken
  // bereits in l.auszahlung (Personalaufwand unten) und dürfen für die
  // ZUSAMMENFASSUNG nicht nochmals mitgezählt werden (analog Accounting.jsx
  // expensesForTotals).
  const expensesForTotals = expenses.filter(e => !e.lohnEntryId);
  const totalExpBrutto = expensesForTotals.reduce((s, e) => s + (e.amount || 0), 0);
  const totalExpNet = expensesForTotals.reduce((s, e) => { const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount; return s + net; }, 0);
  const totalExpTax = totalExpBrutto - totalExpNet;
  // Roh-Summe über exakt die Zeilen, die die SPESEN-Tabelle unten rendert
  // (inkl. über Lohn ausbezahlte) — deren Fusszeile muss auf die sichtbaren
  // Zeilen aufgehen (gleiches Muster wie tableInvoicedTax oben).
  const tableExpBrutto = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const tableExpNet = expenses.reduce((s, e) => { const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount; return s + net; }, 0);
  const tableExpTax = tableExpBrutto - tableExpNet;
  const totalIntExpBrutto = internalExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIntExpNet = internalExpenses.reduce((s, e) => { const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount; return s + net; }, 0);
  const totalIntExpTax = totalIntExpBrutto - totalIntExpNet;
  const totalLoehne = loehne.reduce((s, l) => s + (l.auszahlung || 0), 0);
  const totalLoehneAGAbgaben = loehne.reduce((s, l) => s + (l.bvgAG || 0), 0);
  const totalLoehneGesamt = totalLoehne + totalLoehneAGAbgaben;
  const totalAusgaben = totalExpNet + totalIntExpNet + totalLoehneGesamt;

  const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 0", fontSize: 8, letterSpacing: "0.1em", color: "#888", fontWeight: 500, borderBottom: "1px solid var(--doc-ink)" };
  const thR: React.CSSProperties = { ...thStyle, textAlign: "right" };
  const tdStyle: React.CSSProperties = { padding: "5px 0", fontSize: 9, borderBottom: "1px solid #f0f0f0" };
  const tdR: React.CSSProperties = { ...tdStyle, textAlign: "right" };

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 30 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>BUCHHALTUNGSÜBERSICHT</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 20, marginTop: 4 }}>{filterYear || "Alle Jahre"}</div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 4 }}>{new Date().toLocaleDateString("de-CH")}</div>
        </div>
      </div>

      {/* Zusammenfassung */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24, padding: "14px 16px", background: "#faf8f5", borderRadius: 6, border: "1px solid #e0dbd4" }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#888", marginBottom: 8 }}>EINNAHMEN</div>
          {[
            { label: "Umsatz (Netto)", value: totalInvoicedNet },
            { label: `MWST ${mwstRate}% (excl. Akonto)`, value: taxWithoutAkonto, small: true },
            ...(akontoTax > 0 ? [{ label: "↳ Akonto-MWST ausstehend (bei Schlussrechn.)", value: akontoTax, small: true }] : []),
            { label: "Umsatz (Brutto)", value: totalInvoicedNet + totalInvoicedTax, bold: true },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderTop: r.bold ? "1px solid #ccc" : "none", marginTop: r.bold ? 4 : 0 }}>
              <span style={{ fontSize: r.small ? 8 : 9, color: r.small ? "#888" : "#555" }}>{r.label}</span>
              <span style={{ fontSize: r.small ? 8 : 9, fontWeight: r.bold ? 700 : 400 }}>{formatCHF(r.value)}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#888", marginBottom: 8 }}>AUSGABEN &amp; ERGEBNIS</div>
          {[
            { label: "Spesen (Netto)", value: totalExpNet },
            { label: "Interne Ausgaben (Netto)", value: totalIntExpNet },
            { label: "Vorsteuer", value: totalExpTax + totalIntExpTax, small: true },
            { label: `Personalaufwand / Löhne (${loehne.length}, inkl. AG-Abgaben)`, value: totalLoehneGesamt },
            { label: "Ergebnis (Netto)", value: totalInvoicedNet - totalAusgaben, bold: true },
            { label: "MWST-Schuld (excl. Akonto)", value: taxWithoutAkonto - totalExpTax - totalIntExpTax, bold: true, small: true },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderTop: r.bold && !r.small ? "1px solid #ccc" : "none", marginTop: r.bold && !r.small ? 4 : 0 }}>
              <span style={{ fontSize: r.small ? 8 : 9, color: r.small ? "#888" : "#555" }}>{r.label}</span>
              <span style={{ fontSize: r.small ? 8 : 9, fontWeight: r.bold ? 700 : 400 }}>{formatCHF(r.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rechnungen */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
          RECHNUNGEN ({invoices.length})
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>NR.</th>
              <th style={thStyle}>DATUM</th>
              <th style={thStyle}>KUNDE</th>
              <th style={thStyle}>BESCHREIBUNG</th>
              <th style={thR}>NETTO</th>
              <th style={thR}>MWST</th>
              <th style={thR}>TOTAL</th>
              <th style={thR}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => {
              const client = ((data.persons||[])).find(c => c.id === inv.clientId);
              const desc = (inv.items || []).map(it => it.desc).filter(Boolean).join(", ");
              return (
                <tr key={inv.id}>
                  <td style={tdStyle}><strong>{inv.number}</strong></td>
                  <td style={tdStyle}>{formatDate(inv.date)}</td>
                  <td style={tdStyle}>{client?.name || "—"}</td>
                  <td style={{ ...tdStyle, color: "#666", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc || "—"}</td>
                  <td style={tdR}>{formatCHF(inv.sub)}</td>
                  <td style={{ ...tdR, color: "#888" }}>{inv.mwst ? formatCHF(inv.tax) : "—"}</td>
                  <td style={{ ...tdR, fontWeight: 600 }}>{formatCHF(inv.total)}</td>
                  <td style={{ ...tdR, color: STATUS_COLORS[inv.status] || "#888" }}>{inv.status}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--doc-ink)" }}>
              <td colSpan={4} style={{ padding: "5px 0", fontSize: 9, color: "#888" }}>Total</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(totalInvoicedNet)}</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none", color: "#888" }}>{formatCHF(tableInvoicedTax)}</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(totalInvoicedNet + tableInvoicedTax)}</td>
              <td style={{ borderBottom: "none" }}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Spesen */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
          SPESEN / AUSGABEN ({expenses.length})
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>DATUM</th>
              <th style={thStyle}>KATEGORIE</th>
              <th style={thStyle}>PROJEKT</th>
              <th style={thStyle}>BESCHREIBUNG</th>
              <th style={thR}>NETTO</th>
              <th style={thR}>VORSTEUER</th>
              <th style={thR}>BRUTTO</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => {
              const proj = data.projects.find(p => p.id === e.projectId);
              const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount;
              const tax = e.amount - net;
              return (
                <tr key={e.id}>
                  <td style={tdStyle}>{formatDate(e.date)}</td>
                  <td style={tdStyle}>{e.category}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{proj?.name || "—"}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{e.description || "—"}</td>
                  <td style={tdR}>{formatCHF(net)}</td>
                  <td style={{ ...tdR, color: "#888" }}>{e.mwstRate > 0 ? formatCHF(tax) : "—"}</td>
                  <td style={{ ...tdR, fontWeight: 600 }}>{formatCHF(e.amount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--doc-ink)" }}>
              <td colSpan={4} style={{ padding: "5px 0", fontSize: 9, color: "#888" }}>Total</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(tableExpNet)}</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none", color: "#888" }}>{formatCHF(tableExpTax)}</td>
              <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(tableExpBrutto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Interne Ausgaben */}
      {internalExpenses.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
            INTERNE AUSGABEN ({internalExpenses.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>DATUM</th>
                <th style={thStyle}>KATEGORIE</th>
                <th style={thStyle}>BESCHREIBUNG</th>
                <th style={thR}>NETTO</th>
                <th style={thR}>VORSTEUER</th>
                <th style={thR}>BRUTTO</th>
              </tr>
            </thead>
            <tbody>
              {internalExpenses.map(e => {
                const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount;
                const tax = e.amount - net;
                return (
                  <tr key={e.id}>
                    <td style={tdStyle}>{formatDate(e.date)}</td>
                    <td style={tdStyle}>{e.category}</td>
                    <td style={{ ...tdStyle, color: "#666" }}>{e.description || "—"}</td>
                    <td style={tdR}>{formatCHF(net)}</td>
                    <td style={{ ...tdR, color: "#888" }}>{e.mwstRate > 0 ? formatCHF(tax) : "—"}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{formatCHF(e.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid var(--doc-ink)" }}>
                <td colSpan={3} style={{ padding: "5px 0", fontSize: 9, color: "#888" }}>Total</td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(totalIntExpNet)}</td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none", color: "#888" }}>{formatCHF(totalIntExpTax)}</td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(totalIntExpBrutto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Personalaufwand / Löhne */}
      {loehne.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 10, paddingBottom: 6, borderBottom: "1.5px solid var(--doc-accent)" }}>
            PERSONALAUFWAND / LÖHNE ({loehne.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>MONAT</th>
                <th style={thStyle}>MITARBEITER</th>
                <th style={thR}>BRUTTO</th>
                <th style={thR}>ABZÜGE AN</th>
                <th style={thR}>NETTO</th>
                <th style={thR}>SPESEN</th>
                <th style={thR}>AUSZAHLUNG</th>
                <th style={thR}>PK AG-ANTEIL</th>
              </tr>
            </thead>
            <tbody>
              {loehne.map(l => (
                <tr key={l.id}>
                  <td style={tdStyle}>{l.monat}</td>
                  <td style={tdStyle}>{l.empSnapshot?.name || "—"}</td>
                  <td style={tdR}>{formatCHF(l.bruttoTotal)}</td>
                  <td style={{ ...tdR, color: "#8a1a1a" }}>{formatCHF(l.totalAbzuege)}</td>
                  <td style={tdR}>{formatCHF(l.netto)}</td>
                  <td style={{ ...tdR, color: "#888" }}>{l.spesenTotal > 0 ? formatCHF(l.spesenTotal) : "—"}</td>
                  <td style={{ ...tdR, fontWeight: 600 }}>{formatCHF(l.auszahlung)}</td>
                  <td style={{ ...tdR, color: "#888" }}>{l.bvgAG > 0 ? formatCHF(l.bvgAG) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid var(--doc-ink)" }}>
                <td colSpan={4} style={{ padding: "5px 0", fontSize: 9, color: "#888" }}>Total (inkl. AG-Abgaben)</td>
                <td style={{ borderBottom: "none" }}></td>
                <td style={{ borderBottom: "none" }}></td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none" }}>{formatCHF(totalLoehne)}</td>
                <td style={{ ...tdR, fontWeight: 700, borderBottom: "none", color: "#888" }}>{formatCHF(totalLoehneAGAbgaben)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid #ddd", fontSize: 8, color: "#aaa" }}>
        {settings.name} · {settings.mwst} · Erstellt am {new Date().toLocaleDateString("de-CH")}
      </div>
    </>
  );
}
