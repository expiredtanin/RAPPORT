// Debitoren: Liste der offenen Posten per Stichtag (Buchhaltung → Debitoren), je Kunde gruppiert,
// mit Fälligkeitsstruktur oben. Rechenregeln: `debitoren()` in debitoren.ts (Dateikopf) — dieselbe
// Funktion speist PDF (print/docs/DebitorenPrint.tsx) und CSV. Klick auf eine Zeile öffnet die Rechnung.

import React, { useMemo, useState } from "react";
import { formatCHF, formatDate, localISODate } from "../utils";
import { DEBITOR_BUCKETS, debitoren, debitorenTitle, exportDebitorenCSV, mahnLabel } from "../debitoren";
import { EmptyState, Header, ShareButton, TableToolbar } from "../components/UI";
import type { ViewProps } from "../types";

export default
function Debitoren({ data, setView, setModal, setPrintContent }: Pick<ViewProps, "data" | "setView" | "setModal" | "setPrintContent">) {
  const today = localISODate();
  const [asOfRaw, setAsOf] = useState(today);
  // Leeres/ungültiges Datumsfeld (während des Tippens) → heute
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : today;
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const r = useMemo(() => debitoren(data, asOf, { onlyOverdue }), [data, asOf, onlyOverdue]);

  const mahnColor = (n: number) => n >= 3 ? "var(--negative)" : n === 2 ? "var(--warning)" : "var(--pending)";
  const open = (id: string) => { setView("invoices"); setModal({ type: "openInvoice", id }); };

  return (
    <div>
      <Header title="Debitoren" sub={`${debitorenTitle(asOf)} · ${r.count} ${r.count === 1 ? "offener Posten" : "offene Posten"}${r.overdueCount ? `, ${r.overdueCount} überfällig` : ", nichts überfällig"}.`} action={
        <>
          <label className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
            <span style={{ color: "var(--text4)", fontSize: 12 }}>Stichtag</span>
            <input type="date" value={asOfRaw} onChange={e => setAsOf(e.target.value)} aria-label="Stichtag"
              style={{ border: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0 }} />
          </label>
          <select className="pill" value={onlyOverdue ? "overdue" : "all"} onChange={e => setOnlyOverdue(e.target.value === "overdue")} aria-label="Anzeige">
            <option value="all">Alle offenen</option>
            <option value="overdue">Nur überfällige</option>
          </select>
          <ShareButton options={[
            { label: "PDF", onClick: () => setPrintContent({ type: "debitoren", data, asOf, onlyOverdue, settings: data.settings }) },
            { label: "CSV", onClick: () => exportDebitorenCSV(data, asOf, { onlyOverdue }) },
          ]} />
        </>
      } />

      {/* Fälligkeitsstruktur als Kennzahlenband */}
      <div className="ws-figs cols5" style={{ marginBottom: 20 }}>
        {DEBITOR_BUCKETS.map(b => {
          const x = r.buckets[b.id];
          return (
            <div key={b.id}>
              <small>{b.label}</small>
              <strong className={`num${b.id !== "notDue" && x.amount > 0 ? (b.id === "d1_30" ? " warn" : " neg") : ""}`}>{formatCHF(x.amount)}</strong>
              <em>{x.count} Posten</em>
            </div>
          );
        })}
      </div>

      <TableToolbar detached
        summary={<><b className="num">{r.count}</b> Posten · Total <b className="num">{formatCHF(r.total)}</b>{r.overdueCount > 0 && <>, überfällig <span className="num" style={{ color: "var(--negative)" }}>{formatCHF(r.overdueTotal)}</span></>} · inkl. MWST</>} />
      <div className="card" style={{ padding: 0, borderRadius: "0 0 var(--r-card) var(--r-card)", borderTop: "none" }}>
        {r.count === 0 ? (
          <EmptyState icon="account_balance_wallet" title={onlyOverdue ? "Nichts überfällig" : "Keine offenen Posten"}
            text={`Per ${formatDate(asOf)} ist keine Rechnung offen${onlyOverdue ? " und überfällig" : ""}.`} />
        ) : (
          <table>
            <thead><tr>
              <th>Rechnung</th><th className="hide-mid">Projekt</th><th>Datum</th><th>Fällig</th>
              <th style={{ textAlign: "right" }}>Tage überfällig</th><th>Mahnstufe</th><th style={{ textAlign: "right" }}>Betrag</th>
            </tr></thead>
            {r.groups.map(g => (
              <tbody key={g.clientId || g.clientName}>
                <tr><td colSpan={7} className="group-row">{g.clientName}<span className="group-sum">{g.count} Posten · <b>{formatCHF(g.total)}</b></span></td></tr>
                {g.rows.map(x => (
                  <tr key={x.id} className="row-link" onClick={() => open(x.id)}>
                    <td><strong style={{ whiteSpace: "nowrap" }}>{x.number}</strong></td>
                    <td className="hide-mid" style={{ color: "var(--text3)" }}>{x.projectName || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(x.date)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{x.dueDate ? formatDate(x.dueDate) : "—"}</td>
                    <td className="num" style={{ textAlign: "right", color: x.daysOverdue > 60 ? "var(--negative)" : x.daysOverdue > 0 ? "var(--warning)" : "var(--text4)", fontWeight: x.daysOverdue > 0 ? 500 : 400 }}>{x.daysOverdue}</td>
                    <td>{x.mahnstufe > 0 ? <span style={{ fontSize: 12, color: mahnColor(x.mahnstufe) }}>{mahnLabel(x.mahnstufe)}</span> : <span style={{ color: "var(--text5)" }}>—</span>}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 600, color: x.amount < 0 ? "var(--negative)" : undefined }}>{formatCHF(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td colSpan={6} style={{ fontWeight: 600 }}>Total offene Posten</td>
                <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(r.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
