// Projekte: Liste (Gruppierung nach Status, Filter, Sortierung, KPI-Kacheln). Die Detailansicht
// liegt in ProjectDetail.tsx, das gemeinsame Bearbeitungsformular in ProjectEditForm.tsx.
//
// Daten eines Projekts (`data.projects`): Stammdaten, Abrechnungsart
// ("stundensatz" oder "pauschal"), Budget (Stunden und Betrag, Soll je SIA-Phase),
// aktivierte SIA-Phasen (`enabledPhases`: nur diese sind in der Zeiterfassung wählbar),
// eigene Phasen, Beteiligte (`projectContacts`: Firmen, optional eingeschränkt auf
// Ansprechpartner), interne Mitarbeitende (`internalMembers`) und verknüpfte Offerten
// (`linkedQuotes` mit Rolle «Hauptofferte» / «Nachtrag» / «Referenz»).
//
// Offerten und Budget: Beim Verknüpfen berechnet `deriveQuoteBudget` (utils.ts)
// Stunden-/Betragsbudget und Phasenbudget neu. «Referenz»-Offerten fliessen nie ins
// Budget ein. Nachträge erhalten eine Position (`positions`, Code «N1», «N2», …) mit
// eigenen Phasen; Zeiteinträge können einer Position zugeordnet werden.
// Projektnummer: konfigurierbares Format (`settings.projectNumberFormat`), laufende
// Nummer pro Jahr in `settings.lastProjectSeq/-Year`.
// Kategorie «Wettbewerb» gilt als nicht verrechenbar (`NON_BILLING_CATEGORIES` in constants.ts).
// Berechtigungen: Offerten- und Rechnungsdaten sind nur sichtbar, wenn die Rolle
// «quotes» bzw. «invoices» hat (`userPermissions`).

import React, { useState } from "react";
import { PROJECT_TYPES } from "../constants";
import { generateId, formatHours, applyProjectNumberFormat, parseSeqFromNumber, localISODate } from "../utils";
import { Header, Modal, StatusBadge, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Project, ViewProps } from "../types";
import { ProjectEditForm, type ProjectForm } from "./ProjectEditForm";

export default
function Projects({ data, update, saveAll, modal, setModal, onSelect, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "currentUser" | "userPermissions"> & {
  /** Öffnet die Detailansicht eines Projekts */
  onSelect: (projectId: string) => void;
}) {
  const clients = (data.persons || []);
  const emptyForm: ProjectForm = { number: "", name: "", clientId: "", category: "Direktauftrag", billingType: "stundensatz", hourlyRate: data.settings.defaultHourlyRate, budget: 0, status: "aktiv", description: "", startDate: "", enabledPhases: [], budgetHours: 0, linkedQuotes: [], positions: [], customPhases: [], projectContacts: [], internalMembers: [] };
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [filter, setFilter] = useState(() => { const cid = window.__navClientId || ""; window.__navClientId = null; return { category: "", status: "", search: "", clientId: cid }; });
  const [groupBy, setGroupBy] = useState<string>("status");
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [showAddBeteiligter, setShowAddBeteiligter] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [addContactId, setAddContactId] = useState("");
  const [addPersonIds, setAddPersonIds] = useState<string[]>([]);

  const nextProjectNumber = () => {
    const fmt = data.settings.projectNumberFormat || "YYYY/NN";
    const currentYear = new Date().getFullYear();
    const lastSeq = data.settings.lastProjectYear === currentYear ? (data.settings.lastProjectSeq || 0) : 0;
    // Kein Wrap auf 1 nach 99 — das erzeugte eine Kollision mit dem ersten
    // Projekt des Jahres. applyProjectNumberFormat unterstützt beliebig
    // lange N-Läufe (NNN etc.), falls mehr als 99 Projekte/Jahr nötig sind.
    return applyProjectNumberFormat(fmt, lastSeq + 1);
  };

  const saveProject = () => {
    if (!form.name?.trim()) { alert("Bitte einen Projektnamen eingeben."); return; }
    const isNew = !modal?.id;
    const projects = isNew
      ? [...data.projects, { ...form, id: generateId(), createdAt: new Date().toISOString() }]
      : data.projects.map(p => p.id === modal.id ? { ...p, ...form } : p);
    let settings = data.settings;
    if (isNew) {
      const seq = parseSeqFromNumber(form.number, data.settings.projectNumberFormat || "YYYY/NN");
      if (seq !== null) settings = { ...data.settings, lastProjectSeq: seq, lastProjectYear: new Date().getFullYear() };
    }
    saveAll({ ...data, projects, settings });
    setModal(null);
  };

  const resetBeteiligter = () => { setShowAddBeteiligter(false); setEditingContactId(null); setAddContactId(""); setAddPersonIds([]); };
  const openEdit = (p: Project, e?: React.MouseEvent) => { e?.stopPropagation(); setForm({ ...emptyForm, ...p, enabledPhases: p.enabledPhases || [], projectContacts: p.projectContacts || [] }); resetBeteiligter(); setModal({ type: "project", id: p.id }); };
  const openNew = () => { setForm({ ...emptyForm, number: nextProjectNumber(), startDate: localISODate() }); resetBeteiligter(); setModal({ type: "project" }); };
  const del = async (id: string, e?: React.MouseEvent) => { e?.stopPropagation(); if (await askConfirm("Projekt wirklich löschen?")) update("projects", data.projects.filter(p => p.id !== id)); };

  const projectMinutes = (id: string) => data.timeEntries.filter(e => e.projectId === id).reduce((s, e) => s + (e.minutes || 0), 0);

  const [sort, setSort] = useState({ col: "number", dir: 1 });
  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : 1 }));

  const filtered = data.projects.filter(p => {
    if (filter.clientId && p.clientId !== filter.clientId) return false;
    if (filter.category && p.category !== filter.category) return false;
    if (filter.status && p.status !== filter.status) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const client = clients.find(c => c.id === p.clientId);
      return (p.name || "").toLowerCase().includes(q) || (p.number || "").toLowerCase().includes(q) || (client?.name || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q);
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    if (sort.col === "number") { va = a.number || ""; vb = b.number || ""; }
    else if (sort.col === "name") { va = a.name || ""; vb = b.name || ""; }
    else if (sort.col === "category") { va = a.category || ""; vb = b.category || ""; }
    else if (sort.col === "client") { va = (clients.find(c => c.id === a.clientId)?.name || ""); vb = (clients.find(c => c.id === b.clientId)?.name || ""); }
    else if (sort.col === "hours") { va = projectMinutes(a.id); vb = projectMinutes(b.id); }
    else if (sort.col === "status") { va = a.status || ""; vb = b.status || ""; }
    else { va = ""; vb = ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });

  // Gruppieren
  const groupedProjects: { key: string; label: string; items: Project[] }[] = (() => {
    if (groupBy === "status") {
      const groups: Record<string, Project[]> = {};
      sorted.forEach(p => { const key = p.status || "unbekannt"; if (!groups[key]) groups[key] = []; groups[key].push(p); });
      const order = ["aktiv", "pausiert", "abgeschlossen", "unbekannt"];
      return order.filter(k => groups[k]).map(key => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), items: groups[key] }));
    }
    if (groupBy === "category") {
      const groups: Record<string, Project[]> = {};
      sorted.forEach(p => { const key = p.category || "—"; if (!groups[key]) groups[key] = []; groups[key].push(p); });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key, items }));
    }
    if (groupBy === "client") {
      const groups: Record<string, { label: string; items: Project[] }> = {};
      sorted.forEach(p => { const key = p.clientId || "__none__"; const label = clients.find(c => c.id === p.clientId)?.name || "Kein Auftraggeber"; if (!groups[key]) groups[key] = { label, items: [] }; groups[key].items.push(p); });
      return Object.entries(groups).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, val]) => ({ key, label: val.label, items: val.items }));
    }
    if (groupBy === "year") {
      const groups: Record<string, Project[]> = {};
      sorted.forEach(p => { const key = (p.startDate || p.createdAt || "").slice(0, 4) || "—"; if (!groups[key]) groups[key] = []; groups[key].push(p); });
      return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => ({ key, label: key, items }));
    }
    return [{ key: "all", label: "", items: sorted }];
  })();

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Projekte" action={
        <div style={{ display: "flex", gap: 8 }}>
          <ShareButton options={[{ label: "Gesamt-PDF", onClick: () => setPrintContent({ type: "projectsOverview", projects: data.projects, data }) }]} />
          <button className="btn btn-primary" onClick={openNew}>+ Neues Projekt</button>
        </div>
      } />

      <div className="filter-bar">
        <input className="pill" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} placeholder="Suchen…" style={{ minWidth: 180 }} />
        <select className="pill" value={filter.clientId} onChange={e => setFilter({ ...filter, clientId: e.target.value })}>
          <option value="">Alle Auftraggeber</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="pill" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}>
          <option value="">Alle Kategorien</option>
          {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="pill" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Alle Status</option>
          {["aktiv", "pausiert", "abgeschlossen"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="filter-bar">
        <span className="filter-label">GRUPPIEREN:</span>
        {[{ id: "none", label: "Keine" }, { id: "status", label: "Status" }, { id: "category", label: "Kategorie" }, { id: "client", label: "Auftraggeber" }, { id: "year", label: "Jahr" }].map(g => (
          <button key={g.id} className={`pill${groupBy === g.id ? " active" : ""}`} onClick={() => setGroupBy(g.id)}>{g.label}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 90 }}>Nr.</SortTh>
            <SortTh sort={sort} onSort={toggleSort} col="name">Projekt</SortTh>
            <SortTh sort={sort} onSort={toggleSort} col="category">Kategorie</SortTh>
            <SortTh sort={sort} onSort={toggleSort} col="client">Kunde</SortTh>
            <SortTh sort={sort} onSort={toggleSort} col="hours">Stunden</SortTh>
            <SortTh sort={sort} onSort={toggleSort} col="status">Status</SortTh>
            <th></th>
          </tr></thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={7} className="empty-state">{data.projects.length === 0 ? "Noch keine Projekte" : "Keine Treffer"}</td></tr>}
            {groupedProjects.map(group => (
              <React.Fragment key={group.key}>
                {groupBy !== "none" && group.label && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--surface3)", padding: "6px 12px", fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", fontWeight: 600, textTransform: "uppercase", borderTop: "1px solid var(--border)" }}>
                      {group.label}
                      <span style={{ float: "right", fontWeight: 400, letterSpacing: 0, textTransform: "none", fontSize: 11, color: "var(--text5)" }}>
                        {group.items.length} Projekt{group.items.length !== 1 ? "e" : ""}
                      </span>
                    </td>
                  </tr>
                )}
                {group.items.map(p => {
                  const client = clients.find(c => c.id === p.clientId);
                  const usedMins = projectMinutes(p.id);
                  const usedHours = usedMins / 60;
                  const budget = p.budgetHours || 0;
                  const pct = budget > 0 ? (usedHours / budget) * 100 : 0;
                  const barColor = pct >= 100 ? "var(--negative)" : pct >= 80 ? "var(--warning)" : "var(--positive)";
                  return (
                    <tr key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }}>
                      <td style={{ fontSize: 11, color: "var(--text4)", fontWeight: 500 }}>{p.number || "—"}</td>
                      <td><strong>{p.name}</strong>{p.description && <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>{p.description.slice(0, 60)}</div>}</td>
                      <td style={{ fontSize: 12 }}>{p.category || "—"}</td>
                      <td>{client?.name || "—"}</td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 500, color: budget > 0 ? barColor : "var(--text)" }}>
                          {formatHours(usedMins)}{budget > 0 && ` / ${budget}h`}
                        </div>
                        {budget > 0 && (
                          <div style={{ marginTop: 4, height: 4, background: "var(--surface3)", borderRadius: 2, width: 80, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
                          </div>
                        )}
                      </td>
                      <td><StatusBadge status={p.status} /></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn btn-ghost" style={{ marginRight: 6, padding: "5px 12px", fontSize: 12 }} onClick={(e) => openEdit(p, e)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger" style={{ padding: "5px 12px", fontSize: 12 }} onClick={(e) => del(p.id, e)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.type === "project" && (() => {
        const projectContacts = form.projectContacts || [];
        const allContacts = (data.persons || []);
        const alreadyAdded = new Set(projectContacts.map(pc => pc.contactId));
        const selectedFirm = allContacts.find(c => c.id === addContactId);

        const addBeteiligte = () => {
          if (!addContactId) return;
          setForm(f => ({ ...f, projectContacts: [...(f.projectContacts || []), { contactId: addContactId, personIds: addPersonIds }] }));
          resetBeteiligter();
        };
        const saveEditedBeteiligte = (contactId: string) => {
          setForm(f => ({ ...f, projectContacts: (f.projectContacts || []).map(pc => pc.contactId === contactId ? { ...pc, personIds: addPersonIds } : pc) }));
          setEditingContactId(null); setAddPersonIds([]);
        };
        const removeBeteiligte = (contactId: string) => {
          setForm(f => ({ ...f, projectContacts: (f.projectContacts || []).filter(pc => pc.contactId !== contactId) }));
        };
        const togglePerson = (personId: string) => setAddPersonIds(prev =>
          prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]);

        return (
          <Modal title={modal.id ? "Projekt bearbeiten" : "Neues Projekt"} onClose={() => { setModal(null); resetBeteiligter(); }} onSave={saveProject} wide>
            <ProjectEditForm form={form} setForm={setForm} data={data} />

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 12 }}>INTERNE PROJEKTBETEILIGUNG</div>
              {(data.employees || []).length === 0
                ? <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Noch keine Mitarbeitenden erfasst.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                    {(data.employees || []).map(emp => {
                      const checked = (form.internalMembers || []).includes(emp.id);
                      return (
                        <label key={emp.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, background: checked ? "#f0ede8" : "#faf9f7", border: `1px solid ${checked ? "#c8b89a" : "#ece8e2"}`, borderRadius: 8, padding: "4px 10px" }}>
                          <input type="checkbox" checked={checked} onChange={() => setForm(f => ({ ...f, internalMembers: checked ? (f.internalMembers || []).filter(id => id !== emp.id) : [...(f.internalMembers || []), emp.id] }))} style={{ margin: 0 }} />
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

              {projectContacts.length === 0 && !showAddBeteiligter && allContacts.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 10 }}>Keine Kontakte erfasst. Zuerst unter «Kontakte» einen Kontakt anlegen.</div>
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
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={resetBeteiligter}>Abbrechen</button>
                  </div>
                </div>
              ) : allContacts.length > 0 && (
                <button className="btn btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => setShowAddBeteiligter(true)}>+ Beteiligten hinzufügen</button>
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
