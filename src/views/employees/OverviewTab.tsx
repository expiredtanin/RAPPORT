// Reiter «Übersicht»: Monatstabelle, Überstunden-Konto, Absenz-Matrizen und interne Stunden pro Mitarbeiter.
// Reine Darstellung; die Kennzahlen kommen aus `calc.ts`.

import React from "react";
import { getWorkdaysInMonth } from "../../utils";
import type { Absence, AbsenzType, Employee, ViewProps } from "../../types";
import { MONTHS as months, type EmployeeCalc } from "./calc";

interface OverviewTabProps {
  data: ViewProps["data"];
  employees: Employee[];
  absences: Absence[];
  absenzTypes: AbsenzType[];
  closedMonths: string[];
  viewYear: number;
  viewMonth: number;
  setViewYear: React.Dispatch<React.SetStateAction<number>>;
  setViewMonth: React.Dispatch<React.SetStateAction<number>>;
  calc: EmployeeCalc;
}

/** Reiter «Übersicht» der Mitarbeiter-Ansicht (Monats- und Jahresauswertungen). */
export default function OverviewTab({ data, employees, absences, absenzTypes, closedMonths, viewYear, viewMonth, setViewYear, setViewMonth, calc }: OverviewTabProps) {
  const { calcEmpMonth, calcFerienYear, getFTYear } = calc;
  return (
    <div>
      {employees.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text5)", fontSize: 13 }}>
          Noch keine Mitarbeiter erfasst — Tab «Mitarbeiter» verwenden.
        </div>
      ) : (
        <>
          {/* Monats-Navigator */}
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", marginBottom: 20 }}>
            <button className="btn btn-ghost" style={{ padding: "0 12px" }} onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}>←</button>
            <div style={{ flex: 1, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 18 }}>
              {months[viewMonth]} {viewYear}
              {closedMonths.includes(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`) && (
                <span style={{ marginLeft: 10, fontSize: 11, background: "#1a1a18", color: "#f0ede8", padding: "2px 8px", borderRadius: 20, fontFamily: "inherit", fontWeight: 400 }}>geschlossen</span>
              )}
            </div>
            <button className="btn btn-ghost" style={{ padding: "0 12px" }} onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}>→</button>
            <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
              {[viewYear - 2, viewYear - 1, viewYear, viewYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Alle Mitarbeiter — Monatstabelle */}
          <div className="card" style={{ padding: 0, marginBottom: 20 }}>
            <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
              MONATSÜBERSICHT — {months[viewMonth].toUpperCase()} {viewYear}
            </div>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th style={{ textAlign: "right" }}>Soll</th>
                  <th style={{ textAlign: "right" }}>IST</th>
                  <th style={{ textAlign: "right" }}>Ferien</th>
                  <th style={{ textAlign: "right" }}>Intern / Abs.</th>
                  <th style={{ textAlign: "right" }}>Saldo Monat</th>
                  <th style={{ textAlign: "right" }}>Ferien-Rest</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const s = calcEmpMonth(emp, viewYear, viewMonth);
                  const fs = calcFerienYear(emp, viewYear);
                  const saldoColor = s.saldo > 0.5 ? "var(--positive)" : s.saldo < -0.5 ? "var(--negative)" : "#888";
                  return (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{emp.name}</div>
                        <div style={{ fontSize: 10, color: "var(--text5)" }}>{emp.pensum || 100}% · {emp.role || ""}</div>
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text4)" }}>{s.sollTotal}h</td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>{s.istH}h</td>
                      <td style={{ textAlign: "right", color: "var(--pending)" }}>{s.ferienH > 0 ? `${s.ferienH}h` : "—"}</td>
                      <td style={{ textAlign: "right", color: "var(--text4)" }}>{s.absenzH > 0 ? `${s.absenzH}h` : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "'Inter', sans-serif", color: saldoColor }}>
                        {s.saldo > 0 ? "+" : ""}{s.saldo}h
                      </td>
                      <td style={{ textAlign: "right", color: fs.restH < 0 ? "var(--negative)" : "var(--positive)", fontWeight: 500 }}>
                        {fs.restH}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Jahres-Saldo-Matrix */}
          {(() => {
            const today = new Date();
            const curYear = today.getFullYear();
            const curMonth = today.getMonth();
            return (
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
                  ÜBERSTUNDEN-KONTO {viewYear} — MONATSSALDO
                </div>
                <table style={{ width: "100%", fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                        {months.map((m, i) => {
                          const mStr = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                          const isClosed = closedMonths.includes(mStr);
                          const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                          return (
                            <th key={i} style={{ textAlign: "right", minWidth: 52, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>
                              {m.slice(0, 3)}
                              {isClosed && <span style={{ display: "block", fontSize: 8, color: "var(--text4)" }}>●</span>}
                            </th>
                          );
                        })}
                        <th style={{ textAlign: "right", minWidth: 60 }}>YTD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(emp => {
                        let ytd = 0;
                        return (
                          <tr key={emp.id}>
                            <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                            {months.map((_, i) => {
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              if (isFuture) return <td key={i} style={{ textAlign: "right", color: "#ddd" }}>—</td>;
                              const s = calcEmpMonth(emp, viewYear, i);
                              if (s.notStarted) return <td key={i} style={{ textAlign: "right", color: "#ddd" }}>—</td>;
                              ytd = Math.round((ytd + s.saldo) * 10) / 10;
                              const color = s.saldo > 0.5 ? "var(--positive)" : s.saldo < -0.5 ? "var(--negative)" : "#888";
                              return (
                                <td key={i} style={{ textAlign: "right", fontWeight: 500, color }}>
                                  {s.saldo > 0 ? "+" : ""}{s.saldo}
                                </td>
                              );
                            })}
                            <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "'Inter', sans-serif", color: ytd > 0 ? "var(--positive)" : ytd < 0 ? "var(--negative)" : "var(--text4)" }}>
                              {ytd > 0 ? "+" : ""}{ytd}h
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </div>
            );
          })()}

          {/* Absenz-Übersicht mit Vorjahresvergleich */}
          {employees.length > 0 && (() => {
            const prevYear = viewYear - 1;
            const curMonth = new Date().getMonth();
            const curYear = new Date().getFullYear();

            const calcAbsH = (emp: Employee, year: number, monthIdx: number) => {
              const tagessoll = ((emp.wochenstunden || 35) * (emp.pensum || 100) / 100) / 5;
              const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
              const workdays = getWorkdaysInMonth(year, monthIdx, getFTYear(year));
              return absences.filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved")).reduce((s, a) => {
                const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
                if (!from || from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
                const days = workdays.filter(d => d.date >= from && d.date <= to);
                return s + days.length * tagessoll;
              }, 0);
            };

            const calcInternH = (emp: Employee, year: number, monthIdx: number) => {
              const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
              return (data.timeEntries || []).filter(e =>
                e.employeeId === emp.id &&
                !e.projectId &&
                (e.date || "").startsWith(monthStr)
              ).reduce((s, e) => s + (e.minutes || 0), 0) / 60;
            };

            return (
              <>
                {/* Absenzen-Matrix */}
                <div className="card" style={{ padding: 0, marginTop: 20 }}>
                  <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>INTERN / ABSENZEN {viewYear}</span>
                    <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                  </div>
                  <table style={{ width: "100%", fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                        {months.map((m, i) => {
                          const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                          return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                        })}
                        <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                        <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                        <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(emp => {
                        const monthly = months.map((_, i) => Math.round(calcAbsH(emp, viewYear, i) * 10) / 10);
                        const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                        const prevTotal = Math.round(months.reduce((s, _, i) => s + calcAbsH(emp, prevYear, i), 0) * 10) / 10;
                        const delta = Math.round((total - prevTotal) * 10) / 10;
                        return (
                          <tr key={emp.id}>
                            <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                            {monthly.map((h, i) => {
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--negative)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                            })}
                            <td style={{ textAlign: "right", fontWeight: 700, color: total > 0 ? "var(--negative)" : "var(--text4)" }}>{total > 0 ? `${total}h` : "—"}</td>
                            <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                            <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                              {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Absenzen nach Kategorie */}
                {(() => {
                  const calcAbsHByType = (typeId: string, year: number, monthIdx: number) => {
                    const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
                    const workdays = getWorkdaysInMonth(year, monthIdx, getFTYear(year));
                    return absences.filter(a => a.type === typeId && (!a.status || a.status === "approved")).reduce((s, a) => {
                      const emp = employees.find(e => e.id === a.employeeId);
                      if (!emp) return s;
                      const tagessoll = ((emp.wochenstunden || 35) * (emp.pensum || 100) / 100) / 5;
                      const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
                      if (!from || from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
                      const days = workdays.filter(d => d.date >= from && d.date <= to);
                      return s + days.length * tagessoll;
                    }, 0);
                  };

                  const usedTypes = absenzTypes.filter(t =>
                    absences.some(a => a.type === t.id)
                  );
                  if (usedTypes.length === 0) return null;

                  return (
                    <div className="card" style={{ padding: 0, marginTop: 20 }}>
                      <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>ABSENZEN NACH KATEGORIE {viewYear}</span>
                        <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                      </div>
                      <table style={{ width: "100%", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 140 }}>Kategorie</th>
                            {months.map((m, i) => {
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                            })}
                            <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                            <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                            <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usedTypes.map(t => {
                            const monthly = months.map((_, i) => Math.round(calcAbsHByType(t.id, viewYear, i) * 10) / 10);
                            const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                            const prevTotal = Math.round(months.reduce((s, _, i) => s + calcAbsHByType(t.id, prevYear, i), 0) * 10) / 10;
                            const delta = Math.round((total - prevTotal) * 10) / 10;
                            return (
                              <tr key={t.id}>
                                <td style={{ fontSize: 12 }}>
                                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: t.color || "#888", marginRight: 7, verticalAlign: "middle" }} />
                                  {t.label}
                                </td>
                                {monthly.map((h, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--text2)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                })}
                                <td style={{ textAlign: "right", fontWeight: 700 }}>{total > 0 ? `${total}h` : "—"}</td>
                                <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                                <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                  {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Totalzeile */}
                          {(() => {
                            const monthlyTotals = months.map((_, i) => Math.round(usedTypes.reduce((s, t) => s + calcAbsHByType(t.id, viewYear, i), 0) * 10) / 10);
                            const grandTotal = Math.round(monthlyTotals.reduce((s, h) => s + h, 0) * 10) / 10;
                            const prevGrand = Math.round(usedTypes.reduce((s, t) => s + months.reduce((s2, _, i) => s2 + calcAbsHByType(t.id, prevYear, i), 0), 0) * 10) / 10;
                            const delta = Math.round((grandTotal - prevGrand) * 10) / 10;
                            return (
                              <tr style={{ borderTop: "1.5px solid var(--border3)", background: "var(--surface2)", fontWeight: 700 }}>
                                <td style={{ fontSize: 12 }}>Total</td>
                                {monthlyTotals.map((h, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--text)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                })}
                                <td style={{ textAlign: "right" }}>{grandTotal > 0 ? `${grandTotal}h` : "—"}</td>
                                <td style={{ textAlign: "right", color: "var(--text5)", fontWeight: 400 }}>{prevGrand > 0 ? `${prevGrand}h` : "—"}</td>
                                <td style={{ textAlign: "right", color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                  {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Interne Stunden */}
                {(() => {
                  const hasIntern = employees.some(emp =>
                    months.some((_, i) => calcInternH(emp, viewYear, i) > 0 || calcInternH(emp, prevYear, i) > 0)
                  );
                  if (!hasIntern) return null;
                  return (
                    <div className="card" style={{ padding: 0, marginTop: 20 }}>
                      <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>INTERNE STUNDEN {viewYear} — ohne Projektzuweisung</span>
                        <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                      </div>
                      <table style={{ width: "100%", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                            {months.map((m, i) => {
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                            })}
                            <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                            <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                            <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map(emp => {
                            const monthly = months.map((_, i) => Math.round(calcInternH(emp, viewYear, i) * 10) / 10);
                            const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                            const prevTotal = Math.round(months.reduce((s, _, i) => s + calcInternH(emp, prevYear, i), 0) * 10) / 10;
                            const delta = Math.round((total - prevTotal) * 10) / 10;
                            if (total === 0 && prevTotal === 0) return null;
                            return (
                              <tr key={emp.id}>
                                <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                                {monthly.map((h, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "#2d5a8e" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                })}
                                <td style={{ textAlign: "right", fontWeight: 700, color: total > 0 ? "#2d5a8e" : "var(--text4)" }}>{total > 0 ? `${total}h` : "—"}</td>
                                <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                                <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--warning)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                  {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
