// «Mein Profil»: eigene Adresse, Lohn-IBAN, Avatar und Zoom. Für Nicht-Admins die ganze
// Einstellungsseite, für Admins ein Reiter. Speichert direkt (eigener «Speichern»-Knopf).

import React, { useState } from "react";
import { formatIban, imageFileToJpeg } from "../../utils";
import { Header, FormField } from "../../components/UI";
import { Section } from "./shared";
import type { ViewProps } from "../../types";

/** Persönliche Einstellungen des angemeldeten Benutzers; `nav` sind die Reiter, wenn eingebettet. */
export function PersonalSettings({ data, update, currentUser, uiZoom, setUiZoom, nav = null }: Pick<ViewProps, "data" | "update" | "currentUser"> & {
  uiZoom: number; setUiZoom: React.Dispatch<React.SetStateAction<number>>;
  /** Reiter-Navigation, wenn «Mein Profil» als Reiter eingebettet ist */
  nav?: React.ReactNode;
}) {
  const emp = (data.employees || []).find(e => e.id === currentUser.employeeId || e.name === currentUser.displayName);
  const userRec = (data.users || []).find(u => u.id === currentUser.id);
  const [empForm, setEmpForm] = useState({
    street: emp?.street || "",
    zip: emp?.zip || "",
    city: emp?.city || "",
    lohnIban: emp?.lohnIban || "",
  });
  const [saved, setSaved] = useState(false);
  const zoomStep = 0.05;

  const saveProfile = () => {
    if (emp) {
      update("employees", (data.employees || []).map(e => e.id === emp.id ? { ...e, ...empForm } : e));
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Bitte ein Bild auswählen."); return; }
    try {
      const avatar = await imageFileToJpeg(file, 256, 0.85, "longest"); // klein halten, liegt im Datenstand
      update("users", prev => (prev || []).map(u => u.id === currentUser.id ? { ...u, avatar } : u));
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div>
      <Header title="Mein Profil" action={
        <button className="btn btn-primary" style={{ background: saved ? "var(--positive)" : "#2a2a22", transition: "background 0.3s" }} onClick={saveProfile}>
          {saved ? "✓ Gespeichert" : "Speichern"}
        </button>
      } />

      {nav}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <Section title="PROFIL">
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--surface3)", border: "2px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "var(--text4)", overflow: "hidden", flexShrink: 0 }}>
                  {userRec?.avatar
                    ? <img src={userRec.avatar} alt="Profil" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : (currentUser.displayName || currentUser.username).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>{currentUser.displayName || currentUser.username}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <label className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 11, cursor: "pointer" }}>
                      {userRec?.avatar ? "Ersetzen" : "Foto hochladen"}
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={uploadAvatar} />
                    </label>
                    {userRec?.avatar && (
                      <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }}
                        onClick={() => update("users", (data.users || []).map(u => u.id === currentUser.id ? { ...u, avatar: null } : u))}>
                        <span className="msr" style={{ fontSize: 16 }}>close</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="MEINE ADRESSE">
              <FormField label="Strasse + Nr.">
                <input value={empForm.street} onChange={e => setEmpForm(f => ({ ...f, street: e.target.value }))} placeholder="z.B. Musterstrasse 1" />
              </FormField>
              <div className="form-row">
                <FormField label="PLZ"><input value={empForm.zip} onChange={e => setEmpForm(f => ({ ...f, zip: e.target.value }))} style={{ maxWidth: 120 }} /></FormField>
                <FormField label="Ort"><input value={empForm.city} onChange={e => setEmpForm(f => ({ ...f, city: e.target.value }))} /></FormField>
              </div>
              {!emp && (
                <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 6, padding: "8px 12px", background: "var(--warning-bg)", borderRadius: 8 }}>
                  Kein verknüpfter Mitarbeitereintrag gefunden. Wende dich an den Administrator.
                </div>
              )}
            </Section>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <Section title="LOHNKONTO">
              <FormField label="IBAN">
                <input value={empForm.lohnIban} onChange={e => setEmpForm(f => ({ ...f, lohnIban: formatIban(e.target.value) }))} placeholder="CH00 0000 0000 0000 0000 0" />
              </FormField>
              <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 6, lineHeight: 1.6 }}>
                Diese Angabe wird für die Lohnüberweisung verwendet und ist nur für den Administrator sichtbar.
              </div>
              {!emp && (
                <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 6, padding: "8px 12px", background: "var(--warning-bg)", borderRadius: 8 }}>
                  Kein verknüpfter Mitarbeitereintrag gefunden.
                </div>
              )}
            </Section>
          </div>

          <div className="card">
            <Section title="DARSTELLUNG">
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>Skalierung / Zoom</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button onClick={() => setUiZoom(z => Math.max(0.5, Math.round((z - zoomStep) * 100) / 100))} style={{ width: 36, height: 36, border: "1.5px solid var(--border3)", borderRadius: "50%", background: "none", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>−</button>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", color: "var(--text)" }}>{Math.round((uiZoom || 1) * 100)}%</div>
                </div>
                <button onClick={() => setUiZoom(z => Math.min(1.5, Math.round((z + zoomStep) * 100) / 100))} style={{ width: 36, height: 36, border: "1.5px solid var(--border3)", borderRadius: "50%", background: "none", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>+</button>
              </div>
              {(uiZoom || 1) !== 1 && (
                <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 11, width: "100%" }} onClick={() => setUiZoom(1)}>
                  ↺ Auf 100% zurücksetzen
                </button>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
