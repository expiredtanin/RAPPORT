// Löhne: monatliche Lohnabrechnung pro Mitarbeiter.
//
// Ablauf: Monat wählen (nie in der Zukunft, nicht vor dem Eintrittsdatum),
// Mitarbeiter anklicken → Vorschau der Berechnung (`calcLohn`, Sätze AHV/ALV/BVG/
// NBU/KTG/Quellensteuer). Für den Lauf können Monatslohn, Pensum und eine
// Einmalzahlung/Bonus überschrieben werden (gelten nur für diesen Monat, werden
// nach dem Abschluss zurückgesetzt). «Abschliessen» speichert einen Eintrag in
// `data.lohnEntries` mit eingefrorenen Sätzen (`saetzeSnapshot`) und den Stammdaten
// (`empSnapshot`), damit spätere Änderungen alte Abrechnungen nicht verändern.
//
// Spesen: offene Spesen des Mitarbeiters aus dem Monat (ohne `lohnEntryId`) werden
// mit ausbezahlt und auf «ausbezahlt» gesetzt. «Stornieren» löscht die Abrechnung,
// gibt die Spesen wieder frei («auf nächsten Lohn») und stellt die Overrides wieder her.
// Fachliche Details der Abzüge: utils.ts `calcLohn`, docs/FACHLOGIK.md.

import React, { useState } from "react";
import { generateId, formatCHF, calcLohn } from "../utils";
import { Header, NavArrows, ShareButton } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Employee, LohnEntry, LohnResult, SaetzeSnapshot, ViewProps } from "../types";

export default
function Payroll({ data, saveAll, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent" | "setView">) {
  const now = new Date();
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth());
  const [selEmpId, setSelEmpId] = useState("");
  // Overrides gelten nur für den aktuell angezeigten Lauf (Schlüssel = Mitarbeiter-Id).
  const [bruttoOverride, setBruttoOverride] = useState<Record<string, number>>({});
  const [pensumOverride, setPensumOverride] = useState<Record<string, number>>({});
  // Bonus in CHF unter `empId`, der Beschrieb unter `${empId}_beschrieb` (gleiche Map, daher string | number).
  const [bonusOverride, setBonusOverride] = useState<Record<string, number | string>>({});
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const employees = data.employees || [];
  const lohnEntries = data.lohnEntries || [];
  const months = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const monatStr = `${selYear}-${String(selMonth + 1).padStart(2, "0")}`;

  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const isAtFuture = selYear > todayYear || (selYear === todayYear && selMonth >= todayMonth);
  const goNext = () => {
    if (isAtFuture) return;
    if (selMonth === 11) { setSelMonth(0); setSelYear(y => y + 1); } else setSelMonth(m => m + 1);
  };
  const goPrev = () => {
    if (selMonth === 0) { setSelMonth(11); setSelYear(y => y - 1); } else setSelMonth(m => m - 1);
  };

  const isMonatAvailable = (emp: Employee) => {
    // Nicht in die Zukunft (aktueller Monat ist max)
    if (selYear > todayYear || (selYear === todayYear && selMonth > todayMonth)) return false;
    // Nicht vor Eintrittsdatum
    if (emp.eintrittsdatum) {
      const parts = emp.eintrittsdatum.split("-");
      const ey = parseInt(parts[0]);
      const em = parseInt(parts[1]) - 1; // 0-basiert
      if (selYear < ey || (selYear === ey && selMonth < em)) return false;
    }
    return true;
  };

  const getEffBrutto = (emp: Employee) => bruttoOverride[emp.id] != null ? bruttoOverride[emp.id] : (emp.monatslohn || 0);
  const getEffPensum = (emp: Employee) => pensumOverride[emp.id] != null ? pensumOverride[emp.id] : (emp.pensum || 100);

  const offeneSpesen = (empId: string) => (data.expenses || []).filter(e =>
    e.employeeId === empId && (e.date || "").startsWith(monatStr) && !e.lohnEntryId
  );
  const findEntry = (empId: string) => lohnEntries.find(l => l.monat === monatStr && l.employeeId === empId);

  const abschliessen = (emp: Employee) => {
    if (findEntry(emp.id)) return;
    const spesen = offeneSpesen(emp.id);
    const effBrutto = getEffBrutto(emp);
    const effPensum = getEffPensum(emp);
    const bonus = (bonusOverride[emp.id] as number) || 0;
    const calc = calcLohn({ ...emp, monatslohn: effBrutto, pensum: effPensum }, monatStr, spesen, bonus);
    // Alle Sätze statisch festhalten — unabhängig von späteren Änderungen
    const saetzeSnapshot: SaetzeSnapshot = {
      ahvSatz:  emp.ahvSatz  ?? 5.3,
      alvSatz:  emp.alvSatz  ?? 1.1,
      bvgSatz:  emp.bvgSatz  ?? 8.0,
      nbuSatz:  emp.nbuSatz  ?? 1.5,
      ktgSatz:  emp.ktgSatz  ?? 0.5,
      quellensteuerPflichtig: emp.quellensteuerPflichtig || false,
      quellensteuerSatz: emp.quellensteuerSatz ?? 10,
      dreizehnterLohn: emp.dreizehnterLohn || false,
      pensum: effPensum,
      eintrittsdatum: emp.eintrittsdatum || "",
      pkAGSatz: emp.pkAGSatz ?? 8.0,
    };
    const entry: LohnEntry = {
      id: generateId(), monat: monatStr, employeeId: emp.id,
      empSnapshot: { name: emp.name, role: emp.role, adresse: emp.adresse, ort: emp.ort, ahvNr: emp.ahvNr, personalNr: emp.personalNr, lohnIban: emp.lohnIban },
      saetzeSnapshot,
      bruttoWasOverridden: bruttoOverride[emp.id] != null,
      bonusBeschrieb: (bonusOverride[`${emp.id}_beschrieb`] as string) || "",
      ...calc, spesenIds: spesen.map(s => s.id),
      createdAt: new Date().toISOString(),
    };
    const updatedExp = (data.expenses || []).map(e =>
      spesen.some(s => s.id === e.id) ? { ...e, lohnEntryId: entry.id, status: "ausbezahlt" } : e
    );
    saveAll({ ...data, lohnEntries: [...lohnEntries, entry], expenses: updatedExp });
    // Overrides sind nur für DIESEN Monat gedacht ("Pensum diesen Monat",
    // "Einmalzahlung / Bonus") — ohne Reset blieben sie beim Monatswechsel
    // vorausgefüllt und ein "einmaliger" Bonus würde beim nächsten
    // Abschluss versehentlich erneut ausbezahlt.
    setBruttoOverride(o => { const n = { ...o }; delete n[emp.id]; return n; });
    setPensumOverride(o => { const n = { ...o }; delete n[emp.id]; return n; });
    setBonusOverride(o => { const n = { ...o }; delete n[emp.id]; delete n[`${emp.id}_beschrieb`]; return n; });
  };

  const stornieren = async (id: string) => {
    if (!(await askConfirm("Lohnabrechnung stornieren? Spesen werden wieder freigegeben.", "Stornieren"))) return;
    const entry = lohnEntries.find(l => l.id === id);
    const updatedExp = (data.expenses || []).map(e => e.lohnEntryId === id ? { ...e, lohnEntryId: null, status: "auf nächsten Lohn" } : e);
    saveAll({ ...data, lohnEntries: lohnEntries.filter(l => l.id !== id), expenses: updatedExp });
    // Overrides wiederherstellen, die abschliessen() gesetzt hatte — sonst
    // muss die Pensum-/Bonus-Korrektur, die zu dieser (jetzt stornierten)
    // Abrechnung führte, von Hand neu eingetippt werden.
    if (entry) {
      if (entry.bruttoWasOverridden) setBruttoOverride(o => ({ ...o, [entry.employeeId]: entry.bruttoBase }));
      if (entry.saetzeSnapshot?.pensum != null) setPensumOverride(o => ({ ...o, [entry.employeeId]: entry.saetzeSnapshot!.pensum }));
      if (entry.bonusBetrag > 0) setBonusOverride(o => ({ ...o, [entry.employeeId]: entry.bonusBetrag, [`${entry.employeeId}_beschrieb`]: entry.bonusBeschrieb || "" }));
    }
  };

  const selectedEmp = employees.find(e => e.id === selEmpId);
  const previewSpesen = selEmpId ? offeneSpesen(selEmpId) : [];
  const previewCalc = selectedEmp ? calcLohn({ ...selectedEmp, monatslohn: getEffBrutto(selectedEmp), pensum: getEffPensum(selectedEmp) }, monatStr, previewSpesen, (bonusOverride[selectedEmp.id] as number) || 0) : null;
  const existingEntry = selEmpId ? findEntry(selEmpId) : null;
  const monatEntries = lohnEntries.filter(l => l.monat === monatStr);
  const cardPensum = existingEntry ? (existingEntry.saetzeSnapshot?.pensum || 100) : (selectedEmp ? getEffPensum(selectedEmp) : 100);

  const LohnRow = ({ label, value, bold, color, indent }: { label: string; value: number; bold?: boolean; color?: string; indent?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: indent ? 11 : 12, color: color || (indent ? "var(--text4)" : "var(--text2)"), paddingLeft: indent ? 12 : 0 }}>
      <span>{label}</span><span style={{ fontWeight: bold ? 700 : 400 }}>{formatCHF(value)}</span>
    </div>
  );

  /**
   * Berechnungsblock. `calc` ist die Live-Vorschau oder ein gespeicherter Eintrag;
   * `emp` der Mitarbeiter (bei gespeicherten Einträgen mit `saetzeSnapshot`, dann
   * gelten dessen Sätze statt der aktuellen Stammdaten).
   */
  const renderCalc = (calc: LohnResult & { bonusBeschrieb?: string }, emp: Employee & { saetzeSnapshot?: SaetzeSnapshot }, isPreview: boolean, displayPensum: number) => (
    <div>
      {isPreview && (
        <div style={{ marginBottom: 12, padding: "8px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>MONATSLOHN (100% BASIS) — für diesen Lohnlauf anpassbar</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" step={100} min={0} value={getEffBrutto(emp)}
              onChange={e => setBruttoOverride(o => ({ ...o, [emp.id]: +e.target.value }))}
              style={{ flex: 1, height: 32, fontSize: 13, textAlign: "right", border: bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== emp.monatslohn ? "1.5px solid var(--warning)" : "1px solid var(--border3)" }} />
            <span style={{ fontSize: 11, color: "var(--text4)" }}>CHF</span>
            {bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== emp.monatslohn && (
              <button onClick={() => setBruttoOverride(o => { const n={...o}; delete n[emp.id]; return n; })}
                title="Stammdaten-Wert wiederherstellen"
                style={{ fontSize: 11, color: "var(--text4)", background: "none", border: "1px solid var(--border3)", borderRadius: 20, cursor: "pointer", padding: "2px 8px" }}>↺ Reset</button>
            )}
          </div>
          {bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== emp.monatslohn && (
            <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 4 }}>Abweichend von Stammdaten ({formatCHF(emp.monatslohn || 0)})</div>
          )}
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", margin: "10px 0 6px", paddingTop: 8, borderTop: "1px solid var(--border)" }}>PENSUM DIESEN MONAT</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <input type="number" min={10} max={100} step={5}
              value={getEffPensum(emp)}
              onChange={e => setPensumOverride(o => ({ ...o, [emp.id]: +e.target.value }))}
              style={{ width: 72, height: 32, fontSize: 13, textAlign: "right", border: pensumOverride[emp.id] != null && pensumOverride[emp.id] !== (emp.pensum || 100) ? "1.5px solid var(--warning)" : "1px solid var(--border3)" }} />
            <span style={{ fontSize: 11, color: "var(--text4)" }}>%</span>
            {pensumOverride[emp.id] != null && pensumOverride[emp.id] !== (emp.pensum || 100) && (
              <button onClick={() => setPensumOverride(o => { const n={...o}; delete n[emp.id]; return n; })}
                title="Stammdaten-Wert wiederherstellen"
                style={{ fontSize: 11, color: "var(--text4)", background: "none", border: "1px solid var(--border3)", borderRadius: 20, cursor: "pointer", padding: "2px 8px" }}>↺ Reset</button>
            )}
          </div>
          {pensumOverride[emp.id] != null && pensumOverride[emp.id] !== (emp.pensum || 100) && (
            <div style={{ fontSize: 10, color: "var(--warning)", marginBottom: 4 }}>Abweichend von Stammdaten ({emp.pensum || 100}%)</div>
          )}
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", margin: "10px 0 6px", paddingTop: 8, borderTop: "1px solid var(--border)" }}>EINMALZAHLUNG / BONUS (AHV-pflichtig)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" step={100} min={0} value={bonusOverride[emp.id] || ""}
              onChange={e => setBonusOverride(o => ({ ...o, [emp.id]: +e.target.value || 0 }))}
              placeholder="0"
              style={{ width: 110, height: 32, fontSize: 13, textAlign: "right", border: bonusOverride[emp.id] ? "1.5px solid var(--positive)" : "1px solid var(--border3)" }} />
            <span style={{ fontSize: 11, color: "var(--text4)", lineHeight: "32px" }}>CHF</span>
            <input value={bonusOverride[`${emp.id}_beschrieb`] || ""}
              onChange={e => setBonusOverride(o => ({ ...o, [`${emp.id}_beschrieb`]: e.target.value }))}
              placeholder="Beschrieb (z.B. Jahresbonus)"
              style={{ flex: 1, height: 32, fontSize: 12, border: "1px solid var(--border3)" }} />
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12, color: "var(--text3)" }}>
        <span>Monatslohn {months[selMonth]} {selYear}{displayPensum < 100 ? ` (${displayPensum}%)` : ""}</span>
        <span>{formatCHF(calc.brutto)}</span>
      </div>
      {displayPensum < 100 && calc.bruttoBase != null && calc.bruttoBase !== calc.brutto && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "1px 0 3px 12px", fontSize: 10, color: "var(--text4)" }}>
          <span>Basis 100%: {formatCHF(calc.bruttoBase)} × {displayPensum}%</span>
        </div>
      )}
      {calc.dreizehnter > 0 && <LohnRow label="13. Monatslohn (1/12)" value={calc.dreizehnter} indent />}
      {calc.bonusBetrag > 0 && <LohnRow label={emp.saetzeSnapshot ? (calc.bonusBeschrieb || "Einmalzahlung / Bonus") : ((bonusOverride[`${emp.id}_beschrieb`] as string) || "Einmalzahlung / Bonus")} value={calc.bonusBetrag} indent />}
      <LohnRow label="Bruttolohn Total" value={calc.bruttoTotal} bold />
      <div style={{ marginTop: 10, marginBottom: 4, fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>ABZÜGE ARBEITNEHMER</div>
      {(() => {
        const s = emp.saetzeSnapshot || emp; // abgeschlossen: snapshot, preview: live emp
        return <>
          <LohnRow label={`AHV/IV/EO (${s.ahvSatz ?? 5.3}%)`} value={-calc.ahv} indent color="var(--negative)" />
          <LohnRow label={`ALV (${s.alvSatz ?? 1.1}%)`} value={-calc.alv} indent color="var(--negative)" />
          <LohnRow label={`BVG/PK (${s.bvgSatz ?? 8.0}%)`} value={-calc.bvg} indent color="var(--negative)" />
          <LohnRow label={`NBU (${s.nbuSatz ?? 1.5}%)`} value={-calc.nbu} indent color="var(--negative)" />
          <LohnRow label={`KTG (${s.ktgSatz ?? 0.5}%)`} value={-calc.ktg} indent color="var(--negative)" />
          {calc.qst > 0 && <LohnRow label={`Quellensteuer (${s.quellensteuerSatz ?? 10}%)`} value={-calc.qst} indent color="var(--negative)" />}
        </>;
      })()}
      <div style={{ borderTop: "1.5px solid var(--text)", marginTop: 8, paddingTop: 8 }}>
        <LohnRow label="Nettolohn" value={calc.netto} bold />
      </div>
      {calc.spesenTotal > 0 && <>
        <div style={{ marginTop: 10, marginBottom: 4, fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>SPESENERSTATTUNG</div>
        <LohnRow label="Spesen" value={calc.spesenTotal} indent />
      </>}
      <div style={{ borderTop: "1.5px solid var(--text)", marginTop: 8, paddingTop: 8 }}>
        <LohnRow label="Auszahlung Total" value={calc.auszahlung} bold color="var(--positive)" />
      </div>
      {calc.bvgAG > 0 && (() => {
        const s = emp.saetzeSnapshot || emp;
        return (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed #c8c0b8" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 4 }}>LOHNKOSTEN ARBEITGEBER</div>
            <LohnRow label={`PK / BVG AG-Anteil (${s.pkAGSatz ?? 8.0}%)`} value={calc.bvgAG} indent color="var(--warning)" />
            <LohnRow label="Gesamtlohnkosten (inkl. PK AG)" value={calc.auszahlung + calc.bvgAG} bold />
          </div>
        );
      })()}
    </div>
  );

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Löhne" />
      {employees.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Name</th><th style={{ textAlign: "right" }}>Brutto</th><th style={{ textAlign: "right" }}>Netto</th><th style={{ textAlign: "right" }}>Spesen</th><th style={{ textAlign: "right" }}>Auszahlung</th><th>Status</th><th></th></tr></thead>
            <tbody><tr><td colSpan={7} className="empty-state">Noch keine Mitarbeiter erfasst</td></tr></tbody>
          </table>
        </div>
      ) : (
        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
          <div>
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", marginBottom: 16 }}>
              <NavArrows onPrev={goPrev} onNext={goNext} disabledNext={isAtFuture} />
              <div style={{ flex: 1, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 18 }}>{months[selMonth]} {selYear}</div>
            </div>
            <div className="card" style={{ padding: 0 }}>
              <div className="panel-label">MITARBEITER</div>
              <table>
                <thead><tr>
                  <th>Name</th>
                  <th style={{ textAlign: "right" }}>Brutto</th>
                  <th style={{ textAlign: "right" }}>Netto</th>
                  <th style={{ textAlign: "right" }}>Spesen</th>
                  <th style={{ textAlign: "right" }}>Auszahlung</th>
                  <th>Status</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {employees.filter(e => (e.monatslohn || 0) > 0).length === 0 && (
                    <tr><td colSpan={7} className="empty-state">Noch kein Monatslohn hinterlegt.</td></tr>
                  )}
                  {employees.filter(e => (e.monatslohn || 0) > 0).map(emp => {
                    const available = isMonatAvailable(emp);
                    const entry = findEntry(emp.id);
                    const spesen = entry ? (data.expenses || []).filter(e => e.lohnEntryId === entry.id) : offeneSpesen(emp.id);
                    const effBrutto = getEffBrutto(emp);
                    const calc = entry ? entry : calcLohn({ ...emp, monatslohn: effBrutto, pensum: getEffPensum(emp) }, monatStr, spesen, (bonusOverride[emp.id] as number) || 0);
                    return (
                      <tr key={emp.id} onClick={() => available && setSelEmpId(emp.id)}
                        style={{ cursor: available ? "pointer" : "default", background: selEmpId === emp.id ? "#faf8f5" : "", opacity: available ? 1 : 0.35 }}>
                        <td>
                          <strong>{emp.name}</strong>
                          {emp.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{emp.role}</div>}
                          {!available && <div style={{ fontSize: 10, color: "var(--text5)" }}>vor Eintritt</div>}
                        </td>
                        <td style={{ textAlign: "right" }}>{available ? formatCHF(calc.bruttoTotal) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{available ? formatCHF(calc.netto) : "—"}</td>
                        <td style={{ textAlign: "right", color: calc.spesenTotal > 0 ? "var(--warning)" : "var(--text5)" }}>{available && calc.spesenTotal > 0 ? formatCHF(calc.spesenTotal) : "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{available ? formatCHF(calc.auszahlung) : "—"}</td>
                        <td>{!available ? null : entry
                          ? <span style={{ fontSize: 10, color: "var(--positive)", background: "var(--positive-bg)", border: "1px solid #b0d8c0", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>Abgeschlossen</span>
                          : <span style={{ fontSize: 10, color: "var(--warning)", background: "#fff8f0", border: "1px solid #f0d0a0", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>Offen</span>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {available && (entry
                            ? <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={e => { e.stopPropagation(); stornieren(entry.id); }}>Stornieren</button>
                            : <button className="btn btn-primary" style={{ fontSize: 11, padding: "2px 10px" }} onClick={e => { e.stopPropagation(); abschliessen(emp); }}>Abschliessen</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {monatEntries.length > 0 && (() => {
                  const t = monatEntries.reduce((s,l) => ({ b:s.b+l.bruttoTotal, n:s.n+l.netto, sp:s.sp+l.spesenTotal, a:s.a+l.auszahlung }), {b:0,n:0,sp:0,a:0});
                  return (
                    <tfoot>
                      <tr style={{ borderTop: "1.5px solid var(--text)", fontWeight: 600 }}>
                        <td>Total</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.b)}</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.n)}</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.sp)}</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.a)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>

          <div>
            {selectedEmp && isMonatAvailable(selectedEmp) ? (
              <div className="card">
                <div className="section-label" style={{ marginBottom: 4 }}>LOHNABRECHNUNG</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, marginBottom: 2 }}>{selectedEmp.name}</div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 16 }}>{[selectedEmp.role, `${months[selMonth]} ${selYear}`, cardPensum < 100 ? `${cardPensum}%` : null].filter(Boolean).join(" · ")}</div>
                {existingEntry
                  ? renderCalc(existingEntry, { ...selectedEmp, ...existingEntry.empSnapshot, saetzeSnapshot: existingEntry.saetzeSnapshot } as Employee & { saetzeSnapshot?: SaetzeSnapshot }, false, existingEntry.saetzeSnapshot?.pensum || 100)
                  : renderCalc(previewCalc as LohnResult, selectedEmp, true, getEffPensum(selectedEmp))
                }
                {(() => {
                  const sp = existingEntry ? (data.expenses||[]).filter(e => e.lohnEntryId === existingEntry.id) : previewSpesen;
                  return sp.length > 0 ? (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border2)" }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 8 }}>SPESEN DETAIL</div>
                      {sp.map(s => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text4)", padding: "2px 0" }}>
                          <span>{s.category}{s.description ? ` — ${s.description}` : ""}</span>
                          <span>{formatCHF(s.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                  {existingEntry ? (
                    <>
                      <ShareButton style={{ flex: 1, fontSize: 11 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "lohn", entry: existingEntry, emp: selectedEmp, data, monatLabel: `${months[selMonth]} ${selYear}` }) }]} />
                      <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--negative)", borderColor: "var(--negative)" }} onClick={() => stornieren(existingEntry.id)}>Stornieren</button>
                    </>
                  ) : (
                    <button className="btn btn-primary" style={{ flex: 1, fontSize: 11 }}
                      onClick={() => abschliessen(selectedEmp)}
                      disabled={!selectedEmp.monatslohn && bruttoOverride[selectedEmp.id] == null}>
                      Lohnabrechnung abschliessen
                    </button>
                  )}
                </div>
                {!existingEntry && !selectedEmp.monatslohn && bruttoOverride[selectedEmp.id] == null && (
                  <div style={{ marginTop: 10, fontSize: 11, color: "var(--warning)" }}>Kein Monatslohn hinterlegt.</div>
                )}
              </div>
            ) : (
              <div className="card" style={{ color: "var(--text5)", textAlign: "center", padding: 40, fontSize: 13 }}>
                Mitarbeiter auswählen für Detailansicht
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
