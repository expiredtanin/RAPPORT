// Projekt-Arbeitsraum (seit Beta 26.11): links die Projektliste, rechts das Projekt mit Phasenleiste, Aktionen
// (Stoppuhr, Protokoll, Rechnung) und Reitern — Überblick, Stunden, Termine, Honorar & Rechnungen, Protokolle,
// Beteiligte. Die Reiter zeigen die Karten aus project-detail/ (Budget- und Zeitauswertung, Phasen,
// Terminprogramm, Offerten/Nachträge, Rechnungen, Protokolle, Zeiteinträge); Datenmodell siehe Kopf von Projects.tsx.
// Berechtigungen: Offerten- und Rechnungsdaten nur mit «quotes» bzw. «invoices» (`userPermissions`).

import React, { useRef, useState } from "react";
import { NON_BILLING_CATEGORIES } from "../constants";
import { deriveQuoteBudget, hasQuoteBudget, invoiceNet, migrateLinkedQuotes, projectFee } from "../utils";
import { RowMenu } from "../components/UI";
import type { PaletteTarget } from "../commandPalette";
import { readTimer, writeTimer, weekAgenda } from "../today";
import { showToast } from "../toast";
import { applyEdit } from "../storage/merge";
import type { Project } from "../types";
import { formatHours, localISODate } from "../utils";
import { ProjectList, PhaseBar, OverviewTab, PeopleList, type WsFigure } from "./project-detail/Workspace";
import type { ProjectPosition, ViewProps } from "../types";
import type { ProjectForm } from "./ProjectEditForm";
import { type BudgetForm, type LinkedQuote, computePhaseStats } from "./project-detail/helpers";
import { KpiRow } from "./project-detail/KpiRow";
import { BudgetCard } from "./project-detail/BudgetCard";
import { PhaseCard } from "./project-detail/PhaseCard";
import { EmployeeCard } from "./project-detail/EmployeeCard";
import { TimeEntriesCard } from "./project-detail/TimeEntriesCard";
import { QuotesCard } from "./project-detail/QuotesCard";
import { InvoicesCard } from "./project-detail/InvoicesCard";
import { withPrintSummary } from "./invoices/invoiceHelpers";
import { ProtocolsCard } from "./project-detail/ProtocolsCard";
import { SettingsModal } from "./project-detail/SettingsModal";
import { BudgetModal } from "./project-detail/BudgetModal";
import { ScheduleEditor } from "./schedule/ScheduleEditor";

declare global {
  interface Window {
    /** Einmaliger Hinweis von anderen Ansichten: Reiter, mit dem der Projekt-Arbeitsraum öffnet. */
    __projectTab?: string | null;
  }
}

export default
function ProjectDetail({ data, update, saveAll, projectId, onBack, onSelect, run, setPrintContent, userPermissions, currentUser }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent" | "modal" | "setModal" | "currentUser" | "userPermissions"> & {
  projectId: string;
  onBack: () => void;
  /** anderes Projekt öffnen (Projektliste) */
  onSelect: (id: string) => void;
  /** Aktionen wie in der Befehlspalette (neue Rechnung/Protokoll zum Projekt, zu «Heute») */
  run: (t: PaletteTarget) => void;
}) {
  // userPermissions (aus App.tsx, bereits rollen-aufgelöst) statt des nie befüllten Legacy-Felds
  // currentUser.permissions — letzteres ist für rollenbasierte Cloud-User immer undefined.
  const isAdmin        = userPermissions === null;
  const canSeeQuotes   = isAdmin || userPermissions.includes("quotes");
  const canSeeInvoices = isAdmin || userPermissions.includes("invoices");
  const canSeeMitarbeiter = isAdmin || userPermissions.includes("mitarbeiter");
  const project = data.projects.find(p => p.id === projectId);
  const emptySettingsForm: ProjectForm = { number: "", name: "", clientId: "", category: "Direktauftrag", billingType: "stundensatz", hourlyRate: data.settings.defaultHourlyRate, budget: 0, status: "aktiv", description: "", startDate: "", enabledPhases: [], budgetHours: 0, linkedQuotes: [], positions: [], customPhases: [], internalMembers: [] };
  // Startreiter: einmaliger Hinweis anderer Ansichten (z.B. Terminplanung → «Termine»), sonst Überblick
  const [tab, setTab] = useState(() => { const t = window.__projectTab || "ueberblick"; window.__projectTab = null; return t; });
  const [budgetModal, setBudgetModal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [budgetChartView, setBudgetChartView] = useState("einzeln");
  const [phaseChartView, setPhaseChartView] = useState("einzeln");
  const [settingsForm, setSettingsForm] = useState<ProjectForm>(() => project ? { ...emptySettingsForm, ...project, enabledPhases: project.enabledPhases || [] } : emptySettingsForm);
  const [showAddBeteiligter, setShowAddBeteiligter] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [addContactId, setAddContactId] = useState("");
  const [addPersonIds, setAddPersonIds] = useState<string[]>([]);

  // Projekt beim Öffnen eines Fensters (Einstellungen, Budget): gespeichert wird nur, was im Fenster geändert
  // wurde (applyEdit) — sonst setzte es Änderungen anderer seit dem Öffnen zurück
  const openedAs = useRef<Project | null>(null);
  const saveEdited = (fields: Partial<Project>) => update("projects", prev => prev.map(p => {
    if (p.id !== projectId) return p;
    const base = openedAs.current?.id === projectId ? openedAs.current : p;
    return applyEdit<Project>(base, { ...base, ...fields } as Project, p);
  }));
  const openSettings = () => {
    if (!project) return;
    openedAs.current = project;
    setSettingsForm({ ...emptySettingsForm, ...project, enabledPhases: project.enabledPhases || [], projectContacts: project.projectContacts || [], internalMembers: project.internalMembers || [] });
    setShowAddBeteiligter(false);
    setEditingContactId(null);
    setAddContactId("");
    setAddPersonIds([]);
    setSettingsOpen(true);
  };
  const saveSettings = () => {
    if (!settingsForm.name?.trim()) { showToast("Bitte einen Projektnamen eingeben."); return; }
    if ([settingsForm.hourlyRate, settingsForm.budget, settingsForm.budgetHours].some(v => v != null && String(v) !== "" && !(Number(v) >= 0))) { showToast("Stundensatz, Budget und Budgetstunden dürfen nicht negativ sein."); return; }
    const num = (settingsForm.number || "").trim();
    if (num && num !== (project?.number || "").trim() && data.projects.some(p => p.id !== projectId && (p.number || "").trim() === num)) { showToast(`Die Projektnummer ${num} ist schon vergeben.`); return; }
    saveEdited(settingsForm as Partial<Project>);
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
    openedAs.current = project || null;
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
    // Pauschalpreis mit den verknüpften Offerten (Hauptofferte + Nachträge) nachführen — eine Quelle (projectFee)
    const budget = budgetForm.billingType === "pauschal" && hasQuoteBudget(budgetForm) ? budgetForm.budgetAmount : project.budget;
    saveEdited({ ...budgetForm, budget } as Partial<Project>);
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
  const totalAmount = billingType === "stundensatz" ? (totalMinutes / 60) * (project.hourlyRate as number) : projectFee(project);
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

  // ── Arbeitsraum ────────────────────────────────────────────────
  const canSeeTime = isAdmin || userPermissions.includes("time");
  const nextTerm = weekAgenda(data, localISODate(), 60, { projectId })[0];
  const invoicedTotal = projectInvoices.filter(i => i.status !== "entwurf").reduce((s, i) => s + invoiceNet(i), 0);
  const chf0 = (n: number) => Math.round(n).toLocaleString("de-CH").replace(/[’\u2019]/g, "'");
  const figures: WsFigure[] = [
    { label: "Stunden", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget} h · ${Math.round(budgetPct)} %` : `${entries.length} Einträge`, tone: budgetPct >= 100 ? "neg" : budgetPct >= 80 ? "warn" : undefined },
    ...(canSeeInvoices ? [{ label: "Honorar verrechnet", value: chf0(invoicedTotal), sub: projectFee(project) ? `von CHF ${chf0(projectFee(project))}` : `${projectInvoices.length} Rechnung(en)` }] : []),
    showOffen
      ? { label: "Offen zu verrechnen", value: formatHours(openMinutes), sub: project.hourlyRate && canSeeInvoices ? `≈ CHF ${chf0(openMinutes / 60 * (project.hourlyRate as number))}` : undefined, tone: openMinutes > 0 ? "warn" as const : undefined }
      : { label: "Budget genutzt", value: budget > 0 ? `${Math.round(budgetPct)} %` : "—", sub: isCostControl ? "Kostenkontrolle" : undefined, tone: budgetPct >= 100 ? "neg" as const : undefined },
    { label: "Nächster Termin", value: nextTerm ? nextTerm.label : "—", sub: nextTerm ? new Date(nextTerm.date + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" }) : "nichts geplant" },
  ];
  // Nur Stunden der Hauptofferte (ohne Nachtrags-Position) gegen das Phasenbudget der Hauptofferte —
  // Nachträge haben ihr eigenes Budget (PhaseCard).
  const overrun = phaseStats.filter(ps => ps.phaseBudget > 0 && ps.hoMins / 60 > ps.phaseBudget * 1.02).map(ps => ps.label || (ps.id as string)); // Label («32 Bauprojekt»), nicht nur die Nummer
  const hasPhases = (project.enabledPhases || []).length > 0 || positions.some(pos => entries.some(e => e.positionId === pos.code)) || customPhaseStats.length > 0;
  const phaseCard = hasPhases ? <PhaseCard project={project} data={data} entries={entries} positions={positions} phaseStats={phaseStats} customPhaseStats={customPhaseStats} customMinsTotal={customMinsTotal} unassignedMins={unassignedMins} phaseChartView={phaseChartView} setPhaseChartView={setPhaseChartView} /> : null;
  const openBudget = () => { openBudgetModal(); setBudgetModal(true); };
  const myEmpId = currentUser?.employeeId || "";
  const startTimer = () => {
    const running = readTimer();
    if (running) { showToast("Es läuft schon eine Stoppuhr — unter «Heute» wechseln"); run({ kind: "view", view: "heute" }); return; }
    if (!myEmpId) { showToast("Dein Login ist mit keiner Person verknüpft — Person unter «Heute» wählen"); run({ kind: "view", view: "heute" }); return; }
    writeTimer({ employeeId: myEmpId, projectId, start: new Date().toISOString() });
    showToast(`Stoppuhr für «${project.name}» läuft`);
    run({ kind: "view", view: "heute" });
  };
  const protocolCount = (data.protocols || []).filter(p => p.projectId === projectId).length;
  const peopleCount = (project.projectContacts || []).length + (project.clientId ? 1 : 0);
  const tabs = [
    { id: "ueberblick", label: "Überblick" },
    { id: "stunden", label: "Stunden" },
    { id: "termine", label: "Termine" },
    ...(canSeeQuotes || canSeeInvoices ? [{ id: "honorar", label: "Honorar & Rechnungen" }] : []),
    { id: "protokolle", label: "Protokolle", count: protocolCount },
    { id: "beteiligte", label: "Beteiligte", count: peopleCount },
  ];

  return (
    <div className="ws">
      <ProjectList data={data} currentId={projectId} onSelect={id => { setTab("ueberblick"); onSelect(id); }} />
      <div className="ws-main">
        <div className="ws-head">
          <button className="btn btn-quiet btn-sm ws-back" onClick={onBack}><span className="msr" style={{ fontSize: 16 }}>arrow_back</span>Alle Projekte</button>
          <div className="ws-crumb">{project.number && <b>{project.number}</b>}{[project.category, client?.name].filter(Boolean).join(" · ")}</div>
          <div className="ws-title">
            <h1>{project.name}</h1>
            <div className="ws-actions">
              {canSeeTime && <button className="btn btn-ghost" onClick={startTimer} title="Stoppuhr für dieses Projekt starten"><span className="msr" style={{ fontSize: 17 }}>play_arrow</span>Stoppuhr</button>}
              <button className="btn btn-ghost" onClick={() => run({ kind: "action", action: "newProtocol", projectId })}><span className="msr" style={{ fontSize: 17 }}>description</span>Protokoll</button>
              {canSeeInvoices && <button className="btn btn-primary" onClick={() => run({ kind: "action", action: "newInvoice", projectId })}><span className="msr" style={{ fontSize: 17 }}>receipt_long</span>Rechnung</button>}
              <RowMenu label="Weitere Aktionen" items={[
                { label: "Projekteinstellungen", icon: "tune", hidden: !isAdmin, onClick: openSettings },
                { label: "Budget / Offerten", icon: "request_quote", hidden: !canSeeQuotes, onClick: openBudget },
                { label: "PDF Projektblatt", icon: "picture_as_pdf", onClick: () => setPrintContent({ type: "projectDetail", project, client, entries, phaseStats, unassignedMins, totalMinutes, totalAmount: canSeeInvoices ? totalAmount : 0, billingType, invoices: canSeeInvoices ? projectInvoices : [], showMoney: canSeeInvoices, data }) },
              ]} />
            </div>
          </div>
          {project.description && <div className="ws-desc">{project.description}</div>}
          <PhaseBar project={project} entries={entries} />
          <nav className="ws-tabs" role="tablist">
            {tabs.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}{t.count ? <span className="ws-count">{t.count}</span> : null}
              </button>
            ))}
          </nav>
        </div>

        {tab === "ueberblick" && (
          <OverviewTab data={data} project={project} figures={figures} phaseCard={phaseCard} overrun={overrun}
            onNachtrag={canSeeQuotes ? openBudget : undefined} onOpenTab={setTab} />
        )}
        {tab === "stunden" && (
          <div className="ws-stack">
            <KpiRow project={project} data={data} entries={entries} totalMinutes={totalMinutes} totalHours={totalHours} budget={budget} budgetPct={budgetPct} budgetColor={budgetColor} isCostControl={isCostControl} isNonBilling={isNonBilling} invoicedMinutes={invoicedMinutes} openMinutes={openMinutes} showMoney={canSeeInvoices} />
            {phaseCard}
            {canSeeMitarbeiter && <EmployeeCard project={project} data={data} entries={entries} billingType={billingType} showMoney={canSeeInvoices} />}
            <TimeEntriesCard project={project} data={data} update={update} entries={entries} positions={positions} billingType={billingType} isAdmin={isAdmin} canSeeMitarbeiter={canSeeMitarbeiter} canSeeInvoices={canSeeInvoices} />
          </div>
        )}
        {tab === "termine" && (
          <div className="ws-stack">
            <ScheduleEditor project={project} data={data} update={update} setPrintContent={setPrintContent} canEdit={isAdmin || userPermissions.includes("projects")} />
          </div>
        )}
        {tab === "honorar" && (
          <div className="ws-stack">
            {canSeeQuotes && <BudgetCard project={project} data={data} entries={entries} positions={positions} projectInvoices={projectInvoices} budget={budget} totalHours={totalHours} budgetPct={budgetPct} budgetColor={budgetColor} canSeeInvoices={canSeeInvoices} budgetChartView={budgetChartView} setBudgetChartView={setBudgetChartView} onOpenBudget={openBudget} />}
            {canSeeQuotes && <QuotesCard data={data} projectId={projectId} client={client} setPrintContent={setPrintContent} />}
            {canSeeInvoices && projectInvoices.length > 0 && (
              <InvoicesCard projectInvoices={projectInvoices} client={client} setPrintContent={c => setPrintContent(withPrintSummary(c, data))} showOffen={showOffen} paidTotal={paidTotal} openTotal={openTotal} />
            )}
          </div>
        )}
        {tab === "protokolle" && (
          <div className="ws-stack"><ProtocolsCard data={data} saveAll={saveAll} projectId={projectId} /></div>
        )}
        {tab === "beteiligte" && (
          <div className="ws-stack" style={{ maxWidth: 720 }}>
            <PeopleList data={data} project={project} onEdit={isAdmin ? openSettings : undefined} />
          </div>
        )}
      </div>

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
