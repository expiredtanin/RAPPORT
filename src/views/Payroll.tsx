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
// Spesen: `spesenFuerLohn` (accounting.ts) — Spesen des Monats ohne `lohnEntryId`, die nicht schon
// «ausbezahlt» sind, plus ältere mit «auf nächsten Lohn»; sie werden mit ausbezahlt und auf
// «ausbezahlt» gesetzt. ALV/NBU: Höchstlohn kumuliert über die früheren Abrechnungen des Jahres
// (`lohnVorperioden`); Eintritt im Monat anteilig (calcLohn). «Stornieren» löscht die Abrechnung,
// gibt die Spesen wieder frei («auf nächsten Lohn») und stellt die Overrides wieder her.
// Fachliche Details der Abzüge: utils.ts `calcLohn`, docs/FACHLOGIK.md.

import React, { useState } from "react";
import { generateId, formatCHF, calcLohn, lohnAGSaetze, pensumImMonat, monatslohnImMonat } from "../utils";
import { lohnAGBeitraege, lohnPersonalaufwand, lohnVorperioden, spesenFuerLohn, spesenWartend } from "../accounting";
import { Header, NavArrows, ShareButton, EmptyState } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Employee, LohnEntry, LohnResult, SaetzeSnapshot, ViewProps } from "../types";

export default
function Payroll({ data, saveAll, setPrintContent, setView }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent" | "setView">) {
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
    // Nicht nach dem Austrittsmonat
    if (emp.austrittsdatum && emp.austrittsdatum.slice(0, 7) < monatStr) return false;
    return true;
  };

  // Stammlohn des Monats (Lohnänderung im Monat: am letzten angestellten Tag; die Abrechnung rechnet tagesgenau)
  const stammLohn = (emp: Employee) => monatslohnImMonat(emp, monatStr);
  const getEffBrutto = (emp: Employee) => bruttoOverride[emp.id] != null ? bruttoOverride[emp.id] : stammLohn(emp);
  // Ohne Übersteuerung das Pensum des Monats (bei einem Pensumwechsel tagesgenau gewichtet, s. pensumImMonat)
  const monthPensum = (emp: Employee) => Math.round(pensumImMonat(emp, monatStr) * 100) / 100;
  const getEffPensum = (emp: Employee) => pensumOverride[emp.id] != null ? pensumOverride[emp.id] : monthPensum(emp);

  const offeneSpesen = (empId: string) => spesenFuerLohn(data.expenses || [], empId, monatStr);
  // Überstunden-Auszahlungen (Personal → Jahresabschluss) dieses oder des Vormonats, noch in keiner Lohnabrechnung:
  // gehören als massgebender Lohn in den Lohnlauf (AHV/ALV/UVG/QST), vorher liefen sie daran vorbei
  const prevMonat = (() => { const [y, m] = monatStr.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  const ueberstundenVerrechnet = new Set(lohnEntries.flatMap(l => l.ueberstundenIds || []));
  const offeneUeberstunden = (empId: string) => (data.uberstundenAbschluss || []).filter(a =>
    a.empId === empId && a.type === "payout" && (a.auszahlungBetrag || 0) > 0 && !ueberstundenVerrechnet.has(a.id)
    && (a.date || "").slice(0, 7) <= monatStr && (a.date || "").slice(0, 7) >= prevMonat);
  const ueberstundenSumme = (empId: string) => offeneUeberstunden(empId).reduce((t, a) => t + (a.auszahlungBetrag || 0), 0);
  const findEntry = (empId: string) => lohnEntries.find(l => l.monat === monatStr && l.employeeId === empId);
  /** Vorschau/Abschluss mit den Overrides dieses Laufs und den früheren Abrechnungen des Jahres. */
  const calcFor = (emp: Employee, spesen: { amount?: number }[]) =>
    calcLohn({ ...emp, ...(bruttoOverride[emp.id] != null ? { monatslohn: bruttoOverride[emp.id], lohnVerlauf: undefined } : {}), ...(pensumOverride[emp.id] != null ? { pensum: pensumOverride[emp.id], pensumVerlauf: undefined } : {}) }, monatStr, spesen, (bonusOverride[emp.id] as number) || 0, lohnVorperioden(lohnEntries, emp.id, monatStr), lohnAGSaetze(data.settings), ueberstundenSumme(emp.id));

  const abschliessen = (emp: Employee) => {
    if (findEntry(emp.id)) return;
    const spesen = offeneSpesen(emp.id);
    const effPensum = getEffPensum(emp);
    const calc = calcFor(emp, spesen);
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
      austrittsdatum: emp.austrittsdatum || "",
      pkBeitragAN: emp.pkBeitragAN ?? null,
      pkBeitragAG: emp.pkBeitragAG ?? null,
      ahvRentner: !!emp.ahvRentner,
      agSaetze: lohnAGSaetze(data.settings),
    };
    const entry: LohnEntry = {
      id: generateId(), monat: monatStr, employeeId: emp.id,
      empSnapshot: { name: emp.name, role: emp.role, adresse: emp.adresse, ort: emp.ort, ahvNr: emp.ahvNr, personalNr: emp.personalNr, lohnIban: emp.lohnIban },
      saetzeSnapshot,
      bruttoWasOverridden: bruttoOverride[emp.id] != null,
      bonusBeschrieb: (bonusOverride[`${emp.id}_beschrieb`] as string) || "",
      ...calc, spesenIds: spesen.map(s => s.id), ueberstundenIds: offeneUeberstunden(emp.id).map(a => a.id),
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

  const monatEntries = lohnEntries.filter(l => l.monat === monatStr);
  // Mit Monatslohn; ausgetretene (active === false) nur, wenn für den Monat schon abgerechnet
  const payrollEmployees = employees.filter(e => ((e.monatslohn || 0) > 0 || (e.lohnVerlauf || []).length > 0) && (e.active !== false || !!findEntry(e.id)));
  // Ohne Auswahl zeigt die Detailspalte die erste Person, die abgerechnet werden kann
  const effEmpId = selEmpId || payrollEmployees.find(isMonatAvailable)?.id || "";
  const selectedEmp = employees.find(e => e.id === effEmpId);
  const previewSpesen = effEmpId ? offeneSpesen(effEmpId) : [];
  const previewCalc = selectedEmp ? calcFor(selectedEmp, previewSpesen) : null;
  const existingEntry = effEmpId ? findEntry(effEmpId) : null;
  // Monatssummen (abgeschlossen oder Vorschau) für das Kennzahlen-Band
  const monthRows = payrollEmployees.filter(isMonatAvailable).map(emp => {
    const entry = findEntry(emp.id);
    return { entry, calc: entry ? entry : calcFor(emp, offeneSpesen(emp.id)) };
  });
  const monthSum = monthRows.reduce((t, r) => ({ brutto: t.brutto + r.calc.bruttoTotal, aus: t.aus + r.calc.auszahlung, aufwand: t.aufwand + lohnPersonalaufwand(r.calc), done: t.done + (r.entry ? 1 : 0) }), { brutto: 0, aus: 0, aufwand: 0, done: 0 });
  const cardPensum = existingEntry ? (existingEntry.saetzeSnapshot?.pensum ?? 100) : (selectedEmp ? getEffPensum(selectedEmp) : 100);

  const LohnRow = ({ label, value, bold, color, indent }: { label: string; value: number; bold?: boolean; color?: string; indent?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: indent ? 11 : 12, color: color || (indent ? "var(--text4)" : "var(--text2)"), paddingLeft: indent ? 12 : 0 }}>
      <span>{label}</span><span className="num" style={{ fontWeight: bold ? 700 : 400 }}>{value < 0 ? `− ${formatCHF(-value)}` : formatCHF(value)}</span>
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
              style={{ flex: 1, height: 32, fontSize: 13, textAlign: "right", border: bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== stammLohn(emp) ? "1.5px solid var(--warning)" : "1px solid var(--border3)" }} />
            <span style={{ fontSize: 11, color: "var(--text4)" }}>CHF</span>
            {bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== stammLohn(emp) && (
              <button onClick={() => setBruttoOverride(o => { const n={...o}; delete n[emp.id]; return n; })}
                title="Stammdaten-Wert wiederherstellen"
                style={{ fontSize: 11, color: "var(--text4)", background: "none", border: "1px solid var(--border3)", borderRadius: 20, cursor: "pointer", padding: "2px 8px" }}>↺ Reset</button>
            )}
          </div>
          {bruttoOverride[emp.id] != null && bruttoOverride[emp.id] !== stammLohn(emp) && (
            <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 4 }}>Abweichend von Stammdaten ({formatCHF(stammLohn(emp))})</div>
          )}
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", margin: "10px 0 6px", paddingTop: 8, borderTop: "1px solid var(--border)" }}>PENSUM DIESEN MONAT</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <input type="number" min={10} max={100} step={5}
              value={getEffPensum(emp)}
              onChange={e => setPensumOverride(o => ({ ...o, [emp.id]: +e.target.value }))}
              style={{ width: 72, height: 32, fontSize: 13, textAlign: "right", border: pensumOverride[emp.id] != null && pensumOverride[emp.id] !== monthPensum(emp) ? "1.5px solid var(--warning)" : "1px solid var(--border3)" }} />
            <span style={{ fontSize: 11, color: "var(--text4)" }}>%</span>
            {pensumOverride[emp.id] != null && pensumOverride[emp.id] !== monthPensum(emp) && (
              <button onClick={() => setPensumOverride(o => { const n={...o}; delete n[emp.id]; return n; })}
                title="Stammdaten-Wert wiederherstellen"
                style={{ fontSize: 11, color: "var(--text4)", background: "none", border: "1px solid var(--border3)", borderRadius: 20, cursor: "pointer", padding: "2px 8px" }}>↺ Reset</button>
            )}
          </div>
          {pensumOverride[emp.id] != null && pensumOverride[emp.id] !== monthPensum(emp) && (
            <div style={{ fontSize: 10, color: "var(--warning)", marginBottom: 4 }}>Abweichend von Stammdaten ({monthPensum(emp)}%)</div>
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
              placeholder="z. B. Bonus"
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
      {calc.hinweise && calc.hinweise.length > 0 && (
        <div className="lohn-hinweise">
          {calc.hinweise.map(h => <div key={h}>{h}</div>)}
        </div>
      )}
      {calc.dreizehnter > 0 && <LohnRow label="13. Monatslohn (1/12)" value={calc.dreizehnter} indent />}
      {(calc.ueberstundenBetrag || 0) > 0 && <LohnRow label="Überstunden-Auszahlung (Jahresabschluss)" value={calc.ueberstundenBetrag || 0} indent />}
      {calc.bonusBetrag > 0 && <LohnRow label={emp.saetzeSnapshot ? (calc.bonusBeschrieb || "Einmalzahlung / Bonus") : ((bonusOverride[`${emp.id}_beschrieb`] as string) || "Einmalzahlung / Bonus")} value={calc.bonusBetrag} indent />}
      <LohnRow label="Bruttolohn Total" value={calc.bruttoTotal} bold />
      <div style={{ marginTop: 10, marginBottom: 4, fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>ABZÜGE ARBEITNEHMER</div>
      {(() => {
        const s = emp.saetzeSnapshot || emp; // abgeschlossen: snapshot, preview: live emp
        return <>
          <LohnRow label={`AHV/IV/EO (${s.ahvSatz ?? 5.3}%${calc.ahvBasis != null && calc.ahvBasis !== calc.bruttoTotal ? ` von ${formatCHF(calc.ahvBasis)}` : ""})`} value={-calc.ahv} indent />
          <LohnRow label={`ALV (${s.alvSatz ?? 1.1}%)`} value={-calc.alv} indent />
          <LohnRow label={(s.pkBeitragAN ?? 0) > 0 ? "BVG/PK (laut PK-Ausweis)" : `BVG/PK (${s.bvgSatz ?? 8.0}%)`} value={-calc.bvg} indent />
          <LohnRow label={`NBU (${s.nbuSatz ?? 1.5}%)`} value={-calc.nbu} indent />
          <LohnRow label={`KTG (${s.ktgSatz ?? 0.5}%)`} value={-calc.ktg} indent />
          {calc.qst > 0 && <LohnRow label={`Quellensteuer (${s.quellensteuerSatz ?? 10}%)`} value={-calc.qst} indent />}
        </>;
      })()}
      <div style={{ borderTop: "1.5px solid var(--text)", marginTop: 8, paddingTop: 8 }}>
        <LohnRow label="Nettolohn" value={calc.netto} bold />
      </div>
      {(calc.familienzulagen || 0) > 0 && <LohnRow label="Familienzulagen (nicht AHV-pflichtig)" value={calc.familienzulagen || 0} indent />}
      {calc.spesenTotal > 0 && <>
        <div style={{ marginTop: 10, marginBottom: 4, fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)" }}>SPESENERSTATTUNG</div>
        <LohnRow label="Spesen" value={calc.spesenTotal} indent />
      </>}
      <div style={{ borderTop: "1.5px solid var(--text)", marginTop: 8, paddingTop: 8 }}>
        <LohnRow label="Auszahlung Total" value={calc.auszahlung} bold color="var(--positive)" />
      </div>
      {calc.bruttoTotal > 0 && (() => {
        const s = emp.saetzeSnapshot || emp;
        const ag = lohnAGBeitraege(calc);
        return (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed #c8c0b8" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 4 }}>LOHNKOSTEN ARBEITGEBER</div>
            <LohnRow label={`AHV/IV/EO AG-Anteil (${s.ahvSatz ?? 5.3}%)`} value={ag.ahvAG} indent />
            <LohnRow label={`ALV AG-Anteil (${s.alvSatz ?? 1.1}%)`} value={ag.alvAG} indent />
            {ag.bvgAG > 0 && <LohnRow label={(s.pkBeitragAG ?? 0) > 0 ? "PK / BVG AG-Anteil (laut PK-Ausweis)" : `PK / BVG AG-Anteil (${s.pkAGSatz ?? 8.0}%)`} value={ag.bvgAG} indent />}
            {(calc.agFak || 0) > 0 && <LohnRow label="Familienausgleichskasse (FAK)" value={calc.agFak || 0} indent />}
            {(calc.agVk || 0) > 0 && <LohnRow label="Verwaltungskosten Ausgleichskasse" value={calc.agVk || 0} indent />}
            {(calc.agBu || 0) > 0 && <LohnRow label="Berufsunfall (UVG-BU)" value={calc.agBu || 0} indent />}
            {(calc.agKtg || 0) > 0 && <LohnRow label="Krankentaggeld AG-Anteil" value={calc.agKtg || 0} indent />}
            <LohnRow label="Lohnkosten total" value={lohnPersonalaufwand(calc)} bold />
          </div>
        );
      })()}
    </div>
  );

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Löhne" action={
        <div className="month-nav">
          <NavArrows onPrev={goPrev} onNext={goNext} disabledNext={isAtFuture} />
          <span>{months[selMonth]} {selYear}</span>
        </div>
      } />
      {employees.length === 0 || payrollEmployees.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="payments" title={employees.length === 0 ? "Noch keine Mitarbeitenden" : "Noch kein Monatslohn hinterlegt"}
            text="Löhne rechnen sich aus Monatslohn, Pensum und Sozialversicherungssätzen am Mitarbeitenden. Erfasse diese unter Mitarbeiter → Lohn."
            action={setView ? <button className="btn btn-primary" onClick={() => setView("mitarbeiter")}>Zu den Mitarbeitenden</button> : undefined} />
        </div>
      ) : (<>
        <div className="ws-figs" style={{ marginBottom: 20 }}>
          <div><small>Brutto {months[selMonth]}</small><strong className="num">{formatCHF(monthSum.brutto)}</strong><em>{monthRows.length} {monthRows.length === 1 ? "Person" : "Personen"}</em></div>
          <div><small>Auszahlung</small><strong className="num">{formatCHF(monthSum.aus)}</strong><em>netto inkl. Spesen</em></div>
          <div><small>Personalaufwand</small><strong className="num">{formatCHF(monthSum.aufwand)}</strong><em>Brutto + AG-Beiträge</em></div>
          <div><small>Abgeschlossen</small><strong className={`num${monthSum.done < monthRows.length ? " warn" : ""}`}>{monthSum.done} / {monthRows.length}</strong><em>{monthSum.done < monthRows.length ? "noch offen" : "alle abgerechnet"}</em></div>
        </div>
        <div className="acc-grid">
          <div>
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead><tr>
                  <th>Name</th>
                  <th style={{ textAlign: "right" }}>Brutto</th>
                  <th className="hide-mid" style={{ textAlign: "right" }}>Netto</th>
                  <th className="hide-mid" style={{ textAlign: "right", whiteSpace: "normal", width: 70 }} title="Familienzulagen und Spesen (Auszahlung = Netto + Zulagen + Spesen)">Zulagen/ Spesen</th>
                  <th style={{ textAlign: "right" }}>Auszahlung</th>
                  <th>Status</th>
                </tr></thead>
                <tbody>
                  {payrollEmployees.map(emp => {
                    const available = isMonatAvailable(emp);
                    const entry = findEntry(emp.id);
                    const spesen = entry ? (data.expenses || []).filter(e => e.lohnEntryId === entry.id) : offeneSpesen(emp.id);
                    const calc = entry ? entry : calcFor(emp, spesen);
                    const zuSp = (calc.familienzulagen || 0) + (calc.spesenTotal || 0);
                    return (
                      <tr key={emp.id} className={available ? "row-link" : ""} onClick={() => available && setSelEmpId(emp.id)}
                        style={{ background: effEmpId === emp.id ? "var(--surface2)" : "", opacity: available ? 1 : 0.4 }}>
                        <td>
                          <strong>{emp.name}</strong>
                          {emp.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{emp.role}</div>}
                          {!available && <div style={{ fontSize: 10, color: "var(--text5)" }}>vor Eintritt</div>}
                        </td>
                        <td style={{ textAlign: "right" }}>{available ? formatCHF(calc.bruttoTotal) : "—"}</td>
                        <td className="hide-mid" style={{ textAlign: "right" }}>{available ? formatCHF(calc.netto) : "—"}</td>
                        <td className="hide-mid" style={{ textAlign: "right", color: zuSp > 0 ? "var(--warning)" : "var(--text5)" }}>{available && zuSp > 0 ? formatCHF(zuSp) : "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{available ? formatCHF(calc.auszahlung) : "—"}</td>
                        <td style={{ whiteSpace: "nowrap", paddingRight: 14 }}>{available && (entry
                          ? <><span className="today-pill ok">abgeschlossen</span>
                              <button className="btn-icon" title="Abrechnung stornieren" aria-label="Stornieren" style={{ marginLeft: 4, verticalAlign: "middle" }} onClick={e => { e.stopPropagation(); stornieren(entry.id); }}><span className="msr" style={{ fontSize: 16 }}>undo</span></button></>
                          : <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); abschliessen(emp); }}>Abschliessen</button>
                        )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {monatEntries.length > 0 && (() => {
                  const t = monatEntries.reduce((s,l) => ({ b:s.b+l.bruttoTotal, n:s.n+l.netto, sp:s.sp+(l.familienzulagen||0)+l.spesenTotal, a:s.a+l.auszahlung }), {b:0,n:0,sp:0,a:0});
                  return (
                    <tfoot>
                      <tr style={{ borderTop: "1.5px solid var(--text)", fontWeight: 600 }}>
                        <td title={monatEntries.length < monthRows.length ? "Nur abgeschlossene Abrechnungen" : undefined}>{monatEntries.length < monthRows.length ? "Total abgeschlossen" : "Total"}</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.b)}</td>
                        <td className="hide-mid" style={{ textAlign: "right" }}>{formatCHF(t.n)}</td>
                        <td className="hide-mid" style={{ textAlign: "right" }}>{formatCHF(t.sp)}</td>
                        <td style={{ textAlign: "right" }}>{formatCHF(t.a)}</td>
                        <td></td>
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
                <div className="today-k">Lohnabrechnung</div>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 2 }}>{selectedEmp.name}</div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 16 }}>{[selectedEmp.role, `${months[selMonth]} ${selYear}`, cardPensum < 100 ? `${cardPensum}%` : null].filter(Boolean).join(" · ")}</div>
                {existingEntry
                  ? renderCalc(existingEntry, { ...selectedEmp, ...existingEntry.empSnapshot, saetzeSnapshot: existingEntry.saetzeSnapshot } as Employee & { saetzeSnapshot?: SaetzeSnapshot }, false, existingEntry.saetzeSnapshot?.pensum ?? 100)
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
                {!existingEntry && (() => {
                  const w = spesenWartend(data.expenses || [], selectedEmp.id, monatStr);
                  return w.length > 0 ? (
                    <div className="lohn-hinweise" style={{ marginTop: 12 }}>
                      {w.length} {w.length === 1 ? "Spese wartet" : "Spesen warten"} auf Genehmigung ({formatCHF(w.reduce((a, e) => a + (e.amount || 0), 0))}) und {w.length === 1 ? "geht" : "gehen"} erst nach der Genehmigung mit dem Lohn.
                      {setView && <button className="btn btn-quiet btn-sm" style={{ marginLeft: 6 }} onClick={() => setView("expenses")}>Zu den Spesen</button>}
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
                      disabled={!stammLohn(selectedEmp) && bruttoOverride[selectedEmp.id] == null}>
                      Lohnabrechnung abschliessen
                    </button>
                  )}
                </div>
                {!existingEntry && !stammLohn(selectedEmp) && bruttoOverride[selectedEmp.id] == null && (
                  <div style={{ marginTop: 10, fontSize: 11, color: "var(--warning)" }}>Kein Monatslohn hinterlegt.</div>
                )}
              </div>
            ) : (
              <div className="card today-meta" style={{ textAlign: "center", padding: 32 }}>
                Für diesen Monat ist niemand abzurechnen.
              </div>
            )}
          </div>
        </div>
      </>)}
    </div>
  );
}
