// CRM-Pipeline: Akquise-Board von der Anfrage bis zur Zusage oder Absage.
//
// Jeder Lead (`data.leads`) ist eine Karte in der Spalte seiner Stufe und lässt sich per
// Drag & Drop oder im Dialog verschieben. Pro Lead werden Herkunft, Empfehler, geschätztes
// Honorar und der Kontaktverlauf (ActivityLog) festgehalten — daraus rechnet crm.ts die
// Auswertung. Offerte und Projekt werden nur *verknüpft* (Auswahl im Dialog); sie entstehen
// weiterhin in Offerten bzw. Projekte. Eingebettet in `Crm.tsx` (Tab «Pipeline»).
//
// Nicht Teil dieser Ansicht: Auswertungen (CrmAuswertung.tsx), Kundenpflege/Grusskarten.

import React, { useState } from "react";
import { DEFAULT_LEAD_SOURCES, LEAD_STAGES } from "../constants";
import { dueFollowUps, isOpenLead, meetingCount, overallWinRate, pipelineValue } from "../crm";
import { formatCHF, formatDate, generateId, localISODate } from "../utils";
import ActivityLog from "../components/ActivityLog";
import { DateInput, FormField, KpiCard, Modal, StatusBadge } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Lead, LeadStage, ViewProps } from "../types";

const today = () => localISODate();

/** Setzt die Stufe und pflegt dabei `closedAt`/`lostReason` mit. */
function withStage(lead: Lead, stage: LeadStage): Lead {
  const closed = stage === "gewonnen" || stage === "verloren";
  return {
    ...lead,
    stage,
    closedAt: closed ? (lead.closedAt || today()) : undefined,
    lostReason: stage === "verloren" ? lead.lostReason : undefined,
  };
}

const emptyLead = (): Lead => ({ id: generateId(), title: "", stage: "anfrage", createdAt: today() });

export default function CrmPipeline({ data, update, setView }: Pick<ViewProps, "data" | "update" | "setView">) {
  const leads = data.leads || [];
  const persons = data.persons || [];
  const sources = data.settings.leadSources || DEFAULT_LEAD_SOURCES;
  const year = String(new Date().getFullYear());
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [form, setForm] = useState<Lead | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const nameOf = (id?: string) => (id && persons.find(p => p.id === id)?.name) || "";
  const follow = dueFollowUps(data, today());
  const overdue = follow.filter(f => f.overdue).length;
  const winRate = overallWinRate(data, year);
  const open = leads.filter(isOpenLead);

  const openNew = () => { setForm(emptyLead()); setIsNew(true); };
  const openEdit = (l: Lead) => { setForm({ ...l }); setIsNew(false); };
  const save = () => {
    if (!form || !form.title.trim()) return;
    const lead = { ...form, title: form.title.trim() };
    update("leads", isNew ? [...leads, lead] : leads.map(l => l.id === lead.id ? lead : l));
    setForm(null);
  };
  const remove = async () => {
    if (!form || isNew || !(await askConfirm(`Lead «${form.title}» löschen? Der Kontaktverlauf der Person bleibt erhalten.`))) return;
    update("leads", leads.filter(l => l.id !== form.id));
    setForm(null);
  };
  const move = (id: string, stage: LeadStage) => {
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.stage === stage) return;
    const moved = withStage(lead, stage);
    update("leads", leads.map(l => l.id === id ? moved : l));
    if (stage === "verloren") { setForm(moved); setIsNew(false); } // Absagegrund gleich abfragen
  };
  const newQuote = () => {
    if (!form?.clientId) return;
    window.__newQuoteClientId = form.clientId;
    setForm(null);
    setView("quotes");
  };

  const set = <K extends keyof Lead>(k: K, v: Lead[K]) => setForm(f => f ? { ...f, [k]: v } : f);
  const clientQuotes = form?.clientId ? (data.quotes || []).filter(q => q.clientId === form.clientId) : [];
  const clientProjects = form?.clientId ? (data.projects || []).filter(p => p.clientId === form.clientId) : [];

  // Abgeschlossene Leads nur aus dem laufenden Jahr zeigen, sonst wächst das Board unbegrenzt.
  const inColumn = (stage: LeadStage) => leads
    .filter(l => l.stage === stage && (isOpenLead(l) || (l.closedAt || "").startsWith(year)))
    .sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));

  return (
    <div>
      {ConfirmModalEl}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }} className="responsive-grid-4">
        <KpiCard label="OFFENE LEADS" value={open.length} sub={`${leads.length - open.length} abgeschlossen`} color="var(--info)" />
        <KpiCard label="PIPELINE (NETTO)" value={formatCHF(pipelineValue(leads))} sub={`gewichtet ${formatCHF(pipelineValue(leads, true))}`} color="#b07848" />
        <KpiCard label={`TREFFERQUOTE ${year}`} value={winRate === null ? "—" : `${Math.round(winRate * 100)} %`} sub="gewonnen / entschieden" color="var(--positive)" />
        <KpiCard label="WIEDERVORLAGEN" value={follow.length} sub={overdue ? `${overdue} überfällig` : "keine überfällig"} color={overdue ? "var(--warning)" : "var(--text3)"} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={openNew}>+ Neuer Lead</button>
      </div>

      <div className="pipeline-board">
        {LEAD_STAGES.map(st => {
          const items = inColumn(st.id);
          return (
            <div key={st.id}
              onDragOver={e => { if (dragId) e.preventDefault(); }}
              onDrop={() => { if (dragId) move(dragId, st.id); setDragId(null); }}
              style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 16, padding: 10, minHeight: 160 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px 8px", marginBottom: 10, padding: "0 4px" }}>
                <StatusBadge status={st.id} label={st.label} />
                <span style={{ fontSize: 11, color: "var(--text4)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{items.length}{isOpenLead({ stage: st.id } as Lead) && items.length > 0 ? ` · ${formatCHF(items.reduce((s, l) => s + (l.estimatedValue || 0), 0))}` : ""}</span>
              </div>
              {items.length === 0 && <div style={{ fontSize: 11, color: "var(--text5)", textAlign: "center", padding: "14px 0" }}>—</div>}
              {items.map(l => {
                const meetings = meetingCount(data, l.id);
                const nextFollow = follow.find(f => f.leadId === l.id || (!f.leadId && f.personId === l.clientId));
                return (
                  <div key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => setDragId(null)} onClick={() => openEdit(l)}
                    className="card" style={{ padding: "10px 12px", marginBottom: 8, cursor: "grab", opacity: dragId === l.id ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{l.title}</div>
                    {nameOf(l.clientId) && <div style={{ fontSize: 11, color: "var(--text3)" }}>{nameOf(l.clientId)}</div>}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, fontSize: 10, color: "var(--text4)" }}>
                      {l.source && <span style={{ border: "1px solid var(--border)", borderRadius: 20, padding: "1px 8px" }}>{l.source}</span>}
                      {l.estimatedValue ? <span>{formatCHF(l.estimatedValue)}</span> : null}
                      {meetings > 0 && <span>{meetings} Meeting{meetings === 1 ? "" : "s"}</span>}
                    </div>
                    {l.referrerId && <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>via {nameOf(l.referrerId)}</div>}
                    {nextFollow && <div style={{ fontSize: 10, marginTop: 4, color: nextFollow.overdue ? "var(--warning)" : "var(--text3)" }}>↻ {formatDate(nextFollow.followUpDate as string)}</div>}
                    {l.stage === "verloren" && l.lostReason && <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>{l.lostReason}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {form && (
        <Modal title={isNew ? "Neuer Lead" : "Lead bearbeiten"} onClose={() => setForm(null)} onSave={save} wide>
          <FormField label="Titel *">
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="z.B. Umbau Einfamilienhaus Meier" autoFocus />
          </FormField>
          <div className="form-row">
            <FormField label="Interessent / Auftraggeber">
              <select value={form.clientId || ""} onChange={e => setForm(f => f ? { ...f, clientId: e.target.value || undefined, quoteId: undefined, projectId: undefined } : f)}>
                <option value="">— noch unbekannt —</option>
                {[...persons].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Stufe">
              <select value={form.stage} onChange={e => setForm(f => f ? withStage(f, e.target.value as LeadStage) : f)}>
                {LEAD_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Herkunft">
              <select value={form.source || ""} onChange={e => set("source", e.target.value || undefined)}>
                <option value="">—</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Vermittelt durch">
              <select value={form.referrerId || ""} onChange={e => set("referrerId", e.target.value || undefined)}>
                <option value="">—</option>
                {[...persons].filter(p => p.id !== form.clientId).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Geschätztes Honorar (CHF netto)">
              <input type="number" min={0} value={form.estimatedValue ?? ""} onChange={e => set("estimatedValue", e.target.value === "" ? undefined : Number(e.target.value))} />
            </FormField>
            <FormField label="Entscheid erwartet">
              <DateInput value={form.expectedDecision || ""} onChange={e => set("expectedDecision", e.target.value || undefined)} />
            </FormField>
          </div>
          {form.stage === "verloren" && (
            <FormField label="Absagegrund">
              <input value={form.lostReason || ""} onChange={e => set("lostReason", e.target.value || undefined)} placeholder="z.B. Preis, anderes Büro gewählt, Projekt gestoppt" />
            </FormField>
          )}
          {form.clientId && (
            <div className="form-row">
              <FormField label="Verknüpfte Offerte">
                <select value={form.quoteId || ""} onChange={e => set("quoteId", e.target.value || undefined)}>
                  <option value="">—</option>
                  {clientQuotes.map(q => <option key={q.id} value={q.id}>{q.number} · {q.projectName || q.status}</option>)}
                </select>
              </FormField>
              <FormField label="Verknüpftes Projekt">
                <select value={form.projectId || ""} onChange={e => set("projectId", e.target.value || undefined)}>
                  <option value="">—</option>
                  {clientProjects.map(p => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
                </select>
              </FormField>
            </div>
          )}
          <FormField label="Notiz">
            <textarea value={form.note || ""} onChange={e => set("note", e.target.value || undefined)} rows={2} style={{ height: "auto" }} />
          </FormField>

          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            {form.clientId && <button className="btn btn-ghost btn-sm" onClick={newQuote}>Offerte erstellen →</button>}
            {!isNew && <button className="btn btn-ghost btn-sm" onClick={remove}>Lead löschen</button>}
          </div>

          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text5)", marginTop: 16, marginBottom: 10, paddingTop: 14, borderTop: "1px solid var(--border)" }}>KONTAKTVERLAUF</div>
          {form.clientId && !isNew
            ? <ActivityLog data={data} update={update} personId={form.clientId} leadId={form.id} />
            : <div style={{ fontSize: 12, color: "var(--text4)" }}>{isNew ? "Lead zuerst speichern, dann Kontakte erfassen." : "Interessent wählen, um Kontakte zu erfassen."}</div>}
        </Modal>
      )}
    </div>
  );
}
