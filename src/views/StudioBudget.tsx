// Studio-Budget: rechnet aus Personalkosten, Fixkosten und Annahmen den
// kostendeckenden Stundensatz und das Ziel-Honorar aus.
//
// Rechenweg (alles pro Jahr):
//   Personalkosten = Σ (Brutto inkl. 13. Lohn bei Bedarf) × (1 + AG-Zuschlag)
//   Fixkosten      = interne Ausgaben des Jahres (wiederkehrende hochgerechnet) + manuelle Posten
//   Gesamtkosten   = (Personal + Fix) × (1 + Reserve)
//   Selbstkosten/h = Gesamtkosten ÷ produktive Stunden (Jahresstunden × Produktivquote)
//   Ziel-Honorar/h = Selbstkosten ÷ (1 − Zielmarge)
// Jahresstunden pro Person = Wochenstunden × Pensum × (52 − Ferienwochen − 1.5).
// Jede Zeile lässt sich übersteuern (Checkbox «übersteuern»). Einnahmen kommen
// aus Rechnungen/Offerten des laufenden Jahres (je nach Schalter inkl. Entwürfe).
// Zusätzlich werden die IST-Stunden aus der Zeiterfassung ausgewertet
// (Produktivquote, nicht verrechenbare Wettbewerbs-Projekte).
//
// Speichern schreibt die Eingaben nach `settings.studioBudget`; «Als Version
// speichern» legt zusätzlich einen Schnappschuss mit den Ergebnissen in
// `settings.studioBudgetVersions` ab (auch Grundlage des PDFs).

import React, { useState } from "react";
import { arbeitszeitAm, generateId, formatCHF, lohnAGSaetze, lohnOptionen } from "../utils";
import { budgetEinnahmen, budgetFixkosten, jahresLohnkosten, mergeBudgetRows } from "../budget";
import { Header, ShareButton } from "../components/UI";
import type { Employee, StudioBudgetState, StudioBudgetVersion, ViewProps } from "../types";

type BudgetRow<K extends keyof StudioBudgetState> = StudioBudgetState[K] extends (infer R)[] ? R : never;

/** Kleines Inline-Override-Feld: Checkbox «übersteuern», dann Zahlenfeld statt des berechneten Werts. */
/** Parameter in [min, max] klammern; kein Zahlenwert (NaN/undefined) → Vorgabe. 0 bleibt gültig, soweit min es erlaubt. */
function clampParam(v: number | undefined, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function OverrideInput({ aktiv, checked, onToggle, value, onChange, autoVal, unit = "CHF", step = 100 }: {
  label?: string; aktiv: boolean; checked: boolean; onToggle: (checked: boolean) => void; value: number;
  onChange: (value: number) => void; autoVal: number; unit?: string; step?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: aktiv ? 1 : 0.4 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontSize: 11, color: "var(--text4)", whiteSpace: "nowrap", cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={e => onToggle(e.target.checked)} style={{ width: "auto" }} disabled={!aktiv} />
        übersteuern
      </label>
      {checked && aktiv ? (
        <input type="number" step={step} value={value} onChange={e => onChange(+e.target.value)}
          style={{ width: 110, height: 28, fontSize: 12, padding: "0 8px" }} />
      ) : (
        <span style={{ fontSize: 12, color: "var(--text3)" }}>{unit === "CHF" ? formatCHF(autoVal) : `${autoVal}h`}</span>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children?: React.ReactNode }) {
  return (
    <div className="section-label">{children}</div>
  );
}

export default
function StudioBudget({ data, update, setPrintContent, userPermissions = null }: Pick<ViewProps, "data" | "update" | "setView" | "setPrintContent"> & { userPermissions?: string[] | null }) {
  // Kosten je Person (≈ Lohn + AG-Beiträge) nur mit Recht «Löhne»; sonst nur die Summe (Runde 39)
  const canLohn = !userPermissions || userPermissions.includes("loehne");
  const maskSnap = <T extends { empSnapshot?: { kosten?: number | null }[] }>(v: T): T => canLohn ? v : { ...v, empSnapshot: (v.empSnapshot || []).map(e => ({ ...e, kosten: null })) };
  const employees = data.employees || [];
  const internalExpenses = data.internalExpenses || [];
  const currentYear = new Date().getFullYear();
  const saved = data.settings.studioBudget || {};

  // ── Hilfsfunktion: Auto-Werte für einen MA berechnen ──────────
  const agSaetze = lohnAGSaetze(data.settings);
  /** Lohnkosten und Jahresstunden einer Person — Kosten wie die Lohnläufe (budget.ts). */
  const calcEmpAuto = (emp: Employee) => {
    // Pensum zur Jahresmitte des Budgetjahrs (Pensumwechsel); Lohnkosten rechnen je Monat (calcLohn)
    const pensum = arbeitszeitAm(emp, `${currentYear}-07-01`).pensum / 100;
    const lk = jahresLohnkosten(emp, currentYear, agSaetze, lohnOptionen(data.settings));
    const ferienWochen = emp.ferienWochen || data.settings.defaultFerienWochen || 5;
    const wochenstunden = (emp.wochenstunden || data.settings.defaultWochenstunden || 35) * pensum;
    const nettoWochen = 52 - ferienWochen - 1.5;
    // Bei Ein-/Austritt im Jahr nur die Monate mit Lohn
    const jahresStunden = Math.round(wochenstunden * nettoWochen * (lk.monate / 12));
    return { brutto13: lk.brutto, agAnteil: lk.ag, totalKosten: lk.total, jahresStunden, pensumPct: Math.round(pensum * 100) };
  };

  const calcFixAuto = () => budgetFixkosten(internalExpenses, currentYear);

  const initState = (): StudioBudgetState => {
    const sv = saved;
    const agZuschlag = sv.agZuschlag ?? 20; // nicht mehr verwendet (AG-Beiträge wie Lohnlauf), nur mitgespeichert

    // Mitarbeiter-Zeilen
    const empRows = employees.map(emp => {
      const auto = calcEmpAuto(emp);
      const saved_emp = (sv.empRows || []).find(r => r.id === emp.id) || {} as Partial<BudgetRow<"empRows">>;
      return {
        id: emp.id,
        // Ausgetretene (active === false) standardmässig nicht im Budget
        aktiv: saved_emp.aktiv ?? emp.active !== false,
        kostenOverride: saved_emp.kostenOverride ?? false,
        kostenManual: saved_emp.kostenManual ?? auto.totalKosten,
        stundenOverride: saved_emp.stundenOverride ?? false,
        stundenManual: saved_emp.stundenManual ?? auto.jahresStunden,
      };
    });

    // Fixkosten-Zeilen (aus internen Ausgaben)
    const autoFix = calcFixAuto();
    const fixRows = autoFix.map(f => {
      const saved_fix = (sv.fixRows || []).find(r => r.id === f.id) || {} as Partial<BudgetRow<"fixRows">>;
      return {
        id: f.id,
        aktiv: saved_fix.aktiv ?? true,
        amountOverride: saved_fix.amountOverride ?? false,
        amountManual: saved_fix.amountManual ?? f.amount,
      };
    });

    // Zusätzliche manuelle Fixkostenposten
    const extraRows = (sv.extraRows || []);

    // Manuelle Einnahmen + Rechnungs-Toggles
    const extraIncome = sv.extraIncome || [];

    return {
      agZuschlag,
      empRows,
      fixRows,
      extraRows, // { id, label, amount, aktiv }
      extraIncome, // { id, label, amount, aktiv }
      inkludiereRechnungen: sv.inkludiereRechnungen ?? true,
      // Entwürfe sind noch nicht gestellt — wie in der Buchhaltung standardmässig nicht als Einnahme
      inkludiereEntwuerfe: sv.inkludiereEntwuerfe ?? false,
      inkludiereOfferten: sv.inkludiereOfferten ?? false,
      inkludiereOffertEntwuerfe: sv.inkludiereOffertEntwuerfe ?? false,
      reserve: sv.reserve ?? 10,
      produktivQuote: sv.produktivQuote ?? 70,
      zielMarge: sv.zielMarge ?? 25,
      rateOverride: sv.rateOverride ?? false,
      rateManual: sv.rateManual ?? (data.settings.defaultHourlyRate || 120),
    };
  };

  const [b, setB] = useState<StudioBudgetState>(initState);
  const [newExtra, setNewExtra] = useState({ label: "", amount: 0 });
  const [newIncome, setNewIncome] = useState({ label: "", amount: 0 });

  const setField = <K extends keyof StudioBudgetState>(k: K, v: StudioBudgetState[K]) => setB(prev => ({ ...prev, [k]: v }));

  const setEmpRow = (id: string, changes: Partial<BudgetRow<"empRows">>) => setB(prev => ({
    ...prev,
    empRows: prev.empRows.map(r => r.id === id ? { ...r, ...changes } : r),
  }));
  const setFixRow = (id: string, changes: Partial<BudgetRow<"fixRows">>) => setB(prev => ({
    ...prev,
    fixRows: prev.fixRows.map(r => r.id === id ? { ...r, ...changes } : r),
  }));
  const addExtra = () => {
    if (!newExtra.label.trim() || !newExtra.amount) return;
    setB(prev => ({ ...prev, extraRows: [...prev.extraRows, { id: generateId(), label: newExtra.label, amount: newExtra.amount, aktiv: true }] }));
    setNewExtra({ label: "", amount: 0 });
  };
  const setExtraRow = (id: string, changes: Partial<BudgetRow<"extraRows">>) => setB(prev => ({
    ...prev,
    extraRows: prev.extraRows.map(r => r.id === id ? { ...r, ...changes } : r),
  }));
  const delExtra = (id: string) => setB(prev => ({ ...prev, extraRows: prev.extraRows.filter(r => r.id !== id) }));

  const addIncome = () => {
    if (!newIncome.label.trim() || !newIncome.amount) return;
    setB(prev => ({ ...prev, extraIncome: [...(prev.extraIncome || []), { id: generateId(), label: newIncome.label, amount: newIncome.amount, aktiv: true }] }));
    setNewIncome({ label: "", amount: 0 });
  };
  const setIncomeRow = (id: string, changes: Partial<BudgetRow<"extraIncome">>) => setB(prev => ({
    ...prev,
    extraIncome: (prev.extraIncome || []).map(r => r.id === id ? { ...r, ...changes } : r),
  }));
  const delIncome = (id: string) => setB(prev => ({ ...prev, extraIncome: (prev.extraIncome || []).filter(r => r.id !== id) }));

  // ── Berechnungen ──────────────────────────────────────────────

  const autoFix = calcFixAuto();

  const empCalcRows = employees.map(emp => {
    const auto = calcEmpAuto(emp);
    const row = b.empRows.find(r => r.id === emp.id) || { aktiv: emp.active !== false, kostenOverride: false, kostenManual: 0, stundenOverride: false, stundenManual: 0 };
    const kosten = row.kostenOverride ? (row.kostenManual || 0) : auto.totalKosten;
    const stunden = row.stundenOverride ? (row.stundenManual || 0) : auto.jahresStunden;
    return { emp, auto, row, kosten, stunden, aktiv: row.aktiv };
  });

  const personalKosten = empCalcRows.filter(r => r.aktiv).reduce((s, r) => s + r.kosten, 0);
  // Anteil der AG-Beiträge auf den Bruttolöhnen (nur berechnete Zeilen, ohne übersteuerte)
  const autoRows = empCalcRows.filter(r => r.aktiv && !r.row.kostenOverride);
  const personalKostenBrutto = autoRows.reduce((s, r) => s + r.auto.brutto13, 0);
  const personalKostenAuto = autoRows.reduce((s, r) => s + r.auto.totalKosten, 0);
  const jahresStundenTotal = empCalcRows.filter(r => r.aktiv).reduce((s, r) => s + r.stunden, 0);
  const jahresStundenFallback = employees.length === 0 ? 1800 : jahresStundenTotal;

  const fixCalcRows = autoFix.map(f => {
    const row = b.fixRows.find(r => r.id === f.id) || { aktiv: true, amountOverride: false, amountManual: f.amount };
    const amount = row.amountOverride ? (row.amountManual || 0) : f.amount;
    return { ...f, row, amount, aktiv: row.aktiv };
  });
  const fixKosten = fixCalcRows.filter(r => r.aktiv).reduce((s, r) => s + r.amount, 0);
  const extraKosten = b.extraRows.filter(r => r.aktiv).reduce((s, r) => s + (r.amount || 0), 0);

  const basisKosten = personalKosten + fixKosten + extraKosten;
  // Parameter auf sinnvolle Bereiche klammern (auch für alte/importierte Werte), Anzeige und Rechnung nutzen dieselben Werte
  const reservePct = clampParam(b.reserve, 0, 80, 10);
  const quotePct = clampParam(b.produktivQuote, 10, 100, 70);
  const margePct = clampParam(b.zielMarge, 0, 50, 25);
  const reserve = basisKosten * (reservePct / 100);
  const gesamtKosten = basisKosten + reserve;

  const produktivStunden = Math.round(jahresStundenFallback * (quotePct / 100));
  const selbstkosten = produktivStunden > 0 ? gesamtKosten / produktivStunden : 0;
  const zielHonorar = selbstkosten > 0 ? selbstkosten / (1 - margePct / 100) : 0;

  const defaultRate = data.settings.defaultHourlyRate || 120;
  const currentRate = b.rateOverride ? (b.rateManual || defaultRate) : defaultRate;

  // ── Einnahmen ─────────────────────────────────────────────────
  // Einnahmen (budget.ts): Offerten abzüglich der daraus schon gestellten Rechnungen
  const ein = budgetEinnahmen(data, currentYear, { rechnungen: b.inkludiereRechnungen, rechnungsEntwuerfe: b.inkludiereEntwuerfe, offerten: b.inkludiereOfferten, offertEntwuerfe: b.inkludiereOffertEntwuerfe });
  const paidRevenue = ein.paid, sentRevenue = ein.sent, draftRevenue = ein.draft;
  const acceptedQuoteRevenue = ein.quotesAccepted, sentQuoteRevenue = ein.quotesSent, draftQuoteRevenue = ein.quotesDraft;
  const autoRevenue = ein.total;
  const manualIncomeTotal = (b.extraIncome || []).filter(r => r.aktiv).reduce((s, r) => s + (r.amount || 0), 0);
  const totalRevenue = autoRevenue + manualIncomeTotal;
  const ergebnis = totalRevenue - gesamtKosten;
  // Einnahmen laufen bis heute auf, die Kosten gelten fürs ganze Jahr: zum Vergleich anteilig bis heute
  const nowD = new Date();
  const yearFraction = nowD.getFullYear() === currentYear
    ? Math.min(1, (nowD.getTime() - new Date(currentYear, 0, 1).getTime()) / (new Date(currentYear + 1, 0, 1).getTime() - new Date(currentYear, 0, 1).getTime()))
    : 1;
  const kostenBisHeute = gesamtKosten * yearFraction;
  const ergebnisBisHeute = totalRevenue - kostenBisHeute;

  // ── IST-Daten aus Zeiterfassung ───────────────────────────────
  const NON_BILLING_CATEGORIES = ["Wettbewerb"];
  const projects = data.projects || [];
  const wbProjIds = new Set(projects.filter(p => NON_BILLING_CATEGORIES.includes(p.category as string)).map(p => p.id));
  const yearEntries = (data.timeEntries || []).filter(e => (e.date || "").startsWith(String(currentYear)));
  const totalTrackedMins = yearEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const billingMins = yearEntries.filter(e => e.projectId && !wbProjIds.has(e.projectId)).reduce((s, e) => s + (e.minutes || 0), 0);
  const wbTotalMins = yearEntries.filter(e => wbProjIds.has(e.projectId)).reduce((s, e) => s + (e.minutes || 0), 0);
  const noProjectMins = yearEntries.filter(e => !e.projectId).reduce((s, e) => s + (e.minutes || 0), 0);
  const istProduktivQuote = totalTrackedMins > 0 ? (billingMins / totalTrackedMins) * 100 : null;
  const wbProjects = projects.filter(p => NON_BILLING_CATEGORIES.includes(p.category as string));
  const wbRows = wbProjects.map(p => {
    const mins = yearEntries.filter(e => e.projectId === p.id).reduce((s, e) => s + (e.minutes || 0), 0);
    return { id: p.id, name: p.name, mins, hours: mins / 60, cost: (mins / 60) * selbstkosten };
  }).filter(r => r.mins > 0).sort((a, b) => b.mins - a.mins);
  const wbTotalHours = wbTotalMins / 60;
  const rateDiff = currentRate - zielHonorar;
  const rateOk = rateDiff >= 0;

  // ── Versionen ────────────────────────────────────────────────
  const versions = data.settings.studioBudgetVersions || [];
  const [showVersions, setShowVersions] = useState(false);
  const [saveName, setSaveName] = useState("");

  const buildSnapshot = (name: string): StudioBudgetVersion => ({
    id: generateId(),
    name: name || `Budget ${new Date().toLocaleDateString("de-CH")}`,
    savedAt: new Date().toISOString(),
    // Gleiche vollständige Feldliste wie saveVersion()/saveSettings() — sonst
    // stellt "Version laden" einen übersteuerten Stundenansatz nicht wieder her
    // (identischer Bug wie der in saveVersion() dokumentierte, hier nochmal).
    b: { agZuschlag: b.agZuschlag, empRows: b.empRows, fixRows: b.fixRows, extraRows: b.extraRows, extraIncome: b.extraIncome, inkludiereRechnungen: b.inkludiereRechnungen, inkludiereEntwuerfe: b.inkludiereEntwuerfe, inkludiereOfferten: b.inkludiereOfferten, inkludiereOffertEntwuerfe: b.inkludiereOffertEntwuerfe, reserve: reservePct, produktivQuote: quotePct, zielMarge: margePct, rateOverride: b.rateOverride, rateManual: b.rateManual },
    results: { personalKosten, fixKosten, extraKosten, basisKosten, reserve, gesamtKosten, totalRevenue, ergebnis, jahresStundenTotal: jahresStundenFallback, produktivStunden, selbstkosten, zielHonorar, currentRate },
    empSnapshot: empCalcRows.map(r => ({ name: r.emp.name, kosten: r.kosten, stunden: r.stunden, aktiv: r.aktiv })),
    fixSnapshot: [...fixCalcRows.filter(r => r.aktiv).map(r => ({ label: r.label, amount: r.amount })), ...b.extraRows.filter(r => r.aktiv).map(r => ({ label: r.label, amount: r.amount }))],
  });

  const saveVersion = () => {
    const name = saveName.trim() || `Budget ${new Date().toLocaleDateString("de-CH")}`;
    const snap = buildSnapshot(name);
    // Gleiche vollständige Feldliste wie saveSettings() — vorher fehlten hier
    // extraIncome + alle inkludiere*-Toggles + rateOverride/rateManual, was sie
    // beim nächsten Laden stillschweigend zurücksetzte.
    update("settings", { ...data.settings, studioBudgetVersions: [...versions, snap], studioBudget: {
      agZuschlag: b.agZuschlag, empRows: b.empRows, fixRows: b.fixRows, extraRows: b.extraRows, extraIncome: b.extraIncome,
      inkludiereRechnungen: b.inkludiereRechnungen, inkludiereEntwuerfe: b.inkludiereEntwuerfe,
      inkludiereOfferten: b.inkludiereOfferten, inkludiereOffertEntwuerfe: b.inkludiereOffertEntwuerfe,
      reserve: reservePct, produktivQuote: quotePct, zielMarge: margePct,
      rateOverride: b.rateOverride, rateManual: b.rateManual,
    } });
    setSaveName("");
  };

  const loadVersion = (v: StudioBudgetVersion) => {
    // Zeilen von Personen/Ausgaben, die nach dem Speichern der Version dazukamen, bleiben erhalten (mergeBudgetRows)
    setB(prev => ({ ...prev, ...v.b, empRows: mergeBudgetRows(prev.empRows, v.b.empRows), fixRows: mergeBudgetRows(prev.fixRows, v.b.fixRows), extraRows: v.b.extraRows ?? prev.extraRows, extraIncome: v.b.extraIncome ?? prev.extraIncome }));
    setShowVersions(false);
  };

  const deleteVersion = (id: string) => {
    update("settings", { ...data.settings, studioBudgetVersions: versions.filter(v => v.id !== id) });
  };

  const saveSettings = () => {
    update("settings", { ...data.settings, studioBudget: {
      agZuschlag: b.agZuschlag,
      empRows: b.empRows,
      fixRows: b.fixRows,
      extraRows: b.extraRows,
      extraIncome: b.extraIncome,
      inkludiereRechnungen: b.inkludiereRechnungen,
      inkludiereEntwuerfe: b.inkludiereEntwuerfe,
      inkludiereOfferten: b.inkludiereOfferten,
      inkludiereOffertEntwuerfe: b.inkludiereOffertEntwuerfe,
      reserve: reservePct,
      produktivQuote: quotePct,
      zielMarge: margePct,
      rateOverride: b.rateOverride,
      rateManual: b.rateManual,
    }});
  };

  return (
    <div>
      <Header title="Budget" action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={() => setShowVersions(v => !v)}>
            ⊞ Versionen {versions.length > 0 && <span style={{ marginLeft: 4, background: "var(--accent)", color: "var(--text)", borderRadius: 20, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>{versions.length}</span>}
          </button>
          <ShareButton options={[{ label: "PDF", onClick: () => setPrintContent({ type: "studioBudget", snapshot: maskSnap(buildSnapshot("Aktuell")), settings: data.settings }) }]} />
          <button className="btn btn-primary" onClick={saveSettings}>Speichern</button>
        </div>
      } />

      {/* Versions-Panel */}
      {showVersions && (
        <div className="card mark" style={{ marginBottom: 20, ["--mark" as string]: "var(--accent)" } as React.CSSProperties}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>VERSIONEN</div>

          {/* Neue Version speichern */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder={`z.B. Budget ${new Date().getFullYear()}, Szenario A…`}
              style={{ flex: 1, height: 34, fontSize: 12 }}
              onKeyDown={e => e.key === "Enter" && saveVersion()}
            />
            <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} onClick={saveVersion}>
              + Als Version speichern
            </button>
          </div>

          {versions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text4)" }}>Noch keine Versionen gespeichert.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 8px 8px 0", borderBottom: "1px solid var(--border)" }}>Name</th>
                  <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 8px 8px", borderBottom: "1px solid var(--border)" }}>Selbstkosten/h</th>
                  <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 8px 8px", borderBottom: "1px solid var(--border)" }}>Ziel-Honorar/h</th>
                  <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 8px 8px", borderBottom: "1px solid var(--border)" }}>Gesamtkosten</th>
                  <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 0 8px 8px", borderBottom: "1px solid var(--border)" }}>Gespeichert</th>
                  <th style={{ borderBottom: "1px solid var(--border)", width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {[...versions].reverse().map(v => (
                  <tr key={v.id}>
                    <td style={{ padding: "8px 8px 8px 0", fontWeight: 500, fontSize: 13, borderBottom: "1px solid var(--border2)" }}>{v.name}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontSize: 12, borderBottom: "1px solid var(--border2)" }}>{formatCHF(Math.round(v.results?.selbstkosten || 0))}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--accent)", borderBottom: "1px solid var(--border2)" }}>{formatCHF(Math.round(v.results?.zielHonorar || 0))}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontSize: 12, borderBottom: "1px solid var(--border2)" }}>{formatCHF(Math.round(v.results?.gesamtKosten || 0))}</td>
                    <td style={{ padding: "8px 0 8px 8px", textAlign: "right", fontSize: 11, color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
                      {new Date(v.savedAt).toLocaleDateString("de-CH")}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border2)" }}>
                      <ShareButton style={{ fontSize: 11, padding: "4px 8px", marginRight: 4 }}
                        options={[{ label: "PDF", onClick: () => setPrintContent({ type: "studioBudget", snapshot: maskSnap(v), settings: data.settings }) }]} />
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", marginRight: 4 }}
                        onClick={() => loadVersion(v)}>Laden</button>
                      <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen"
                        onClick={() => deleteVersion(v.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Kennzahlen als Band (wie Projekt-Arbeitsraum) ── */}
      <div className="ws-figs" style={{ marginBottom: 20 }}>
        <div><small>Selbstkostensatz</small><strong className="num">{formatCHF(Math.round(selbstkosten))}</strong><em>pro produktive Stunde</em></div>
        <div><small>Ziel-Honorar</small><strong className="num">{formatCHF(Math.round(zielHonorar))}</strong><em>inkl. {margePct} % Marge</em></div>
        <div><small>Gesamtkosten / Jahr</small><strong className="num">{formatCHF(gesamtKosten)}</strong><em>{produktivStunden} h produktiv von {jahresStundenFallback} h</em></div>
        {gesamtKosten <= 0 || produktivStunden <= 0 ? (
          // ohne Kosten oder ohne produktive Stunden gibt es kein Ziel-Honorar (sonst «CHF 120 über Ziel» bei Ziel 0)
          <div><small>Aktueller Ansatz</small><strong className="warn">noch offen</strong><em>{gesamtKosten > 0 ? "keine produktiven Stunden: Personen aktivieren oder Stunden übersteuern" : personalKosten <= 0 ? "Löhne bei den Mitarbeitenden erfassen oder unten übersteuern" : "keine Kosten erfasst"}</em></div>
        ) : (
          <div title={`Break-even bei ${Math.ceil(gesamtKosten / currentRate)} h zum aktuellen Ansatz`}>
            <small>Aktueller Ansatz</small>
            <strong className={`num${rateOk ? "" : " neg"}`}>{formatCHF(currentRate)}</strong>
            <em>{rateOk ? `${formatCHF(Math.round(rateDiff))} über Ziel` : `${formatCHF(Math.round(-rateDiff))} unter Ziel`}</em>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20, alignItems: "start" }}>

        {/* ── LINKE SPALTE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Personalkosten */}
          <div className="card">
            <SectionLabel>PERSONALKOSTEN / JAHR</SectionLabel>
            <div className="hint" style={{ fontSize: 12, color: "var(--text4)", marginBottom: 12 }}>
              Kosten wie in den Lohnabrechnungen: Bruttolohn inkl. 13. Monatslohn plus alle Arbeitgeberbeiträge
              (AHV/IV/EO, ALV, Pensionskasse, FAK, Verwaltungskosten, Berufsunfall, Krankentaggeld — Sätze unter Einstellungen → Studio).
              {personalKostenBrutto > 0 && <> Das sind {Math.round((personalKostenAuto / personalKostenBrutto - 1) * 1000) / 10} % auf den Bruttolöhnen.</>}
            </div>
            {employees.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text4)", padding: "8px 0" }}>Keine Mitarbeiter erfasst – unter «Mitarbeiter» Löhne hinterlegen.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px 4px 0", borderBottom: "1px solid var(--border)" }}>Mitarbeiter</th>
                    <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Kosten/Jahr</th>
                    <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 0 4px 6px", borderBottom: "1px solid var(--border)" }}>Jahresstunden</th>
                  </tr>
                </thead>
                <tbody>
                  {empCalcRows.map(({ emp, auto, row, aktiv }) => (
                    <tr key={emp.id} style={{ opacity: aktiv ? 1 : 0.45 }}>
                      <td style={{ padding: "8px 6px 8px 0", borderBottom: "1px solid var(--border2)", verticalAlign: "top" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                          <input type="checkbox" checked={aktiv} onChange={e => setEmpRow(emp.id, { aktiv: e.target.checked })} style={{ width: "auto" }} />
                          <div>
                            <div style={{ fontWeight: 500 }}>{emp.name}</div>
                            <div style={{ fontSize: 10, color: "var(--text4)" }}><span title="Pensum zur Jahresmitte (damit rechnen die Stunden)">{auto.pensumPct}%</span> · {emp.dreizehnterLohn ? "13. Monatslohn" : "12 Monatslöhne"}{(() => {
                              // Ein-/Austritt in diesem Jahr anzeigen (Kosten und Stunden sind dann anteilig)
                              const y = String(currentYear);
                              const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
                              const parts = [
                                emp.eintrittsdatum?.startsWith(y) ? `ab ${fmt(emp.eintrittsdatum)}` : "",
                                emp.austrittsdatum?.startsWith(y) ? `bis ${fmt(emp.austrittsdatum)}` : "",
                              ].filter(Boolean);
                              return parts.length ? ` · ${parts.join(" ")}` : "";
                            })()}</div>
                          </div>
                        </label>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border2)", verticalAlign: "top", textAlign: "right" }}>
                        {canLohn ? <OverrideInput aktiv={aktiv} checked={row.kostenOverride} onToggle={v => setEmpRow(emp.id, { kostenOverride: v })}
                          value={row.kostenManual} onChange={v => setEmpRow(emp.id, { kostenManual: v })} autoVal={auto.totalKosten} step={500} />
                          : <span style={{ fontSize: 12, color: "var(--text4)" }} title="Nur mit Recht «Löhne»">—</span>}
                      </td>
                      <td style={{ padding: "8px 0 8px 6px", borderBottom: "1px solid var(--border2)", verticalAlign: "top", textAlign: "right" }}>
                        <OverrideInput aktiv={aktiv} checked={row.stundenOverride} onToggle={v => setEmpRow(emp.id, { stundenOverride: v })}
                          value={row.stundenManual} onChange={v => setEmpRow(emp.id, { stundenManual: v })} autoVal={auto.jahresStunden} unit="h" step={10} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, paddingTop: 8, borderTop: "1.5px solid var(--border)" }}>
              <span>Total Personalkosten</span>
              <span style={{ fontFamily: "var(--font-ui)" }}>{formatCHF(personalKosten)}</span>
            </div>
          </div>

          {/* Fixkosten */}
          <div className="card">
            <SectionLabel>FIXKOSTEN / JAHR</SectionLabel>

            {fixCalcRows.length === 0 && b.extraRows.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 12 }}>
                Keine internen Ausgaben erfasst – unter «Interne Ausgaben» hinterlegen oder manuell unten hinzufügen.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px 4px 0", borderBottom: "1px solid var(--border)" }}>Posten</th>
                    <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>CHF/Jahr</th>
                  </tr>
                </thead>
                <tbody>
                  {fixCalcRows.map(f => (
                    <tr key={f.id} style={{ opacity: f.aktiv ? 1 : 0.45 }}>
                      <td style={{ padding: "7px 6px 7px 0", borderBottom: "1px solid var(--border2)", verticalAlign: "middle" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                          <input type="checkbox" checked={f.aktiv} onChange={e => setFixRow(f.id, { aktiv: e.target.checked })} style={{ width: "auto" }} />
                          <div>
                            <div style={{ fontWeight: 500 }}>{f.label}</div>
                            <div style={{ fontSize: 10, color: "var(--text4)" }}>{f.cat}</div>
                          </div>
                        </label>
                      </td>
                      <td style={{ padding: "7px 0 7px 6px", borderBottom: "1px solid var(--border2)", textAlign: "right" }}>
                        <OverrideInput aktiv={f.aktiv} checked={f.row.amountOverride} onToggle={v => setFixRow(f.id, { amountOverride: v })}
                          value={f.row.amountManual} onChange={v => setFixRow(f.id, { amountManual: v })} autoVal={f.amount} step={100} />
                      </td>
                    </tr>
                  ))}
                  {b.extraRows.map(r => (
                    <tr key={r.id} style={{ opacity: r.aktiv ? 1 : 0.45 }}>
                      <td style={{ padding: "7px 6px 7px 0", borderBottom: "1px solid var(--border2)" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                          <input type="checkbox" checked={r.aktiv} onChange={e => setExtraRow(r.id, { aktiv: e.target.checked })} style={{ width: "auto" }} />
                          <span style={{ fontWeight: 500, fontStyle: "italic", color: "var(--text3)" }}>{r.label}</span>
                        </label>
                      </td>
                      <td style={{ padding: "7px 0 7px 6px", borderBottom: "1px solid var(--border2)", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <input type="number" step="100" value={r.amount} onChange={e => setExtraRow(r.id, { amount: +e.target.value })}
                            style={{ width: 110, height: 28, fontSize: 12, padding: "0 8px" }} />
                          <button onClick={() => delExtra(r.id)} style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", fontSize: 14, padding: 0 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Neuen Posten hinzufügen */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
              <input value={newExtra.label} onChange={e => setNewExtra(p => ({ ...p, label: e.target.value }))}
                placeholder="Bezeichnung (z.B. Buchführung)" style={{ flex: 1, height: 32, fontSize: 12 }} />
              <input type="number" step="100" value={newExtra.amount || ""} onChange={e => setNewExtra(p => ({ ...p, amount: +e.target.value }))}
                placeholder="CHF/Jahr" style={{ width: 100, height: 32, fontSize: 12 }} />
              <button className="btn btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={addExtra}>+ Hinzufügen</button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, paddingTop: 8, borderTop: "1.5px solid var(--border)" }}>
              <span>Total Fixkosten</span>
              <span style={{ fontFamily: "var(--font-ui)" }}>{formatCHF(fixKosten + extraKosten)}</span>
            </div>
          </div>

          {/* Einnahmen */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <SectionLabel>EINNAHMEN / JAHR</SectionLabel>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text3)", cursor: "pointer", textTransform: "none" }}>
                <input type="checkbox" checked={b.inkludiereRechnungen} onChange={e => setField("inkludiereRechnungen", e.target.checked)} style={{ width: "auto" }} />
                Rechnungen aus Buchhaltung
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text3)", cursor: "pointer", textTransform: "none" }}>
                <input type="checkbox" checked={b.inkludiereOfferten} onChange={e => setField("inkludiereOfferten", e.target.checked)} style={{ width: "auto" }} />
                Offerten
              </label>
            </div>

            {b.inkludiereRechnungen && (
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 8 }}>AUS RECHNUNGEN {currentYear}</div>
                {[
                  { label: "Bezahlt", value: paidRevenue, color: "var(--positive)" },
                  { label: "Versendet / Überfällig", value: sentRevenue, color: "var(--accent)" },
                ].map(({ label, value, color }) => value > 0 && (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--text3)" }}>{label}</span>
                    <span style={{ fontWeight: 500, color }}>{formatCHF(value)}</span>
                  </div>
                ))}
                {draftRevenue > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border2)" }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textTransform: "none" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text3)" }}>
                        <input type="checkbox" checked={b.inkludiereEntwuerfe} onChange={e => setField("inkludiereEntwuerfe", e.target.checked)} style={{ width: "auto" }} />
                        Entwürfe einbeziehen
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: b.inkludiereEntwuerfe ? "var(--warning)" : "var(--text4)", fontStyle: b.inkludiereEntwuerfe ? "normal" : "italic" }}>
                        {b.inkludiereEntwuerfe ? formatCHF(draftRevenue) : "—"}
                        {b.inkludiereEntwuerfe && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 4 }}>erwartet</span>}
                      </span>
                    </label>
                  </div>
                )}
                {paidRevenue === 0 && sentRevenue === 0 && draftRevenue === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text4)" }}>Keine Rechnungen in {currentYear} gefunden.</div>
                )}
              </div>
            )}

            {b.inkludiereOfferten && (
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 8 }}>AUS OFFERTEN {currentYear}</div>
                {[
                  { label: "Angenommen", value: acceptedQuoteRevenue, color: "var(--positive)" },
                  { label: "Gesendet", value: sentQuoteRevenue, color: "var(--accent)" },
                ].map(({ label, value, color }) => value > 0 && (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--text3)" }}>{label}</span>
                    <span style={{ fontWeight: 500, color }}>{formatCHF(value)}</span>
                  </div>
                ))}
                {draftQuoteRevenue > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border2)" }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textTransform: "none" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text3)" }}>
                        <input type="checkbox" checked={b.inkludiereOffertEntwuerfe} onChange={e => setField("inkludiereOffertEntwuerfe", e.target.checked)} style={{ width: "auto" }} />
                        Entwürfe einbeziehen
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: b.inkludiereOffertEntwuerfe ? "var(--warning)" : "var(--text4)", fontStyle: b.inkludiereOffertEntwuerfe ? "normal" : "italic" }}>
                        {b.inkludiereOffertEntwuerfe ? formatCHF(draftQuoteRevenue) : "—"}
                        {b.inkludiereOffertEntwuerfe && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 4 }}>erwartet</span>}
                      </span>
                    </label>
                  </div>
                )}
                {acceptedQuoteRevenue === 0 && sentQuoteRevenue === 0 && draftQuoteRevenue === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text4)" }}>Keine Offerten in {currentYear} gefunden.</div>
                )}
              </div>
            )}

            {(b.extraIncome || []).length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                <tbody>
                  {(b.extraIncome || []).map(r => (
                    <tr key={r.id} style={{ opacity: r.aktiv ? 1 : 0.45 }}>
                      <td style={{ padding: "7px 6px 7px 0", borderBottom: "1px solid var(--border2)" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                          <input type="checkbox" checked={r.aktiv} onChange={e => setIncomeRow(r.id, { aktiv: e.target.checked })} style={{ width: "auto" }} />
                          <span style={{ fontWeight: 500, fontStyle: "italic", color: "var(--text3)" }}>{r.label}</span>
                        </label>
                      </td>
                      <td style={{ padding: "7px 0 7px 6px", borderBottom: "1px solid var(--border2)", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <input type="number" step="100" value={r.amount} onChange={e => setIncomeRow(r.id, { amount: +e.target.value })}
                            style={{ width: 110, height: 28, fontSize: 12, padding: "0 8px" }} />
                          <button onClick={() => delIncome(r.id)} style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", fontSize: 14, padding: 0 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
              <input value={newIncome.label} onChange={e => setNewIncome(p => ({ ...p, label: e.target.value }))}
                placeholder="z.B. Subvention, Förderung…" style={{ flex: 1, height: 32, fontSize: 12 }}
                onKeyDown={e => e.key === "Enter" && addIncome()} />
              <input type="number" step="100" value={newIncome.amount || ""} onChange={e => setNewIncome(p => ({ ...p, amount: +e.target.value }))}
                placeholder="CHF/Jahr" style={{ width: 100, height: 32, fontSize: 12 }} />
              <button className="btn btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={addIncome}>+ Hinzufügen</button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, paddingTop: 8, borderTop: "1.5px solid var(--border)" }}>
              <span>Total Einnahmen</span>
              <span style={{ fontFamily: "var(--font-ui)", color: "var(--positive)" }}>{formatCHF(totalRevenue)}</span>
            </div>
          </div>

          {/* Reserve & Stunden & Marge — kompakt in einer Zeile */}
          <div className="card">
            <SectionLabel>PARAMETER</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
              {[
                { label: "Reserve %", key: "reserve" as const, min: 0, max: 80, hint: "Puffer für Unvorhergesehenes" },
                { label: "Produktiv-Quote %", key: "produktivQuote" as const, min: 10, max: 100, hint: "Verrechenbare Stunden (60–75%)" },
                { label: "Ziel-Marge %", key: "zielMarge" as const, min: 0, max: 50, hint: "Aufschlag für Gewinn / Reinvestition" },
              ].map(({ label, key, min, max, hint }) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 5 }}>{label}</div>
                  <input type="number" step="1" min={min} max={max} value={b[key]}
                    onChange={e => setField(key, Math.min(max, Math.max(0, Number.isFinite(+e.target.value) ? +e.target.value : 0)))}
                    onBlur={e => setField(key, Math.min(max, Math.max(min, Number.isFinite(+e.target.value) ? +e.target.value : min)))}
                    style={{ width: "100%", height: 34, fontSize: 13, padding: "0 10px" }} />
                  <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>{hint}</div>
                </div>
              ))}
            </div>
            <div style={{ paddingTop: 12, borderTop: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Aktueller Stundensatz (Vergleichswert)</div>
              <OverrideInput
                label="übersteuern"
                aktiv={true}
                checked={b.rateOverride}
                onToggle={v => setField("rateOverride", v)}
                value={b.rateManual}
                onChange={v => setField("rateManual", v)}
                autoVal={defaultRate}
                unit="CHF"
                step={5}
              />
              <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>Standard aus Einstellungen: {formatCHF(defaultRate)}/h</div>
            </div>
          </div>

        </div>

        {/* ── RECHTE SPALTE: Ergebnis ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Kostenstruktur */}
          <div className="card">
            <div className="today-k">Kostenstruktur / Jahr</div>
            <div className="acc-lines">
              <div><span>Personalkosten</span><b className="num">{formatCHF(personalKosten)}</b></div>
              <div><span>Fixkosten</span><b className="num">{formatCHF(fixKosten + extraKosten)}</b></div>
              <div><span>Basiskosten</span><b className="num">{formatCHF(basisKosten)}</b></div>
              <div className="sub"><span>dazu Reserve <i>{reservePct} %</i></span><b className="num">{formatCHF(reserve)}</b></div>
              <div className="total"><span>Gesamtkosten</span><b className="num">{formatCHF(gesamtKosten)}</b></div>
            </div>
            {totalRevenue > 0 && (
              <div className="acc-lines acc-mwst">
                <div><span>Einnahmen
                  {b.inkludiereEntwuerfe && draftRevenue > 0 && b.inkludiereRechnungen && <i>inkl. {formatCHF(draftRevenue)} erwartet (Rechnungen)</i>}
                  {b.inkludiereOffertEntwuerfe && draftQuoteRevenue > 0 && b.inkludiereOfferten && <i>inkl. {formatCHF(draftQuoteRevenue)} erwartet (Offerten)</i>}
                </span><b className="num">{formatCHF(totalRevenue)}</b></div>
                {yearFraction < 1 ? <>
                  <div><span>Kosten bis heute <i>{Math.round(yearFraction * 100)} % des Jahres</i></span><b className="num">− {formatCHF(kostenBisHeute)}</b></div>
                  <div className="total"><span>Ergebnis bis heute</span><b className={`num${ergebnisBisHeute < 0 ? " neg" : ""}`}>{ergebnisBisHeute < 0 ? `− ${formatCHF(-ergebnisBisHeute)}` : formatCHF(ergebnisBisHeute)}</b></div>
                  <div className="sub"><span>mit vollen Jahreskosten</span><b className="num">{ergebnis < 0 ? `− ${formatCHF(-ergebnis)}` : formatCHF(ergebnis)}</b></div>
                </> : <>
                  <div><span>Gesamtkosten</span><b className="num">− {formatCHF(gesamtKosten)}</b></div>
                  <div className="total"><span>Ergebnis</span><b className={`num${ergebnis < 0 ? " neg" : ""}`}>{ergebnis < 0 ? `− ${formatCHF(-ergebnis)}` : formatCHF(ergebnis)}</b></div>
                </>}
              </div>
            )}
          </div>

          {/* Stunden — Soll + Ist zusammen */}
          <div className="card">
            <SectionLabel>STUNDEN</SectionLabel>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border2)", fontSize: 12 }}>
              <span style={{ color: "var(--text2)" }}>Verfügbar</span>
              <span>{jahresStundenFallback}h {employees.length === 0 && <span style={{ color: "var(--text4)", fontSize: 10 }}>Fallback</span>}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border2)", fontSize: 12 }}>
              <span style={{ color: "var(--text2)" }}>Produktiv ({quotePct}%)</span>
              <span style={{ fontWeight: 600 }}>{produktivStunden}h</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${quotePct}%`, height: "100%", background: quotePct >= 80 ? "var(--negative)" : quotePct >= 70 ? "var(--warning)" : "var(--positive)", borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>Über 75% ist anspruchsvoll</div>
            </div>

            {totalTrackedMins > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>IST {currentYear}</div>
                {[
                  { label: "Verrechenbar", mins: billingMins, color: "var(--positive)" },
                  { label: "Wettbewerbe", mins: wbTotalMins, color: "var(--warning)" },
                  { label: "Ohne Projekt", mins: noProjectMins, color: "var(--text5)" },
                ].map(({ label, mins, color }) => {
                  if (mins === 0) return null;
                  const pct = (mins / totalTrackedMins) * 100;
                  return (
                    <div key={label} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: "var(--text2)" }}>{label}</span>
                        <span>{Math.round(mins / 60)}h <span style={{ color: "var(--text4)" }}>({Math.round(pct)}%)</span></span>
                      </div>
                      <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingTop: 6, borderTop: "1px solid var(--border2)", marginTop: 2 }}>
                  <span style={{ color: "var(--text2)" }}>Total erfasst</span>
                  <span style={{ fontWeight: 600 }}>{Math.round(totalTrackedMins / 60)}h</span>
                </div>
                {istProduktivQuote !== null && (
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 11, padding: "6px 10px", borderRadius: 5, background: "var(--surface2)" }}>
                    <span style={{ color: "var(--text3)" }}>Ist-Produktivquote</span>
                    <span>
                      <strong style={{ color: Math.abs(istProduktivQuote - quotePct) > 10 ? "var(--warning)" : "var(--text)" }}>{Math.round(istProduktivQuote)}%</strong>
                      <span style={{ color: "var(--text4)", marginLeft: 5 }}>Soll: {quotePct}%</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Wettbewerbe – Interner Aufwand */}
          {wbProjects.length > 0 && (
            <div className="card">
              <SectionLabel>WETTBEWERBE — INTERNER AUFWAND</SectionLabel>
              {wbRows.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text4)" }}>Keine Wettbewerb-Stunden in {currentYear} erfasst.</div>
              ) : (
                <>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px 6px 0", borderBottom: "1px solid var(--border)" }}>Projekt</th>
                        <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 6px 6px", borderBottom: "1px solid var(--border)" }}>Std.</th>
                        <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 0 6px", borderBottom: "1px solid var(--border)" }}>Interner Aufwand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wbRows.map(r => (
                        <tr key={r.id}>
                          <td style={{ padding: "6px 6px 6px 0", borderBottom: "1px solid var(--border2)", fontSize: 12 }}>{r.name}</td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid var(--border2)", textAlign: "right", fontSize: 12 }}>{Math.round(r.hours * 10) / 10}h</td>
                          <td style={{ padding: "6px 0", borderBottom: "1px solid var(--border2)", textAlign: "right", fontSize: 12 }}>{selbstkosten > 0 ? formatCHF(Math.round(r.cost)) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ padding: "7px 6px 2px 0", fontWeight: 600, fontSize: 12 }}>Total</td>
                        <td style={{ padding: "7px 6px 2px", textAlign: "right", fontWeight: 600, fontSize: 12 }}>{Math.round(wbTotalHours * 10) / 10}h</td>
                        <td style={{ padding: "7px 0 2px", textAlign: "right", fontWeight: 600, fontSize: 12 }}>{selbstkosten > 0 ? formatCHF(Math.round(wbTotalHours * selbstkosten)) : "—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {selbstkosten > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text4)", paddingTop: 8, borderTop: "1px solid var(--border2)" }}>
                      Entgangenes Honorar: {Math.round(wbTotalHours)}h × {formatCHF(currentRate)}/h = <strong style={{ color: "var(--text3)" }}>{formatCHF(Math.round(wbTotalHours * currentRate))}</strong>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Rollenvergleich */}
          {(data.settings.roles || []).length > 0 && selbstkosten > 0 && (
            <div className="card">
              <SectionLabel>ROLLEN-VERGLEICH</SectionLabel>
              {(data.settings.roles || []).map(role => {
                const diff = role.rate - zielHonorar;
                const ok = diff >= 0;
                return (
                  <div key={role.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border2)" }}>
                    <div>
                      <span style={{ fontSize: 12 }}>{role.label}</span>
                      <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 6 }}>{formatCHF(role.rate)}/h</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ok ? "var(--positive)" : "var(--negative)" }}>
                      {ok ? "+ " : "− "}{formatCHF(Math.abs(Math.round(diff)))}
                    </span>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 8 }}>Differenz zum Ziel-Honorar von {formatCHF(Math.round(zielHonorar))}/h</div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
