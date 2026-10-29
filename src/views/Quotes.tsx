// Offerten: Liste (Filter, Gruppierung, Sortierung) und Editor in drei Modi:
//   "sia"    – Honorar nach SIA-Formel aus Baukosten, Schwierigkeitsgrad und
//              Teilleistungen (`calcSIAHours`), mal Stundenansatz;
//   "manual" – Stunden pro Phase und Rolle × Stundensatz der Rolle (`calcManualHours`);
//   "free"   – freie Positionen (Menge × Preis), keine Stunden.
// Die Summen (sub/tax/total/totalHours) werden beim Speichern EINMAL berechnet und
// mitgespeichert; die Liste zeigt nur diese gespeicherten Werte. Der MWST-Satz wird
// pro Offerte festgehalten (`mwstRate`), spätere Änderungen am Studio-Satz ändern
// alte Offerten nicht.
//
// Weiterverarbeitung einer Offerte:
//   - Projekt anlegen (`createProjectFromQuote`): übernimmt Budget/Stunden/Phasen,
//     vergibt die nächste Projektnummer (`settings.lastProjectSeq/-Year`) und
//     verknüpft beides.
//   - In Rechnung bzw. Vertrag umwandeln: wechselt die Ansicht und übergibt per
//     `setModal({ type: "newInvoice" | "newVertrag", quoteId })`; Invoices/Contracts
//     fangen das ab und öffnen ihr Formular vorbefüllt.
// Nummern: «O<Jahr>-NNN» (laufend pro Jahr, kein konfigurierbares Format).

import React, { useState, useEffect } from "react";
import { SIA_PHASES, SIA_PHASE_WEIGHTS } from "../constants";
import { calcSIAHours, calcManualHours, generateId, formatCHF, formatDate, formatHours, roundCHF, applyProjectNumberFormat, migrateLinkedQuotes, deriveQuoteBudget, localISODate } from "../utils";
import { Header, Modal, FormField, StatusSelect, DateInput, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { ManualPhase, Project, Quote, SiaItem, ViewProps } from "../types";

declare global {
  interface Window {
    /** Einmaliger Navigationshinweis von anderen Ansichten: Kunden-Id, nach der die Liste beim Öffnen gefiltert wird. */
    __navClientId?: string | null;
    /** Einmaliger Hinweis aus der CRM-Pipeline: öffnet beim Betreten ein neues Offerten-Formular mit diesem Kunden. */
    __newQuoteClientId?: string | null;
  }
}

/** Formularstand einer Offerte: Summen und Id kommen erst beim Speichern dazu; die Editor-Teile sind immer vorhanden. */
type QuoteForm = Omit<Quote, "id" | "sub" | "tax" | "total" | "manualPhases" | "quoteRoles" | "sia" | "freeItems"> &
  Partial<Pick<Quote, "id" | "sub" | "tax" | "total" | "totalHours" | "createdAt">> &
  Required<Pick<Quote, "manualPhases" | "quoteRoles" | "sia" | "freeItems">>;

export default
function Quotes({ data, update, saveAll, modal, setModal, setPrintContent, setView, onSelectProject }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "setView"> & {
  /** Öffnet ein Projekt in der Projektansicht (nach «Projekt anlegen») */
  onSelectProject?: (projectId: string) => void;
}) {
  const clients = (data.persons || []);
  const roles = data.settings.roles || [];
  const defaultRolesForPhase = () => {
    const obj: Record<string, number> = {};
    roles.forEach(r => { obj[r.id] = 0; });
    return obj;
  };
  const emptyManualPhases = (): ManualPhase[] => SIA_PHASES.map(p => ({
    id: p.id, label: p.label, enabled: ["31","32","33","41","51","52","53"].includes(p.id),
    hoursByRole: defaultRolesForPhase(),
  }));
  const emptySIAPhases = () => SIA_PHASE_WEIGHTS.map(ph => ({
    id: ph.id, label: ph.label,
    items: ph.items.map(it => ({ ...it, enabled: true, r: 1 })),
  }));
  const defaultQuoteRoles = () => (data.settings.roles || []).map(r => ({ ...r }));
  const emptyForm: QuoteForm = {
    number: "", clientId: "", projectId: "", projectName: "", date: localISODate(),
    validUntil: "", mode: "sia", notes: "", status: "entwurf", mwst: true,
    manualPhases: emptyManualPhases(),
    quoteRoles: defaultQuoteRoles(),
    sia: { baukosten: 0, schwierigkeit: 1, stundenansatz: data.settings.defaultHourlyRate || 120, phases: emptySIAPhases() },
    freeItems: [{ id: generateId(), desc: "", qty: 1, price: 0 }],
  };
  const [form, setForm] = useState<QuoteForm>(emptyForm);
  const [filter, setFilter] = useState(() => { const cid = window.__navClientId || ""; window.__navClientId = null; return { status: "", search: "", clientId: cid, year: "" }; });
  const [groupBy, setGroupBy] = useState("date");
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const compact = true;
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const nextNum = () => {
    const y = new Date().getFullYear();
    const nums = (data.quotes||[]).filter(q => q.number?.startsWith("O"+y+"-")).map(q => parseInt(q.number.split("-")[1]||"0")).filter(Boolean);
    return "O"+y+"-"+String((nums.length ? Math.max(...nums)+1 : 1)).padStart(3,"0");
  };
  const openNew = () => {
    const vd = new Date(); vd.setDate(vd.getDate()+60);
    setForm({ ...emptyForm, number: nextNum(), validUntil: localISODate(vd), manualPhases: emptyManualPhases(), quoteRoles: defaultQuoteRoles(), sia: { ...emptyForm.sia, phases: emptySIAPhases() } });
    setModal({ type: "quote" });
  };
  // Einstieg aus der CRM-Pipeline («Offerte erstellen»): neues Formular mit vorbelegtem Kunden.
  useEffect(() => {
    const cid = window.__newQuoteClientId;
    if (!cid) return;
    window.__newQuoteClientId = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Übergabe aus der CRM-Pipeline beim Öffnen der Ansicht
    openNew();
    setForm(f => ({ ...f, clientId: cid }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Öffnen der Ansicht
  }, []);
  const openEdit = (q: Quote) => {
    setForm({ ...emptyForm, ...q, manualPhases: q.manualPhases || emptyManualPhases(), quoteRoles: q.quoteRoles || defaultQuoteRoles(), sia: q.sia || emptyForm.sia, freeItems: q.freeItems || [{ id: generateId(), desc: "", qty: 1, price: 0 }] });
    setModal({ type: "quote", id: q.id });
  };
  const del = async (id: string) => { if (await askConfirm("Offerte löschen?")) update("quotes", (data.quotes||[]).filter(q => q.id !== id)); };
  const setStatus = (id: string, st: string) => update("quotes", (data.quotes||[]).map(q => q.id === id ? { ...q, status: st } : q));

  const createProjectFromQuote = (q: Quote) => {
    const qRoles = q.quoteRoles || data.settings.roles || [];
    const siaH = q.mode === "sia" ? calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []) : null;
    const manH = q.mode === "manual" ? calcManualHours(q.manualPhases || [], qRoles) : null;
    const budgetHours = q.mode === "sia" ? Math.round((siaH?.total || 0) * 10) / 10
      : q.mode === "manual" ? Math.round((manH?.totalHours || 0) * 10) / 10 : 0;
    const enabledPhases = q.mode === "sia"
      ? (siaH?.phases || []).filter(ph => ph.hours > 0).map(ph => ph.id)
      : q.mode === "manual"
      ? (q.manualPhases || []).filter(ph => ph.enabled).map(ph => ph.id)
      : [];
    const phasesBudget = q.mode === "sia"
      ? (siaH?.phases || []).filter(ph => ph.hours > 0).map(ph => ({ id: ph.id, hours: Math.round(ph.hours * 10) / 10 }))
      : q.mode === "manual"
      ? (q.manualPhases || []).filter(ph => ph.enabled).map(ph => ({
          id: ph.id, hours: Math.round(qRoles.reduce((s, r) => s + (ph.hoursByRole?.[r.id] || 0), 0) * 10) / 10
        }))
      : [];

    // Projektnummer generieren
    const fmt = data.settings.projectNumberFormat || "YYYY/NN";
    const currentYear = new Date().getFullYear();
    const lastSeq = data.settings.lastProjectYear === currentYear ? (data.settings.lastProjectSeq || 0) : 0;
    // Kein Wrap auf 1 nach 99 (siehe Projects.jsx nextProjectNumber) — verhindert
    // eine Kollision mit dem ersten Projekt des Jahres.
    const nextSeq = lastSeq + 1;
    const projNumber = applyProjectNumberFormat(fmt, nextSeq);

    const existingProj = data.projects.find(p => p.id === q.projectId);
    const projName = q.projectName || existingProj?.name || ("Projekt " + q.number);
    // Manueller Modus: Blend-Satz aus Gesamtbetrag/Gesamtstunden statt des
    // Satzes der ERSTEN Rolle — sonst weicht jede Phasenrechnung, die sich
    // aus budgetHours * proj.hourlyRate ergibt, systematisch vom tatsächlich
    // offerierten Betrag ab (bis zu mehreren tausend Franken pro Phase).
    const stundenansatz = q.mode === "sia" ? (q.sia?.stundenansatz || data.settings.defaultHourlyRate)
      : q.mode === "manual" ? (manH && manH.totalHours > 0 ? Math.round((manH.totalAmount / manH.totalHours) * 100) / 100 : (qRoles[0]?.rate || data.settings.defaultHourlyRate))
      : data.settings.defaultHourlyRate;
    const billingType = q.mode === "manual" ? "stundensatz" : "pauschal";
    const budgetFromQuote = q.mode === "free"
      ? (q.freeItems || []).reduce((s, it) => s + it.qty * it.price, 0)
      : q.sub || 0;
    const newProj: Project = {
      id: generateId(),
      number: projNumber,
      name: projName,
      clientId: q.clientId || "",
      category: existingProj?.category || "Direktauftrag",
      billingType,
      hourlyRate: stundenansatz,
      budget: billingType === "pauschal" ? budgetFromQuote : 0,
      status: "aktiv",
      description: "",
      startDate: localISODate(),
      enabledPhases,
      budgetHours,
      budgetAmount: budgetFromQuote,
      phasesBudget,
      linkedQuotes: [{ quoteId: q.id, role: "Hauptofferte" }],
      createdAt: new Date().toISOString(),
    };
    const newSettings = { ...data.settings, lastProjectSeq: nextSeq, lastProjectYear: currentYear };
    // Offerte mit neuem Projekt verknüpfen
    const updatedQuotes = (data.quotes || []).map(x => x.id === q.id ? { ...x, projectId: newProj.id } : x);
    saveAll({ ...data, projects: [...data.projects, newProj], quotes: updatedQuotes, settings: newSettings });
    if (setView && onSelectProject) { setView("projects"); onSelectProject(newProj.id); }
  };

  // Berechnungen
  const activeRoles = form.quoteRoles || roles;
  const siaCalc = form.mode === "sia" ? calcSIAHours(form.sia.baukosten, form.sia.schwierigkeit, form.sia.phases) : null;
  const manCalc = form.mode === "manual" ? calcManualHours(form.manualPhases, activeRoles) : null;
  const freeSubTotal = form.mode === "free" ? (form.freeItems || []).reduce((s, it) => s + (it.qty * it.price), 0) : 0;
  const subTotal = form.mode === "sia" ? (siaCalc?.total || 0) * (form.sia.stundenansatz || 0) : form.mode === "manual" ? (manCalc?.totalAmount || 0) : freeSubTotal;
  const totalHours = form.mode === "sia" ? (siaCalc?.total || 0) : form.mode === "manual" ? (manCalc?.totalHours || 0) : 0;
  // Beim Bearbeiten den tatsächlich gespeicherten Satz beibehalten (form.mwstRate,
  // von openEdit aus der Offerte geladen) — sonst würde reines Öffnen+Speichern
  // einer alten Offerte ihren MWST-Satz rückwirkend auf den aktuellen Studio-
  // Default überschreiben, selbst wenn der gespeicherte Satz bewusst 0 war.
  const taxRate = form.mwstRate ?? data.settings.mwstRate ?? 8.1;
  const tax = form.mwst ? subTotal * (taxRate / 100) : 0;
  const total = roundCHF(subTotal + tax);

  const save = () => {
    if (!form.clientId) { alert("Bitte einen Kunden auswählen."); return; }
    // Projektname oder verknüpftes Projekt
    if (!form.projectId && !form.projectName?.trim()) {
      alert("Bitte einen Projektnamen eingeben oder ein Projekt verknüpfen."); return;
    }
    // Mindestens eine Position
    if (form.mode === "free") {
      const hasItem = (form.freeItems || []).some(it => it.desc?.trim() || it.price > 0);
      if (!hasItem) { alert("Bitte mindestens eine Position mit Beschreibung oder Betrag erfassen."); return; }
    } else if (form.mode === "manual") {
      const hasPhase = (form.manualPhases || []).some(ph => ph.enabled && Object.values(ph.hoursByRole || {}).some(h => h > 0));
      if (!hasPhase) { alert("Bitte mindestens eine Phase mit Stunden erfassen."); return; }
    } else if (form.mode === "sia") {
      if (!form.sia?.baukosten || form.sia.baukosten <= 0) {
        alert("Bitte Baukosten eingeben (SIA-Modus)."); return;
      }
    }
    const q: Quote = { ...form, sub: subTotal, totalHours, tax, total, mwstRate: taxRate, id: (modal?.id as string | undefined) || generateId(), createdAt: modal?.id ? form.createdAt : new Date().toISOString() };
    const quotes = modal?.id ? (data.quotes||[]).map(x => x.id === modal.id ? q : x) : [...(data.quotes||[]), q];
    update("quotes", quotes);
    setModal(null);
  };

  const [projectModal, setProjectModal] = useState<Quote | null>(null); // quote object when open
  const [pmMode, setPmMode] = useState<"new" | "attach">("new");
  const [pmName, setPmName] = useState("");
  const [pmAttachId, setPmAttachId] = useState("");

  const convertToInvoice = (q: Quote) => {
    setView("invoices");
    setModal({ type: "newInvoice", quoteId: q.id });
  };

  const convertToVertrag = (q: Quote) => {
    setView("contracts");
    setModal({ type: "newVertrag", quoteId: q.id });
  };

  // SIA-Editor Helpers
  const toggleSIAItem = (phId: string, idx: number) => {
    setForm(f => ({ ...f, sia: { ...f.sia, phases: f.sia.phases.map(p => p.id !== phId ? p : { ...p, items: p.items.map((it,i) => i === idx ? { ...it, enabled: !it.enabled } : it) }) } }));
  };
  const updateSIAItem = (phId: string, idx: number, changes: Partial<SiaItem>) => {
    setForm(f => ({ ...f, sia: { ...f.sia, phases: f.sia.phases.map(p => p.id !== phId ? p : { ...p, items: p.items.map((it,i) => i === idx ? { ...it, ...changes } : it) }) } }));
  };
  const updateManualHours = (phId: string, roleId: string, val: string | number) => {
    setForm(f => ({ ...f, manualPhases: f.manualPhases.map(p => p.id !== phId ? p : { ...p, hoursByRole: { ...p.hoursByRole, [roleId]: Math.max(0,+val||0) } }) }));
  };
  const toggleManualPhase = (phId: string, enabled: boolean) => {
    setForm(f => ({ ...f, manualPhases: f.manualPhases.map(p => p.id !== phId ? p : { ...p, enabled }) }));
  };

  const filtered = [...(data.quotes||[])].filter(q => {
    if (filter.status && q.status !== filter.status) return false;
    if (filter.clientId && q.clientId !== filter.clientId) return false;
    if (filter.year && !(q.date||"").startsWith(filter.year)) return false;
    if (filter.search) {
      const s = filter.search.toLowerCase();
      const cl = clients.find(c => c.id === q.clientId);
      if (![q.number,cl?.name,cl?.company,q.notes,q.projectName].filter(Boolean).join(" ").toLowerCase().includes(s)) return false;
    }
    return true;
  }).sort((a, b) => {
    let va: string | number, vb: string | number;
    if (sort.col === "number") { va = a.number || ""; vb = b.number || ""; }
    else if (sort.col === "date") { va = a.date || ""; vb = b.date || ""; }
    else if (sort.col === "validUntil") { va = a.validUntil || ""; vb = b.validUntil || ""; }
    else if (sort.col === "client") { va = clients.find(c => c.id === a.clientId)?.name || ""; vb = clients.find(c => c.id === b.clientId)?.name || ""; }
    else if (sort.col === "total") { va = a.total || 0; vb = b.total || 0; }
    else if (sort.col === "status") { va = a.status || ""; vb = b.status || ""; }
    else { va = a.date || ""; vb = b.date || ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });

  const availableQuoteYears = Array.from(new Set((data.quotes||[]).map(q => (q.date||"").slice(0,4)).filter(Boolean))).sort().reverse();

  // Gruppieren
  const groupedQuotes: { key: string; label: string; items: Quote[] }[] = (() => {
    if (groupBy === "date") {
      const months: Record<string, Quote[]> = {};
      filtered.forEach(q => {
        const key = (q.date || "").slice(0, 7);
        if (!months[key]) months[key] = [];
        months[key].push(q);
      });
      return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => ({
        key, label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum", items,
      }));
    }
    if (groupBy === "client") {
      const groups: Record<string, { label: string; items: Quote[] }> = {};
      filtered.forEach(q => {
        const cl = clients.find(c => c.id === q.clientId);
        const key = q.clientId || "__none__";
        const label = cl?.name || "Kein Kunde";
        if (!groups[key]) groups[key] = { label, items: [] };
        groups[key].items.push(q);
      });
      return Object.entries(groups).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, val]) => ({ key, label: val.label, items: val.items }));
    }
    if (groupBy === "status") {
      const statuses: Record<string, Quote[]> = {};
      filtered.forEach(q => {
        const key = q.status || "unbekannt";
        if (!statuses[key]) statuses[key] = [];
        statuses[key].push(q);
      });
      return Object.entries(statuses).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), items }));
    }
    return [{ key: "all", label: "", items: filtered }];
  })();

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Offerten" action={<button className="btn btn-primary" onClick={openNew}>+ Neue Offerte</button>} />
      <div className="filter-bar">
        <input className="pill" placeholder="Suche…" value={filter.search} onChange={e => setFilter({...filter, search: e.target.value})} style={{ minWidth: 180 }} />
        <select className="pill" value={filter.status} onChange={e => setFilter({...filter, status: e.target.value})}>
          <option value="">Alle Status</option>
          {["entwurf","gesendet","angenommen","abgelehnt","abgelaufen"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="pill" value={filter.clientId || ""} onChange={e => setFilter({...filter, clientId: e.target.value})}>
          <option value="">Alle Kunden</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="pill" value={filter.year || ""} onChange={e => setFilter({...filter, year: e.target.value})}>
          <option value="">Alle Jahre</option>
          {availableQuoteYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>{filtered.length} Offerte{filtered.length !== 1 ? "n" : ""} · {formatCHF(filtered.reduce((s,q)=>s+(q.total||0),0))}</div>
      </div>

      <div className="filter-bar">
        <span className="filter-label">GRUPPIEREN:</span>
        {[{ id: "none", label: "Keine" }, { id: "date", label: "Monat" }, { id: "client", label: "Kunde" }, { id: "status", label: "Status" }].map(g => (
          <button key={g.id} className={`pill${groupBy === g.id ? " active" : ""}`} onClick={() => setGroupBy(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 100 }}>Nr.</SortTh><SortTh sort={sort} onSort={toggleSort} col="client">Kunde</SortTh><th className={compact ? "hide-compact" : ""}>Modus</th><SortTh sort={sort} onSort={toggleSort} col="date" className={compact ? "hide-compact" : ""}>Datum</SortTh><SortTh sort={sort} onSort={toggleSort} col="validUntil" className={compact ? "hide-compact" : ""}>Gültig bis</SortTh><SortTh sort={sort} onSort={toggleSort} col="total" style={{ textAlign: "right" }}>Honorar</SortTh><SortTh sort={sort} onSort={toggleSort} col="status">Status</SortTh><th></th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} className="empty-state">{(data.quotes||[]).length === 0 ? "Noch keine Offerten" : "Keine Treffer"}</td></tr>}
            {groupedQuotes.map(group => (
              <React.Fragment key={group.key}>
                {groupBy !== "none" && group.label && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--surface3)", padding: "6px 12px", fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", fontWeight: 600, textTransform: "uppercase", borderTop: "1px solid var(--border)" }}>
                      {group.label}
                      <span style={{ float: "right", fontWeight: 400, letterSpacing: 0, textTransform: "none", fontSize: 11, color: "var(--text5)" }}>
                        {group.items.length} · {formatCHF(group.items.reduce((s, q) => s + (q.total || 0), 0))}
                      </span>
                    </td>
                  </tr>
                )}
            {group.items.map(q => {
              const cl = clients.find(c => c.id === q.clientId);
              const qInvoiced = q.status === "angenommen"
                ? (data.invoices || []).filter(i => (i.quoteId === q.id || (q.projectId && i.projectId === q.projectId)) && i.status !== "entwurf").reduce((s, i) => s + (i.sub || 0), 0)
                : 0;
              return (
                <tr key={q.id}>
                  <td><strong>{q.number}</strong>{q.projectName && <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 1 }}>{q.projectName}</div>}</td>
                  <td>{cl?.name || "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--text4)" }}>{q.mode === "sia" ? "SIA 102" : q.mode === "free" ? "Freie Positionen" : "Aufwand"}</td>
                  <td>{formatDate(q.date)}</td>
                  <td>{formatDate(q.validUntil)}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{formatCHF(q.total)}</strong>
                    {qInvoiced > 0 && <div style={{ fontSize: 10, color: "var(--positive)", marginTop: 1 }}>verrechnet {formatCHF(qInvoiced)}</div>}
                  </td>
                  <td>
                    <StatusSelect value={q.status} options={["entwurf","gesendet","angenommen","abgelehnt","abgelaufen"]} onChange={v => setStatus(q.id, v)} />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <ShareButton style={{ marginRight: 6, padding: "5px 10px", fontSize: 12 }} options={[{ label: "PDF", onClick: () => setPrintContent({ type: "quote", quote: q, client: cl, settings: data.settings }) }]} />
                    {!q.convertedToInvoiceId && <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12, borderColor: "var(--positive)", color: "var(--positive)" }} onClick={() => convertToInvoice(q)}>→ Rechnung</button>}
                    <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12, borderColor: "#9a7858", color: "#9a7858" }} onClick={() => convertToVertrag(q)}>→ Vertrag</button>
                    {(q.mode === "sia" || q.mode === "manual" || q.mode === "free") && (() => {
                      const linkedProj = data.projects.find(p => migrateLinkedQuotes(p).some(lq => lq.quoteId === q.id));
                      return linkedProj
                        ? <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12, borderColor: "var(--info)", color: "var(--info)" }} onClick={() => { const suggested = q.projectName || linkedProj.name || ("Projekt " + q.number); setPmMode("new"); setPmName(suggested); setPmAttachId(linkedProj.id); setProjectModal(q); }}>⬡ {linkedProj.number || "Projekt"}</button>
                        : <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12, borderColor: "var(--pending)", color: "var(--pending)" }} onClick={() => { const suggested = q.projectName || (data.projects.find(p => p.id === q.projectId)?.name) || ("Projekt " + q.number); setPmMode("new"); setPmName(suggested); setPmAttachId(q.projectId || ""); setProjectModal(q); }}>→ Projekt</button>;
                    })()}
                    <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 10px", fontSize: 12 }} onClick={() => openEdit(q)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(q.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </td>
                </tr>
              );
            })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {projectModal && (() => {
        const q = projectModal;
        const qRoles = q.quoteRoles || data.settings.roles || [];
        const siaH = q.mode === "sia" ? calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []) : null;
        const manH = q.mode === "manual" ? calcManualHours(q.manualPhases || [], qRoles) : null;
        const budgetH = q.mode === "sia" ? Math.round((siaH?.total||0)*10)/10 : q.mode === "manual" ? Math.round((manH?.totalHours||0)*10)/10 : 0;
        const stundenansatz = q.mode === "sia" ? (q.sia?.stundenansatz || data.settings.defaultHourlyRate)
          : q.mode === "manual" ? (manH && manH.totalHours > 0 ? Math.round((manH.totalAmount / manH.totalHours) * 100) / 100 : (qRoles[0]?.rate || data.settings.defaultHourlyRate))
          : data.settings.defaultHourlyRate;
        const alreadyLinkedProject = data.projects.find(p => migrateLinkedQuotes(p).some(lq => lq.quoteId === q.id));

        // Offerte entkoppeln
        const doUnlink = () => {
          const updatedProjects = data.projects.map(p => {
            const linked = migrateLinkedQuotes(p).filter(lq => lq.quoteId !== q.id);
            if (linked.length === migrateLinkedQuotes(p).length) return p;
            const derived = deriveQuoteBudget(linked, data.quotes || [], data.settings.roles || []);
            return { ...p, linkedQuotes: linked, budgetHours: derived.budgetHours, budgetAmount: derived.budgetAmount, phasesBudget: derived.phasesBudget };
          });
          const updatedQuotes = (data.quotes || []).map(x => x.id === q.id ? { ...x, projectId: null } : x);
          saveAll({ ...data, projects: updatedProjects, quotes: updatedQuotes });
          setProjectModal(null);
        };

        const doCreate = () => {
          if (pmMode === "new") {
            createProjectFromQuote({ ...q, projectName: pmName });
          } else {
            if (!pmAttachId) return;
            const proj = data.projects.find(p => p.id === pmAttachId);
            if (!proj) return;
            const existingLinked = migrateLinkedQuotes(proj);
            if (existingLinked.some(lq => lq.quoteId === q.id)) { setProjectModal(null); return; }
            const newLinked = [...existingLinked, { quoteId: q.id, role: existingLinked.length === 0 ? "Hauptofferte" : "Nachtrag" }];
            const derived = deriveQuoteBudget(newLinked, data.quotes || [], data.settings.roles || []);
            const updatedProjects = data.projects.map(p => p.id === pmAttachId ? {
              ...p, linkedQuotes: newLinked, budgetHours: derived.budgetHours,
              budgetAmount: derived.budgetAmount, phasesBudget: derived.phasesBudget,
              enabledPhases: [...new Set([...(p.enabledPhases || []), ...derived.enabledPhases])],
              hourlyRate: p.hourlyRate || stundenansatz,
            } : p);
            const updatedQuotes = (data.quotes || []).map(x => x.id === q.id ? { ...x, projectId: pmAttachId } : x);
            saveAll({ ...data, projects: updatedProjects, quotes: updatedQuotes });
            if (setView && onSelectProject) { setView("projects"); onSelectProject(pmAttachId); }
          }
          setProjectModal(null);
        };

        // Wenn Offerte bereits verknüpft: Entkoppeln-Dialog zeigen
        if (alreadyLinkedProject) {
          return (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setProjectModal(null)}>
              <div className="modal">
                <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, marginBottom: 16, fontSize: 22 }}>Offerte verknüpft</h2>
                <div style={{ marginBottom: 20, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>OFFERTE</div>
                  <div><strong>{q.number}</strong>{q.projectName ? " · " + q.projectName : ""}</div>
                  <div style={{ marginTop: 8, fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 4 }}>VERKNÜPFTES PROJEKT</div>
                  <div><strong>{alreadyLinkedProject.number ? alreadyLinkedProject.number + " · " : ""}{alreadyLinkedProject.name}</strong></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                  <button className="btn btn-primary" onClick={() => { setView("projects"); onSelectProject?.(alreadyLinkedProject.id); setProjectModal(null); }}
                    style={{ padding: "12px 18px", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Zum Projekt navigieren</span>
                    <span style={{ opacity: 0.7 }}>→</span>
                  </button>
                  <button className="btn btn-ghost" onClick={doUnlink}
                    style={{ padding: "12px 18px", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: "#c0a0a0", color: "var(--negative)" }}>
                    <span>Offerte entkoppeln</span>
                    <span style={{ opacity: 0.7, fontSize: 11 }}>Verknüpfung aufheben</span>
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={() => setProjectModal(null)}>Abbrechen</button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <Modal title="Projekt aus Offerte" onClose={() => setProjectModal(null)} onSave={doCreate} saveLabel={pmMode === "new" ? "Neues Projekt erstellen" : "Zu Projekt hinzufügen"}>
            <div style={{ marginBottom: 16, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 12 }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 4 }}>
                <span><strong>{q.number}</strong> · {q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"}</span>
                {budgetH > 0 && <span style={{ color: "var(--text4)" }}>{budgetH}h Soll-Budget</span>}
                <span style={{ color: "var(--text4)" }}>CHF {stundenansatz}/h</span>
                <span style={{ fontWeight: 600 }}>{formatCHF(q.total)}</span>
              </div>
              {q.projectName && <div style={{ color: "var(--text3)" }}>Auftragsbezeichnung: <strong>{q.projectName}</strong></div>}
            </div>
            <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1.5px solid var(--border)" }}>
              {[{ id: "new", label: "Neues Projekt erstellen" }, { id: "attach", label: "Zu bestehendem Projekt" }].map(tab => (
                <button key={tab.id} onClick={() => setPmMode(tab.id as "new" | "attach")} style={{
                  padding: "9px 18px", background: "transparent", border: "none", fontFamily: "inherit",
                  borderBottom: pmMode === tab.id ? "2px solid var(--text)" : "2px solid transparent",
                  marginBottom: -1.5, color: pmMode === tab.id ? "var(--text)" : "var(--text4)",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>{tab.label}</button>
              ))}
            </div>
            {pmMode === "new" ? (
              <div>
                <FormField label="Projektname">
                  <input value={pmName} onChange={e => setPmName(e.target.value)} autoFocus placeholder="z.B. Umbau EFH Muster" />
                </FormField>
                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>
                  Neues Projekt wird erstellt mit: Stundenbudget {budgetH}h, Stundensatz CHF {stundenansatz}/h, SIA-Phasen aus der Offerte.
                </div>
              </div>
            ) : (
              <div>
                <FormField label="Projekt auswählen">
                  <select value={pmAttachId} onChange={e => setPmAttachId(e.target.value)} autoFocus>
                    <option value="">— Projekt wählen —</option>
                    {data.projects.map(p => (
                      <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>
                    ))}
                  </select>
                </FormField>
                {pmAttachId && (() => {
                  const proj = data.projects.find(p => p.id === pmAttachId);
                  if (!proj) return null;
                  const existing = migrateLinkedQuotes(proj);
                  const alreadyLinked = existing.some(lq => lq.quoteId === q.id);
                  return (
                    <div style={{ fontSize: 11, color: alreadyLinked ? "var(--warning)" : "var(--text4)", marginTop: 4 }}>
                      {alreadyLinked
                        ? "⚠ Diese Offerte ist bereits mit diesem Projekt verknüpft."
                        : `Offerte wird als ${existing.length === 0 ? "Hauptofferte" : "Nachtrag"} hinzugefügt. Stundenbudget: ${proj.budgetHours || 0}h + ${budgetH}h = ${(proj.budgetHours || 0) + budgetH}h`}
                    </div>
                  );
                })()}
              </div>
            )}
          </Modal>
        );
      })()}
      {modal?.type === "quote" && (
        <Modal title={modal.id ? "Offerte bearbeiten" : "Neue Offerte"} onClose={() => setModal(null)} onSave={save} wide>
          <div className="form-row">
            <FormField label="Nr."><input value={form.number} onChange={e => setForm({...form, number: e.target.value})} /></FormField>
            <FormField label="Datum"><DateInput value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></FormField>
            <FormField label="Gültig bis"><DateInput value={form.validUntil} onChange={e => setForm({...form, validUntil: e.target.value})} /></FormField>
          </div>
          <div className="form-row">
            <FormField label="Kunde *">
              <select value={form.clientId} onChange={e => setForm({...form, clientId: e.target.value})} style={!form.clientId ? { borderColor: "var(--warning)" } : {}}>
                <option value="">— Kunde wählen (Pflichtfeld) —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Auftragsbezeichnung / Projektname">
              <input value={form.projectName || ""} onChange={e => setForm({...form, projectName: e.target.value})} placeholder="z.B. Umbau EFH Muster, Neubau MFH…" />
            </FormField>
            <FormField label="Projekt verknüpfen (optional)">
              <select value={form.projectId || ""} onChange={e => setForm({...form, projectId: e.target.value, projectName: e.target.value ? (data.projects.find(p => p.id === e.target.value)?.name || form.projectName) : form.projectName})}>
                <option value="">— kein Projekt —</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
              </select>
            </FormField>
          </div>
          {/* Tab-Auswahl */}
          <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1.5px solid var(--border)" }}>
            {[{ id: "sia", label: "SIA 102 (Baukosten)" }, { id: "manual", label: "Aufwandschätzung (Stunden)" }, { id: "free", label: "Freie Positionen" }].map(tab => (
              <button key={tab.id} onClick={() => setForm({...form, mode: tab.id})} style={{
                padding: "10px 20px", background: "transparent", border: "none", fontFamily: "inherit",
                borderBottom: form.mode === tab.id ? "2px solid var(--text)" : "2px solid transparent",
                marginBottom: -1.5, color: form.mode === tab.id ? "var(--text)" : "var(--text4)",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>{tab.label}</button>
            ))}
          </div>
          {/* Freier Modus */}
          {form.mode === "free" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--text4)" }}>Positionen frei definieren</div>
                <button className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: 11 }} onClick={() => setForm({...form, freeItems: [...(form.freeItems||[]), { id: generateId(), desc: "", qty: 1, price: 0 }]})}>+ Position</button>
              </div>
              <div style={{ borderRadius: 6, border: "1px solid var(--border2)", overflow: "hidden" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--surface3)" }}>
                      <th style={{ padding: "8px 10px" }}>Beschreibung</th>
                      <th style={{ padding: "8px 6px", textAlign: "right", width: 75 }}>Menge</th>
                      <th style={{ padding: "8px 6px", textAlign: "right", width: 100 }}>Preis CHF</th>
                      <th style={{ padding: "8px 6px", textAlign: "right", width: 100 }}>Total</th>
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.freeItems || []).map((it, idx) => (
                      <tr key={it.id} style={{ borderTop: "1px solid var(--border2)" }}>
                        <td style={{ padding: "4px 6px" }}>
                          <input value={it.desc} onChange={e => setForm({...form, freeItems: form.freeItems.map((x,i) => i===idx ? {...x, desc: e.target.value} : x)})} placeholder="Leistungsbeschreibung" style={{ border: "1px solid var(--border)", height: 28, fontSize: 12 }} />
                        </td>
                        <td style={{ padding: "4px 4px" }}>
                          <input type="number" step="0.25" min={0} value={it.qty} onChange={e => setForm({...form, freeItems: form.freeItems.map((x,i) => i===idx ? {...x, qty: +e.target.value} : x)})} style={{ border: "1px solid var(--border)", height: 28, fontSize: 12, textAlign: "right" }} />
                        </td>
                        <td style={{ padding: "4px 4px" }}>
                          <input type="number" step="0.05" min={0} value={it.price} onChange={e => setForm({...form, freeItems: form.freeItems.map((x,i) => i===idx ? {...x, price: +e.target.value} : x)})} style={{ border: "1px solid var(--border)", height: 28, fontSize: 12, textAlign: "right" }} />
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text4)" }}>{formatCHF(it.qty * it.price)}</td>
                        <td style={{ padding: "4px 4px", textAlign: "center" }}>
                          <button className="btn btn-danger" style={{ padding: "0 7px", height: 26, fontSize: 11 }} onClick={() => setForm({...form, freeItems: form.freeItems.filter((_,i) => i!==idx)})}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* SIA-Modus */}
          {form.mode === "sia" && siaCalc && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14, padding: 14, background: "#fff8ed", borderRadius: 6, border: "1px solid #f0e4c4" }}>
                <FormField label="Baukosten (CHF)">
                  <input type="number" value={form.sia.baukosten} onChange={e => setForm({...form, sia: {...form.sia, baukosten: +e.target.value}})} style={{ background: "var(--surface)" }} />
                </FormField>
                <FormField label="Schwierigkeitsgrad n">
                  <input type="number" step="0.1" value={form.sia.schwierigkeit} onChange={e => setForm({...form, sia: {...form.sia, schwierigkeit: +e.target.value}})} style={{ background: "var(--surface)" }} />
                </FormField>
                <FormField label="Stundenansatz CHF/h">
                  <input type="number" value={form.sia.stundenansatz} onChange={e => setForm({...form, sia: {...form.sia, stundenansatz: +e.target.value}})} style={{ background: "var(--surface)" }} />
                </FormField>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 12, padding: "6px 14px", background: "var(--surface2)", borderRadius: 6, fontSize: 11, color: "var(--text3)" }}>
                <div>∛B = <strong style={{ color: "var(--text)" }}>{siaCalc.cbrtB?.toFixed(1)}</strong></div>
                <div>p = <strong style={{ color: "var(--text)" }}>{siaCalc.p}</strong></div>
                <div style={{ marginLeft: "auto" }}>Total <strong style={{ color: "var(--text)" }}>{formatHours(Math.round(siaCalc.total * 60))}</strong> · <strong style={{ color: "var(--text)" }}>{formatCHF(siaCalc.total * (form.sia.stundenansatz||0))}</strong></div>
              </div>
              <div style={{ marginBottom: 16, borderRadius: 6, border: "1px solid var(--border2)", overflow: "hidden" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--surface3)" }}>
                      <th style={{ padding: "8px", width: 30 }}></th>
                      <th style={{ padding: "8px" }}>Teilleistung</th>
                      <th style={{ padding: "8px", textAlign: "right", width: 55 }}>q %</th>
                      <th style={{ padding: "8px", textAlign: "right", width: 55 }}>r</th>
                      <th style={{ padding: "8px", textAlign: "right", width: 75 }}>Stunden</th>
                      <th style={{ padding: "8px", textAlign: "right", width: 95 }}>Honorar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siaCalc.phases.map(ph => (
                      <React.Fragment key={ph.id}>
                        <tr style={{ background: "var(--surface2)" }}>
                          <td colSpan={4} style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "var(--text3)" }}>PHASE {ph.id} · {ph.label}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>{formatHours(Math.round(ph.hours*60))}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>{formatCHF(ph.hours*(form.sia.stundenansatz||0))}</td>
                        </tr>
                        {ph.items.map((it, idx) => (
                          <tr key={idx} style={{ opacity: it.enabled !== false ? 1 : 0.35 }}>
                            <td style={{ padding: "4px 8px" }}>
                              <input type="checkbox" checked={it.enabled !== false} onChange={() => toggleSIAItem(ph.id, idx)} style={{ width: "auto" }} />
                            </td>
                            <td style={{ padding: "4px 8px" }}>{it.label}</td>
                            <td style={{ padding: "4px 8px" }}>
                              <input type="number" step="0.5" value={it.pct} onChange={e => updateSIAItem(ph.id, idx, { pct: +e.target.value })} disabled={it.enabled === false} style={{ width: 48, height: 26, fontSize: 11, textAlign: "right" }} />
                            </td>
                            <td style={{ padding: "4px 8px" }}>
                              <input type="number" step="0.05" value={it.r ?? 1} onChange={e => updateSIAItem(ph.id, idx, { r: +e.target.value })} disabled={it.enabled === false} style={{ width: 48, height: 26, fontSize: 11, textAlign: "right" }} />
                            </td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text4)" }}>{formatHours(Math.round(it.hours*60))}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text4)" }}>{formatCHF(it.hours*(form.sia.stundenansatz||0))}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Manueller Modus */}
          {form.mode === "manual" && manCalc && (
            <div>
              <div style={{ marginBottom: 14, padding: 12, background: "#fff8ed", borderRadius: 6, border: "1px solid #f0e4c4" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>ROLLEN &amp; STUNDENSÄTZE FÜR DIESE OFFERTE</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                      title="Rollen aus Einstellungen zurücksetzen"
                      onClick={() => setForm(f => ({ ...f, quoteRoles: defaultQuoteRoles() }))}>
                      ↺ Reset
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                      onClick={() => {
                        const newId = "R" + (form.quoteRoles.length + 1);
                        setForm(f => ({ ...f, quoteRoles: [...f.quoteRoles, { id: newId, label: "Neue Rolle", rate: 120 }] }));
                      }}>
                      + Rolle
                    </button>
                  </div>
                </div>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 10, color: "var(--text4)", fontWeight: 500, width: 70 }}>KÜRZEL</th>
                      <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 10, color: "var(--text4)", fontWeight: 500 }}>BEZEICHNUNG</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 10, color: "var(--text4)", fontWeight: 500, width: 110 }}>CHF/h</th>
                      <th style={{ width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.quoteRoles || []).map((r, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f0e8d8" }}>
                        <td style={{ padding: "3px 6px" }}>
                          <input
                            value={r.id}
                            onChange={e => setForm(f => ({ ...f, quoteRoles: f.quoteRoles.map((x, i) => i === idx ? { ...x, id: e.target.value.toUpperCase().slice(0,4) } : x) }))}
                            style={{ width: 52, height: 26, fontSize: 12, fontWeight: 600, textAlign: "center", border: "1px solid var(--border)", background: "var(--surface)" }}
                            maxLength={4}
                          />
                        </td>
                        <td style={{ padding: "3px 6px" }}>
                          <input
                            value={r.label}
                            onChange={e => setForm(f => ({ ...f, quoteRoles: f.quoteRoles.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))}
                            style={{ width: "100%", height: 26, fontSize: 12, border: "1px solid var(--border)", background: "var(--surface)" }}
                          />
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={5}
                            value={r.rate}
                            onChange={e => setForm(f => ({ ...f, quoteRoles: f.quoteRoles.map((x, i) => i === idx ? { ...x, rate: +e.target.value } : x) }))}
                            style={{ width: 80, height: 26, fontSize: 12, textAlign: "right", border: "1px solid var(--border)", background: "var(--surface)" }}
                          />
                        </td>
                        <td style={{ padding: "3px 4px", textAlign: "center" }}>
                          <button className="btn btn-danger" style={{ padding: "0 7px", height: 26, fontSize: 11 }}
                            onClick={() => setForm(f => ({ ...f, quoteRoles: f.quoteRoles.filter((_, i) => i !== idx), manualPhases: f.manualPhases.map(p => { const h = { ...p.hoursByRole }; delete h[r.id]; return { ...p, hoursByRole: h }; }) }))}>
                            <span className="msr" style={{ fontSize: 16 }}>close</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginBottom: 16, borderRadius: 6, border: "1px solid var(--border2)", overflow: "hidden" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--surface3)" }}>
                      <th style={{ padding: "8px", width: 30 }}></th>
                      <th style={{ padding: "8px" }}>Phase</th>
                      {activeRoles.map(r => <th key={r.id} style={{ padding: "8px", textAlign: "right", width: 65 }} title={r.label+" · CHF "+r.rate+"/h"}>{r.id}</th>)}
                      <th style={{ padding: "8px", textAlign: "right", width: 65 }}>Std</th>
                      <th style={{ padding: "8px", textAlign: "right", width: 95 }}>Honorar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.manualPhases.map(rawPh => {
                      const calcPh = manCalc.phases.find(p => p.id === rawPh.id);
                      return (
                        <tr key={rawPh.id} style={{ opacity: rawPh.enabled ? 1 : 0.35 }}>
                          <td style={{ padding: "4px 8px" }}>
                            <input type="checkbox" checked={rawPh.enabled} onChange={e => toggleManualPhase(rawPh.id, e.target.checked)} style={{ width: "auto" }} />
                          </td>
                          <td style={{ padding: "4px 8px", fontSize: 11 }}>{rawPh.label}</td>
                          {activeRoles.map(r => (
                            <td key={r.id} style={{ padding: "4px 4px" }}>
                              <input type="number" min={0} step="0.5" value={rawPh.hoursByRole?.[r.id] || 0}
                                onChange={e => updateManualHours(rawPh.id, r.id, e.target.value)}
                                disabled={!rawPh.enabled}
                                style={{ width: 56, height: 26, fontSize: 11, textAlign: "right", background: rawPh.enabled ? "#fff8ed" : undefined }} />
                            </td>
                          ))}
                          <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text4)" }}>{calcPh ? formatHours(Math.round(calcPh.totalHours*60)) : "—"}</td>
                          <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text4)" }}>{calcPh ? formatCHF(calcPh.totalAmount) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
                Total: <strong style={{ marginLeft: 8, color: "var(--text)" }}>{formatHours(Math.round(manCalc.totalHours*60))} · {formatCHF(manCalc.totalAmount)}</strong>
              </div>
            </div>
          )}
          {/* Total */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, padding: "12px 14px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={form.mwst} onChange={e => setForm({...form, mwst: e.target.checked})} style={{ width: "auto" }} />
              MWST {taxRate}% ausweisen
            </label>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div style={{ color: "var(--text4)" }}>Honorar netto {formatCHF(subTotal)}</div>
              {form.mwst && <div style={{ color: "var(--text4)" }}>MWST {formatCHF(tax)}</div>}
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>Total {formatCHF(total)}</div>
            </div>
          </div>
          <FormField label="Bemerkungen">
            <textarea rows={3} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={{ resize: "vertical" }} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

// ─── CLIENTS ──────────────────────────────────────────────────
