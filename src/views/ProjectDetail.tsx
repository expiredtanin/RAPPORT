// Projekt-Detailansicht: Budget- und Zeitauswertung, Phasen, Offerten/Nachträge, Rechnungen,
// Protokolle und Zeiteinträge eines Projekts (Datenmodell siehe Kopf von Projects.tsx).
// Berechtigungen: Offerten- und Rechnungsdaten nur mit «quotes» bzw. «invoices» (`userPermissions`).

import React, { useState } from "react";
import { NON_BILLING_CATEGORIES } from "../constants";
import { deriveQuoteBudget, migrateLinkedQuotes } from "../utils";
import { ShareButton } from "../components/UI";
import type { ProjectPosition, ViewProps } from "../types";
import type { ProjectForm } from "./ProjectEditForm";
import { type BudgetForm, type LinkedQuote, computePhaseStats } from "./project-detail/helpers";
import { KpiRow } from "./project-detail/KpiRow";
import { ContactsBar } from "./project-detail/ContactsBar";
import { BudgetCard } from "./project-detail/BudgetCard";
import { PhaseCard } from "./project-detail/PhaseCard";
import { EmployeeCard } from "./project-detail/EmployeeCard";
import { TimeEntriesCard } from "./project-detail/TimeEntriesCard";
import { QuotesCard } from "./project-detail/QuotesCard";
import { InvoicesCard } from "./project-detail/InvoicesCard";
import { ProtocolsCard } from "./project-detail/ProtocolsCard";
import { SettingsModal } from "./project-detail/SettingsModal";
import { BudgetModal } from "./project-detail/BudgetModal";

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

  const [budgetForm, setBudgetForm] = useState<BudgetForm>(() => ({
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
  const phaseStats = computePhaseStats(project, entries, positions, hoPhasesBudget, totalMinutes);
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

      <KpiRow project={project} data={data} entries={entries} totalMinutes={totalMinutes} totalHours={totalHours} budget={budget} budgetPct={budgetPct} budgetColor={budgetColor} isCostControl={isCostControl} isNonBilling={isNonBilling} invoicedMinutes={invoicedMinutes} openMinutes={openMinutes} />

      {/* Projektbeteiligte */}
      {(project.projectContacts || []).length > 0 && <ContactsBar project={project} data={data} />}

      {/* Stundenbudget-Anzeige — offertenabgeleitet (Hauptofferten-Betrag etc.),
          daher wie der "Budget / Offerten"-Button an canSeeQuotes gekoppelt. */}
      {canSeeQuotes && <BudgetCard project={project} data={data} entries={entries} positions={positions} projectInvoices={projectInvoices} budget={budget} totalHours={totalHours} budgetPct={budgetPct} budgetColor={budgetColor} canSeeInvoices={canSeeInvoices} budgetChartView={budgetChartView} setBudgetChartView={setBudgetChartView} onOpenBudget={() => { openBudgetModal(); setBudgetModal(true); }} />}

      {/* Aufwand pro Phase — Hauptofferte + Nachträge in einer Karte */}
      {((project.enabledPhases || []).length > 0 || positions.some(pos => entries.some(e => e.positionId === pos.code)) || customPhaseStats.length > 0) && (
        <PhaseCard project={project} data={data} entries={entries} positions={positions} phaseStats={phaseStats} customPhaseStats={customPhaseStats} customMinsTotal={customMinsTotal} unassignedMins={unassignedMins} phaseChartView={phaseChartView} setPhaseChartView={setPhaseChartView} />
      )}

      {/* Mitarbeiter-Auswertung */}
      {canSeeMitarbeiter && <EmployeeCard project={project} data={data} entries={entries} billingType={billingType} />}

      <TimeEntriesCard project={project} data={data} update={update} entries={entries} positions={positions} billingType={billingType} isAdmin={isAdmin} canSeeMitarbeiter={canSeeMitarbeiter} canSeeInvoices={canSeeInvoices} />

      {canSeeQuotes && <QuotesCard data={data} projectId={projectId} client={client} setPrintContent={setPrintContent} />}

      {canSeeInvoices && projectInvoices.length > 0 && (
        <InvoicesCard projectInvoices={projectInvoices} client={client} setPrintContent={setPrintContent} showOffen={showOffen} paidTotal={paidTotal} openTotal={openTotal} />
      )}

      {/* Protokolle zum Projekt */}
      <ProtocolsCard data={data} saveAll={saveAll} projectId={projectId} />

      {/* Einstellungen Modal */}
      {settingsOpen && (
        <SettingsModal data={data} settingsForm={settingsForm} setSettingsForm={setSettingsForm} showAddBeteiligter={showAddBeteiligter} setShowAddBeteiligter={setShowAddBeteiligter} editingContactId={editingContactId} setEditingContactId={setEditingContactId} addContactId={addContactId} setAddContactId={setAddContactId} addPersonIds={addPersonIds} setAddPersonIds={setAddPersonIds} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      )}

      {/* Budget / Offerten-Modal */}
      {budgetModal && (
        <BudgetModal data={data} projectId={projectId} budgetForm={budgetForm} setBudgetForm={setBudgetForm} addLinkedQuote={addLinkedQuote} removeLinkedQuote={removeLinkedQuote} changeLinkedRole={changeLinkedRole} onClose={() => setBudgetModal(false)} onSave={saveBudget} />
      )}
    </div>
  );
}
