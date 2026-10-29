// Projekt-Detailansicht: Budget- und Zeitauswertung, Phasen, Offerten/Nachträge, Rechnungen,
// Protokolle und Zeiteinträge eines Projekts (Datenmodell siehe Kopf von Projects.tsx).
// Berechtigungen: Offerten- und Rechnungsdaten nur mit «quotes» bzw. «invoices» (`userPermissions`).

import React, { useState } from "react";
import { SIA_PHASES, PROTOKOLL_TYPES, NON_BILLING_CATEGORIES } from "../constants";
import { calcSIAHours, calcManualHours, deriveQuoteBudget, migrateLinkedQuotes, generateId, formatCHF, formatDate, formatHours, nextProtoSeq, applyProtoNumberFormat, localISODate } from "../utils";
import { Modal, FormField, StatusBadge, KpiCard, ShareButton } from "../components/UI";
import type { ProjectPosition, TimeEntry, ViewProps } from "../types";
import { ProjectEditForm, type ProjectForm } from "./ProjectEditForm";

type LinkedQuote = { quoteId: string; role: string };

/** Filter für Listen, die `null`-Einträge enthalten (nur null/undefined, nicht leere Strings). */
const notNull = <T,>(x: T | null | undefined): x is T => x != null;

export default
function ProjectDetail({ data, update, saveAll, projectId, onBack, setPrintContent, userPermissions }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent" | "modal" | "setModal" | "currentUser" | "userPermissions"> & {
  projectId: string;
  onBack: () => void;
}) {
  // userPermissions (aus App.tsx, bereits rollen-aufgelöst) statt des nie befüllten Legacy-Felds
  // currentUser.permissions — letzteres ist für rollenbasierte Cloud-User immer undefined.
  const isAdmin        = userPermissions === null;
  const canSeeQuotes   = isAdmin || userPermissions.includes("quotes");
  const canSeeInvoices = isAdmin || userPermissions.includes("invoices");
  const canSeeMitarbeiter = isAdmin || userPermissions.includes("mitarbeiter");
  const project = data.projects.find(p => p.id === projectId);
  const emptySettingsForm: ProjectForm = { number: "", name: "", clientId: "", category: "Direktauftrag", billingType: "stundensatz", hourlyRate: data.settings.defaultHourlyRate, budget: 0, status: "aktiv", description: "", startDate: "", enabledPhases: [], budgetHours: 0, linkedQuotes: [], positions: [], customPhases: [], internalMembers: [] };
  const [budgetModal, setBudgetModal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [budgetChartView, setBudgetChartView] = useState("einzeln");
  const [phaseChartView, setPhaseChartView] = useState("einzeln");
  const [settingsForm, setSettingsForm] = useState<ProjectForm>(() => project ? { ...emptySettingsForm, ...project, enabledPhases: project.enabledPhases || [] } : emptySettingsForm);
  const [showAddBeteiligter, setShowAddBeteiligter] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [addContactId, setAddContactId] = useState("");
  const [addPersonIds, setAddPersonIds] = useState<string[]>([]);

  const openSettings = () => {
    if (!project) return;
    setSettingsForm({ ...emptySettingsForm, ...project, enabledPhases: project.enabledPhases || [], projectContacts: project.projectContacts || [], internalMembers: project.internalMembers || [] });
    setShowAddBeteiligter(false);
    setEditingContactId(null);
    setAddContactId("");
    setAddPersonIds([]);
    setSettingsOpen(true);
  };
  const saveSettings = () => {
    if (!settingsForm.name?.trim()) { alert("Bitte einen Projektnamen eingeben."); return; }
    update("projects", data.projects.map(p => p.id === projectId ? { ...p, ...settingsForm } : p));
    setSettingsOpen(false);
  };

  const buildNachtragPositions = (linked: LinkedQuote[], existingPos: ProjectPosition[]) => {
    const manual = (existingPos || []).filter(p => !p.quoteId);
    const nachtrag = linked.filter(lq => lq.role === "Nachtrag").map((lq, idx) => {
      const existing = (existingPos || []).find(p => p.quoteId === lq.quoteId);
      const q = (data.quotes || []).find(x => x.id === lq.quoteId);
      const sd = deriveQuoteBudget([lq], data.quotes || [], data.settings.roles || []);
      return { code: existing?.code || `N${idx + 1}`, label: existing !== undefined ? existing.label : (q?.projectName || q?.number || ""), enabledPhases: existing?.enabledPhases || sd.enabledPhases, quoteId: lq.quoteId };
    });
    return [...manual, ...nachtrag];
  };

  const [budgetForm, setBudgetForm] = useState(() => ({
    budgetHours: project?.budgetHours || 0,
    budgetAmount: project?.budgetAmount || 0,
    linkedQuotes: project ? migrateLinkedQuotes(project) : [],
    phasesBudget: project?.phasesBudget || [],
    enabledPhases: project?.enabledPhases || [],
    billingType: project?.billingType || "stundensatz",
    positions: project?.positions || [],
  }));

  if (!project) return <div style={{ padding: 32 }}>Projekt nicht gefunden. <button className="btn btn-ghost" onClick={onBack}>Zurück</button></div>;

  const openBudgetModal = () => {
    const linked = migrateLinkedQuotes(project);
    setBudgetForm({
      budgetHours: project.budgetHours || 0,
      budgetAmount: project.budgetAmount || 0,
      linkedQuotes: linked,
      phasesBudget: project.phasesBudget || [],
      enabledPhases: project.enabledPhases || [],
      billingType: project.billingType || "stundensatz",
      positions: buildNachtragPositions(linked, project.positions || []),
    });
  };

  const addLinkedQuote = (quoteId: string) => {
    if (!quoteId || budgetForm.linkedQuotes.some(lq => lq.quoteId === quoteId)) return;
    const isFirst = budgetForm.linkedQuotes.length === 0;
    const newLq = { quoteId, role: isFirst ? "Hauptofferte" : "Nachtrag" };
    const newLinked = [...budgetForm.linkedQuotes, newLq];
    const d = deriveQuoteBudget(newLinked, data.quotes || [], data.settings.roles || []);
    const q = (data.quotes || []).find(x => x.id === quoteId);
    setBudgetForm(f => {
      const positions = isFirst ? (f.positions || []) : buildNachtragPositions(newLinked, f.positions || []);
      return {
        ...f,
        linkedQuotes: newLinked,
        budgetHours: d.budgetHours,
        budgetAmount: d.budgetAmount,
        phasesBudget: d.phasesBudget,
        enabledPhases: isFirst ? [...new Set([...(f.enabledPhases || []), ...d.enabledPhases])] : (f.enabledPhases || []),
        billingType: isFirst ? (q?.mode === "manual" ? "stundensatz" : "pauschal") : f.billingType,
        positions,
      };
    });
  };
  const removeLinkedQuote = (quoteId: string) => {
    const newLinked = budgetForm.linkedQuotes.filter(lq => lq.quoteId !== quoteId);
    const d = newLinked.length > 0 ? deriveQuoteBudget(newLinked, data.quotes || [], data.settings.roles || []) : { budgetHours: 0, budgetAmount: 0, phasesBudget: [] };
    setBudgetForm(f => ({
      ...f, linkedQuotes: newLinked, budgetHours: d.budgetHours, budgetAmount: d.budgetAmount, phasesBudget: d.phasesBudget,
      positions: buildNachtragPositions(newLinked, f.positions || []),
    }));
  };
  const changeLinkedRole = (quoteId: string, role: string) => setBudgetForm(f => {
    const newLinked = f.linkedQuotes.map(lq => lq.quoteId === quoteId ? { ...lq, role } : lq);
    return { ...f, linkedQuotes: newLinked, positions: buildNachtragPositions(newLinked, f.positions || []) };
  });

  const saveBudget = () => {
    update("projects", data.projects.map(p => p.id === projectId ? { ...p, ...budgetForm } : p));
    setBudgetModal(false);
  };

  const clients = (data.persons || []);
  const client = clients.find(c => c.id === project.clientId);
  const entries = data.timeEntries.filter(e => e.projectId === projectId).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const totalMinutes = entries.reduce((s, e) => s + (e.minutes || 0), 0);
  const totalHours = totalMinutes / 60;
  const billingType = project.billingType || project.type || "stundensatz";
  const isNonBilling = NON_BILLING_CATEGORIES.includes(project.category as string);
  const isCostControl = billingType !== "stundensatz" || isNonBilling;
  const totalAmount = billingType === "stundensatz" ? (totalMinutes / 60) * (project.hourlyRate as number) : project.budget;
  const budget = project.budgetHours || 0;
  const budgetPct = budget > 0 ? (totalHours / budget) * 100 : 0;
  const budgetColor = budgetPct >= 100 ? "var(--negative)" : budgetPct >= 80 ? "var(--warning)" : "var(--positive)";
  const invoicedMinutes = entries.filter(e => e.invoiceId).reduce((s, e) => s + (e.minutes || 0), 0);
  const openMinutes = totalMinutes - invoicedMinutes;

  // Phasen-Auswertung (nur aktivierte Phasen; aufgeteilt nach HO + Positionen)
  const positions = project.positions || [];
  // project.phasesBudget kombiniert Hauptofferte UND Nachträge (Invoices.jsx
  // braucht genau diesen kombinierten Wert für die Akonto-/Teilrechnungs-
  // Restbudget-Berechnung) — für den HO-Anteil hier aber die Nachtrag-
  // Stunden separat aus der Hauptofferte allein neu ableiten, sonst würden
  // sie unten in der Gesamt-Ansicht ein zweites Mal zum Nachtrags-Budget
  // addiert.
  const hauptLinked = migrateLinkedQuotes(project).filter(lq => lq.role === "Hauptofferte");
  const hoPhasesBudget = hauptLinked.length > 0
    ? deriveQuoteBudget(hauptLinked, data.quotes || [], data.settings.roles || []).phasesBudget
    : (project.phasesBudget || []);
  const phaseStats = (project.enabledPhases || []).map(phaseId => {
    const phase = SIA_PHASES.find(p => p.id === phaseId);
    const phaseEntries = entries.filter(e => e.phaseId === phaseId);
    const hoMins = phaseEntries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
    const totalPhaseMins = phaseEntries.reduce((s, e) => s + (e.minutes || 0), 0);
    const phaseBudget = hoPhasesBudget.find(pb => pb.id === phaseId)?.hours || 0;
    const byPosition = positions.map(pos => ({
      code: pos.code, label: pos.label,
      mins: phaseEntries.filter(e => e.positionId === pos.code).reduce((s, e) => s + (e.minutes || 0), 0),
    })).filter(p => p.mins > 0);
    return { ...phase, minutes: totalPhaseMins, hoMins, hours: totalPhaseMins / 60, phaseBudget, percent: totalMinutes > 0 ? (totalPhaseMins / totalMinutes) * 100 : 0, entries: phaseEntries.length, byPosition };
  });
  const unassignedMins = entries.filter(e => !e.phaseId).reduce((s, e) => s + (e.minutes || 0), 0);
  const customPhaseStats = (project.customPhases || []).map(cp => {
    const mins = entries.filter(e => e.phaseId === cp.id).reduce((s, e) => s + (e.minutes || 0), 0);
    return { id: cp.id, label: cp.label, mins };
  });
  const customMinsTotal = customPhaseStats.reduce((s, cp) => s + cp.mins, 0);

  // Rechnungen zum Projekt
  const projectInvoices = data.invoices.filter(i => i.projectId === projectId);

  // Offen-Anzeige: nur bei Stundensatz-Projekten oder wenn ein Nachtrag stundensatz-basiert ist
  const hasStundensatzNachtrag = positions.some(pos => {
    if (!pos.quoteId) return false;
    const q = (data.quotes || []).find(q => q.id === pos.quoteId);
    return q?.mode === "manual";
  });
  const showOffen = billingType === "stundensatz" || hasStundensatzNachtrag;
  const paidInvoices = projectInvoices.filter(i => i.status === "bezahlt");
  const openInvoices = projectInvoices.filter(i => i.status === "gesendet" || i.status === "überfällig");
  const paidTotal = paidInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const openTotal = openInvoices.reduce((s, i) => s + (i.total || 0), 0);

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18, padding: "6px 14px", fontSize: 12 }}>← Alle Projekte</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 6 }}>{project.number && <span style={{ color: "#b07848", marginRight: 8 }}>{project.number}</span>}{(project.category || "—").toUpperCase()} · {client?.name || "Kein Auftraggeber"}</div>
          <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 34, fontWeight: 400, letterSpacing: "-0.01em" }}>{project.name}</h1>
          {project.description && <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 6, maxWidth: 600 }}>{project.description}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isAdmin && <button className="btn btn-ghost" onClick={openSettings}>Einstellungen</button>}
          {canSeeQuotes && <button className="btn btn-ghost" onClick={() => { openBudgetModal(); setBudgetModal(true); }}>Budget / Offerten</button>}
          <ShareButton options={[{ label: "PDF", onClick: () => setPrintContent({ type: "projectDetail", project, client, entries, phaseStats, unassignedMins, totalMinutes, totalAmount, billingType, invoices: projectInvoices, data }) }]} />
        </div>
      </div>

      <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {(() => {
          const internalRate = project.hourlyRate || data.settings.defaultHourlyRate || 0;
          const internalCost = (totalMinutes / 60) * internalRate;
          if (isCostControl) return [
            { label: "STUNDEN TOTAL", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "#b07848" },
            isNonBilling
              ? { label: "NICHT VERRECHENBAR", value: project.category, sub: "Stunden fliessen ins Studio-Budget", color: "var(--text5)" }
              : { label: "INTERNER AUFWAND", value: internalRate > 0 ? formatCHF(internalCost) : "—", sub: internalRate > 0 ? `bei ${formatCHF(internalRate)}/h · Kostenkontrolle` : "Kein Stundensatz hinterlegt", color: "var(--text4)" },
            { label: "BUDGET GENUTZT", value: budget > 0 ? `${Math.min(Math.round(budgetPct), 999)}%` : "—", sub: budget > 0 ? `${totalHours.toFixed(1)}h / ${budget}h` : "Kein Stundenbudget", color: budget > 0 ? budgetColor : "var(--text5)" },
            { label: "STATUS", value: <StatusBadge status={project.status} />, color: "#b07848" },
          ];
          return [
            { label: "STUNDEN TOTAL", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "#b07848" },
            { label: "VERRECHNET", value: formatHours(invoicedMinutes), sub: formatCHF(invoicedMinutes / 60 * (project.hourlyRate as number)), color: "var(--positive)" },
            { label: "OFFEN", value: formatHours(openMinutes), sub: formatCHF(openMinutes / 60 * (project.hourlyRate as number)), color: openMinutes > 0 ? "var(--warning)" : "var(--text5)" },
            { label: "STATUS", value: <StatusBadge status={project.status} />, color: "#b07848" },
          ];
        })().map(c => (
          <KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} color={c.color} />
        ))}
      </div>

      {/* Projektbeteiligte */}
      {(project.projectContacts || []).length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 10, color: "var(--text5)", letterSpacing: "0.1em", fontWeight: 600, flexShrink: 0 }}>BETEILIGTE</span>
          {(project.projectContacts || []).map(pc => {
            const firm = (data.persons || []).find(p => p.id === pc.contactId);
            if (!firm) return null;
            const selectedPersons = (firm.contacts || []).filter(p => (pc.personIds || []).includes(p.id));
            return (
              <div key={pc.contactId} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 10px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{firm.name}</span>
                {firm.type && <span style={{ fontSize: 10, color: "var(--text5)" }}>{firm.type}</span>}
                {selectedPersons.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text3)", borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>
                    {selectedPersons.map(p => p.name).join(", ")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stundenbudget-Anzeige — offertenabgeleitet (Hauptofferten-Betrag etc.),
          daher wie der "Budget / Offerten"-Button an canSeeQuotes gekoppelt. */}
      {canSeeQuotes && (() => {
        const linked = migrateLinkedQuotes(project);
        const derived = linked.length > 0 ? deriveQuoteBudget(linked, data.quotes || [], data.settings.roles || []) : null;
        const amountBudget = project.budgetAmount || derived?.budgetAmount || 0;
        // Entwürfe sind noch nicht ausgestellt und dürfen den Budgetverbrauch
        // nicht überzeichnen (analog Accounting.jsx totalTax-Fix).
        const invoicedAmount = projectInvoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + (i.sub || 0), 0);

        if (budget === 0 && amountBudget === 0) return (
          <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--border)", padding: "12px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text5)" }}>Kein Budget gesetzt</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }}
                onClick={() => { openBudgetModal(); setBudgetModal(true); }}>
                + Budget / Offerte verknüpfen
              </button>
            </div>
          </div>
        );

        // Pro Offerte einzeln berechnen
        const quoteRows = linked.map(lq => {
          const q = (data.quotes || []).find(x => x.id === lq.quoteId);
          if (!q) return null;
          const roles = q.quoteRoles || data.settings.roles || [];
          let qHours = 0, qAmount = 0;
          if (q.mode === "sia") {
            const calc = calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []);
            qHours = calc.total || 0;
            qAmount = qHours * (q.sia?.stundenansatz || 0);
          } else if (q.mode === "manual") {
            const calc = calcManualHours(q.manualPhases || [], roles);
            qHours = calc.totalHours || 0;
            qAmount = calc.totalAmount || 0;
          } else if (q.mode === "free") {
            qAmount = (q.freeItems || []).reduce((s, it) => s + (it.qty * it.price), 0);
          }
          return { lq, q, qHours: Math.round(qHours * 10) / 10, qAmount: Math.round(qAmount) };
        }).filter(notNull);

        const isNachtrag = (role: string) => role === "Nachtrag";
        const nachtragRows = quoteRows.filter(r => isNachtrag(r.lq.role));
        const sortedQuoteRows = [
          ...quoteRows.filter(r => !isNachtrag(r.lq.role)),
          ...nachtragRows,
        ];
        const hauptTotal = quoteRows.filter(r => !isNachtrag(r.lq.role)).reduce((s, r) => s + r.qHours, 0);
        const nachtragTotal = nachtragRows.reduce((s, r) => s + r.qHours, 0);

        // resolve per-row posCode from project.positions (custom codes)
        const rowsWithPos = sortedQuoteRows.map(({ lq, q, qHours, qAmount }) => {
          const isNT = isNachtrag(lq.role);
          const pos = isNT ? positions.find(p => p.quoteId === lq.quoteId) : null;
          const ntIdx = isNT ? nachtragRows.findIndex(r => r.lq.quoteId === lq.quoteId) : -1;
          const posCode = pos?.code || (isNT ? `N${ntIdx + 1}` : null);
          const usedMins = isNT
            ? entries.filter(e => posCode && e.positionId === posCode).reduce((s, e) => s + (e.minutes || 0), 0)
            : entries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
          return { lq, q, qHours, qAmount, isNT, posCode, usedH: usedMins / 60 };
        });
        const totalBudgetH = rowsWithPos.filter(r => r.qHours > 0).reduce((s, r) => s + r.qHours, 0);
        const remaining = Math.max(0, budget - totalHours);

        return (
          <div className="card" style={{ marginBottom: 20, borderLeft: `4px solid ${budgetColor}`, padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>HONORAR- UND STUNDENBUDGET</div>
                {quoteRows.length > 1 && (
                  <div style={{ display: "flex", gap: 1, background: "var(--surface3)", borderRadius: 20, padding: 2 }}>
                    {[["einzeln", "Einzeln"], ["gesamt", "Gesamt"]].map(([v, l]) => (
                      <button key={v} onClick={() => setBudgetChartView(v)} style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, border: "none", cursor: "pointer", background: budgetChartView === v ? "var(--surface)" : "transparent", color: budgetChartView === v ? "var(--text)" : "var(--text4)", fontWeight: budgetChartView === v ? 600 : 400 }}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              {canSeeInvoices && <div style={{ fontSize: 11, color: "var(--text4)" }}>
                Total verrechnet: <strong style={{ color: "var(--text)" }}>{formatCHF(invoicedAmount)}</strong>
                {amountBudget > 0 && <span> / {formatCHF(amountBudget)}</span>}
              </div>}
            </div>

            {budgetChartView === "gesamt" && quoteRows.length > 1 ? (
              <div>
                {/* Segmentierter Balken */}
                <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", marginBottom: 10, background: "var(--surface3)" }}>
                  {rowsWithPos.filter(r => r.qHours > 0).map((r, idx, arr) => {
                    const segW = (r.qHours / totalBudgetH) * 100;
                    const fillW = Math.min((r.usedH / r.qHours) * 100, 100);
                    const isOver = r.usedH > r.qHours;
                    const segBg = r.isNT ? "#c8d8ee" : "#b8dcc8";
                    const fillColor = isOver ? "var(--negative)" : (r.isNT ? "var(--info)" : "var(--positive)");
                    const label = r.posCode || (r.isNT ? "NT" : "HO");
                    return (
                      <div key={r.lq.quoteId} style={{ width: `${segW}%`, position: "relative", background: segBg, borderRight: idx < arr.length - 1 ? "2px solid #fff" : "none", overflow: "hidden", flexShrink: 0 }}>
                        <div style={{ width: `${fillW}%`, height: "100%", background: fillColor, transition: "width 0.4s" }} />
                        {segW > 6 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{label}</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Legende */}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
                  {rowsWithPos.map(r => {
                    const color = r.isNT ? "var(--info)" : "var(--positive)";
                    const label = r.posCode || (r.isNT ? "NT" : "HO");
                    const isOver = r.usedH > r.qHours && r.qHours > 0;
                    return (
                      <div key={r.lq.quoteId} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: isOver ? "var(--negative)" : color, flexShrink: 0 }} />
                        <span style={{ color: "var(--text4)" }}>{label}:</span>
                        <span style={{ fontWeight: 600, color: isOver ? "var(--negative)" : color }}>{r.usedH.toFixed(1)}h</span>
                        {r.qHours > 0 && <span style={{ color: "var(--text5)", fontSize: 10 }}>/ {r.qHours}h</span>}
                        {r.qAmount > 0 && <span style={{ color: "var(--text5)", fontSize: 10 }}> · {formatCHF(r.qAmount)}</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Gesamt-Summe */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, paddingTop: 10, borderTop: "1px solid var(--border2)" }}>
                  <div style={{ color: "var(--text4)", display: "flex", gap: 16 }}>
                    <span>Verbraucht: <strong style={{ color: budgetColor }}>{totalHours.toFixed(1)}h</strong></span>
                    {budget > 0 && <span>Verfügbar: <strong style={{ color: remaining === 0 ? "var(--negative)" : "var(--positive)" }}>{remaining.toFixed(1)}h</strong></span>}
                  </div>
                  <span style={{ fontWeight: 700, color: budgetColor }}>
                    {budget > 0 ? `${totalHours.toFixed(1)}h / ${budget}h — ${budgetPct.toFixed(0)}%` : `${totalHours.toFixed(1)}h total`}
                    {budgetPct >= 100 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--negative)" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> überschritten</span>}
                  </span>
                </div>
              </div>
            ) : (
              <>
                {/* Einzeln-Ansicht */}
                {rowsWithPos.map(({ lq, q, qHours, qAmount, isNT, usedH }) => {
                  const barPct = qHours > 0 ? Math.min((usedH / qHours) * 100, 100) : 0;
                  const barColor = barPct >= 100 ? "var(--negative)" : barPct >= 80 ? "var(--warning)" : isNT ? "var(--info)" : "var(--positive)";
                  return (
                    <div key={lq.quoteId} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border2)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, letterSpacing: "0.04em", background: isNT ? "var(--info-bg)" : "#f0f8f4", color: isNT ? "var(--info)" : "var(--positive)", border: `1px solid ${isNT ? "#b0c8e8" : "#b8dcc8"}` }}>
                            {isNT ? "↪ " : "⬡ "}{lq.role}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>
                            {q.number && <span style={{ color: "#b07848", marginRight: 6, fontWeight: 600 }}>{q.number}</span>}
                            {q.projectName || "—"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, textAlign: "right" }}>
                          {qHours > 0 && <span style={{ fontWeight: 600, color: barColor }}>{usedH.toFixed(1)}h / {qHours}h<span style={{ fontWeight: 400, color: "var(--text4)", marginLeft: 6 }}>({barPct.toFixed(0)}%)</span></span>}
                          {qAmount > 0 && <span style={{ color: "var(--text4)", fontSize: 11, marginLeft: 10 }}>{formatCHF(qAmount)}</span>}
                        </div>
                      </div>
                      {qHours > 0 && (
                        <>
                          <div style={{ height: 7, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${barPct}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width 0.4s" }} />
                          </div>
                          {barPct >= 80 && <div style={{ fontSize: 10, color: barColor, marginTop: 3 }}>{barPct >= 100 ? "⚠ Budget überschritten" : "⚠ Budget fast ausgeschöpft"}</div>}
                        </>
                      )}
                    </div>
                  );
                })}

                {quoteRows.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingTop: 4 }}>
                    <span style={{ color: "var(--text4)" }}>
                      {hauptTotal > 0 && <span>Hauptofferte {hauptTotal.toFixed(1)}h</span>}
                      {nachtragTotal > 0 && <span style={{ marginLeft: 8, color: "var(--info)" }}>+ Nachträge {nachtragTotal.toFixed(1)}h</span>}
                    </span>
                    <span style={{ fontWeight: 700, color: budgetColor }}>
                      {totalHours.toFixed(1)}h / {budget}h — {budgetPct.toFixed(0)}%
                      {budgetPct >= 100 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--negative)" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> überschritten</span>}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Fallback wenn kein linked quote aber manuelles Budget */}
            {quoteRows.length === 0 && budget > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--text4)" }}>Stunden</span>
                  <span style={{ fontWeight: 700, color: budgetColor }}>{totalHours.toFixed(1)}h / {budget}h — {budgetPct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 8, background: "var(--surface3)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(budgetPct, 100)}%`, height: "100%", background: budgetColor, borderRadius: 4 }} />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Aufwand pro Phase — Hauptofferte + Nachträge in einer Karte */}
      {((project.enabledPhases || []).length > 0 || positions.some(pos => entries.some(e => e.positionId === pos.code)) || customPhaseStats.length > 0) && (() => {
        const linked = migrateLinkedQuotes(project);
        const hauptLq = linked.find(lq => lq.role === "Hauptofferte");
        const hauptQ = hauptLq ? (data.quotes || []).find(q => q.id === hauptLq.quoteId) : null;
        const hoMinsTotal = entries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
        const hasPositions = positions.some(pos => entries.some(e => e.positionId === pos.code));
        return (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>AUFWAND PRO PHASE</div>
              {hasPositions && (project.enabledPhases || []).length > 0 && (
                <div style={{ display: "flex", gap: 1, background: "var(--surface3)", borderRadius: 20, padding: 2 }}>
                  {[["einzeln", "Einzeln"], ["gesamt", "Gesamt"]].map(([v, l]) => (
                    <button key={v} onClick={() => setPhaseChartView(v)} style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, border: "none", cursor: "pointer", background: phaseChartView === v ? "var(--surface)" : "transparent", color: phaseChartView === v ? "var(--text)" : "var(--text4)", fontWeight: phaseChartView === v ? 600 : 400 }}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            {/* ─ Eigene Phasen (immer einzeln) ─ */}
            {customPhaseStats.length > 0 && (
              <div style={{ marginBottom: (project.enabledPhases || []).length > 0 || hasPositions ? 20 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, background: "var(--warning-bg)", color: "var(--warning)", padding: "2px 8px", borderRadius: 20 }}>EIGENE</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>{formatHours(customMinsTotal)}</span>
                </div>
                {customPhaseStats.map(cp => {
                  const pct = customMinsTotal > 0 ? (cp.mins / customMinsTotal) * 100 : 0;
                  return (
                    <div key={cp.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 500 }}>{cp.label}</span>
                        <span style={{ color: cp.mins > 0 ? "var(--warning)" : "#bbb", fontWeight: 500 }}>{formatHours(cp.mins)}</span>
                      </div>
                      <div style={{ height: 6, background: "var(--warning-bg)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: cp.mins > 0 ? "var(--warning)" : "transparent" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {phaseChartView === "gesamt" && hasPositions && (project.enabledPhases || []).length > 0 ? (() => {
              const allPhaseIds = [...new Set([
                ...(project.enabledPhases || []),
                ...positions.flatMap(pos => pos.enabledPhases || []),
                ...entries.map(e => e.phaseId).filter(id => id && SIA_PHASES.some(p => p.id === id)),
              ])];

              const segments = [
                { code: null, label: "HO", color: "var(--positive)" },
                ...positions.map(pos => ({ code: pos.code, label: pos.code || "NT", color: "var(--info)" })),
              ];

              // Phasenbudgets der Nachträge vorberechnen
              const posPhasesBudget = positions.map(pos => {
                const linkedQ = pos.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
                if (!linkedQ) return { code: pos.code, phases: [] };
                const roles = linkedQ.quoteRoles || data.settings.roles || [];
                let phases: { id: string; hours: number }[] = [];
                if (linkedQ.mode === "sia") {
                  const calc = calcSIAHours(linkedQ.sia?.baukosten, linkedQ.sia?.schwierigkeit, linkedQ.sia?.phases || []);
                  phases = (calc.phases || []).filter(p => p.hours > 0).map(p => ({ id: p.id, hours: Math.round(p.hours * 10) / 10 }));
                } else if (linkedQ.mode === "manual") {
                  phases = (linkedQ.manualPhases || []).filter(ph => ph.enabled).map(ph => {
                    const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
                    return { id: ph.id, hours: Math.round(h * 10) / 10 };
                  }).filter(p => p.hours > 0);
                }
                return { code: pos.code, phases };
              });

              const phaseRows = allPhaseIds.map(phId => {
                const ph = SIA_PHASES.find(p => p.id === phId);
                if (!ph) return null;
                const phEntries = entries.filter(e => e.phaseId === phId);
                const segMins = segments.map(seg => ({
                  ...seg,
                  mins: seg.code === null
                    ? phEntries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0)
                    : phEntries.filter(e => e.positionId === seg.code).reduce((s, e) => s + (e.minutes || 0), 0),
                }));
                const totalMins = segMins.reduce((s, s2) => s + s2.mins, 0);
                const hoBudget = phaseStats.find(ps => ps.id === phId)?.phaseBudget || 0;
                const ntBudget = posPhasesBudget.reduce((s, p) => s + (p.phases.find(p2 => p2.id === phId)?.hours || 0), 0);
                const totalPhaseBudget = hoBudget + ntBudget;
                const remainingH = totalPhaseBudget > 0 ? Math.max(0, totalPhaseBudget - totalMins / 60) : 0;
                return { ph, segMins, totalMins, totalPhaseBudget, remainingH };
              }).filter(notNull).filter(r => r.totalPhaseBudget > 0 || r.totalMins > 0);

              const activeSeg = segments.filter(seg =>
                phaseRows.some(r => (r.segMins.find(s => s.code === seg.code)?.mins || 0) > 0)
              );

              return (
                <div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    {activeSeg.map(seg => (
                      <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
                        <span style={{ color: "var(--text4)" }}>{seg.label}</span>
                      </div>
                    ))}
                    {phaseRows.some(r => r.remainingH > 0) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "#d0ccc8" }} />
                        <span style={{ color: "var(--text4)" }}>Verfügbar</span>
                      </div>
                    )}
                  </div>
                  {phaseRows.map(({ ph, segMins, totalMins, totalPhaseBudget, remainingH }) => {
                    const totalUsedH = totalMins / 60;
                    const isOver = totalPhaseBudget > 0 && totalUsedH > totalPhaseBudget;
                    const budgetPctPh = totalPhaseBudget > 0 ? (totalUsedH / totalPhaseBudget) * 100 : 0;
                    const labelColor = isOver ? "var(--negative)" : budgetPctPh >= 80 ? "var(--warning)" : "#1a1a18";
                    // Balken-Basis: bei Budget = Budget*60min, sonst = verwendete Minuten
                    const barBaseMins = totalPhaseBudget > 0 ? totalPhaseBudget * 60 : totalMins;
                    const remainingBarMins = totalPhaseBudget > 0 ? Math.max(0, totalPhaseBudget * 60 - totalMins) : 0;
                    return (
                      <div key={ph.id} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                          <span style={{ fontWeight: 500 }}>{ph.label}</span>
                          <span style={{ color: labelColor, fontWeight: 500 }}>
                            {formatHours(totalMins)}
                            {totalPhaseBudget > 0 && (
                              <span style={{ fontWeight: 400, color: "var(--text4)", marginLeft: 6 }}>
                                / {totalPhaseBudget}h
                                {remainingH > 0
                                  ? <span style={{ color: "var(--positive)" }}> · {remainingH.toFixed(1)}h offen</span>
                                  : isOver
                                    ? <span style={{ color: "var(--negative)" }}> · überschritten</span>
                                    : null}
                              </span>
                            )}
                          </span>
                        </div>
                        <div style={{ display: "flex", height: 8, borderRadius: 3, overflow: "hidden", background: "var(--surface3)" }}>
                          {barBaseMins > 0 && segMins.filter(s => s.mins > 0).map((seg, idx, arr) => (
                            <div key={seg.label} style={{ width: `${(seg.mins / barBaseMins) * 100}%`, height: "100%", background: isOver ? "var(--negative)" : seg.color, borderRight: idx < arr.length - 1 ? "1px solid rgba(255,255,255,0.4)" : "none", flexShrink: 0 }} />
                          ))}
                          {remainingBarMins > 0 && (
                            <div style={{ width: `${(remainingBarMins / barBaseMins) * 100}%`, height: "100%", background: "#d0ccc8", flexShrink: 0 }} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {unassignedMins > 0 && <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> {formatHours(unassignedMins)} ohne Phasen-Zuordnung</div>}
                </div>
              );
            })() : (
              <>
                {/* ─ Einzeln: Hauptauftrag ─ */}
                {(project.enabledPhases || []).length > 0 && (
                  <div style={{ marginBottom: hasPositions ? 20 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, background: "var(--positive-bg)", color: "var(--positive)", padding: "2px 8px", borderRadius: 20 }}>⬡ HO</span>
                      {hauptQ?.number && <span style={{ fontWeight: 600, color: "#b07848", fontSize: 12 }}>{hauptQ.number}</span>}
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>Hauptauftrag</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>{formatHours(hoMinsTotal)}</span>
                    </div>
                    {phaseStats.map(ps => {
                      const hoMins = ps.hoMins;
                      const hoHours = hoMins / 60;
                      const phasePct = ps.phaseBudget > 0 ? (hoHours / ps.phaseBudget) * 100 : (hoMinsTotal > 0 ? (hoMins / hoMinsTotal) * 100 : 0);
                      const barColor = ps.phaseBudget > 0 ? (phasePct >= 100 ? "var(--negative)" : phasePct >= 80 ? "var(--warning)" : "var(--positive)") : "var(--positive)";
                      return (
                        <div key={ps.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                            <span style={{ fontWeight: 500 }}>{ps.label}</span>
                            <span style={{ color: barColor, fontWeight: 500 }}>
                              {formatHours(hoMins)}
                              {ps.phaseBudget > 0 && ` / ${ps.phaseBudget}h (${phasePct.toFixed(0)}%)`}
                            </span>
                          </div>
                          <div style={{ height: 6, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(phasePct, 100)}%`, height: "100%", background: barColor }} />
                          </div>
                        </div>
                      );
                    })}
                    {unassignedMins > 0 && <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> {formatHours(unassignedMins)} ohne Phasen-Zuordnung</div>}
                  </div>
                )}

                {/* ─ Einzeln: Nachträge / Positionen ─ */}
                {positions.map(pos => {
                  const posEntries = entries.filter(e => e.positionId === pos.code);
                  const posMins = posEntries.reduce((s, e) => s + (e.minutes || 0), 0);
                  const enabledPhaseIds = pos.enabledPhases || [];
                  const extraPhaseIds = [...new Set(posEntries.map(e => e.phaseId).filter((id): id is string => !!id).filter(id => !enabledPhaseIds.includes(id)))];
                  const allPhaseIds = [...enabledPhaseIds, ...extraPhaseIds];
                  if (allPhaseIds.length === 0 && posMins === 0) return null;
                  const linkedQ = pos.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
                  let nachtragPhasesBudget: { id: string; hours: number }[] = [];
                  if (linkedQ) {
                    const roles = linkedQ.quoteRoles || data.settings.roles || [];
                    if (linkedQ.mode === "sia") {
                      const calc = calcSIAHours(linkedQ.sia?.baukosten, linkedQ.sia?.schwierigkeit, linkedQ.sia?.phases || []);
                      nachtragPhasesBudget = (calc.phases || []).filter(p => p.hours > 0).map(p => ({ id: p.id, hours: Math.round(p.hours * 10) / 10 }));
                    } else if (linkedQ.mode === "manual") {
                      nachtragPhasesBudget = (linkedQ.manualPhases || []).filter(ph => ph.enabled).map(ph => {
                        const h = roles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0);
                        return { id: ph.id, hours: Math.round(h * 10) / 10 };
                      }).filter(p => p.hours > 0);
                    }
                  }
                  return (
                    <div key={pos.code} style={{ paddingTop: 20, borderTop: "1px solid var(--border2)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, background: "var(--info-bg)", color: "var(--info)", padding: "2px 8px", borderRadius: 20 }}>↪ {pos.code}</span>
                        {linkedQ?.number && <span style={{ fontWeight: 600, color: "#b07848", fontSize: 12 }}>{linkedQ.number}</span>}
                        <span style={{ fontSize: 12, color: "var(--text3)" }}>{pos.label || "Nachtrag"}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--info)", fontWeight: 600 }}>{formatHours(posMins)}</span>
                      </div>
                      {allPhaseIds.length > 0 ? allPhaseIds.map(phId => {
                        const ph = SIA_PHASES.find(p => p.id === phId);
                        if (!ph) return null;
                        const phMins = posEntries.filter(e => e.phaseId === phId).reduce((s, e) => s + (e.minutes || 0), 0);
                        const phaseBudgetHours = nachtragPhasesBudget.find(p => p.id === phId)?.hours || 0;
                        const phHours = phMins / 60;
                        const phPct = phaseBudgetHours > 0 ? (phHours / phaseBudgetHours) * 100 : (posMins > 0 ? (phMins / posMins) * 100 : 0);
                        const barColor = phaseBudgetHours > 0 ? (phPct >= 100 ? "var(--negative)" : phPct >= 80 ? "var(--warning)" : "var(--info)") : (phMins > 0 ? "var(--info)" : "#ccc");
                        return (
                          <div key={phId} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                              <span style={{ fontWeight: 500 }}>{ph.label}</span>
                              <span style={{ color: barColor, fontWeight: 500 }}>
                                {formatHours(phMins)}
                                {phaseBudgetHours > 0 && ` / ${phaseBudgetHours}h (${phPct.toFixed(0)}%)`}
                              </span>
                            </div>
                            <div style={{ height: 6, background: "var(--info-bg)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(phPct, 100)}%`, height: "100%", background: barColor }} />
                            </div>
                          </div>
                        );
                      }) : (
                        <div style={{ fontSize: 12, color: "var(--text5)" }}>Noch keine Stunden erfasst</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })()}

      {/* Mitarbeiter-Auswertung */}
      {canSeeMitarbeiter && (() => {
        const employees = data.employees || [];
        // Gruppe nach Mitarbeiter
        const byEmp: Record<string, { mins: number; entries: TimeEntry[] }> = {};
        entries.forEach(e => {
          const empId = e.employeeId || "__none__";
          if (!byEmp[empId]) byEmp[empId] = { mins: 0, entries: [] };
          byEmp[empId].mins += e.minutes || 0;
          byEmp[empId].entries.push(e);
        });
        const empRows = Object.entries(byEmp).map(([empId, d]) => {
          const emp = empId === "__none__" ? null : employees.find(e => e.id === empId);
          // Aufschlüsselung nach Phase
          const byPhase: Record<string, number> = {};
          d.entries.forEach(e => {
            const k = e.phaseId || "__none__";
            byPhase[k] = (byPhase[k] || 0) + (e.minutes || 0);
          });
          const amount = billingType === "stundensatz" ? (d.mins / 60) * (project.hourlyRate as number) : null;
          return { empId, emp, mins: d.mins, amount, byPhase, count: d.entries.length };
        }).sort((a, b) => b.mins - a.mins);

        if (empRows.length === 0) return null;

        const totalMins = empRows.reduce((s, r) => s + r.mins, 0);

        return (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>MITARBEITER-AUSWERTUNG</div>
            <table>
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th style={{ textAlign: "right" }}>Stunden</th>
                  <th style={{ textAlign: "right" }}>Anteil</th>
                  {billingType === "stundensatz" && <th style={{ textAlign: "right" }}>Betrag</th>}
                  <th>Einträge</th>
                  <th>Phasen</th>
                </tr>
              </thead>
              <tbody>
                {empRows.map(row => {
                  const pct = totalMins > 0 ? Math.round(row.mins / totalMins * 100) : 0;
                  const phases = Object.entries(row.byPhase).map(([phId, mins]) => {
                    const ph = SIA_PHASES.find(p => p.id === phId);
                    return ph ? `${ph.id} (${formatHours(mins)})` : `— (${formatHours(mins)})`;
                  }).join(", ");
                  return (
                    <tr key={row.empId}>
                      <td>
                        <strong>{row.emp?.name || "Ohne Mitarbeiter"}</strong>
                        {row.emp?.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{row.emp.role}</div>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatHours(row.mins)}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <div style={{ width: 60, height: 6, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: "#b07848", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 12, color: "var(--text4)", minWidth: 32 }}>{pct}%</span>
                        </div>
                      </td>
                      {billingType === "stundensatz" && <td style={{ textAlign: "right" }}>{row.amount !== null ? formatCHF(row.amount) : "—"}</td>}
                      <td style={{ color: "var(--text4)", fontSize: 12 }}>{row.count} Einträge</td>
                      <td style={{ fontSize: 11, color: "var(--text4)" }}>{phases || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--text)" }}>
                  <td><strong>Total</strong></td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{formatHours(totalMins)}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: "var(--text4)" }}>100%</td>
                  {billingType === "stundensatz" && <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(empRows.reduce((s, r) => s + (r.amount || 0), 0))}</td>}
                  <td style={{ color: "var(--text4)", fontSize: 12 }}>{entries.length} Einträge</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })()}

      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>ZEITEINTRÄGE</div>
        <table style={{ tableLayout: "fixed" }}>
          <thead><tr>
            <th style={{ width: "12%" }}>Datum</th>
            {canSeeMitarbeiter && <th style={{ width: "14%" }}>Mitarbeiter</th>}
            <th style={{ width: "15%" }}>Phase / Position</th>
            <th>Tätigkeit</th>
            <th style={{ width: "10%" }}>Dauer</th>
            {canSeeInvoices && <th style={{ width: "11%" }}>Betrag</th>}
            {canSeeInvoices && <th style={{ width: "12%" }}>Rechnung</th>}
          </tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={canSeeMitarbeiter && canSeeInvoices ? 7 : 4} style={{ textAlign: "center", color: "var(--text5)", padding: 24 }}>Noch keine Zeiteinträge</td></tr>}
            {entries.map(e => {
              const phase = SIA_PHASES.find(p => p.id === e.phaseId);
              const pos = positions.find(p => p.code === e.positionId);
              const emp = e.employeeId ? (data.employees || []).find(em => em.id === e.employeeId) : null;
              const amount = billingType === "stundensatz" ? (e.minutes / 60) * (project.hourlyRate as number) : null;
              const invoice = e.invoiceId ? data.invoices.find(i => i.id === e.invoiceId) : null;
              const posQuote = pos?.quoteId ? (data.quotes || []).find(q => q.id === pos.quoteId) : null;
              const isStundensatzEntry = e.positionId
                ? posQuote?.mode === "manual"
                : billingType === "stundensatz";
              return (
                <tr key={e.id} style={{ opacity: invoice && canSeeInvoices ? 0.75 : 1 }}>
                  <td>{formatDate(e.date)}</td>
                  {canSeeMitarbeiter && <td style={{ fontSize: 11, color: "var(--text3)" }}>{emp?.name || <span style={{ color: "var(--text5)" }}>—</span>}</td>}
                  <td style={{ fontSize: 12 }}>
                    {isAdmin ? (
                      <select
                        value={e.phaseId ? (e.positionId ? e.phaseId + "|" + e.positionId : e.phaseId) : ""}
                        onChange={ev => {
                          const val = ev.target.value;
                          if (!val) { update("timeEntries", data.timeEntries.map(te => te.id === e.id ? { ...te, phaseId: "", positionId: "" } : te)); return; }
                          const [ph, p] = val.split("|");
                          update("timeEntries", data.timeEntries.map(te => te.id === e.id ? { ...te, phaseId: ph, positionId: p || "" } : te));
                        }}
                        disabled={!!e.invoiceId}
                        style={{ border: "1px solid var(--border)", height: 26, fontSize: 11, maxWidth: "100%", opacity: e.invoiceId ? 0.6 : 1 }}
                      >
                        <option value="">—</option>
                        {(project.customPhases || []).map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                        {positions.length === 0 && (project.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id} value={ph.id}>{ph.id}</option> : null; }).filter(Boolean)}
                        {positions.length > 0 && (project.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id} value={ph.id}>{ph.id} HO</option> : null; }).filter(Boolean)}
                        {positions.flatMap(pos => (pos.enabledPhases || []).map(phId => { const ph = SIA_PHASES.find(p => p.id === phId); return ph ? <option key={ph.id + "|" + pos.code} value={ph.id + "|" + pos.code}>{pos.code}·{ph.id}</option> : null; }).filter(Boolean))}
                      </select>
                    ) : phase ? (
                      <span>
                        <span style={{ color: "var(--text3)" }}>{phase.label.split(" ")[0]}</span>
                        {pos && <span style={{ fontWeight: 600, color: "var(--pending)", background: "#fffbe8", padding: "1px 5px", borderRadius: 20, marginLeft: 5, fontSize: 11 }}>{pos.code}</span>}
                      </span>
                    ) : <span style={{ color: "var(--text5)" }}>—</span>}
                  </td>
                  <td style={{ color: "var(--text3)" }}>{e.description || "—"}</td>
                  <td>{formatHours(e.minutes)}</td>
                  {canSeeInvoices && <td>{amount !== null ? formatCHF(amount) : "—"}</td>}
                  {canSeeInvoices && <td style={{ fontSize: 11 }}>
                    {invoice
                      ? <span className="tag" style={{ background: "var(--positive)", fontSize: 10 }}>{invoice.number}</span>
                      : isStundensatzEntry
                        ? <span style={{ color: "var(--text5)" }}>offen</span>
                        : null}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canSeeQuotes && (() => {
        const projectQuotes = (data.quotes || []).filter(q => q.projectId === projectId);
        if (projectQuotes.length === 0) return null;
        return (
          <div className="card" style={{ padding: 0, marginBottom: 20 }}>
            <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>OFFERTEN</div>
            <table style={{ tableLayout: "fixed" }}>
              <thead><tr><th style={{ width: "18%" }}>Nr.</th><th style={{ width: "14%" }}>Datum</th><th>Modus</th><th style={{ width: "14%" }}>Status</th><th style={{ width: "16%", textAlign: "right" }}>Honorar</th><th style={{ width: "7%" }}></th></tr></thead>
              <tbody>
                {projectQuotes.map(q => (
                  <tr key={q.id}>
                    <td><strong>{q.number}</strong></td>
                    <td>{formatDate(q.date)}</td>
                    <td style={{ fontSize: 11, color: "var(--text4)" }}>{q.mode === "sia" ? "SIA 102" : "Aufwand"}</td>
                    <td><StatusBadge status={q.status} /></td>
                    <td style={{ textAlign: "right" }}><strong>{formatCHF(q.total)}</strong></td>
                    <td style={{ textAlign: "right" }}>
                      <ShareButton style={{ padding: "5px 10px", fontSize: 12 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "quote", quote: q, client, settings: data.settings }) }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {canSeeInvoices && projectInvoices.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "16px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>RECHNUNGEN</div>
          <table style={{ tableLayout: "fixed" }}>
            <thead><tr><th style={{ width: "18%" }}>Nr.</th><th style={{ width: "14%" }}>Datum</th><th>Art</th><th style={{ width: "14%" }}>Status</th><th style={{ width: "16%", textAlign: "right" }}>Betrag</th><th style={{ width: "7%" }}></th></tr></thead>
            <tbody>
              {projectInvoices.map(inv => (
                <tr key={inv.id}>
                  <td><strong>{inv.number}</strong></td>
                  <td>{formatDate(inv.date)}</td>
                  <td style={{ fontSize: 11, color: "var(--text4)" }}>{inv.invoiceKind === "akonto" ? "Akonto" : inv.invoiceKind === "teilrechnung" ? "Teilrechnung" : inv.invoiceKind === "schluss" ? "Schluss" : "—"}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td style={{ textAlign: "right" }}><strong>{formatCHF(inv.total)}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    <ShareButton style={{ padding: "5px 10px", fontSize: 12 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "invoice", inv, client }) }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showOffen && (paidTotal > 0 || openTotal > 0) && (
            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border2)", display: "flex", gap: 24, fontSize: 12 }}>
              <span style={{ color: "#4a7c59" }}>Bezahlt: <strong>{formatCHF(paidTotal)}</strong></span>
              {openTotal > 0 && (
                <span style={{ color: "var(--warning)" }}>Noch offen: <strong>{formatCHF(openTotal)}</strong></span>
              )}
              {openTotal === 0 && paidTotal > 0 && (
                <span style={{ color: "var(--text4)", fontSize: 11 }}>Alles bezahlt</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Protokolle zum Projekt */}
      {(() => {
        const projProtokolle = (data.protocols || [])
          .filter(p => p.projectId === projectId)
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        return (
          <div className="card" style={{ padding: 0, marginTop: 20 }}>
            <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: projProtokolle.length > 0 ? "1px solid var(--border2)" : "none" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>PROTOKOLLE ({projProtokolle.length})</div>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => {
                const p = {
                  id: generateId(),
                  title: "",
                  type: PROTOKOLL_TYPES[0],
                  date: localISODate(),
                  time: "10:00",
                  endTime: "",
                  location: "",
                  projectId,
                  projectManual: "",
                  nummer: (() => {
                    const all = data.protocols || [];
                    const abbr = data.settings.protokollTypeAbbreviations || {};
                    const typKuerzel = abbr[PROTOKOLL_TYPES[0]] || "SO";
                    const proj = data.projects.find(x => x.id === projectId);
                    const seq = nextProtoSeq(all);
                    return applyProtoNumberFormat(data.settings.protokollNumberFormat || "PP-TT-NN", {
                      date: localISODate(),
                      projectNumber: proj?.number || "",
                      seq,
                      typKuerzel,
                    });
                  })(),
                  participants: [],
                  traktanden: [{ id: generateId(), nr: "1", title: "", items: [] }],
                  nextDate: "",
                  verteiler: "",
                  createdAt: new Date().toISOString(),
                };
                saveAll({ ...data, protocols: [...(data.protocols || []), p] });
                // navigate to protokolle view – signal via a custom event
                window.__openProtokoll = p.id;
                window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: p.id } }));
              }}>+ Neues Protokoll</button>
            </div>
            {projProtokolle.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Nr.</th>
                    <th style={{ width: 100 }}>Datum</th>
                    <th style={{ width: 160 }}>Typ</th>
                    <th>Titel</th>
                    <th style={{ width: 60, textAlign: "center" }}>TN</th>
                    <th style={{ width: 50, textAlign: "center" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle" }}>push_pin</span></th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {projProtokolle.map(proto => {
                    const anwesend = (proto.participants || []).filter(x => x.status === "anwesend").length;
                    const total = (proto.participants || []).length;
                    const offene = (proto.traktanden || []).flatMap(t => (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt")).length;
                    return (
                      <tr key={proto.id}>
                        <td><strong style={{ color: "#b07848" }}>{proto.nummer}</strong></td>
                        <td>{formatDate(proto.date)}</td>
                        <td style={{ fontSize: 11, color: "var(--text4)" }}>{proto.type}</td>
                        <td>{proto.title || <span style={{ color: "var(--text5)" }}>Kein Titel</span>}</td>
                        <td style={{ textAlign: "center", fontSize: 12, color: "var(--text4)" }}>{total > 0 ? `${anwesend}/${total}` : "—"}</td>
                        <td style={{ textAlign: "center" }}>{offene > 0 && <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>{offene}</span>}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
                            onClick={() => { window.__openProtokoll = proto.id; window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: proto.id } })); }}>
                            Öffnen
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* Einstellungen Modal */}
      {settingsOpen && (() => {
        const projectContacts = settingsForm.projectContacts || [];
        const allContacts = (data.persons || []);
        const alreadyAdded = new Set(projectContacts.map(pc => pc.contactId));
        const selectedFirm = allContacts.find(c => c.id === addContactId);

        const addBeteiligte = () => {
          if (!addContactId) return;
          setSettingsForm(f => ({ ...f, projectContacts: [...(f.projectContacts || []), { contactId: addContactId, personIds: addPersonIds }] }));
          setShowAddBeteiligter(false); setAddContactId(""); setAddPersonIds([]);
        };
        const saveEditedBeteiligte = (contactId: string) => {
          setSettingsForm(f => ({ ...f, projectContacts: (f.projectContacts || []).map(pc => pc.contactId === contactId ? { ...pc, personIds: addPersonIds } : pc) }));
          setEditingContactId(null); setAddPersonIds([]);
        };
        const removeBeteiligte = (contactId: string) => {
          setSettingsForm(f => ({ ...f, projectContacts: (f.projectContacts || []).filter(pc => pc.contactId !== contactId) }));
        };
        const togglePerson = (personId: string) => setAddPersonIds(prev =>
          prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]);

        return (
          <Modal title="Projekteinstellungen" onClose={() => setSettingsOpen(false)} onSave={saveSettings} wide>
            <ProjectEditForm form={settingsForm} setForm={setSettingsForm} data={data} />

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 12 }}>INTERNE PROJEKTBETEILIGUNG</div>
              {(data.employees || []).length === 0
                ? <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Noch keine Mitarbeitenden erfasst.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                    {(data.employees || []).map(emp => {
                      const checked = (settingsForm.internalMembers || []).includes(emp.id);
                      return (
                        <label key={emp.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, background: checked ? "#f0ede8" : "#faf9f7", border: `1px solid ${checked ? "#c8b89a" : "#ece8e2"}`, borderRadius: 8, padding: "4px 10px" }}>
                          <input type="checkbox" checked={checked} onChange={() => setSettingsForm(f => ({ ...f, internalMembers: checked ? (f.internalMembers || []).filter(id => id !== emp.id) : [...(f.internalMembers || []), emp.id] }))} style={{ margin: 0 }} />
                          <span>{emp.name}</span>
                          {emp.role && <span style={{ fontSize: 10, color: "var(--text5)" }}>{emp.role}</span>}
                        </label>
                      );
                    })}
                  </div>
              }
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 12 }}>PROJEKTBETEILIGTE</div>

              {projectContacts.map(pc => {
                const firm = allContacts.find(c => c.id === pc.contactId);
                if (!firm) return null;
                const selectedPersons = (firm.contacts || []).filter(p => pc.personIds!.includes(p.id));
                const isEditing = editingContactId === pc.contactId;
                return (
                  <div key={pc.contactId} style={{ padding: "10px 0", borderBottom: "1px solid var(--border2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        {firm.type && <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 2, letterSpacing: "0.06em" }}>{firm.type.toUpperCase()}</div>}
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{firm.name}</div>
                        {!isEditing && (selectedPersons.length > 0
                          ? <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {selectedPersons.map(p => <span key={p.id} style={{ fontSize: 11, background: "var(--surface2)", color: "var(--text2)", padding: "2px 8px", borderRadius: 20 }}>{p.name}{p.position ? " · " + p.position : ""}</span>)}
                            </div>
                          : <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 3 }}>Alle Ansprechpartner</div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(firm.contacts || []).length > 0 && !isEditing && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => { setEditingContactId(pc.contactId as string); setAddPersonIds(pc.personIds || []); setShowAddBeteiligter(false); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                        )}
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", color: "var(--text4)" }} onClick={() => removeBeteiligte(pc.contactId as string)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                      </div>
                    </div>
                    {isEditing && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Personen (leer = alle):</div>
                        {(firm.contacts || []).map(p => (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 4 }}>
                            <input type="checkbox" checked={addPersonIds.includes(p.id)} onChange={() => togglePerson(p.id)} />
                            <span>{p.name}</span>
                            {p.position && <span style={{ fontSize: 11, color: "var(--text4)" }}>{p.position}</span>}
                          </label>
                        ))}
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => saveEditedBeteiligte(pc.contactId as string)}>Speichern</button>
                          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditingContactId(null); setAddPersonIds([]); }}>Abbrechen</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {projectContacts.length === 0 && !showAddBeteiligter && (
                <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Noch keine Beteiligten erfasst.</div>
              )}

              {showAddBeteiligter ? (
                <div style={{ marginTop: 12 }}>
                  <select value={addContactId} onChange={e => { setAddContactId(e.target.value); setAddPersonIds([]); }} style={{ width: "100%", height: 34, marginBottom: 10 }}>
                    <option value="">— Firma wählen —</option>
                    {allContacts.filter(c => !alreadyAdded.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                      <option key={c.id} value={c.id}>{c.type ? "[" + c.type + "] " : ""}{c.name}</option>
                    ))}
                  </select>
                  {selectedFirm && (selectedFirm.contacts || []).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Personen (leer = alle):</div>
                      {(selectedFirm.contacts || []).map(p => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 4 }}>
                          <input type="checkbox" checked={addPersonIds.includes(p.id)} onChange={() => togglePerson(p.id)} />
                          <span>{p.name}</span>
                          {p.position && <span style={{ fontSize: 11, color: "var(--text4)" }}>{p.position}</span>}
                        </label>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={addBeteiligte} disabled={!addContactId}>Hinzufügen</button>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setShowAddBeteiligter(false); setAddContactId(""); setAddPersonIds([]); }}>Abbrechen</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-ghost" style={{ fontSize: 12, marginTop: 10 }} onClick={() => setShowAddBeteiligter(true)}>+ Beteiligten hinzufügen</button>
              )}
            </div>
          </Modal>
        );
      })()}

            {/* Budget / Offerten-Modal */}
      {budgetModal && (() => {
        const ROLES = ["Hauptofferte", "Nachtrag", "Referenz"];
        const linked = budgetForm.linkedQuotes || [];
        const nachtragLinked = linked.filter(lq => lq.role !== "Hauptofferte" && lq.role !== "Referenz");
        const alreadyInOtherProjects = new Set((data.projects || []).filter(p => p.id !== projectId).flatMap(p => migrateLinkedQuotes(p).map(lq => lq.quoteId)));
        const unlinked = (data.quotes || []).filter(q => !linked.some(lq => lq.quoteId === q.id) && !alreadyInOtherProjects.has(q.id));
        const sortedLinked = [
          ...linked.filter(lq => lq.role === "Hauptofferte"),
          ...linked.filter(lq => lq.role !== "Hauptofferte"),
        ];
        return (
          <Modal title="Budget & Honorarofferten" onClose={() => setBudgetModal(false)} onSave={saveBudget} wide>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>VERKNÜPFTE OFFERTEN</div>

            {sortedLinked.map(lq => {
              const q = (data.quotes || []).find(x => x.id === lq.quoteId);
              if (!q) return null;
              const isNT = lq.role === "Nachtrag";
              const ntIdx = isNT ? nachtragLinked.findIndex(x => x.quoteId === lq.quoteId) : -1;
              const posCode = isNT ? `N${ntIdx + 1}` : null;
              const pos = isNT
                ? ((budgetForm.positions || []).find(p => p.quoteId === lq.quoteId) || (posCode ? (budgetForm.positions || []).find(p => p.code === posCode) : null))
                : null;
              const currentPhases = isNT ? (pos?.enabledPhases || []) : (budgetForm.enabledPhases || []);
              const togglePhase = (phId: string) => {
                if (isNT) {
                  setBudgetForm(f => ({
                    ...f,
                    positions: f.positions.map(p =>
                      (p.quoteId ? p.quoteId === lq.quoteId : p.code === posCode)
                        ? { ...p, enabledPhases: (p.enabledPhases || []).includes(phId) ? (p.enabledPhases || []).filter(x => x !== phId) : [...(p.enabledPhases || []), phId] }
                        : p
                    ),
                  }));
                } else {
                  setBudgetForm(f => {
                    const phases = f.enabledPhases || [];
                    return { ...f, enabledPhases: phases.includes(phId) ? phases.filter(p => p !== phId) : [...phases, phId] };
                  });
                }
              };
              const qRoles = q.quoteRoles || data.settings.roles || [];
              const qH = q.mode === "sia" ? (calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []).total || 0)
                : q.mode === "manual" ? (calcManualHours(q.manualPhases || [], qRoles).totalHours || 0) : 0;
              const bgColor = isNT ? "#f0f5fd" : "#faf8f5";
              const borderColor = isNT ? "#c8d8ee" : "#ddd8d0";
              const accentColor = isNT ? "var(--info)" : "var(--positive)";
              return (
                <div key={lq.quoteId} style={{ marginBottom: 12, border: `1px solid ${borderColor}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: bgColor, flexWrap: "wrap" }}>
                    {isNT && pos ? (
                      <>
                        <input value={pos.code || ""} onChange={e => setBudgetForm(f => ({ ...f, positions: f.positions.map(p => p.quoteId === lq.quoteId ? { ...p, code: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 6) } : p) }))} placeholder="N1" style={{ width: 52, fontWeight: 700, fontSize: 12, height: 26, padding: "0 6px" }} />
                        <input value={pos.label || ""} onChange={e => setBudgetForm(f => ({ ...f, positions: f.positions.map(p => p.quoteId === lq.quoteId ? { ...p, label: e.target.value } : p) }))} placeholder="z.B. Nachtrag Fassade" style={{ flex: 1, minWidth: 80, fontSize: 12, height: 26, padding: "0 6px" }} />
                      </>
                    ) : lq.role === "Referenz" ? (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "#f0f0ee", color: "var(--text4)", padding: "2px 8px", borderRadius: 20 }}>⬡ REF</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "var(--positive-bg)", color: accentColor, padding: "2px 8px", borderRadius: 20 }}>⬡ HO</span>
                    )}
                    <span style={{ fontWeight: 600, color: "#b07848" }}>{q.number}</span>
                    <span style={{ color: "var(--text4)", fontSize: 11 }}>{q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"}</span>
                    {qH > 0 && <span style={{ color: "var(--text3)", fontSize: 11 }}>{qH.toFixed(1)}h · {formatCHF(q.sub || q.total || 0)}</span>}
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <select value={lq.role} onChange={e => changeLinkedRole(lq.quoteId, e.target.value)} style={{ fontSize: 11, height: 26, padding: "0 6px" }}>
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                      <button className="btn btn-danger" style={{ padding: "0 6px", height: 24, fontSize: 10 }} onClick={() => removeLinkedQuote(lq.quoteId)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </div>
                  </div>
                  <div style={{ padding: "10px 14px", background: "var(--surface)" }}>
                    <div style={{ fontSize: 10, color: "var(--text4)", marginBottom: 6, letterSpacing: "0.07em" }}>AKTIVIERTE SIA-PHASEN FÜR ZEITERFASSUNG</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {SIA_PHASES.map(ph => (
                        <label key={ph.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, textTransform: "none", color: "var(--text)", padding: "3px 0" }}>
                          <input type="checkbox" checked={currentPhases.includes(ph.id)} onChange={() => togglePhase(ph.id)} style={{ width: "auto" }} />
                          {ph.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {linked.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Noch keine Offerte verknüpft. SIA, Aufwand und Pauschal-Offerten können verknüpft werden.</div>
            )}
            {unlinked.length > 0 && (
              <select defaultValue="" onChange={e => { if (e.target.value) { addLinkedQuote(e.target.value); e.target.value = ""; } }} style={{ fontSize: 12, width: "100%", marginBottom: 16 }}>
                <option value="">{linked.length === 0 ? "Offerte verknüpfen…" : "+ Nachtrag / weitere Offerte hinzufügen…"}</option>
                {unlinked.map(q => <option key={q.id} value={q.id}>{q.number} — {q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"} · {formatCHF(q.total)}</option>)}
              </select>
            )}

            <FormField label="Stundenbudget manuell überschreiben (leert Offerten-Verknüpfung)">
              <input type="number" step="0.5" min={0} value={budgetForm.budgetHours || 0}
                onChange={e => setBudgetForm(f => ({ ...f, budgetHours: +e.target.value, linkedQuotes: [], phasesBudget: [] }))}
                placeholder="0 = aus Offerten berechnet" />
            </FormField>
          </Modal>
        );
      })()}
    </div>
  );
}
