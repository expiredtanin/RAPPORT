// Buchhaltung: Jahresübersicht aus Rechnungen, Spesen, internen Ausgaben und
// Lohnabrechnungen, plus Mahnwesen und Export (PDF/CSV).
//
// Rechenregeln: `accountingSummary` in accounting.ts (dort im Dateikopf beschrieben) — dieselbe
// Funktion speist die Druckvorlage und den CSV-Export. Kurz: Einnahmen = gestellte Rechnungen netto
// (wie `yearRevenue`), Entwürfe nur «erwartet»; Akonto-MWST getrennt «ausstehend»; Spesen alle mit
// Netto/Vorsteuer (auch über Lohn ausbezahlte); Personalaufwand = Bruttolohn + AG-Beiträge.
// Überfällig = Status «gesendet»/«überfällig» mit Fälligkeit vor heute.

import React, { useState } from "react";
import { formatCHF, formatDate, localISODate, invoiceNet } from "../utils";
import { accountingSummary, exportBuchhaltungCSV, inPeriod, mwstPerioden, periodLabel } from "../accounting";
import { Header, StatusBadge, ShareButton } from "../components/UI";
import { MahnModal } from "../components/MahnModal";
import { addDays } from "../schedule";
import { ReceiptViewer } from "../components/ReceiptViewer";
import type { Expense, Invoice, ViewProps } from "../types";

export default
function Accounting({ data, update, setView, setModal, setPrintContent }: Pick<ViewProps, "data" | "update" | "setView" | "setModal" | "setPrintContent">) {
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const currentYear = new Date().getFullYear().toString();
  // Periode: "" = alle, "2026" = Jahr, "2026-Q3" = Quartal (MWST-Abrechnung)
  const [period, setPeriod] = useState(currentYear);
  const filterYear = period.slice(0, 4);

  const availableYears = Array.from(new Set([
    ...data.invoices.map(i => (i.date || "").slice(0, 4)),
    ...(data.expenses || []).map(e => (e.date || "").slice(0, 4)),
    ...(data.internalExpenses || []).map(e => (e.date || "").slice(0, 4)),
    ...(data.lohnEntries || []).map(l => (l.monat || "").slice(0, 4)),
  ].filter(Boolean))).sort().reverse();
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);

  // Gefilterte Daten und Summen — eine Quelle für Ansicht, PDF und CSV (accounting.ts)
  const expenses = (data.expenses || []).filter(e => inPeriod(e.date, period));
  const sum = accountingSummary(data, period);

  // Einnahmen
  const totalInvoiced = sum.revenueNet;
  const { akontoTax } = sum;
  const saldo = sum.mwstMethode === "saldo";
  const totalPaid = sum.paidTotal;
  // Entwürfe sind noch nicht verschickt, also keine offene Forderung.
  const totalOpen = sum.openTotal;
  const totalOverdue = sum.overdueTotal;
  const totalDraftSub = sum.draftNet;
  const issuedCount = sum.issuedCount;

  // Spesen: alle (auch die über den Lohn ausbezahlten) mit Netto und Vorsteuer
  const totalExpBrutto = sum.expGross;

  // Interne Ausgaben

  // Personalaufwand: Bruttolöhne + Arbeitgeberbeiträge (AHV/ALV paritätisch, PK-AG)
  const totalLoehne = sum.lohnBrutto;
  const totalLoehneAGAbgaben = sum.lohnAG;
  const totalLoehneAnzahl = sum.lohnCount;

  const totalAusgaben = sum.ausgabenTotal;
  const result = sum.ergebnis;

  // Überfällige Rechnungen für Mahnwesen
  const today = localISODate();
  const [mahnModal, setMahnModal] = useState<{ inv: Invoice } | null>(null);
  const [mahnMode, setMahnMode] = useState<string>("new"); // "new" oder "reprint-<Index>" (siehe MahnModal)
  const [mahnSentDate, setMahnSentDate] = useState(localISODate());
  const [receiptView, setReceiptView] = useState<Expense | null>(null);

  const overdueInvoices = data.invoices.filter(i =>
    (i.status === "gesendet" || i.status === "überfällig") && (i.total || 0) > 0 && i.dueDate && i.dueDate < today
  ).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const sendReminder = (inv: Invoice) => {
    // Der Knopf heisst nach der NÄCHSTEN Mahnstufe → immer «neu» vorwählen. Früher «reprint» (kein
    // gültiger Modus): keine Option gewählt, «Drucken» legte trotzdem stillschweigend eine Mahnung an.
    setMahnMode("new");
    setMahnSentDate(localISODate());
    setMahnModal({ inv });
  };

  /** MWST-Schuld; negativ = Guthaben bei der ESTV */
  const mwst = (v: number) => v < 0 ? `Guthaben ${formatCHF(-v)}` : formatCHF(v);
  // Zu erledigen: was in der Buchhaltung jetzt ansteht (unabhängig von der gewählten Periode)
  const drafts = data.invoices.filter(i => i.status === "entwurf");
  const spesenOffen = (data.expenses || []).filter(e => (e.status || "offen") === "offen" && !e.lohnEntryId);
  const thisMonth = today.slice(0, 7);
  const lohnEmps = (data.employees || []).filter(e => e.active !== false && (e.monatslohn || 0) > 0);
  const lohnDone = lohnEmps.filter(e => (data.lohnEntries || []).some(l => l.employeeId === e.id && l.monat === thisMonth)).length;
  const monthName = new Date(`${thisMonth}-15T12:00:00`).toLocaleDateString("de-CH", { month: "long" });
  // Letzte abgeschlossene MWST-Periode (effektiv: Quartal, Saldosteuersatz: Halbjahr) und ihre Frist
  const methode = data.settings.mwstMethode === "saldo" ? "saldo" : "effektiv";
  const nowY = Number(today.slice(0, 4));
  const prevPer = [...mwstPerioden(nowY - 1, methode), ...mwstPerioden(nowY, methode)].filter(p => p.end < thisMonth).pop();
  const prevPerSum = prevPer ? accountingSummary(data, prevPer.period) : null;
  const todos: { key: string; icon: string; label: string; meta: string; late?: boolean; onClick: () => void }[] = [
    ...(overdueInvoices.length ? [{ key: "mahn", icon: "notification_important", label: `${overdueInvoices.length} ${overdueInvoices.length === 1 ? "Rechnung" : "Rechnungen"} überfällig`, meta: `${formatCHF(overdueInvoices.reduce((s, i) => s + (i.total || 0), 0))} · mahnen`, late: true, onClick: () => document.getElementById("mahnwesen")?.scrollIntoView({ behavior: "smooth" }) }] : []),
    ...(drafts.length ? [{ key: "draft", icon: "draft", label: `${drafts.length} ${drafts.length === 1 ? "Rechnungsentwurf" : "Rechnungsentwürfe"} versenden`, meta: formatCHF(drafts.reduce((s, i) => s + invoiceNet(i), 0)) + " netto", onClick: () => setView("invoices") }] : []),
    ...(spesenOffen.length ? [{ key: "spesen", icon: "receipt_long", label: `${spesenOffen.length} ${spesenOffen.length === 1 ? "Spese" : "Spesen"} genehmigen`, meta: formatCHF(spesenOffen.reduce((s, e) => s + (e.amount || 0), 0)), onClick: () => setView("expenses") }] : []),
    ...(lohnEmps.length && lohnDone < lohnEmps.length ? [{ key: "lohn", icon: "payments", label: `Löhne ${monthName} abrechnen`, meta: `${lohnDone} von ${lohnEmps.length} erstellt`, onClick: () => setView("loehne") }] : []),
    ...(prevPer && prevPerSum && prevPer.due >= today && prevPerSum.issuedCount + prevPerSum.expCount > 0 ? [{ key: "mwst", icon: "account_balance", label: `MWST ${periodLabel(prevPer.period)} abrechnen`, meta: `${mwst(prevPerSum.mwstSchuld)} · bis ${formatDate(prevPer.due)}`, late: prevPer.due <= addDays(today, 10), onClick: () => setPeriod(prevPer.period) }] : []),
  ];
  const quarterYear = Number(filterYear || today.slice(0, 4));
  const quarters = mwstPerioden(quarterYear, methode).map(p => ({
    ...p, sum: accountingSummary(data, p.period), started: p.start <= thisMonth, ended: p.end < thisMonth,
  }));
  const minus = (v: number) => v === 0 ? formatCHF(0) : `− ${formatCHF(Math.abs(v))}`;

  return (
    <div>
      <Header title="Buchhaltung" sub={`${periodLabel(period)} · ${issuedCount} ${issuedCount === 1 ? "Rechnung" : "Rechnungen"} gestellt${overdueInvoices.length ? `, ${overdueInvoices.length} überfällig` : ", nichts überfällig"}.`} action={
        <>
          <select className="pill" value={period} onChange={e => setPeriod(e.target.value)} aria-label="Periode">
            <option value="">Alle Jahre</option>
            {availableYears.map(y => (
              <optgroup key={y} label={y}>
                <option value={y}>{y} ganzes Jahr</option>
                {mwstPerioden(Number(y), data.settings.mwstMethode).map(p => <option key={p.period} value={p.period}>{periodLabel(p.period)}</option>)}
              </optgroup>
            ))}
          </select>
          <ShareButton options={[
            { label: "PDF", onClick: () => setPrintContent({ type: "buchhaltung", data, filterYear: period, settings: data.settings }) },
            { label: "CSV", onClick: () => exportBuchhaltungCSV(data, period) },
          ]} />
        </>
      } />

      {/* Kennzahlen als Band (wie im Projekt-Arbeitsraum) */}
      <div className="ws-figs" style={{ marginBottom: 20 }}>
        <div><small>Umsatz netto</small><strong className="num">{formatCHF(totalInvoiced)}</strong><em>{issuedCount} {issuedCount === 1 ? "Rechnung" : "Rechnungen"}{totalDraftSub > 0 ? ` · ${formatCHF(totalDraftSub)} in Entwürfen` : ""}</em></div>
        <div><small>Bezahlt</small><strong className="num">{formatCHF(totalPaid)}</strong><em>eingegangen</em></div>
        <div><small>Offen</small><strong className={`num${totalOverdue > 0 ? " neg" : ""}`}>{formatCHF(totalOpen + totalOverdue)}</strong><em>{totalOverdue > 0 ? `${formatCHF(totalOverdue)} überfällig` : "nichts überfällig"}</em></div>
        <div><small>Ergebnis vor MWST</small><strong className={`num${result < 0 ? " neg" : ""}`}>{formatCHF(result)}</strong><em>Aufwand {formatCHF(totalAusgaben)}</em></div>
      </div>

      <div className="acc-grid">
        <div className="ws-col">
          {/* Erfolgsrechnung */}
          <section className="card">
            <div className="today-k">Ergebnis {periodLabel(period)}</div>
            <div className="acc-lines">
              {saldo
                ? <div><span>Einnahmen <i>Entgelt inkl. MWST − Saldosteuer</i></span><b className="num">{formatCHF(sum.ertrag)}</b></div>
                : <div><span>Einnahmen <i>gestellte Rechnungen, netto</i></span><b className="num">{formatCHF(totalInvoiced)}</b></div>}
              {totalDraftSub > 0 && <div className="sub"><span>dazu in Entwürfen <i>nicht im Ergebnis</i></span><b className="num">{formatCHF(totalDraftSub)}</b></div>}
              {/* Saldosteuersatz: ohne Vorsteuerabzug gehen die Ausgaben brutto ins Ergebnis */}
              <div><span>Spesen <i>{saldo ? "brutto" : "netto"}</i></span><b className="num">{minus(sum.expImErgebnis)}</b></div>
              <div><span>Büroausgaben <i>{saldo ? "brutto" : "netto"}</i></span><b className="num">{minus(sum.intImErgebnis)}</b></div>
              <div><span>Personalaufwand <i>{totalLoehneAnzahl} {totalLoehneAnzahl === 1 ? "Lohnabrechnung" : "Lohnabrechnungen"}</i></span><b className="num">{minus(totalLoehne + totalLoehneAGAbgaben)}</b></div>
              {totalLoehneAGAbgaben > 0 && <div className="sub"><span>davon AG-Beiträge <i>AHV/IV/EO, ALV, PK</i></span><b className="num">{formatCHF(totalLoehneAGAbgaben)}</b></div>}
              <div className="total"><span>Ergebnis vor MWST</span><b className={`num${result < 0 ? " neg" : ""}`}>{formatCHF(result)}</b></div>
            </div>
            <div className="acc-lines acc-mwst">
              {saldo ? <>
                <div><span>Entgelt inkl. MWST <i>{sum.mwstArt === "vereinnahmt" ? "eingegangen" : "fakturiert"}</i></span><b className="num">{formatCHF(sum.mwstEntgeltBrutto)}</b></div>
                <div><span>Steuer zum Saldosteuersatz <i>{data.settings.mwstSaldoSatz ?? 0} %, ohne Vorsteuerabzug</i></span><b className="num">{formatCHF(sum.umsatzsteuer)}</b></div>
              </> : <>
                <div><span>Umsatzsteuer <i>{sum.mwstArt === "vereinnahmt" ? "bezahlte Rechnungen" : `gestellte Rechnungen, ${mwstRate} %`}</i></span><b className="num">{formatCHF(sum.umsatzsteuer)}</b></div>
                {akontoTax > 0 && sum.mwstArt === "vereinbart" && <div className="sub"><span>davon auf Akontorechnungen</span><b className="num">{formatCHF(akontoTax)}</b></div>}
                <div><span>Vorsteuer <i>Spesen und Büroausgaben</i></span><b className="num">{minus(sum.vorsteuer)}</b></div>
              </>}
              <div className="total"><span>{sum.mwstSchuld < 0 ? "MWST-Guthaben" : "MWST-Schuld"}</span><b className="num">{formatCHF(Math.abs(sum.mwstSchuld))}</b></div>
            </div>
          </section>

          {/* Monatsumsatz */}
          <section className="card">
            {(() => {
            const year = filterYear || String(new Date().getFullYear());
            const months = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
            const monthData = months.map((label, i) => {
              const key = `${year}-${String(i + 1).padStart(2, "0")}`;
              const invs = data.invoices.filter(inv => (inv.date || "").startsWith(key));
              const paid = invs.filter(inv => inv.status === "bezahlt").reduce((s, inv) => s + invoiceNet(inv), 0);
              const open = invs.filter(inv => inv.status === "gesendet" || inv.status === "überfällig").reduce((s, inv) => s + invoiceNet(inv), 0);
              const draft = invs.filter(inv => inv.status === "entwurf").reduce((s, inv) => s + invoiceNet(inv), 0);
              return { label, key, paid, open, draft, total: paid + open + draft, inPeriod: inPeriod(key + "-15", period) };
            });
            const maxVal = Math.max(...monthData.map(m => m.total), 1);
            const yearTotal = monthData.reduce((s, m) => s + m.paid + m.open, 0);
            const currentMonth = localISODate().slice(0, 7);
            return (
              <>
                <div className="today-k">Monatsumsatz {year} <span className="num">{formatCHF(yearTotal)}</span></div>
                <div className="acc-bars">
                  {monthData.map(m => (
                    <div key={m.key} className={`acc-bar${m.inPeriod ? "" : " dim"}${m.key === currentMonth ? " now" : ""}`} title={`${m.label}: bezahlt ${formatCHF(m.paid)} · ausstehend ${formatCHF(m.open)}${m.draft ? ` · Entwurf ${formatCHF(m.draft)}` : ""}`}>
                      <div className="acc-bar-stack">
                        {m.total > 0 && <em className="num">{m.total >= 1000 ? `${Math.round(m.total / 1000)}k` : Math.round(m.total)}</em>}
                        <div className="acc-col" style={{ height: `${(m.total / maxVal) * 100}%` }}>
                          {m.draft > 0 && <i className="draft" style={{ flexGrow: m.draft }} />}
                          {m.open > 0 && <i className="open" style={{ flexGrow: m.open }} />}
                          {m.paid > 0 && <i className="paid" style={{ flexGrow: m.paid }} />}
                        </div>
                      </div>
                      <span>{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="acc-legend"><span><i className="paid" />Bezahlt</span><span><i className="open" />Ausstehend</span><span><i className="draft" />Entwurf</span></div>
              </>
            );
            })()}
          </section>
        </div>

        <div className="ws-col">
          <section className="card">
            <div className="today-k">Zu erledigen</div>
            {todos.length === 0 && <div className="today-meta">Alles erledigt.</div>}
            {todos.map(t => (
              <button key={t.key} className="agenda-row" onClick={t.onClick}>
                <span className="msr" style={{ fontSize: 18, color: t.late ? "var(--negative)" : "var(--text4)" }}>{t.icon}</span>
                <span style={{ minWidth: 0 }}><span className="agenda-label">{t.label}</span><span className="today-meta">{t.meta}</span></span>
              </button>
            ))}
          </section>
          <section className="card">
            <div className="today-k">MWST {quarterYear} <span>{saldo ? `Saldosteuersatz · halbjährlich` : "effektiv · vierteljährlich"}</span></div>
            {quarters.map(q => (
              <button key={q.period} className={`agenda-row acc-q${period === q.period ? " on" : ""}`} disabled={!q.started} onClick={() => setPeriod(period === q.period ? String(quarterYear) : q.period)}>
                <span className="acc-q-n">{q.label}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="agenda-label num">{q.started ? mwst(q.sum.mwstSchuld) : "—"}</span>
                  <span className="today-meta">{!q.started ? "noch nicht begonnen" : !q.ended ? "läuft" : q.due >= today ? `abrechnen bis ${formatDate(q.due)}` : `Frist ${formatDate(q.due)}`}</span>
                </span>
              </button>
            ))}
            <div className="today-meta" style={{ marginTop: 8 }}>Antippen zeigt die Periode oben. Frist 60 Tage nach Periodenende (Art. 71 MWSTG). Methode in den Einstellungen.</div>
          </section>
        </div>
      </div>

      {/* Mahnwesen (nur wenn etwas überfällig ist) */}
      {overdueInvoices.length > 0 && <div className="card" id="mahnwesen" style={{ marginBottom: 20 }}>
        <div className="today-k">Mahnwesen · überfällige Rechnungen</div>
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
      </div>}

      {/* Letzte Rechnungen */}
      <div className="card">
        <div className="today-k">Rechnungen {periodLabel(period)} <button className="btn btn-quiet btn-sm" onClick={() => setView("invoices")}>Alle Rechnungen →</button></div>
        <table>
          <thead><tr><th>Nr.</th><th>Kunde</th><th>Datum</th><th style={{ textAlign: "right" }}>Betrag</th><th>Status</th></tr></thead>
          <tbody>
            {[...data.invoices].filter(i => inPeriod(i.date, period)).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8).map(inv => {
              const client = ((data.persons||[])).find(c => c.id === inv.clientId);
              return (
                <tr key={inv.id} className="row-link" onClick={() => { setView("invoices"); setModal({ type: "openInvoice", id: inv.id }); }}>
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
                const statusColors = { offen: "var(--accent)", genehmigt: "var(--positive)", "auf nächsten Lohn": "var(--info)", ausbezahlt: "var(--positive)" };
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
                  {sum.expViaLohnCount > 0 && ` (davon ${sum.expViaLohnCount} über Lohn ausbezahlt)`}
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
