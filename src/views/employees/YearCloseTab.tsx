// Reiter «Jahresabschluss»: Ferienübertrag ins Folgejahr bestätigen und Überstunden auszahlen.

import React from "react";
import { formatCHF } from "../../utils";
import type { Employee, ViewProps } from "../../types";
import type { EmployeeCalc } from "./calc";
import type { AbschlussForm } from "./types";

interface YearCloseTabProps {
  data: ViewProps["data"];
  employees: Employee[];
  abschlussYear: number;
  setAbschlussYear: React.Dispatch<React.SetStateAction<number>>;
  abschlussForm: Record<string, AbschlussForm>;
  setAbschlussForm: React.Dispatch<React.SetStateAction<Record<string, AbschlussForm>>>;
  saveFerienUebertrag: (emp: Employee, hours: number | string) => void;
  saveUbAbschluss: (emp: Employee, form: AbschlussForm) => void;
  calc: EmployeeCalc;
}

/** Reiter «Jahresabschluss» der Mitarbeiter-Ansicht. */
export default function YearCloseTab({ data, employees, abschlussYear, setAbschlussYear, abschlussForm, setAbschlussForm, saveFerienUebertrag, saveUbAbschluss, calc }: YearCloseTabProps) {
  const { calcFerienYear, calcEffectiveUbSaldo } = calc;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "var(--text4)" }}>Ferienüberträge bestätigen und Überstunden abrechnen</div>
        <select value={abschlussYear} onChange={e => setAbschlussYear(+e.target.value)} style={{ width: 100, fontSize: 12 }}>
          {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}</option>; })}
        </select>
      </div>

      {employees.length === 0 && <div className="empty-state">Keine Mitarbeiter erfasst</div>}

      {employees.filter(emp => emp.eintrittsdatum && emp.eintrittsdatum <= `${abschlussYear}-12-31`).length === 0 && employees.length > 0 && (
        <div className="empty-state">Keine Mitarbeiter waren {abschlussYear} angestellt</div>
      )}

      {employees.filter(emp => emp.eintrittsdatum && emp.eintrittsdatum <= `${abschlussYear}-12-31`).map(emp => {
        const fs = calcFerienYear(emp, abschlussYear);
        const ubSaldo = calcEffectiveUbSaldo(emp);
        const currentUebertrag = (emp.ferienUebertragVorjahr || {})[abschlussYear + 1];
        const formDef = { ferienUebertrag: fs.restH > 0 ? fs.restH : 0, ubHours: ubSaldo > 0 ? ubSaldo : 0, ubZuschlag: 25 };
        const form = { ...formDef, ...(abschlussForm[emp.id] || {}) };
        const setForm = (val: Partial<AbschlussForm>) => setAbschlussForm(prev => ({ ...prev, [emp.id]: { ...form, ...val } }));
        const stundenlohn = emp.monatslohn
          ? Math.round((emp.monatslohn * 12 / ((emp.wochenstunden || 35) * 52)) * 100) / 100
          : 0;
        const auszahlungBetrag = Math.round(form.ubHours * stundenlohn * (1 + form.ubZuschlag / 100) * 100) / 100;
        const existingPayouts = (data.uberstundenAbschluss || []).filter(a => a.empId === emp.id && a.year === abschlussYear);

        return (
          <div key={emp.id} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border2)" }}>
              <div>
                <strong style={{ fontSize: 14 }}>{emp.name}</strong>
                {emp.role && <span style={{ fontSize: 12, color: "var(--text4)", marginLeft: 10 }}>{emp.role}</span>}
              </div>
              <span style={{ fontSize: 11, color: "var(--text4)" }}>{emp.pensum || 100}% · {((emp.wochenstunden || 35) * (emp.pensum || 100) / 100).toFixed(1)}h/Wo</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
              {/* Ferien */}
              <div>
                <div className="section-label" style={{ marginBottom: 10 }}>Ferien {abschlussYear}</div>
                {[
                  { label: "Jahresanspruch", value: `${fs.anspruchH}h` },
                  fs.ubertragH > 0 ? { label: "Übertrag Vorjahr", value: `+${fs.ubertragH}h` } : null,
                  { label: "Bezogen", value: `-${fs.bezogenH}h` },
                ].filter((r): r is { label: string; value: string } => !!r).map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}>
                    <span>{r.label}</span><span>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, padding: "6px 0 0", marginTop: 4, borderTop: "1px solid var(--border2)" }}>
                  <span>Restanspruch</span>
                  <span style={{ color: fs.restH > 0 ? "var(--positive)" : fs.restH < 0 ? "var(--negative)" : "var(--text4)" }}>{fs.restH}h</span>
                </div>

                {fs.restH > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Übertrag ins {abschlussYear + 1}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="number" min={0} max={fs.restH} step={0.5}
                        value={form.ferienUebertrag}
                        onChange={e => setForm({ ferienUebertrag: Math.min(+e.target.value, fs.restH) })}
                        style={{ width: 70, fontSize: 12 }}
                      />
                      <span style={{ fontSize: 12, color: "var(--text4)" }}>h von {fs.restH}h</span>
                    </div>
                    <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 14px", marginTop: 10 }}
                      onClick={() => saveFerienUebertrag(emp, form.ferienUebertrag)}>
                      Bestätigen
                    </button>
                    {currentUebertrag !== undefined && (
                      <div style={{ fontSize: 11, color: "var(--positive)", marginTop: 6 }}>✓ {currentUebertrag}h bestätigt für {abschlussYear + 1}</div>
                    )}
                  </div>
                ) : fs.restH < 0 ? (
                  <div style={{ fontSize: 11, color: "var(--negative)", marginTop: 12 }}>Negativsaldo — Bezug übersteigt Anspruch</div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 12 }}>Kein Restanspruch — kein Übertrag nötig</div>
                )}
              </div>

              {/* Überstunden */}
              <div>
                <div className="section-label" style={{ marginBottom: 10 }}>Überstunden (Saldo gesamt)</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                  <span>Verbleibend</span>
                  <span style={{ color: ubSaldo > 0 ? "var(--positive)" : ubSaldo < 0 ? "var(--negative)" : "var(--text4)" }}>{ubSaldo}h</span>
                </div>

                {existingPayouts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {existingPayouts.map(p => (
                      <div key={p.id} style={{ fontSize: 11, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "4px 12px", marginBottom: 4 }}>
                        ✓ {p.hoursSettled}h ausbezahlt — {formatCHF(p.auszahlungBetrag)} ({p.zuschlagPercent}% Zuschlag)
                      </div>
                    ))}
                  </div>
                )}

                {ubSaldo > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Stunden ausbezahlen</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                      <input
                        type="number" min={0.5} max={ubSaldo} step={0.5}
                        value={form.ubHours}
                        onChange={e => setForm({ ubHours: Math.min(+e.target.value, ubSaldo) })}
                        placeholder="Std."
                        style={{ width: 65, fontSize: 12 }}
                      />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>h ×</span>
                      <input
                        type="number" min={0} step={1}
                        value={form.ubZuschlag}
                        onChange={e => setForm({ ubZuschlag: +e.target.value })}
                        style={{ width: 52, fontSize: 12 }}
                      />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>% Zuschlag</span>
                    </div>
                    {form.ubZuschlag < 25 && (
                      <div style={{ fontSize: 10, color: "var(--warning)", marginBottom: 6 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> OR Art. 321c: mind. 25% Zuschlag empfohlen</div>
                    )}
                    {stundenlohn > 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                        {form.ubHours}h × {formatCHF(stundenlohn)}/h = <strong>{formatCHF(auszahlungBetrag)}</strong>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--warning)", marginBottom: 10 }}>Kein Monatslohn hinterlegt</div>
                    )}
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: "4px 14px" }}
                      disabled={!stundenlohn || !(form.ubHours > 0)}
                      onClick={() => saveUbAbschluss(emp, form)}
                    >
                      Erfassen
                    </button>
                    <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 6 }}>Restliche Stunden werden übertragen.</div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--text4)" }}>Kein Überstundensaldo vorhanden.</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
