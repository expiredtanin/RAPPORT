// Modal «Mitarbeiter»: Personalien, Arbeitszeit, Lohn/Sozialabzüge und optionaler App-Zugang.

import React from "react";
import { formatIban, formatCHF } from "../../utils";
import { Modal, FormField, DateInput, DatePicker } from "../../components/UI";
import type { ViewProps } from "../../types";
import type { EmpForm } from "./types";

interface EmployeeModalProps {
  data: ViewProps["data"];
  empForm: EmpForm;
  setEmpForm: React.Dispatch<React.SetStateAction<EmpForm>>;
  nextPersonalNr: () => string;
  onClose: () => void;
  onSave: () => void;
}

/** Formular-Modal zum Anlegen/Bearbeiten eines Mitarbeiters. */
export default function EmployeeModal({ data, empForm, setEmpForm, nextPersonalNr, onClose, onSave }: EmployeeModalProps) {
  return (
    <Modal title={empForm.id ? "Mitarbeiter bearbeiten" : "Neuer Mitarbeiter"} onClose={onClose} onSave={onSave} wide>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>PERSONALIEN</div>
      <div className="form-row">
        <FormField label="Name *"><input value={empForm.name || ""} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} autoFocus style={!empForm.name?.trim() ? { borderColor: "var(--warning)" } : {}} /></FormField>
        <FormField label="Funktion / Rolle"><input value={empForm.role || ""} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} placeholder="z.B. Architekt, Praktikant…" /></FormField>
        <FormField label="Personal-Nr.">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input value={empForm.personalNr || ""} onChange={e => setEmpForm({ ...empForm, personalNr: e.target.value })} style={{ flex: 1 }} placeholder="001" />
            {empForm.id && empForm.personalNr === "" && (
              <button type="button" className="btn btn-ghost" style={{ padding: "0 10px", height: 36, fontSize: 11 }} onClick={() => setEmpForm({ ...empForm, personalNr: nextPersonalNr() })}>Auto</button>
            )}
          </div>
          {empForm.personalNr && !/^\d+$/.test(empForm.personalNr) && (
            <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}>Nicht-numerische Nr. wird nicht für Auto-Zählung verwendet</div>
          )}
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Adresse"><input value={empForm.adresse || ""} onChange={e => setEmpForm({ ...empForm, adresse: e.target.value })} placeholder="Musterstrasse 1" /></FormField>
        <FormField label="PLZ / Ort"><input value={empForm.ort || ""} onChange={e => setEmpForm({ ...empForm, ort: e.target.value })} placeholder="8001 Zürich" /></FormField>
      </div>
      <div className="form-row">
        <FormField label="AHV-Nr."><input value={empForm.ahvNr || ""} onChange={e => setEmpForm({ ...empForm, ahvNr: e.target.value })} placeholder="756.1234.5678.90" /></FormField>
        <FormField label="Geburtsdatum"><DateInput value={empForm.geburtsdatum || ""} onChange={e => setEmpForm({ ...empForm, geburtsdatum: e.target.value })} /></FormField>
        <FormField label="E-Mail"><input type="email" value={empForm.email || ""} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} /></FormField>
      </div>
      <div className="form-row">
        <FormField label="Eintrittsdatum *"><DatePicker value={empForm.eintrittsdatum || ""} onChange={e => setEmpForm({ ...empForm, eintrittsdatum: e.target.value })} style={!empForm.eintrittsdatum ? { borderColor: "var(--warning)" } : {}} /></FormField>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>ARBEITSZEIT & FERIEN</div>
      <div className="form-row">
        <FormField label="Pensum %">
          <input type="number" min={10} max={100} step={5} value={empForm.pensum || 100} onChange={e => setEmpForm({ ...empForm, pensum: +e.target.value })} />
        </FormField>
        <FormField label="Wochenstunden (100%)">
          <input type="number" min={1} max={50} step={0.5} value={empForm.wochenstunden || data.settings.defaultWochenstunden || 35} onChange={e => setEmpForm({ ...empForm, wochenstunden: +e.target.value })} />
          <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Effektiv: {(((empForm.wochenstunden || 35) * (empForm.pensum || 100)) / 100).toFixed(1)}h/Wo</div>
        </FormField>
        <FormField label="Ferien (Wochen/Jahr)">
          <input type="number" min={4} max={10} step={0.5} value={empForm.ferienWochen || data.settings.defaultFerienWochen || 5} onChange={e => setEmpForm({ ...empForm, ferienWochen: +e.target.value })} />
          <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Minimum: 4 Wochen (OR)</div>
        </FormField>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>LOHN & AUSZAHLUNG</div>
      <div className="form-row">
        <FormField label="Monatslohn Brutto CHF (100% Basis)">
          <input type="number" min={0} step={100} value={empForm.monatslohn || ""} onChange={e => setEmpForm({ ...empForm, monatslohn: +e.target.value })} placeholder="z.B. 7000" />
          {(empForm.pensum || 100) < 100 && (empForm.monatslohn || 0) > 0 && (
            <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 3 }}>Effektiv bei {empForm.pensum}%: {formatCHF(Math.round((empForm.monatslohn as number) * ((empForm.pensum as number) / 100) * 100) / 100)}</div>
          )}
        </FormField>
        <FormField label="IBAN Lohnkonto">
          <input
            value={empForm.lohnIban || ""}
            onChange={e => setEmpForm({ ...empForm, lohnIban: formatIban(e.target.value) })}
            placeholder="CH00 0000 0000 0000 0000 0"
          />
        </FormField>
        <FormField label=" ">
          <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
            <input type="checkbox" checked={!!empForm.dreizehnterLohn} onChange={e => setEmpForm({ ...empForm, dreizehnterLohn: e.target.checked })} style={{ width: "auto" }} />
            13. Monatslohn
          </label>
        </FormField>
      </div>
      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 8 }}>Sozialabzüge Arbeitnehmer (anpassbar)</div>
      <div className="form-row">
        <FormField label="AHV/IV/EO %">
          <input type="number" step={0.01} min={0} value={empForm.ahvSatz ?? 5.3} onChange={e => setEmpForm({ ...empForm, ahvSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Standard 5.30%</div>
        </FormField>
        <FormField label="ALV %">
          <input type="number" step={0.01} min={0} value={empForm.alvSatz ?? 1.1} onChange={e => setEmpForm({ ...empForm, alvSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Standard 1.10%</div>
        </FormField>
        <FormField label="BVG / PK AN %">
          <input type="number" step={0.1} min={0} value={empForm.bvgSatz ?? 8.0} onChange={e => setEmpForm({ ...empForm, bvgSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Arbeitnehmer-Anteil</div>
        </FormField>
      </div>
      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 8 }}>Sozialabgaben Arbeitgeber</div>
      <div className="form-row">
        <FormField label="PK / BVG AG %">
          <input type="number" step={0.1} min={0} value={empForm.pkAGSatz ?? (data.settings.defaultPkAGSatz ?? 8.0)} onChange={e => setEmpForm({ ...empForm, pkAGSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>AG muss mind. AN-Anteil zahlen</div>
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="NBU % (Nichtberufsunfall)">
          <input type="number" step={0.01} min={0} value={empForm.nbuSatz ?? 1.5} onChange={e => setEmpForm({ ...empForm, nbuSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>trägt AN</div>
        </FormField>
        <FormField label="KTG % (Krankentaggeld)">
          <input type="number" step={0.01} min={0} value={empForm.ktgSatz ?? 0.5} onChange={e => setEmpForm({ ...empForm, ktgSatz: +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>je nach Vertrag</div>
        </FormField>
        <FormField label=" ">
          <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
            <input type="checkbox" checked={!!empForm.quellensteuerPflichtig} onChange={e => setEmpForm({ ...empForm, quellensteuerPflichtig: e.target.checked })} style={{ width: "auto" }} />
            Quellensteuerpflichtig
          </label>
          {empForm.quellensteuerPflichtig && (
            <input type="number" step={0.1} min={0} value={empForm.quellensteuerSatz ?? 10} onChange={e => setEmpForm({ ...empForm, quellensteuerSatz: +e.target.value })} placeholder="Satz %" style={{ marginTop: 4 }} />
          )}
        </FormField>
      </div>

      {/* APP-ZUGANG */}
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "18px 0 12px", paddingTop: 14, borderTop: "1px solid var(--border2)" }}>APP-ZUGANG</div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
          <input type="checkbox" checked={!!empForm._appAccess} onChange={e => setEmpForm({ ...empForm, _appAccess: e.target.checked })} style={{ width: "auto" }} />
          Zugang zur App aktivieren
        </label>
      </div>
      {empForm._appAccess && (
        <>
          <div className="form-row">
            <FormField label="Benutzername *">
              <input value={empForm._appUsername || ""} onChange={e => setEmpForm({ ...empForm, _appUsername: e.target.value })} placeholder="vorname.nachname" style={!empForm._appUsername?.trim() ? { borderColor: "var(--warning)" } : {}} />
            </FormField>
            <FormField label={empForm._appUserId ? "Neues Passwort (leer = unverändert)" : "Passwort"}>
              <input type="password" value={empForm._appPassword || ""} onChange={e => setEmpForm({ ...empForm, _appPassword: e.target.value })} placeholder={empForm._appUserId ? "••••••" : "Passwort vergeben"} />
            </FormField>
          </div>
          <FormField label="Rolle">
            <select value={empForm._appRoleId || ""} onChange={e => setEmpForm({ ...empForm, _appRoleId: e.target.value })}>
              <option value="">— Rolle wählen —</option>
              {(data.appRoles || []).map(r => (
                <option key={r.id} value={r.id}>{r.name}{r.permissions === null ? " (Alle Rechte)" : ` (${(r.permissions || []).length} Bereiche)`}</option>
              ))}
            </select>
            {!empForm._appRoleId && <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}>Bitte eine Rolle wählen</div>}
            {empForm._appRoleId && (() => {
              const role = (data.appRoles || []).find(r => r.id === empForm._appRoleId);
              if (!role) return null;
              if (role.permissions === null) return <div style={{ fontSize: 10, color: "var(--positive)", marginTop: 3 }}>Zugriff auf alle Bereiche</div>;
              if (!role.permissions?.length) return <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> Rolle hat keine Bereiche — Benutzer sieht nichts</div>;
              return <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>{role.permissions.join(", ")}</div>;
            })()}
          </FormField>
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 4 }}>Rollen und Berechtigungen unter Einstellungen → App-Rollen verwalten.</div>
        </>
      )}
    </Modal>
  );
}
