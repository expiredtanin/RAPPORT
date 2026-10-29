// Buchhaltung: Jahresübersicht aus Rechnungen, Spesen, internen Ausgaben und
// Lohnabrechnungen, plus Mahnwesen und Export (PDF/CSV).
//
// Rechenregeln (alle bewusst so, nicht vereinfachen):
//   - Einnahmen = Summe der Netto-Beträge (`inv.sub`) der Rechnungen des Jahres,
//     inkl. Entwürfe (die werden als «erwartet» separat ausgewiesen).
//   - MWST-Schuld: nur nicht-Entwürfe; Akonto-MWST wird getrennt ausgewiesen, weil
//     sie erst bei der Schlussrechnung steuerrelevant ist.
//   - Spesen, die über eine Lohnabrechnung ausbezahlt wurden (`lohnEntryId`), stecken
//     schon in `lohn.auszahlung` und werden für die Summen NICHT doppelt gezählt.
//   - Personalaufwand = Auszahlung + Arbeitgeberanteil Pensionskasse (`bvgAG`).
//   - Vorsteuer = MWST-Anteil aus Spesen und internen Ausgaben.
// Der CSV-Export (`exportBuchhaltungCSV` in utils.ts) muss dieselben Regeln
// einhalten; bei Änderungen beides anpassen.
// Überfällig = Status «gesendet»/«überfällig» mit Fälligkeit vor heute.

import React, { useState } from "react";
import { formatCHF, formatDate, exportBuchhaltungCSV, localISODate } from "../utils";
import { Header, StatusBadge, KpiCard, ShareButton } from "../components/UI";
import { MahnModal } from "../components/MahnModal";
import { ReceiptViewer } from "../components/ReceiptViewer";
import type { Expense, Invoice, ViewProps } from "../types";

/** Zeile in der Ergebnis-Übersicht («Jahresergebnis»). */
type ResultRow = {
  label: string;
  value: number;
  bold?: boolean;
  /** eingerückte Zusatzzeile (kursiv) */
  note?: boolean;
  /** Entwürfe: noch nicht fakturiert */
  expected?: boolean;
  /** Akonto-MWST: noch ausstehend */
  pending?: boolean;
  small?: boolean;
  /** Trennlinie davor */
  sep?: boolean;
};

export default
function Accounting({ data, update, setView, setPrintContent }: Pick<ViewProps, "data" | "update" | "setView" | "setPrintContent">) {
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const currentYear = new Date().getFullYear().toString();
  const [filterYear, setFilterYear] = useState(currentYear);

  const availableYears = Array.from(new Set([
    ...data.invoices.map(i => (i.date || "").slice(0, 4)),
    ...(data.expenses || []).map(e => (e.date || "").slice(0, 4)),
  ].filter(Boolean))).sort().reverse();
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);

  // Gefilterte Daten
  const invoices = data.invoices.filter(i => !filterYear || (i.date || "").startsWith(filterYear));
  const expenses = (data.expenses || []).filter(e => !filterYear || (e.date || "").startsWith(filterYear));
  const lohnEntries = (data.lohnEntries || []).filter(l => !filterYear || l.monat.startsWith(filterYear));

  // Einnahmen
  const totalInvoiced = invoices.reduce((s, i) => s + (i.sub || 0), 0);
  // Entwürfe sind noch nicht ausgestellt — es entsteht noch keine MWST-Schuld.
  const totalTax = invoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + (i.tax || 0), 0);
  // Akonto-MwSt ist erst bei Schlussrechnung steuerrelevant — separat ausweisen
  const akontoInvoices = invoices.filter(i => i.invoiceKind === "akonto" && i.status !== "entwurf");
  const akontoTax = akontoInvoices.reduce((s, i) => s + (i.tax || 0), 0);
  const taxWithoutAkonto = totalTax - akontoTax;
  const totalPaid = invoices.filter(i => i.status === "bezahlt").reduce((s, i) => s + (i.total || 0), 0);
  // Entwürfe sind noch nicht verschickt, also keine offene Forderung.
  const totalOpen = invoices.filter(i => i.status === "gesendet").reduce((s, i) => s + (i.total || 0), 0);
  const totalOverdue = invoices.filter(i => i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
  const totalDraftSub = invoices.filter(i => i.status === "entwurf").reduce((s, i) => s + (i.sub || 0), 0);
  const totalBilledSub = totalInvoiced - totalDraftSub;

  // Ausgaben Spesen — über Lohnabrechnung ausbezahlte Spesen (lohnEntryId
  // gesetzt) stecken bereits in l.auszahlung (siehe totalLoehne unten) und
  // dürfen hier nicht nochmals mitgezählt werden, sonst werden sie doppelt
  // verbucht.
  const expensesForTotals = expenses.filter(e => !e.lohnEntryId);
  const totalExpBrutto = expensesForTotals.reduce((s, e) => s + (e.amount || 0), 0);
  const totalExpNet = expensesForTotals.reduce((s, e) => { const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount; return s + net; }, 0);
  const totalExpTax = totalExpBrutto - totalExpNet;

  // Interne Ausgaben
  const internalExpenses = (data.internalExpenses || []).filter(e => !filterYear || (e.date || "").startsWith(filterYear));
  const totalIntExpBrutto = internalExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIntExpNet = internalExpenses.reduce((s, e) => { const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount; return s + net; }, 0);
  const totalIntExpTax = totalIntExpBrutto - totalIntExpNet;

  // Personalaufwand (abgeschlossene Lohnabrechnungen — Auszahlung an MA + AG-Abgaben)
  const totalLoehne = lohnEntries.reduce((s, l) => s + (l.auszahlung || 0), 0);
  const totalLoehneAGAbgaben = lohnEntries.reduce((s, l) => s + (l.bvgAG || 0), 0);
  const totalLoehneGesamt = totalLoehne + totalLoehneAGAbgaben;
  const totalLoehneAnzahl = lohnEntries.length;

  const totalAusgaben = totalExpNet + totalIntExpNet + totalLoehneGesamt;
  const result = totalInvoiced - totalAusgaben;

  // Überfällige Rechnungen für Mahnwesen
  const today = localISODate();
  const [mahnModal, setMahnModal] = useState<{ inv: Invoice } | null>(null);
  const [mahnMode, setMahnMode] = useState<string>("new"); // "new" oder "reprint-<Index>" (siehe MahnModal)
  const [mahnSentDate, setMahnSentDate] = useState(localISODate());
  const [receiptView, setReceiptView] = useState<Expense | null>(null);

  const overdueInvoices = data.invoices.filter(i =>
    (i.status === "gesendet" || i.status === "überfällig") && i.dueDate && i.dueDate < today
  ).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const sendReminder = (inv: Invoice) => {
    const reminders = inv.reminders || [];
    setMahnMode(reminders.length === 0 ? "new" : "reprint");
    setMahnSentDate(localISODate());
    setMahnModal({ inv });
  };

  return (
    <div>
      <Header title="Buchhaltung" action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="pill" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
            <option value="">Alle Jahre</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <ShareButton options={[
            { label: "PDF", onClick: () => setPrintContent({ type: "buchhaltung", data, filterYear, settings: data.settings }) },
            { label: "CSV", onClick: () => exportBuchhaltungCSV(data, filterYear) },
          ]} />
        </div>
      } />

      {/* KPI-Karten */}
      <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "UMSATZ NETTO", value: formatCHF(totalInvoiced), sub: totalDraftSub > 0 ? `${invoices.length} Rechnungen — davon ${formatCHF(totalDraftSub)} erwartet` : `${invoices.length} Rechnungen`, color: "var(--positive)" },
          { label: "DAVON BEZAHLT", value: formatCHF(totalPaid), sub: "eingegangen", color: "var(--positive)" },
          { label: "OFFEN / ÜBERFÄLLIG", value: formatCHF(totalOpen + totalOverdue), sub: `${overdueInvoices.length} überfällig`, color: totalOverdue > 0 ? "var(--negative)" : "var(--pending)" },
          { label: "AUSGABEN TOTAL", value: formatCHF(totalAusgaben), sub: `Spesen + ${totalLoehneAnzahl} Lohnabrechnungen (inkl. AG-Abgaben)`, color: "var(--text3)" },
        ].map(c => (
          <KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} color={c.color} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
        {/* Ergebnis-Übersicht */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 16 }}>JAHRESERGEBNIS {filterYear || "GESAMT"}</div>
          {([
            { label: "Einnahmen (Netto)", value: totalInvoiced, bold: false },
            totalDraftSub > 0 && { label: "→ Davon fakturiert", value: totalBilledSub, note: true },
            totalDraftSub > 0 && { label: "→ Davon erwartet (Entwürfe)", value: totalDraftSub, note: true, expected: true },
            { label: "Spesen (Netto)", value: -totalExpNet, bold: false },
            { label: "Interne Ausgaben (Netto)", value: -totalIntExpNet, bold: false },
            { label: "Personalaufwand (Löhne)", value: -totalLoehne, bold: false },
            totalLoehneAGAbgaben > 0 && { label: "→ AG-Sozialabgaben (PK/BVG)", value: -totalLoehneAGAbgaben, note: true },
            { label: "Ergebnis vor MWST", value: result, bold: true, sep: true },
            { label: `MWST auf Einnahmen (${mwstRate}%, excl. Akonto)`, value: taxWithoutAkonto, bold: false, small: true },
            akontoTax > 0 && { label: `↳ Akonto-MWST ausstehend (bei Schlussrechn.)`, value: akontoTax, bold: false, small: true, pending: true },
            { label: "Vorsteuer (Spesen + Ausgaben)", value: -(totalExpTax + totalIntExpTax), bold: false, small: true },
            { label: "MWST-Schuld (excl. Akonto)", value: taxWithoutAkonto - totalExpTax - totalIntExpTax, bold: true, small: true },
          ] as (ResultRow | false)[]).filter((r): r is ResultRow => !!r).map((row, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              padding: row.sep ? "10px 0 4px" : row.note ? "2px 0 2px 12px" : "4px 0",
              borderTop: row.sep ? "1.5px solid var(--text)" : "none",
              marginTop: row.sep ? 8 : 0,
            }}>
              <span style={{ fontSize: row.small ? 11 : row.note ? 11 : 13, color: row.expected ? "var(--warning)" : row.pending ? "#b07848" : row.small || row.note ? "var(--text4)" : "var(--text2)", fontStyle: row.note ? "italic" : "normal" }}>
                {row.label}
                {row.expected && <span style={{ fontSize: 10, marginLeft: 4, background: "var(--warning-bg)", color: "var(--warning)", padding: "1px 8px", borderRadius: 20, fontStyle: "normal", fontWeight: 600 }}>noch nicht fakturiert</span>}
                {row.pending && <span style={{ fontSize: 10, marginLeft: 4, background: "#fff8ed", color: "#b07848", padding: "1px 8px", borderRadius: 20, fontStyle: "normal", fontWeight: 600 }}>ausstehend</span>}
              </span>
              <span style={{ fontSize: row.small || row.note ? 11 : 13, fontWeight: row.bold ? 700 : 400, color: row.expected ? "var(--warning)" : row.pending ? "#b07848" : row.value < 0 ? "var(--negative)" : row.bold ? "var(--text)" : "var(--text4)", fontFamily: row.bold ? "'Inter', sans-serif" : "inherit" }}>
                {formatCHF(row.value)}
              </span>
            </div>
          ))}
        </div>

        {/* Monatsumsatz */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 4 }}>MONATSUMSATZ {filterYear || new Date().getFullYear()}</div>
          {(() => {
            const year = filterYear || String(new Date().getFullYear());
            const months = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
            const monthData = months.map((label, i) => {
              const key = `${year}-${String(i + 1).padStart(2, "0")}`;
              const invs = data.invoices.filter(inv => (inv.date || "").startsWith(key));
              const paid = invs.filter(inv => inv.status === "bezahlt").reduce((s, inv) => s + (inv.sub || 0), 0);
              const open = invs.filter(inv => inv.status === "gesendet" || inv.status === "überfällig").reduce((s, inv) => s + (inv.sub || 0), 0);
              const draft = invs.filter(inv => inv.status === "entwurf").reduce((s, inv) => s + (inv.sub || 0), 0);
              return { label, key, paid, open, draft, total: paid + open + draft };
            });
            const maxVal = Math.max(...monthData.map(m => m.total), 1);
            const yearTotal = monthData.reduce((s, m) => s + m.total, 0);
            const currentMonth = localISODate().slice(0, 7);
            return (
              <>
                <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 16 }}>
                  Total {formatCHF(yearTotal)} · {data.invoices.filter(i => (i.date||"").startsWith(year)).length} Rechnungen
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80, marginBottom: 8 }}>
                  {monthData.map(m => (
                    <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 72 }}>
                        {m.total === 0 ? (
                          <div style={{ height: 2, background: "var(--surface3)", borderRadius: 1 }} />
                        ) : (
                          <>
                            {m.draft > 0 && <div style={{ height: `${(m.draft / maxVal) * 70}px`, background: "#ccc", borderRadius: "2px 2px 0 0", minHeight: 2 }} title={`Entwurf: ${formatCHF(m.draft)}`} />}
                            {m.open > 0 && <div style={{ height: `${(m.open / maxVal) * 70}px`, background: "#b07848", minHeight: 2 }} title={`Ausstehend: ${formatCHF(m.open)}`} />}
                            {m.paid > 0 && <div style={{ height: `${(m.paid / maxVal) * 70}px`, background: "var(--positive)", borderRadius: m.draft === 0 && m.open === 0 ? "2px 2px 0 0" : 0, minHeight: 2 }} title={`Bezahlt: ${formatCHF(m.paid)}`} />}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {monthData.map(m => (
                    <div key={m.key} style={{
                      flex: 1, textAlign: "center", fontSize: 9, color: m.key === currentMonth ? "var(--text)" : "var(--text5)",
                      fontWeight: m.key === currentMonth ? 700 : 400,
                    }}>{m.label}</div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border2)" }}>
                  {[
                    { color: "var(--positive)", label: "Bezahlt" },
                    { color: "#b07848", label: "Ausstehend" },
                    { color: "var(--text5)", label: "Entwurf" },
                  ].map(l => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text4)" }}>
                      <div style={{ width: 10, height: 10, background: l.color, borderRadius: 2 }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Mahnwesen */}
      <div className="card" style={{ marginBottom: 28 }}>
        <div className="section-label" style={{ marginBottom: overdueInvoices.length ? 16 : 0 }}>
          MAHNWESEN — ÜBERFÄLLIGE RECHNUNGEN
          {overdueInvoices.length === 0 && <span style={{ marginLeft: 12, color: "var(--positive)", fontWeight: 400 }}>✓ Keine überfälligen Rechnungen</span>}
        </div>
        {overdueInvoices.length > 0 && (
          <table>
            <thead><tr>
              <th>Nr.</th><th>Kunde</th><th>Fällig seit</th><th>Mahnungen</th><th style={{ textAlign: "right" }}>Betrag</th><th></th>
            </tr></thead>
            <tbody>
              {overdueInvoices.map(inv => {
                const client = ((data.persons||[])).find(c => c.id === inv.clientId);
                const daysPast = Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400000);
                const reminders = inv.reminders || [];
                const nextNr = reminders.length + 1;
                const mahnLabel = nextNr === 1 ? "Zahlungserinnerung" : `${nextNr}. Mahnung`;
                const mahnColor = nextNr >= 3 ? "var(--negative)" : nextNr === 2 ? "var(--warning)" : "var(--pending)";
                return (
                  <tr key={inv.id}>
                    <td><strong>{inv.number}</strong></td>
                    <td>{client?.name || "—"}</td>
                    <td>
                      <span style={{ color: daysPast > 30 ? "var(--negative)" : "var(--warning)", fontWeight: 500 }}>
                        {formatDate(inv.dueDate)} ({daysPast} Tage)
                      </span>
                    </td>
                    <td>
                      {reminders.length === 0 ? (
                        <span style={{ fontSize: 11, color: "var(--text5)" }}>Keine</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {reminders.map((r, i) => (
                            <span key={i} style={{ fontSize: 11, color: i === reminders.length - 1 ? "var(--warning)" : "var(--text5)" }}>
                              {i === 0 ? "Erinnerung" : `${i + 1}. Mahnung`} · {formatDate(r.date)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", borderColor: mahnColor, color: mahnColor }}
                        onClick={() => sendReminder(inv)}>
                        ✉ {mahnLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Letzte Rechnungen */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>LETZTE RECHNUNGEN</div>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setView("invoices")}>Alle anzeigen →</button>
        </div>
        <table>
          <thead><tr><th>Nr.</th><th>Kunde</th><th>Datum</th><th style={{ textAlign: "right" }}>Betrag</th><th>Status</th></tr></thead>
          <tbody>
            {[...data.invoices].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6).map(inv => {
              const client = ((data.persons||[])).find(c => c.id === inv.clientId);
              return (
                <tr key={inv.id}>
                  <td><strong>{inv.number}</strong></td>
                  <td>{client?.name || "—"}</td>
                  <td>{formatDate(inv.date)}</td>
                  <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
                  <td><StatusBadge status={inv.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Spesen & Belege */}
      {expenses.length > 0 && (
        <div className="card" style={{ marginTop: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="section-label" style={{ marginBottom: 0 }}>
              SPESEN {filterYear || ""}
              <span style={{ marginLeft: 10, fontWeight: 400, color: "var(--text4)", fontSize: 11 }}>
                {expenses.filter(e => e.receiptData).length} von {expenses.length} mit Beleg
              </span>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setView && setView("expenses")}>
              Alle anzeigen →
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Datum</th>
                <th style={{ width: 160 }}>Kategorie</th>
                <th>Beschreibung</th>
                <th style={{ width: 120 }}>Mitarbeiter</th>
                <th style={{ textAlign: "right", width: 120 }}>Brutto</th>
                <th style={{ width: 80, textAlign: "center" }}>Beleg</th>
                <th style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(e => {
                const emp = (data.employees || []).find(em => em.id === e.employeeId);
                const expStatus = e.status || "offen";
                const statusColors = { offen: "#b07848", genehmigt: "var(--positive)", "auf nächsten Lohn": "var(--info)", ausbezahlt: "var(--positive)" };
                return (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td style={{ fontSize: 12 }}>{e.category}</td>
                    <td style={{ color: "var(--text3)" }}>{e.description || "—"}</td>
                    <td style={{ color: "var(--text4)", fontSize: 12 }}>{emp?.name || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCHF(e.amount)}</td>
                    <td style={{ textAlign: "center" }}>
                      {e.receiptData ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          title={e.receiptName || "Beleg anzeigen"}
                          onClick={() => setReceiptView(e)}
                          style={{ lineHeight: 1, padding: "3px 6px" }}
                        ><span className="msr" style={{ fontSize: 16, verticalAlign: "middle" }}>receipt_long</span></button>
                      ) : (
                        <span style={{ color: "#ddd", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, color: (statusColors as Record<string, string>)[expStatus] || "#888" }}>
                        {expStatus.charAt(0).toUpperCase() + expStatus.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--text)" }}>
                <td colSpan={4} style={{ color: "var(--text4)", fontSize: 12 }}>
                  {expenses.length} Einträge
                  {expenses.length !== expensesForTotals.length && ` (davon ${expenses.length - expensesForTotals.length} bereits über Lohn ausbezahlt, nicht in Summe)`}
                </td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(totalExpBrutto)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Mahnung-Dialog */}
      {mahnModal && (
        <MahnModal
          inv={mahnModal.inv}
          data={data}
          update={update}
          setPrintContent={setPrintContent}
          onClose={() => setMahnModal(null)}
          mahnMode={mahnMode}
          setMahnMode={setMahnMode}
          mahnSentDate={mahnSentDate}
          setMahnSentDate={setMahnSentDate}
        />
      )}
      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />
    </div>
  );
}
