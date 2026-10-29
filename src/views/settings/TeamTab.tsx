// Reiter «Team & Rollen»: Cloud-Mitglieder (einladen), Mitarbeiter-Standards und Offert-Rollen
// (im Entwurf `s`), App-Rollen mit Berechtigungen (`PERMISSION_GROUPS`; die Ids entsprechen den
// Navigations-Ids, siehe constants.ts NAV_ITEMS). App-Rollen und Einladungen speichern sofort.

import { useState } from "react";
import { storage, isCloudBackend } from "../../storage/adapter";
import type { PocketBaseAdapter } from "../../storage/pocketbase-adapter";
import { generateId } from "../../utils";
import { FormField, Modal } from "../../components/UI";
import { useConfirm } from "../../hooks/useConfirm";
import { Section, type DraftProps } from "./shared";
import type { AppRole, ViewProps } from "../../types";

/** Cloud-Methoden des Adapters; nur sinnvoll aufrufen, wenn `isCloudBackend` true ist. */
const cloud = storage as unknown as PocketBaseAdapter;

const PERMISSION_GROUPS = [
  { label: "Grundmodule", items: [
    { id: "dashboard", label: "Übersicht" },
    { id: "pinnwand", label: "Pinnwand" },
    { id: "projects", label: "Projekte" },
    { id: "time", label: "Zeiterfassung" },
    { id: "personen", label: "Kontakte" },
    { id: "crm", label: "Akquise (CRM)" },
  ]},
  { label: "Buchhaltung", items: [
    { id: "invoices", label: "Rechnungen" },
    { id: "expenses", label: "Spesen" },
    { id: "internal-expenses", label: "Ausgaben" },
    { id: "loehne", label: "Löhne" },
    { id: "studio-budget", label: "Budget" },
  ]},
  { label: "Dokumente", items: [
    { id: "quotes", label: "Offerten" },
    { id: "contracts", label: "Verträge" },
    { id: "protokolle", label: "Protokolle" },
    { id: "lieferscheine", label: "Lieferscheine" },
    { id: "letters", label: "Briefe" },
  ]},
  { label: "Administration", items: [
    { id: "mitarbeiter", label: "Mitarbeiter (inkl. Zeiterfassung aller MA)" },
    { id: "settings", label: "Einstellungen / Mein Profil" },
    { id: "dashboard-vorlage", label: "Dashboard-Vorlagen speichern" },
    { id: "pinnwand-schreiben", label: "Pinnwand — Beiträge verfassen" },
  ]},
];

/** Benutzer, Rollen und Berechtigungen des Studios. */
export function TeamTab({ s, setField, data, update, isAdmin }: DraftProps & Pick<ViewProps, "data" | "update"> & { isAdmin: boolean }) {
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState<AppRole | null>(null);
  const [inviteModal, setInviteModal] = useState<{ email: string; displayName: string; appRoleId: string; tempPassword: string } | null>(null);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; error?: string; tempPassword?: string; email?: string } | null>(null);
  const { askConfirm, ConfirmModalEl } = useConfirm();

  // App-Rollen
  const appRoles = data.appRoles || [];
  const openEditRole = (role: AppRole) => { setEditingRoleId(role.id); setRoleForm({ ...role, permissions: role.permissions ? [...role.permissions] : null }); };
  const saveRole = () => { update("appRoles", appRoles.map(r => r.id === roleForm!.id ? { ...roleForm! } : r)); setEditingRoleId(null); };
  const addRole = () => { const nr: AppRole = { id: generateId(), name: "Neue Rolle", permissions: ["dashboard", "projects", "time"] }; update("appRoles", [...appRoles, nr]); openEditRole(nr); };
  const deleteRole = async (id: string) => { if (!await askConfirm("Rolle löschen? Benutzer mit dieser Rolle verlieren ihren Zugang.")) return; update("appRoles", appRoles.filter(r => r.id !== id)); };
  const togglePerm = (permId: string) => { if (!roleForm || roleForm.permissions === null) return; const cur = roleForm.permissions || []; setRoleForm({ ...roleForm, permissions: cur.includes(permId) ? cur.filter(p => p !== permId) : [...cur, permId] }); };

  return (
    <>
      {ConfirmModalEl}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {isCloudBackend && isAdmin && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>MITARBEITER (CLOUD)</div>
                <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setInviteModal({ email: "", displayName: "", appRoleId: "r-mitarbeiter", tempPassword: Math.random().toString(36).slice(2, 10) })}>+ Einladen</button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>
                Personen mit Cloud-Zugang zu diesem Studio. Beim Einladen vergeben Sie ein temporäres Passwort, das Sie der Person separat mitteilen.
              </div>
              {(data.users || []).map(u => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border2)", fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{u.displayName || u.username}</div>
                    <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.04em" }}>{u.username} · {u.role === "admin" ? "Admin" : (data.appRoles || []).find(r => r.id === u.appRoleId)?.name || u.appRoleId}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <Section title="MITARBEITER-STANDARDS">
              <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 14 }}>Vorausgefüllt bei neuen Mitarbeitern.</div>
              <FormField label="Wochenstunden (100%)">
                <input type="number" min={1} max={50} step={0.5} value={s.defaultWochenstunden || 35} onChange={e => setField({ defaultWochenstunden: +e.target.value })} />
              </FormField>
              <FormField label="Ferienwochen / Jahr">
                <input type="number" min={4} max={10} step={0.5} value={s.defaultFerienWochen || 5} onChange={e => setField({ defaultFerienWochen: +e.target.value })} />
                <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 3 }}>Minimum gesetzlich: 4 Wochen</div>
              </FormField>
              <FormField label="PK / BVG AG-Anteil %">
                <input type="number" min={0} step={0.1} value={s.defaultPkAGSatz ?? 8.0} onChange={e => setField({ defaultPkAGSatz: +e.target.value })} />
              </FormField>
            </Section>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>ROLLEN FÜR OFFERTEN</div>
              <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setField({ roles: [...(s.roles || []), { id: "", label: "", rate: s.defaultHourlyRate || 120 }] })}>+ Rolle</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Kürzel, Bezeichnung und Stundensatz für Aufwandschätzungen in Offerten.</div>
            {(s.roles || []).map((r, idx) => (
              <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
                <input value={r.id} onChange={e => setField({ roles: s.roles.map((x, i) => i === idx ? { ...x, id: e.target.value.toUpperCase().slice(0, 3) } : x) })} placeholder="PL" style={{ width: 46, textAlign: "center", fontSize: 11 }} />
                <input value={r.label} onChange={e => setField({ roles: s.roles.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) })} placeholder="Bezeichnung" style={{ flex: 1, fontSize: 12 }} />
                <input type="number" value={r.rate} onChange={e => setField({ roles: s.roles.map((x, i) => i === idx ? { ...x, rate: +e.target.value } : x) })} style={{ width: 72, textAlign: "right", fontSize: 12 }} />
                <span style={{ fontSize: 11, color: "var(--text4)" }}>CHF/h</span>
                <button className="btn btn-danger" style={{ padding: "0 7px", height: 30, fontSize: 11 }} onClick={() => setField({ roles: s.roles.filter((_, i) => i !== idx) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>APP-ROLLEN & BERECHTIGUNGEN</div>
            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={addRole}>+ Rolle</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 16 }}>
            Rollen bestimmen, welche Bereiche Mitarbeitende sehen können.
          </div>

          {appRoles.map(role => (
            <div key={role.id} style={{ marginBottom: 10, border: "1.5px solid var(--border2)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface2)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{role.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>
                    {role.permissions === null ? "Voller Zugriff" : `${(role.permissions || []).length} Bereiche`}
                    {" · "}{(data.users || []).filter(u => u.appRoleId === role.id).length} Benutzer
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {editingRoleId === role.id
                    ? <><button className="btn btn-primary" style={{ padding: "4px 12px", fontSize: 11 }} onClick={saveRole}>Speichern</button>
                       <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setEditingRoleId(null)}>Abbrechen</button></>
                    : <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => openEditRole(role)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                  }
                  {role.id !== "r-admin" && <button className="btn btn-danger" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => deleteRole(role.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
                </div>
              </div>

              {editingRoleId === role.id && roleForm && (
                <div style={{ padding: "14px 14px 10px", borderTop: "1px solid var(--border2)" }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: "var(--text4)", display: "block", marginBottom: 5 }}>Rollenname</label>
                    <input value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })} style={{ fontSize: 13, width: "100%", maxWidth: 300 }} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, marginBottom: 10 }}>
                      <input type="checkbox" checked={roleForm.permissions === null}
                        onChange={e => setRoleForm({ ...roleForm, permissions: e.target.checked ? null : ["dashboard"] })}
                        style={{ width: "auto" }} />
                      Voller Zugriff (Administrator)
                    </label>
                    {roleForm.permissions !== null && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 20px" }}>
                        {PERMISSION_GROUPS.map(group => (
                          <div key={group.label}>
                            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text5)", marginBottom: 6, fontWeight: 600 }}>{group.label.toUpperCase()}</div>
                            {group.items.map(perm => (
                              <label key={perm.id} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, marginBottom: 5 }}>
                                <input type="checkbox" checked={(roleForm.permissions || []).includes(perm.id)} onChange={() => togglePerm(perm.id)} style={{ width: "auto" }} />
                                {perm.label}
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ paddingTop: 10, borderTop: "1px solid var(--border2)" }}>
                    <label style={{ fontSize: 11, color: "var(--text4)", display: "block", marginBottom: 6 }}>Dashboard-Vorlage</label>
                    <select value={roleForm.dashboardTemplateId || ""} onChange={e => setRoleForm({ ...roleForm, dashboardTemplateId: e.target.value || null })} style={{ width: "100%", maxWidth: 300 }}>
                      <option value="">— keine —</option>
                      {(data.dashboardTemplates || []).filter(t => t.isPublic).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Cloud: Mitarbeiter einladen Modal */}
      {inviteModal && (
        <Modal onClose={() => setInviteModal(null)} hideFooter>
          <h3 style={{ marginBottom: 6, fontFamily: "'Inter', sans-serif", fontSize: 22 }}>Mitarbeiter einladen</h3>
          <p style={{ fontSize: 12, color: "var(--text4)", marginBottom: 18, lineHeight: 1.6 }}>
            Konto wird angelegt und der Person als Studio-Mitglied zugeordnet. Das temporäre Passwort teilen Sie der Person separat mit.
          </p>
          <FormField label="EMAIL">
            <input
              type="email"
              autoFocus
              value={inviteModal.email}
              onChange={e => setInviteModal(m => ({ ...m!, email: e.target.value }))}
              placeholder="name@studio.ch"
            />
          </FormField>
          <FormField label="NAME">
            <input
              type="text"
              value={inviteModal.displayName}
              onChange={e => setInviteModal(m => ({ ...m!, displayName: e.target.value }))}
              placeholder="Anna Beispiel"
            />
          </FormField>
          <FormField label="APP-ROLLE">
            <select
              value={inviteModal.appRoleId}
              onChange={e => setInviteModal(m => ({ ...m!, appRoleId: e.target.value }))}
            >
              {(data.appRoles || []).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="TEMPORÄRES PASSWORT">
            <input
              type="text"
              value={inviteModal.tempPassword}
              onChange={e => setInviteModal(m => ({ ...m!, tempPassword: e.target.value }))}
            />
            <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 4 }}>
              Wird automatisch generiert. Person kann es nach erstem Login ändern.
            </div>
          </FormField>
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setInviteModal(null)}>Abbrechen</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!inviteModal.email.trim() || !inviteModal.displayName.trim() || inviteModal.tempPassword.length < 6}
              onClick={async () => {
                const m = inviteModal;
                const res = await cloud.inviteMember(m.email.trim(), m.tempPassword, m.displayName.trim(), m.appRoleId);
                if (res?.ok) {
                  setInviteResult({ ok: true, email: m.email.trim(), tempPassword: m.tempPassword });
                  setInviteModal(null);
                } else {
                  alert("Einladen fehlgeschlagen: " + (res?.error || "unbekannt"));
                }
              }}
            >
              Einladen
            </button>
          </div>
        </Modal>
      )}

      {/* Cloud: Erfolgs-Bestätigung mit Credentials zum Weitergeben */}
      {inviteResult?.ok && (
        <Modal onClose={() => setInviteResult(null)} hideFooter>
          <h3 style={{ marginBottom: 6, fontFamily: "'Inter', sans-serif", fontSize: 22 }}>Eingeladen ✓</h3>
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 18, lineHeight: 1.6 }}>
            Bitte teilen Sie diese Zugangsdaten der Person mit. Sie kann sich damit anmelden und das Passwort danach selbst ändern.
          </p>
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: 16, marginBottom: 16, fontFamily: "monospace", fontSize: 13 }}>
            <div style={{ marginBottom: 8 }}><span style={{ color: "var(--text5)", fontSize: 10, letterSpacing: "0.1em" }}>EMAIL</span><br />{inviteResult.email}</div>
            <div><span style={{ color: "var(--text5)", fontSize: 10, letterSpacing: "0.1em" }}>PASSWORT</span><br />{inviteResult.tempPassword}</div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setInviteResult(null)}>Schliessen</button>
        </Modal>
      )}
    </>
  );
}
