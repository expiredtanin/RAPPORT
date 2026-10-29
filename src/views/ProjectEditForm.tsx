// Formular «Projekt bearbeiten/neu» (Stammdaten, Abrechnung, Phasen, Beteiligte); genutzt von der
// Projektliste (Projects.tsx) und der Detailansicht (ProjectDetail.tsx).

import React, { useState } from "react";
import { SIA_PHASES, PROJECT_TYPES, NON_BILLING_CATEGORIES } from "../constants";
import { calcSIAHours, calcManualHours, deriveQuoteBudget, migrateLinkedQuotes, generateId, formatCHF } from "../utils";
import { FormField, DateInput } from "../components/UI";
import type { Project, ProjectPosition, ViewProps } from "../types";

/** Formularstand eines Projekts; die Id kommt erst beim Speichern. */
export type ProjectForm = Omit<Project, "id"> & { id?: string };
type LinkedQuote = { quoteId: string; role: string };

/** Eingabefelder eines Projekts; `form`/`setForm` gehören der aufrufenden Ansicht. */
export function ProjectEditForm({ form, setForm, data }: {
  form: ProjectForm; setForm: React.Dispatch<React.SetStateAction<ProjectForm>>; data: ViewProps["data"];
}) {
  const [newPhaseLabel, setNewPhaseLabel] = useState("");
  const togglePhase = (phaseId: string) => {
    setForm(prev => {
      const phases = prev.enabledPhases || [];
      return { ...prev, enabledPhases: phases.includes(phaseId) ? phases.filter(p => p !== phaseId) : [...phases, phaseId] };
    });
  };
  return (
    <>
      <div className="form-row">
        <FormField label="Projektnummer">
          <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder={`z.B. ${new Date().getFullYear()}/01`} style={{ maxWidth: 140 }} />
        </FormField>
        <FormField label="Projektname *" style={{ flex: 3 }}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Wohnhaus Müller" autoFocus style={!form.name?.trim() ? { borderColor: "var(--warning)" } : {}} />
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Kategorie">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Auftraggeber">
          <select value={form.clientId || ""} onChange={e => setForm({ ...form, clientId: e.target.value })}>
            <option value="">— kein Auftraggeber —</option>
            {(data.persons||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {["aktiv", "pausiert", "abgeschlossen"].map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
      </div>
      <div className="form-row">
        {NON_BILLING_CATEGORIES.includes(form.category as string) ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, color: "var(--text4)" }}>
            <span style={{ fontSize: 16 }}>○</span>
            <span><strong style={{ color: "var(--text)" }}>Nicht verrechenbar</strong> — Stunden werden erfasst, aber nicht fakturiert.</span>
          </div>
        ) : (
          <>
            <FormField label="Abrechnungstyp">
              <select value={form.billingType} onChange={e => setForm({ ...form, billingType: e.target.value })}>
                <option value="stundensatz">Stundensatz</option>
                <option value="pauschal">Pauschal</option>
              </select>
            </FormField>
            {form.billingType === "stundensatz"
              ? <FormField label="Stundensatz (CHF)"><input type="number" value={form.hourlyRate} onChange={e => setForm({ ...form, hourlyRate: +e.target.value })} /></FormField>
              : <FormField label="Pauschalpreis (CHF)"><input type="number" value={form.budget} onChange={e => setForm({ ...form, budget: +e.target.value })} /></FormField>}
          </>
        )}
        <FormField label="Startdatum"><DateInput value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></FormField>
      </div>
      <div className="form-row">
        <FormField label="Stundenbudget (Soll-Stunden)">
          <input type="number" step="0.5" min={0} value={form.budgetHours || 0}
            onChange={e => setForm({ ...form, budgetHours: +e.target.value, linkedQuotes: [], phasesBudget: [] })}
            placeholder="0 = aus Offerten berechnet" />
        </FormField>
      </div>
      {(() => {
        const linked = form.linkedQuotes || [];
        const ROLES = ["Hauptofferte", "Nachtrag", "Referenz"];

        const buildPositions = (newLinked: LinkedQuote[], existingPositions: ProjectPosition[]) => {
          const manual = (existingPositions || []).filter(p => !p.quoteId);
          const nachtraege = newLinked.filter(lq => lq.role === "Nachtrag").map((lq, idx) => {
            const existing = (existingPositions || []).find(p => p.quoteId === lq.quoteId);
            const q = (data.quotes || []).find(x => x.id === lq.quoteId);
            const sd = deriveQuoteBudget([lq], data.quotes || [], data.settings.roles || []);
            return { code: existing?.code || `N${idx + 1}`, label: existing !== undefined ? existing.label : (q?.projectName || q?.number || ""), enabledPhases: existing?.enabledPhases || sd.enabledPhases, quoteId: lq.quoteId };
          });
          return [...manual, ...nachtraege];
        };

        const addQuote = (quoteId: string) => {
          if (!quoteId || linked.some(lq => lq.quoteId === quoteId)) return;
          const isFirst = linked.length === 0;
          const newLinked = [...linked, { quoteId, role: isFirst ? "Hauptofferte" : "Nachtrag" }];
          const d = deriveQuoteBudget(newLinked, data.quotes || [], data.settings.roles || []);
          const q = (data.quotes || []).find(x => x.id === quoteId);
          setForm(f => ({
            ...f, linkedQuotes: newLinked, budgetHours: d.budgetHours, budgetAmount: d.budgetAmount, phasesBudget: d.phasesBudget,
            enabledPhases: isFirst ? [...new Set([...(f.enabledPhases || []), ...d.enabledPhases])] : (f.enabledPhases || []),
            billingType: isFirst ? (q?.mode === "manual" ? "stundensatz" : "pauschal") : f.billingType,
            positions: buildPositions(newLinked, f.positions || []),
          }));
        };

        const removeQuote = (quoteId: string) => {
          const newLinked = linked.filter(lq => lq.quoteId !== quoteId);
          const d = newLinked.length > 0 ? deriveQuoteBudget(newLinked, data.quotes || [], data.settings.roles || []) : { budgetHours: 0, budgetAmount: 0, phasesBudget: [] };
          setForm(f => ({ ...f, linkedQuotes: newLinked, budgetHours: d.budgetHours, budgetAmount: d.budgetAmount, phasesBudget: d.phasesBudget, positions: buildPositions(newLinked, (f.positions || []).filter(p => p.quoteId !== quoteId)) }));
        };

        const changeRole = (quoteId: string, role: string) => setForm(f => {
          const newLinked = (f.linkedQuotes || []).map(lq => lq.quoteId === quoteId ? { ...lq, role } : lq);
          return { ...f, linkedQuotes: newLinked, positions: buildPositions(newLinked, f.positions || []) };
        });

        const updateNachtragPos = (quoteId: string, updates: Partial<ProjectPosition>) => setForm(f => ({ ...f, positions: (f.positions || []).map(p => p.quoteId === quoteId ? { ...p, ...updates } : p) }));
        const toggleHOPhase = (phId: string) => setForm(f => { const phases = f.enabledPhases || []; return { ...f, enabledPhases: phases.includes(phId) ? phases.filter(p => p !== phId) : [...phases, phId] }; });
        const toggleNTPhase = (quoteId: string, phId: string) => setForm(f => ({ ...f, positions: (f.positions || []).map(p => { if (p.quoteId !== quoteId) return p; const phases = p.enabledPhases || []; return { ...p, enabledPhases: phases.includes(phId) ? phases.filter(x => x !== phId) : [...phases, phId] }; }) }));

        const alreadyInOtherProjects = new Set((data.projects || []).filter(p => p.id !== form.id).flatMap(p => migrateLinkedQuotes(p).map(lq => lq.quoteId)));
        const unlinkedQuotes = (data.quotes || []).filter(q => !linked.some(lq => lq.quoteId === q.id) && !alreadyInOtherProjects.has(q.id));
        const sortedLinked = [...linked.filter(lq => lq.role === "Hauptofferte"), ...linked.filter(lq => lq.role !== "Hauptofferte")];

        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>VERKNÜPFTE HONORAROFFERTEN</div>
            {sortedLinked.map(lq => {
              const q = (data.quotes || []).find(x => x.id === lq.quoteId);
              if (!q) return null;
              const isNT = lq.role === "Nachtrag";
              const pos = isNT ? (form.positions || []).find(p => p.quoteId === lq.quoteId) : null;
              const currentPhases = isNT ? (pos?.enabledPhases || []) : (form.enabledPhases || []);
              const qRoles = q.quoteRoles || data.settings.roles || [];
              const qH = q.mode === "sia" ? (calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []).total || 0) : q.mode === "manual" ? (calcManualHours(q.manualPhases || [], qRoles).totalHours || 0) : 0;
              const bgColor = isNT ? "#f0f5fd" : "#faf8f5";
              const borderColor = isNT ? "#c8d8ee" : "#ddd8d0";
              const accentColor = isNT ? "var(--info)" : "var(--positive)";
              return (
                <div key={lq.quoteId} style={{ marginBottom: 10, border: `1px solid ${borderColor}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: bgColor, flexWrap: "wrap" }}>
                    {isNT && pos ? (
                      <>
                        <input value={pos.code || ""} onChange={e => updateNachtragPos(lq.quoteId, { code: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 6) })} placeholder="N1" style={{ width: 52, fontWeight: 700, fontSize: 12, height: 26, padding: "0 6px" }} />
                        <input value={pos.label || ""} onChange={e => updateNachtragPos(lq.quoteId, { label: e.target.value })} placeholder="z.B. Nachtrag Fassade" style={{ flex: 1, minWidth: 100, fontSize: 12, height: 26, padding: "0 6px" }} />
                      </>
                    ) : lq.role === "Referenz" ? (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "#f0f0ee", color: "var(--text4)", padding: "2px 8px", borderRadius: 20 }}>⬡ REF</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "var(--positive-bg)", color: accentColor, padding: "2px 8px", borderRadius: 20 }}>⬡ HO</span>
                    )}
                    <span style={{ fontWeight: 600, color: "#b07848", fontSize: 12 }}>{q.number}</span>
                    <span style={{ color: "var(--text4)", fontSize: 11 }}>{q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"}</span>
                    {qH > 0 && <span style={{ color: "var(--text3)", fontSize: 11 }}>{qH.toFixed(1)}h</span>}
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <select value={lq.role} onChange={e => changeRole(lq.quoteId, e.target.value)} style={{ fontSize: 11, height: 26, padding: "0 6px" }}>
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                      <button className="btn btn-danger" style={{ padding: "0 6px", height: 24, fontSize: 10 }} onClick={() => removeQuote(lq.quoteId)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </div>
                  </div>
                  <div style={{ padding: "10px 12px", background: "var(--surface)" }}>
                    <div style={{ fontSize: 10, color: "var(--text4)", marginBottom: 6, letterSpacing: "0.07em" }}>AKTIVIERTE SIA-PHASEN FÜR ZEITERFASSUNG</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                      {SIA_PHASES.map(ph => (
                        <label key={ph.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, textTransform: "none", color: "var(--text)" }}>
                          <input type="checkbox" checked={currentPhases.includes(ph.id)} onChange={() => isNT ? toggleNTPhase(lq.quoteId, ph.id) : toggleHOPhase(ph.id)} style={{ width: "auto" }} />
                          {ph.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {linked.length === 0 && <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 8 }}>Noch keine Offerte verknüpft.</div>}
            {unlinkedQuotes.length > 0 && (
              <select defaultValue="" onChange={e => { addQuote(e.target.value); e.target.value = ""; }} style={{ fontSize: 12, width: "100%" }}>
                <option value="">{linked.length === 0 ? "Offerte verknüpfen…" : "+ Nachtrag / weitere Offerte hinzufügen…"}</option>
                {unlinkedQuotes.map(q => <option key={q.id} value={q.id}>{q.number} — {q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Aufwand" : "Pauschal"} · {formatCHF(q.total)}</option>)}
              </select>
            )}
          </div>
        );
      })()}
      <FormField label="Beschreibung"><textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: "vertical" }} /></FormField>
      <div className="form-group" style={{ marginTop: 6 }}>
        <label>Eigene Phasen <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text5)" }}>(z.B. für Wettbewerbe)</span></label>
        <div style={{ padding: "8px 10px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
          {(form.customPhases || []).map(cp => (
            <div key={cp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border2)" }}>
              <span style={{ fontSize: 12 }}>{cp.label}</span>
              <button onClick={() => setForm(f => ({ ...f, customPhases: (f.customPhases || []).filter(c => c.id !== cp.id) }))} style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 15, padding: "0 2px", lineHeight: 1 }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: (form.customPhases || []).length > 0 ? 7 : 0 }}>
            <input value={newPhaseLabel} onChange={e => setNewPhaseLabel(e.target.value)} placeholder="z.B. Visualisierung, Modell, Präsentation…" style={{ flex: 1, height: 28, fontSize: 12 }}
              onKeyDown={e => { if (e.key === "Enter" && newPhaseLabel.trim()) { setForm(f => ({ ...f, customPhases: [...(f.customPhases || []), { id: "cp_" + generateId(), label: newPhaseLabel.trim() }] })); setNewPhaseLabel(""); }}} />
            <button className="btn btn-ghost" style={{ height: 28, padding: "0 10px", fontSize: 11, whiteSpace: "nowrap" }}
              onClick={() => { if (!newPhaseLabel.trim()) return; setForm(f => ({ ...f, customPhases: [...(f.customPhases || []), { id: "cp_" + generateId(), label: newPhaseLabel.trim() }] })); setNewPhaseLabel(""); }}>+ Hinzufügen</button>
          </div>
        </div>
      </div>
      {(form.linkedQuotes || []).length === 0 && (
        <div className="form-group" style={{ marginTop: 6 }}>
          <label>Relevante SIA-Phasen (nur angewählte sind bei der Zeiterfassung verfügbar)</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
            {SIA_PHASES.map(ph => (
              <label key={ph.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, textTransform: "none", color: "var(--text)", padding: "4px 0" }}>
                <input type="checkbox" checked={(form.enabledPhases || []).includes(ph.id)} onChange={() => togglePhase(ph.id)} style={{ width: "auto" }} />
                {ph.label}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 4 }}>Leer lassen, wenn keine Phasen-Unterteilung gewünscht.</div>
        </div>
      )}
    </>
  );
}
