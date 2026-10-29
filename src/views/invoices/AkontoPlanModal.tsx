// Dialog «Akonto-Plan erstellen»: Projekt/Kunde, Gesamthonorar, Verteilung (gleichmässig oder manuell) und Vorschau.

import type React from "react";
import { generateId, formatCHF, formatDate, roundCHF } from "../../utils";
import { DateInput } from "../../components/UI";
import type { AppData, Person } from "../../types";
import type { AkontoPlan } from "./invoiceHelpers";

/** Planer für mehrere Akonto-Rechnungen; «Entwürfe erstellen» ruft `onCreate` mit den Raten `apRows`. */
export function AkontoPlanModal({ ap, setAp, apRows, data, clients, onClose, onCreate }: {
  ap: AkontoPlan;
  setAp: React.Dispatch<React.SetStateAction<AkontoPlan>>;
  apRows: { id: string; date: string; amt: number }[];
  data: AppData;
  clients: Person[];
  onClose: () => void;
  onCreate: () => void;
}) {
  const apProj = data.projects.find(p => p.id === ap.projectId);
  const apBudget = apProj ? (apProj.budget || apProj.budgetAmount || 0) : 0;
  const apTotal = apRows.reduce((s, r) => s + (r.amt || 0), 0);
  const canCreate = apRows.length > 0 && apRows.every(r => r.date && r.amt > 0) && (ap.projectId || ap.clientId);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 22, marginBottom: 20 }}>Akonto-Plan erstellen</h2>

        {/* Projekt */}
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group">
            <label>Projekt</label>
            <select value={ap.projectId} onChange={e => {
              const p = data.projects.find(x => x.id === e.target.value);
              setAp(a => ({ ...a, projectId: e.target.value, clientId: p?.clientId || a.clientId, totalAmt: p ? (p.budget || p.budgetAmount || 0) : a.totalAmt }));
            }}>
              <option value="">— Projekt wählen —</option>
              {data.projects.filter(p => p.status !== "archiviert").map(p => (
                <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Kunde</label>
            <select value={ap.clientId} onChange={e => setAp(a => ({ ...a, clientId: e.target.value }))}>
              <option value="">— Kunde —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Gesamtbetrag */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Gesamthonorar (Netto, exkl. MWST)
            {apBudget > 0 && <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text5)", marginLeft: 6 }}>Budget: {formatCHF(apBudget)}</span>}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" step="500" min={0} value={ap.totalAmt} onChange={e => setAp(a => ({ ...a, totalAmt: +e.target.value }))}
              style={{ width: 180, textAlign: "right" }} />
            {apBudget > 0 && ap.totalAmt !== apBudget && (
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                onClick={() => setAp(a => ({ ...a, totalAmt: apBudget }))}>= Budget übernehmen</button>
            )}
          </div>
        </div>

        {/* Verteilung */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>VERTEILUNG</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[{ id: "interval", label: "Gleichmässig" }, { id: "manual", label: "Manuell" }].map(m => (
              <button key={m.id} onClick={() => setAp(a => ({
                ...a, mode: m.id as AkontoPlan["mode"],
                manualRows: m.id === "manual" && a.mode === "interval"
                  ? apRows.map(r => ({ ...r, id: generateId() }))
                  : a.manualRows,
              }))} style={{
                padding: "6px 14px", fontSize: 12, borderRadius: 20, border: "1.5px solid",
                borderColor: ap.mode === m.id ? "var(--text)" : "#c8c0b8",
                background: ap.mode === m.id ? "#1a1a18" : "transparent",
                color: ap.mode === m.id ? "#f0ede8" : "var(--text3)",
                cursor: "pointer", fontFamily: "inherit",
              }}>{m.label}</button>
            ))}
          </div>

          {ap.mode === "interval" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Erste Rechnung</div>
                <DateInput value={ap.startDate} onChange={e => setAp(a => ({ ...a, startDate: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Intervall (Monate)</div>
                <input type="number" min={1} max={24} step={1} value={ap.intervalMonths}
                  onChange={e => setAp(a => ({ ...a, intervalMonths: Math.max(1, +e.target.value) }))} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>Anzahl Raten</div>
                <input type="number" min={1} max={24} step={1} value={ap.count}
                  onChange={e => setAp(a => ({ ...a, count: Math.max(1, +e.target.value) }))} />
              </div>
            </div>
          )}
        </div>

        {/* Vorschau / Manuell-Tabelle */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>VORSCHAU — {apRows.length} ENTWÜRFE</div>
            {ap.mode === "manual" && (
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                onClick={() => setAp(a => ({ ...a, manualRows: [...a.manualRows, { id: generateId(), date: "", amt: 0 }] }))}>
                + Zeile
              </button>
            )}
          </div>
          <div style={{ border: "1px solid var(--border2)", borderRadius: 6, overflow: "hidden" }}>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface3)" }}>
                  <th style={{ width: 28, padding: "6px 8px", textAlign: "center", color: "var(--text4)", fontWeight: 500 }}>#</th>
                  <th style={{ padding: "6px 8px", color: "var(--text4)", fontWeight: 500 }}>Datum</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)", fontWeight: 500 }}>Betrag netto</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)", fontWeight: 500 }}>Total inkl. MWST</th>
                  {ap.mode === "manual" && <th style={{ width: 28 }}></th>}
                </tr>
              </thead>
              <tbody>
                {apRows.map((row, i) => {
                  const mwstAmt = row.amt * (data.settings.mwstRate / 100);
                  return (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--border2)" }}>
                      <td style={{ padding: "6px 8px", textAlign: "center", color: "var(--text4)" }}>{i + 1}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {ap.mode === "manual"
                          ? <DateInput value={row.date} onChange={e => setAp(a => ({ ...a, manualRows: a.manualRows.map(r => r.id === row.id ? { ...r, date: e.target.value } : r) }))} style={{ height: 28, fontSize: 12 }} />
                          : <span style={{ color: row.date ? "var(--text)" : "var(--text5)" }}>{row.date ? formatDate(row.date) : "—"}</span>}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {ap.mode === "manual"
                          ? <input type="number" step="100" min={0} value={row.amt} onChange={e => setAp(a => ({ ...a, manualRows: a.manualRows.map(r => r.id === row.id ? { ...r, amt: +e.target.value } : r) }))} style={{ width: 110, height: 28, fontSize: 12, textAlign: "right" }} />
                          : <strong>{formatCHF(row.amt)}</strong>}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text4)" }}>
                        {formatCHF(roundCHF(row.amt + mwstAmt))}
                      </td>
                      {ap.mode === "manual" && (
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button onClick={() => setAp(a => ({ ...a, manualRows: a.manualRows.filter(r => r.id !== row.id) }))}
                            style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--border3)", background: "var(--surface2)" }}>
                  <td colSpan={2} style={{ padding: "7px 8px", fontSize: 11, color: "var(--text4)" }}>Total</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700 }}>{formatCHF(apTotal)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700 }}>{formatCHF(roundCHF(apTotal * (1 + (data.settings.mwstRate || 0) / 100)))}</td>
                  {ap.mode === "manual" && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 6 }}>Werden als Entwurf gespeichert — Nummern, Beschreibungen und Beträge danach noch editierbar.</div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
          <button className="btn btn-ghost" onClick={() => onClose()}>Abbrechen</button>
          <button className="btn btn-primary" onClick={onCreate} disabled={!canCreate} style={{ opacity: canCreate ? 1 : 0.4 }}>
            {apRows.length} Entwürfe erstellen →
          </button>
        </div>
      </div>
    </div>
  );
}
