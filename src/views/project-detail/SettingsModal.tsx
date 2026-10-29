// Modal «Projekteinstellungen» der Projekt-Detailansicht: Stammdaten, interne Beteiligung und Projektbeteiligte.

import { Modal } from "../../components/UI";
import { type ViewProps } from "../../types";
import { ProjectEditForm, type ProjectForm } from "../ProjectEditForm";

/** Einstellungs-Modal; der Formular- und Beteiligten-Zustand liegt in ProjectDetail und wird durchgereicht. */
export function SettingsModal({ data, settingsForm, setSettingsForm, showAddBeteiligter, setShowAddBeteiligter, editingContactId, setEditingContactId, addContactId, setAddContactId, addPersonIds, setAddPersonIds, onClose, onSave }: {
  data: ViewProps["data"];
  settingsForm: ProjectForm;
  setSettingsForm: React.Dispatch<React.SetStateAction<ProjectForm>>;
  showAddBeteiligter: boolean;
  setShowAddBeteiligter: (v: boolean) => void;
  editingContactId: string | null;
  setEditingContactId: (v: string | null) => void;
  addContactId: string;
  setAddContactId: (v: string) => void;
  addPersonIds: string[];
  setAddPersonIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClose: () => void;
  onSave: () => void;
}) {
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
    <Modal title="Projekteinstellungen" onClose={onClose} onSave={onSave} wide>
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
}
