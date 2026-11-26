// Modal «Mitarbeiter»: Personalien, Arbeitszeit, Lohn/Sozialabzüge und optionaler App-Zugang.

import React from "react";
import { arbeitszeitAm, formatIban, formatCHF, localISODate, monatslohnAm } from "../../utils";
import { Modal, FormField, DateInput, DatePicker } from "../../components/UI";
import { isCloudBackend } from "../../storage/adapter";
import type { LohnWechsel, PensumWechsel, ViewProps } from "../../types";
import type { EmpForm } from "./types";

interface EmployeeModalProps {
  data: ViewProps["data"];
  empForm: EmpForm;
  setEmpForm: React.Dispatch<React.SetStateAction<EmpForm>>;
  nextPersonalNr: () => string;
  onClose: () => void;
  onSave: () => void;
  /** false = Lohnfelder nur lesen (ohne Recht «Löhne»; der Server lehnt Änderungen ab, pb_hooks/integrity.pb.js) */
  canEditLohn?: boolean;
  /** App-Zugang (Konto, Passwort, Rolle) anlegen/ändern — nur Admins (lokal/Datenordner) */
  canManageAccounts?: boolean;
}

/** Formular-Modal zum Anlegen/Bearbeiten eines Mitarbeiters. */
export default function EmployeeModal({ data, empForm, setEmpForm, nextPersonalNr, onClose, onSave, canEditLohn = true, canManageAccounts = true }: EmployeeModalProps) {
  const verlauf = empForm.pensumVerlauf || [];
  const setVerlauf = (list: PensumWechsel[]) => setEmpForm({ ...empForm, pensumVerlauf: list });
  const heute = arbeitszeitAm(empForm, localISODate());
  const lohnVerlauf = empForm.lohnVerlauf || [];
  const setLohnVerlauf = (list: LohnWechsel[]) => setEmpForm({ ...empForm, lohnVerlauf: list });
  const lohnHeute = monatslohnAm(empForm, localISODate());
  const stichtagJahr = (empForm.saldoStichtag || "").slice(0, 4);
  const ferienStichtag = stichtagJahr ? (empForm.ferienUebertragVorjahr || {})[stichtagJahr] : undefined;
  const hint = { fontSize: 10, color: "var(--text5)", marginTop: 3 } as const;
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
        {/* Sozialversicherungsnummer nur mit Recht «Löhne» (Runde 39) */}
        {canEditLohn && <FormField label="AHV-Nr."><input value={empForm.ahvNr || ""} onChange={e => setEmpForm({ ...empForm, ahvNr: e.target.value })} placeholder="756.1234.5678.90" /></FormField>}
        <FormField label="Geburtsdatum"><DateInput value={empForm.geburtsdatum || ""} onChange={e => setEmpForm({ ...empForm, geburtsdatum: e.target.value })} /></FormField>
        <FormField label="E-Mail"><input type="email" value={empForm.email || ""} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} /></FormField>
      </div>
      <div className="form-row">
        <FormField label="Eintrittsdatum *"><DatePicker value={empForm.eintrittsdatum || ""} onChange={e => setEmpForm({ ...empForm, eintrittsdatum: e.target.value })} style={!empForm.eintrittsdatum ? { borderColor: "var(--warning)" } : {}} /></FormField>
        <FormField label="Austrittsdatum">
          <DatePicker value={empForm.austrittsdatum || ""} onChange={e => setEmpForm({ ...empForm, austrittsdatum: e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>letzter Monat anteilig</div>
        </FormField>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>ARBEITSZEIT & FERIEN</div>
      <div className="form-row">
        <FormField label={verlauf.length ? "Pensum % (ab Eintritt)" : "Pensum %"}>
          <input type="number" min={10} max={100} step={5} value={empForm.pensum || 100} onChange={e => setEmpForm({ ...empForm, pensum: +e.target.value })} />
        </FormField>
        <FormField label="Wochenstunden (100%)">
          <input type="number" min={1} max={50} step={0.5} value={empForm.wochenstunden || data.settings.defaultWochenstunden || 35} onChange={e => setEmpForm({ ...empForm, wochenstunden: +e.target.value })} />
          <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Effektiv{verlauf.length ? " heute" : ""}: {((heute.wochenstunden * heute.pensum) / 100).toFixed(1)}h/Wo{verlauf.length ? ` (${heute.pensum} %)` : ""}</div>
        </FormField>
        <FormField label="Ferien (Wochen/Jahr)">
          <input type="number" min={4} max={10} step={0.5} value={empForm.ferienWochen || data.settings.defaultFerienWochen || 5} onChange={e => setEmpForm({ ...empForm, ferienWochen: +e.target.value })} />
          <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Minimum: 4 Wochen (OR)</div>
        </FormField>
      </div>
      {/* Pensumwechsel: ab einem Datum gilt ein anderes Pensum (Soll, Ferienanspruch, Lohn tagesgenau) */}
      <div style={{ fontSize: 11, color: "var(--text4)", margin: "4px 0 8px" }}>
        Pensumwechsel <span style={{ color: "var(--text5)" }}>— Soll, Ferienanspruch und Lohn rechnen ab dem Datum mit dem neuen Pensum (im Wechselmonat tagesgenau anteilig)</span>
      </div>
      {verlauf.map((v, i) => (
        <div key={i} className="form-row" style={{ alignItems: "flex-end" }}>
          <FormField label="Ab"><DatePicker value={v.ab || ""} onChange={e => setVerlauf(verlauf.map((x, j) => j === i ? { ...x, ab: e.target.value } : x))} style={!v.ab ? { borderColor: "var(--warning)" } : {}} /></FormField>
          <FormField label="Pensum %"><input type="number" min={0} max={100} step={5} value={v.pensum ?? ""} title="0 % = unbezahlter Urlaub ab diesem Datum" onChange={e => setVerlauf(verlauf.map((x, j) => j === i ? { ...x, pensum: (e.target.value === "" ? null : +e.target.value) as number } : x))} /></FormField>
          <FormField label="Wochenstunden (100%)"><input type="number" min={1} max={50} step={0.5} value={v.wochenstunden ?? ""} placeholder="wie bisher" onChange={e => setVerlauf(verlauf.map((x, j) => j === i ? { ...x, wochenstunden: e.target.value === "" ? null : +e.target.value } : x))} /></FormField>
          <div style={{ flex: "0 0 auto", paddingBottom: 6 }}>
            <button type="button" className="btn-icon danger" title="Wechsel entfernen" aria-label="Wechsel entfernen" onClick={() => setVerlauf(verlauf.filter((_, j) => j !== i))}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", marginBottom: 6 }}
        onClick={() => setVerlauf([...verlauf, { ab: "", pensum: heute.pensum }])}>+ Pensum ab …</button>

      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>SALDO-ÜBERTRAG (UMSTIEG)</div>
      <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 10, lineHeight: 1.5 }}>
        Für den Wechsel von Excel oder einem anderen Programm: Ab dem Stichtag rechnet RAPPORT Soll, Ist und Ferien selbst; alles davor zählt nicht. Überstunden und Ferienguthaben per Stichtag aus der bisherigen Abrechnung übernehmen (z.B. Stand am Morgen des 1. Januar).
      </div>
      <div className="form-row">
        <FormField label="Stichtag">
          <DatePicker value={empForm.saldoStichtag || ""} onChange={e => setEmpForm({ ...empForm, saldoStichtag: e.target.value })} />
          <div style={hint}>leer = Saldo seit Eintritt</div>
        </FormField>
        <FormField label="Überstunden per Stichtag (h)">
          <input type="number" step={0.25} value={empForm.saldoUebertragStunden ?? ""} placeholder="0" disabled={!empForm.saldoStichtag}
            onChange={e => setEmpForm({ ...empForm, saldoUebertragStunden: e.target.value === "" ? null : +e.target.value })} />
          <div style={hint}>Minusstunden mit «−»</div>
        </FormField>
        <FormField label={`Ferienguthaben per Stichtag (h)`}>
          <input type="number" step={0.5} value={ferienStichtag ?? ""} placeholder="0" disabled={!stichtagJahr}
            onChange={e => {
              const rest = { ...(empForm.ferienUebertragVorjahr || {}) };
              if (e.target.value === "") delete rest[stichtagJahr]; else rest[stichtagJahr] = +e.target.value;
              setEmpForm({ ...empForm, ferienUebertragVorjahr: rest });
            }} />
          <div style={hint}>{stichtagJahr ? `= Ferienübertrag ${stichtagJahr}; Anspruch ${stichtagJahr} zählt ab Stichtag` : "Stunden; Tage × Tagessoll"}</div>
        </FormField>
      </div>

      {/* ohne Recht «Löhne» ganz ausgeblendet (vorher nur gesperrt — Lohn, IBAN, AHV-Nr. blieben lesbar, Runde 37) */}
      {!canEditLohn && <div style={{ ...hint, margin: "14px 0 0", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>Lohn und Auszahlung sieht und ändert, wer das Recht «Löhne» hat.</div>}
      <fieldset disabled={!canEditLohn} style={{ border: "none", padding: 0, margin: 0, minWidth: 0, display: canEditLohn ? undefined : "none" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>LOHN & AUSZAHLUNG</div>
      <div className="form-row">
        <FormField label={lohnVerlauf.length ? "Monatslohn CHF (100 %, ab Eintritt)" : "Monatslohn Brutto CHF (100% Basis)"}>
          <input type="number" min={0} step={100} value={empForm.monatslohn || ""} onChange={e => setEmpForm({ ...empForm, monatslohn: +e.target.value })} placeholder="z.B. 7000" />
          {(heute.pensum < 100 || lohnVerlauf.length > 0) && lohnHeute > 0 && (
            <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 3 }}>Effektiv heute{heute.pensum < 100 ? ` bei ${heute.pensum}%` : ""}: {formatCHF(Math.round(lohnHeute * (heute.pensum / 100) * 100) / 100)}</div>
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
      {/* Lohnänderungen: ab einem Datum gilt ein anderer Monatslohn (im Wechselmonat tagesgenau) */}
      <div style={{ fontSize: 11, color: "var(--text4)", margin: "4px 0 8px" }}>
        Lohnänderungen <span style={{ color: "var(--text5)" }}>— ab dem Datum gilt der neue Monatslohn (100 %); im Wechselmonat tagesgenau anteilig, frühere Abrechnungen bleiben</span>
      </div>
      {lohnVerlauf.map((v, i) => (
        <div key={i} className="form-row" style={{ alignItems: "flex-end" }}>
          <FormField label="Ab"><DatePicker value={v.ab || ""} onChange={e => setLohnVerlauf(lohnVerlauf.map((x, j) => j === i ? { ...x, ab: e.target.value } : x))} style={!v.ab ? { borderColor: "var(--warning)" } : {}} /></FormField>
          <FormField label="Monatslohn CHF (100 %)"><input type="number" min={0} step={100} value={v.monatslohn || ""} onChange={e => setLohnVerlauf(lohnVerlauf.map((x, j) => j === i ? { ...x, monatslohn: +e.target.value } : x))} /></FormField>
          <div style={{ flex: "0 0 auto", paddingBottom: 6 }}>
            <button type="button" className="btn-icon danger" title="Lohnänderung entfernen" aria-label="Lohnänderung entfernen" onClick={() => setLohnVerlauf(lohnVerlauf.filter((_, j) => j !== i))}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", marginBottom: 6 }}
        onClick={() => setLohnVerlauf([...lohnVerlauf, { ab: "", monatslohn: lohnHeute }])}>+ Lohn ab …</button>
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
      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 8 }}>Pensionskasse laut PK-Ausweis (empfohlen; ersetzt die %-Sätze)</div>
      <div className="form-row">
        <FormField label="PK Arbeitnehmer CHF/Monat">
          <input type="number" step={0.05} min={0} value={empForm.pkBeitragAN ?? ""} placeholder="leer = % oben" onChange={e => setEmpForm({ ...empForm, pkBeitragAN: e.target.value === "" ? null : +e.target.value })} />
        </FormField>
        <FormField label="PK Arbeitgeber CHF/Monat">
          <input type="number" step={0.05} min={0} value={empForm.pkBeitragAG ?? ""} placeholder="leer = % oben" onChange={e => setEmpForm({ ...empForm, pkBeitragAG: e.target.value === "" ? null : +e.target.value })} />
          {(empForm.pkBeitragAG ?? 0) < (empForm.pkBeitragAN ?? 0) && <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}>AG-Beitrag muss mind. gleich hoch sein (Art. 66 BVG)</div>}
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Familienzulagen CHF/Monat">
          <input type="number" step={5} min={0} value={empForm.familienzulagen ?? ""} placeholder="0" onChange={e => setEmpForm({ ...empForm, familienzulagen: e.target.value === "" ? null : +e.target.value })} />
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Kinder-/Ausbildungszulagen laut FAK, nicht AHV-pflichtig</div>
        </FormField>
        <FormField label=" ">
          <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
            <input type="checkbox" checked={!!empForm.ahvRentner} onChange={e => setEmpForm({ ...empForm, ahvRentner: e.target.checked })} style={{ width: "auto" }} />
            AHV-Rentner:in
          </label>
          <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Freibetrag CHF 1'400/Mt., keine ALV/BVG; ab 65 automatisch aus dem Geburtsdatum</div>
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

      </fieldset>

      {/* APP-ZUGANG */}
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "18px 0 12px", paddingTop: 14, borderTop: "1px solid var(--border2)" }}>APP-ZUGANG</div>
      {!canManageAccounts && !isCloudBackend ? (
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6 }}>
          {empForm._appAccess ? "Mit einem Konto verknüpft." : "Kein App-Zugang."} Konten und Rollen verwaltet ein Admin.
        </div>
      ) : isCloudBackend ? (
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6 }}>
          {empForm.appUserId ? "Mit einem Konto verknüpft." : "Noch kein Konto verknüpft."} Konten, Passwörter und Rollen verwaltet
          der Server: einladen und Rolle ändern unter Einstellungen → Team.
        </div>
      ) : (<>
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
      </>)}
    </Modal>
  );
}
