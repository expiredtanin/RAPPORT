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
import { generateId, formatCHF } from "../utils";
import { Header, FormField, ShareButton } from "../components/UI";
import type { Employee, StudioBudgetState, StudioBudgetVersion, ViewProps } from "../types";

type BudgetRow<K extends keyof StudioBudgetState> = StudioBudgetState[K] extends (infer R)[] ? R : never;

/** Kleines Inline-Override-Feld: Checkbox «übersteuern», dann Zahlenfeld statt des berechneten Werts. */
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
function StudioBudget({ data, update, setPrintContent }: Pick<ViewProps, "data" | "update" | "setView" | "setPrintContent">) {
  const employees = data.employees || [];
  const internalExpenses = data.internalExpenses || [];
  const currentYear = new Date().getFullYear();
  const saved = data.settings.studioBudget || {};

  // ── Hilfsfunktion: Auto-Werte für einen MA berechnen ──────────
  const calcEmpAuto = (emp: Employee, agZuschlag?: number) => {
    const pensum = (emp.pensum || 100) / 100;
    // monatslohn ist der 100%-Basislohn (siehe Employees.jsx "Effektiv bei X%"-
    // Hinweis und calcLohn() in utils.js) — Pensum muss auf den Lohn selbst
    // angewendet werden, nicht nur auf die Stunden, sonst rechnet Teilzeit
    // hier mit vollem Lohn (bis zu +100% zu hohe Personalkosten bei 50%).
    const monatslohnEff = (emp.monatslohn || 0) * pensum;
    const brutto12 = monatslohnEff * 12;
    const brutto13 = emp.dreizehnterLohn ? brutto12 + monatslohnEff : brutto12;
    const agAnteil = brutto13 * ((agZuschlag ?? 20) / 100);
    const totalKosten = brutto13 + agAnteil;
    const ferienWochen = emp.ferienWochen || data.settings.defaultFerienWochen || 5;
    const wochenstunden = (emp.wochenstunden || data.settings.defaultWochenstunden || 35) * pensum;
    const nettoWochen = 52 - ferienWochen - 1.5;
    const jahresStunden = Math.round(wochenstunden * nettoWochen);
    return { brutto13, agAnteil, totalKosten, jahresStunden };
  };

  // ── Hilfsfunktion: Auto-Werte für interne Ausgaben ───────────
  const calcFixAuto = () => {
    const rows: { id: string; label: string; cat: string; amount: number }[] = [];
    internalExpenses.forEach(e => {
      const year = (e.date || "").slice(0, 4);
      const net = e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount;
      let annualized = net;
      if (e.recurring) {
        if (e.recurringInterval === "monatlich") annualized = net * 12;
        else if (e.recurringInterval === "quartalsweise") annualized = net * 4;
      } else if (year !== String(currentYear)) return;
      rows.push({ id: e.id, label: e.description || e.category, cat: e.category, amount: annualized });
    });
    return rows;
  };

  // ── State: ein Eintrag pro MA, pro Fixkostenposten, plus globale Parameter ──
  const initState = (): StudioBudgetState => {
    const sv = saved;
    const agZuschlag = sv.agZuschlag ?? 20;

    // Mitarbeiter-Zeilen
    const empRows = employees.map(emp => {
      const auto = calcEmpAuto(emp, agZuschlag);
      const saved_emp = (sv.empRows || []).find(r => r.id === emp.id) || {} as Partial<BudgetRow<"empRows">>;
      return {
        id: emp.id,
        aktiv: saved_emp.aktiv ?? true,
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
      inkludiereEntwuerfe: sv.inkludiereEntwuerfe ?? true,
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
    const auto = calcEmpAuto(emp, b.agZuschlag);
    const row = b.empRows.find(r => r.id === emp.id) || { aktiv: true, kostenOverride: false, kostenManual: 0, stundenOverride: false, stundenManual: 0 };
    const kosten = row.kostenOverride ? (row.kostenManual || 0) : auto.totalKosten;
    const stunden = row.stundenOverride ? (row.stundenManual || 0) : auto.jahresStunden;
    return { emp, auto, row, kosten, stunden, aktiv: row.aktiv };
  });

  const personalKosten = empCalcRows.filter(r => r.aktiv).reduce((s, r) => s + r.kosten, 0);
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
  const reserve = basisKosten * ((b.reserve || 0) / 100);
  const gesamtKosten = basisKosten + reserve;

  const produktivStunden = Math.round(jahresStundenFallback * ((b.produktivQuote || 70) / 100));
  const selbstkosten = produktivStunden > 0 ? gesamtKosten / produktivStunden : 0;
  const zielHonorar = selbstkosten > 0 ? selbstkosten / (1 - (b.zielMarge ?? 25) / 100) : 0;

  const defaultRate = data.settings.defaultHourlyRate || 120;
  const currentRate = b.rateOverride ? (b.rateManual || defaultRate) : defaultRate;

  // ── Einnahmen ─────────────────────────────────────────────────
  const yearInvoices = (data.invoices || []).filter(i => (i.date || "").startsWith(String(currentYear)));
  const paidRevenue = yearInvoices.filter(i => i.status === "bezahlt").reduce((s, i) => s + (i.sub || 0), 0);
  const sentRevenue = yearInvoices.filter(i => i.status === "gesendet" || i.status === "überfällig").reduce((s, i) => s + (i.sub || 0), 0);
  const draftRevenue = yearInvoices.filter(i => i.status === "entwurf").reduce((s, i) => s + (i.sub || 0), 0);
  const invoiceAutoRevenue = b.inkludiereRechnungen
    ? paidRevenue + sentRevenue + (b.inkludiereEntwuerfe ? draftRevenue : 0)
    : 0;

  const yearQuotes = (data.quotes || []).filter(q => (q.date || "").startsWith(String(currentYear)));
  const acceptedQuoteRevenue = yearQuotes.filter(q => q.status === "angenommen").reduce((s, q) => s + (q.sub || 0), 0);
  const sentQuoteRevenue = yearQuotes.filter(q => q.status === "gesendet").reduce((s, q) => s + (q.sub || 0), 0);
  const draftQuoteRevenue = yearQuotes.filter(q => q.status === "entwurf").reduce((s, q) => s + (q.sub || 0), 0);
  const quoteAutoRevenue = b.inkludiereOfferten
    ? acceptedQuoteRevenue + sentQuoteRevenue + (b.inkludiereOffertEntwuerfe ? draftQuoteRevenue : 0)
    : 0;

  const autoRevenue = invoiceAutoRevenue + quoteAutoRevenue;
  const manualIncomeTotal = (b.extraIncome || []).filter(r => r.aktiv).reduce((s, r) => s + (r.amount || 0), 0);
  const totalRevenue = autoRevenue + manualIncomeTotal;
  const ergebnis = totalRevenue - gesamtKosten;

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
    b: { agZuschlag: b.agZuschlag, empRows: b.empRows, fixRows: b.fixRows, extraRows: b.extraRows, extraIncome: b.extraIncome, inkludiereRechnungen: b.inkludiereRechnungen, inkludiereEntwuerfe: b.inkludiereEntwuerfe, inkludiereOfferten: b.inkludiereOfferten, inkludiereOffertEntwuerfe: b.inkludiereOffertEntwuerfe, reserve: b.reserve, produktivQuote: b.produktivQuote, zielMarge: b.zielMarge, rateOverride: b.rateOverride, rateManual: b.rateManual },
    results: { personalKosten, fixKosten, extraKosten, basisKosten, reserve: basisKosten * ((b.reserve || 0) / 100), gesamtKosten, totalRevenue, ergebnis, jahresStundenTotal: jahresStundenFallback, produktivStunden, selbstkosten, zielHonorar, currentRate },
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
      reserve: b.reserve, produktivQuote: b.produktivQuote, zielMarge: b.zielMarge,
      rateOverride: b.rateOverride, rateManual: b.rateManual,
    } });
    setSaveName("");
  };

  const loadVersion = (v: StudioBudgetVersion) => {
    setB(prev => ({ ...prev, ...v.b }));
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
      reserve: b.reserve,
      produktivQuote: b.produktivQuote,
      zielMarge: b.zielMarge,
      rateOverride: b.rateOverride,
      rateManual: b.rateManual,
    }});
  };

  return (
    <div>
      <Header title="Budget" action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={() => setShowVersions(v => !v)}>
            ⊞ Versionen {versions.length > 0 && <span style={{ marginLeft: 4, background: "#b07848", color: "var(--text)", borderRadius: 20, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>{versions.length}</span>}
          </button>
          <ShareButton options={[{ label: "PDF", onClick: () => setPrintContent({ type: "studioBudget", snapshot: buildSnapshot("Aktuell"), settings: data.settings }) }]} />
          <button className="btn btn-primary" onClick={saveSettings}>Speichern</button>
        </div>
      } />

      {/* Versions-Panel */}
      {showVersions && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid #b07848" }}>
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
                    <td style={{ padding: "8px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#b07848", borderBottom: "1px solid var(--border2)" }}>{formatCHF(Math.round(v.results?.zielHonorar || 0))}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontSize: 12, borderBottom: "1px solid var(--border2)" }}>{formatCHF(Math.round(v.results?.gesamtKosten || 0))}</td>
                    <td style={{ padding: "8px 0 8px 8px", textAlign: "right", fontSize: 11, color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
                      {new Date(v.savedAt).toLocaleDateString("de-CH")}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border2)" }}>
                      <ShareButton style={{ fontSize: 11, padding: "4px 8px", marginRight: 4 }}
                        options={[{ label: "PDF", onClick: () => setPrintContent({ type: "studioBudget", snapshot: v, settings: data.settings }) }]} />
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", marginRight: 4 }}
                        onClick={() => loadVersion(v)}>Laden</button>
                      <button className="btn btn-danger" style={{ fontSize: 11, padding: "4px 8px" }}
                        onClick={() => deleteVersion(v.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── ANALYSE — full width, ganz oben ── */}
      <div className="card" style={{ borderTop: `3px solid ${rateOk ? "var(--positive)" : "var(--negative)"}`, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 0, alignItems: "stretch" }}>
          <div style={{ padding: "14px 20px 14px 0", borderRight: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.1em", marginBottom: 8 }}>SELBSTKOSTENSATZ</div>
            <div style={{ fontSize: 32, fontFamily: "'Inter', sans-serif", fontWeight: 700, lineHeight: 1 }}>{formatCHF(Math.round(selbstkosten))}</div>
            <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 6 }}>pro produktive Stunde</div>
          </div>
          <div style={{ padding: "14px 20px", borderRight: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.1em", marginBottom: 8 }}>ZIEL-HONORAR</div>
            <div style={{ fontSize: 32, fontFamily: "'Inter', sans-serif", fontWeight: 700, color: "#b07848", lineHeight: 1 }}>{formatCHF(Math.round(zielHonorar))}</div>
            <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 6 }}>inkl. {b.zielMarge}% Marge</div>
          </div>
          <div style={{ padding: "14px 20px", borderRight: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.1em", marginBottom: 8 }}>GESAMTKOSTEN / JAHR</div>
            <div style={{ fontSize: 32, fontFamily: "'Inter', sans-serif", fontWeight: 700, lineHeight: 1 }}>{formatCHF(gesamtKosten)}</div>
            <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 6 }}>{jahresStundenFallback}h verfügbar · {produktivStunden}h produktiv</div>
          </div>
          <div style={{ padding: "14px 0 14px 20px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 180 }}>
            <div style={{ padding: "10px 14px", borderRadius: 6, border: `1.5px solid ${rateOk ? "#b8dcc8" : "#e8b0b0"}`, background: rateOk ? "#f0f8f4" : "var(--negative-bg)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: rateOk ? "var(--positive)" : "var(--negative)", marginBottom: 4 }}>
                {rateOk ? "✓ Ansatz ausreichend" : "⚠ Ansatz zu tief"}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Inter', sans-serif", color: rateOk ? "var(--positive)" : "var(--negative)" }}>
                {rateOk ? "+" : ""}{formatCHF(Math.round(rateDiff))}
              </div>
              <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>Aktuell {formatCHF(currentRate)}/h</div>
            </div>
            {selbstkosten > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min((produktivStunden / Math.ceil(gesamtKosten / currentRate)) * 100, 100)}%`, height: "100%", background: rateOk ? "var(--positive)" : "var(--warning)", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>Break-even: {Math.ceil(gesamtKosten / currentRate)}h</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20, alignItems: "start" }}>

        {/* ── LINKE SPALTE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Personalkosten */}
          <div className="card">
            <SectionLabel>PERSONALKOSTEN / JAHR</SectionLabel>
            <div style={{ marginBottom: 12 }}>
              <FormField label="AG-Sozialleistungen %">
                <input type="number" step="0.5" min={0} max={50} value={b.agZuschlag}
                  onChange={e => { const v = +e.target.value; setField("agZuschlag", v); setB(prev => ({ ...prev, agZuschlag: v })); }} />
                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 3 }}>AHV, UVG, BVG, KTG AG-Anteil (typisch 18–22%)</div>
              </FormField>
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
                            <div style={{ fontSize: 10, color: "var(--text4)" }}>{emp.pensum || 100}% · {emp.dreizehnterLohn ? "13 Mt." : "12 Mt."}</div>
                          </div>
                        </label>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border2)", verticalAlign: "top", textAlign: "right" }}>
                        <OverrideInput aktiv={aktiv} checked={row.kostenOverride} onToggle={v => setEmpRow(emp.id, { kostenOverride: v })}
                          value={row.kostenManual} onChange={v => setEmpRow(emp.id, { kostenManual: v })} autoVal={auto.totalKosten} step={500} />
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
              <span style={{ fontFamily: "'Inter', sans-serif" }}>{formatCHF(personalKosten)}</span>
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
              <span style={{ fontFamily: "'Inter', sans-serif" }}>{formatCHF(fixKosten + extraKosten)}</span>
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
                  { label: "Versendet / Überfällig", value: sentRevenue, color: "#b07848" },
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
                  { label: "Gesendet", value: sentQuoteRevenue, color: "#b07848" },
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
              <span style={{ fontFamily: "'Inter', sans-serif", color: "var(--positive)" }}>{formatCHF(totalRevenue)}</span>
            </div>
          </div>

          {/* Reserve & Stunden & Marge — kompakt in einer Zeile */}
          <div className="card">
            <SectionLabel>PARAMETER</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
              {[
                { label: "Reserve %", key: "reserve" as const, min: 0, max: 50, hint: "Puffer für Unvorhergesehenes" },
                { label: "Produktiv-Quote %", key: "produktivQuote" as const, min: 10, max: 100, hint: "Verrechenbare Stunden (60–75%)" },
                { label: "Ziel-Marge %", key: "zielMarge" as const, min: 0, max: 80, hint: "Aufschlag für Gewinn / Reinvestition" },
              ].map(({ label, key, min, max, hint }) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 5 }}>{label}</div>
                  <input type="number" step="1" min={min} max={max} value={b[key]}
                    onChange={e => setField(key, +e.target.value)}
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
            <SectionLabel>KOSTENSTRUKTUR / JAHR</SectionLabel>
            {[
              { label: "Personalkosten", value: personalKosten },
              { label: "Fixkosten", value: fixKosten + extraKosten },
              { label: "Basiskosten", value: basisKosten, bold: true },
              { label: `+ Reserve (${b.reserve}%)`, value: reserve, indent: true },
              { label: "Gesamtkosten", value: gesamtKosten, total: true },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: r.total ? "8px 0 2px" : r.indent ? "2px 0 2px 12px" : "4px 0", borderTop: r.total ? "2px solid var(--text)" : "none", borderBottom: r.total ? "none" : "1px solid var(--border2)", marginTop: r.total ? 4 : 0 }}>
                <span style={{ fontSize: r.total ? 13 : r.indent ? 11 : 12, fontWeight: r.total || r.bold ? 700 : 400, color: r.total || r.bold ? "var(--text)" : "var(--text2)" }}>{r.label}</span>
                <span style={{ fontSize: r.total ? 15 : 12, fontWeight: r.total || r.bold ? 700 : 400, fontFamily: r.total || r.bold ? "'Inter', sans-serif" : "inherit" }}>{formatCHF(r.value)}</span>
              </div>
            ))}
            {totalRevenue > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", marginTop: 8, borderTop: "1px dashed var(--border)" }}>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>
                    Einnahmen
                    {b.inkludiereEntwuerfe && draftRevenue > 0 && b.inkludiereRechnungen && (
                      <span style={{ fontSize: 10, color: "var(--warning)", marginLeft: 5 }}>inkl. {formatCHF(draftRevenue)} erwartet (Rechnungen)</span>
                    )}
                    {b.inkludiereOffertEntwuerfe && draftQuoteRevenue > 0 && b.inkludiereOfferten && (
                      <span style={{ fontSize: 10, color: "var(--warning)", marginLeft: 5 }}>inkl. {formatCHF(draftQuoteRevenue)} erwartet (Offerten)</span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--positive)" }}>{formatCHF(totalRevenue)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: "2px solid var(--text)", marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Ergebnis</span>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Inter', sans-serif", color: ergebnis >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {ergebnis >= 0 ? "+" : ""}{formatCHF(ergebnis)}
                  </span>
                </div>
              </>
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
              <span style={{ color: "var(--text2)" }}>Produktiv ({b.produktivQuote}%)</span>
              <span style={{ fontWeight: 600 }}>{produktivStunden}h</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${b.produktivQuote}%`, height: "100%", background: b.produktivQuote >= 80 ? "var(--negative)" : b.produktivQuote >= 70 ? "var(--warning)" : "var(--positive)", borderRadius: 3 }} />
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
                      <strong style={{ color: Math.abs(istProduktivQuote - b.produktivQuote) > 10 ? "var(--warning)" : "var(--text)" }}>{Math.round(istProduktivQuote)}%</strong>
                      <span style={{ color: "var(--text4)", marginLeft: 5 }}>Soll: {b.produktivQuote}%</span>
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
                      {ok ? "+" : ""}{formatCHF(Math.round(diff))} {ok ? "▲" : "▼"}
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
