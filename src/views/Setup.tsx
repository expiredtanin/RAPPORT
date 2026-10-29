// Einrichtungsassistent für den lokalen Betrieb (3 Schritte): Studio-Stammdaten →
// Admin-Account → Zusammenfassung. Erzeugt aus `defaultData` den Startzustand mit
// einem Administrator (Passwort als PBKDF2-Hash, nie im Klartext) und einem
// zugehörigen Mitarbeiterprofil und übergibt ihn an `onComplete` (App.jsx speichert).
// Alternativ kann ein JSON-Backup importiert werden (`handleImport`), das nur
// grob geprüft wird (settings + projects vorhanden).
//
// Exportiert zusätzlich `SetupPrompt` (Rückfrage für Nutzer mit Altdaten).
// Der Cloud-Pendant ist CloudSetup.tsx; Palette `C` und Styles `S` sind dort
// dupliziert (bewusst, damit beide Wizards unabhängig bleiben).

import React, { useState, useRef } from "react";
import type { CSSProperties } from "react";
import { defaultData } from "../constants";
import { generateId, hashPassword, localISODate } from "../utils";
import type { AppData, Employee } from "../types";

// ─── Palette — matches the app's light theme exactly ─────────────────────────
const C = {
  bg:       "#ebe7e1",
  surface:  "#fdfcfa",
  surface2: "#f7f4f0",
  border:   "#ddd8d0",
  border2:  "#e6e1da",
  text:     "#1a1a18",
  text3:    "#6a6660",
  text4:    "#8c8880",
  danger:   "#8a1a1a",
  dangerBg: "#fdf2f2",
  dangerBorder: "#e0b0b0",
};

const S = {
  wrap: {
    background: C.bg,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Inter', sans-serif",
    color: C.text,
    padding: "32px 16px",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: C.surface,
    borderRadius: 14,
    padding: "44px 40px",
    boxShadow: "0 2px 24px rgba(60,50,40,0.10)",
    border: `1px solid ${C.border}`,
  },
  logo: {
    fontFamily: "Krungthep,'Archivo Black',sans-serif",
    fontSize: 34,
    color: C.text,
    letterSpacing: "-0.02em",
    textAlign: "center",
    marginBottom: 4,
  },
  sub: {
    textAlign: "center",
    fontSize: 10,
    color: C.text4,
    letterSpacing: "0.14em",
    marginBottom: 32,
  },
  progress: {
    display: "flex",
    gap: 6,
    justifyContent: "center",
    marginBottom: 32,
  },
  dot: (active: boolean, done: boolean): CSSProperties => ({
    width: active ? 22 : 8,
    height: 8,
    borderRadius: 4,
    background: done ? C.text : active ? C.text : C.border,
    opacity: done ? 1 : active ? 1 : 0.4,
    transition: "all 0.3s",
  }),
  label: {
    fontSize: 9,
    letterSpacing: "0.14em",
    color: C.text4,
    display: "block",
    marginBottom: 5,
    marginTop: 16,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: "9px 12px",
    color: C.text,
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    outline: "none",
    transition: "border-color 0.15s",
  },
  inputErr: { border: `1px solid ${C.dangerBorder}` },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: "9px 12px",
    color: C.text,
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    outline: "none",
    resize: "vertical",
    minHeight: 64,
  },
  err: { fontSize: 11, color: C.danger, marginTop: 4 },
  hint: { fontSize: 11, color: C.text4, marginTop: 5, lineHeight: 1.5 },
  btnPrimary: {
    width: "100%",
    background: C.text,
    border: "none",
    borderRadius: 20,
    padding: "12px 0",
    color: "#fff",
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    cursor: "pointer",
    marginTop: 28,
    letterSpacing: "0.04em",
    transition: "opacity 0.15s",
  },
  btnGhost: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: "10px 0",
    color: C.text4,
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    cursor: "pointer",
    marginTop: 10,
  },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;

// ─── Prompt for users with existing data ─────────────────────────────────────

/** Rückfrage für Nutzer mit Altdaten: neu einrichten (löscht alles) oder Daten behalten. */
export function SetupPrompt({ onSetup, onSkip }: { onSetup: () => void; onSkip: () => void }) {
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.logo}>RAPPORT</div>
        <div style={S.sub}>NEUE VERSION</div>

        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, color: C.text, marginBottom: 10 }}>
          Neuer Einrichtungsassistent.
        </div>
        <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.7, marginBottom: 24 }}>
          Rapport verfügt über einen neuen Setup-Assistenten für Studio, Admin-Account und Mitarbeiterprofil.
          Möchtest du ihn durchlaufen?
        </div>

        <div style={{ background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: C.danger, marginBottom: 4 }}>
          Neu einrichten löscht alle bestehenden Daten unwiderruflich.
        </div>

        <button onClick={onSetup} style={{ ...S.btnPrimary, marginTop: 16 }}>Neu einrichten</button>
        <button onClick={onSkip} style={S.btnGhost}>Vorhandene Daten behalten →</button>
      </div>
    </div>
  );
}

// ─── Main setup wizard ────────────────────────────────────────────────────────

/** @param onComplete bekommt den fertigen Startzustand (oder den importierten Backup-Stand) */
export default function Setup({ onComplete }: { onComplete: (data: AppData) => void }) {
  const TOTAL = 3;
  const [step, setStep]     = useState(1);
  const [studio, setStudio] = useState({ name: "", address: "", email: "", phone: "" });
  const [account, setAccount] = useState({ displayName: "", username: "admin", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPw, setShowPw] = useState(false);
  const [importErr, setImportErr] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed.settings || !Array.isArray(parsed.projects)) {
          setImportErr("Ungültiges Backup-Format.");
          return;
        }
        onComplete({
          ...defaultData,
          ...parsed,
          settings: { ...defaultData.settings, ...parsed.settings, setupCompleted: true },
          appRoles: parsed.appRoles || defaultData.appRoles,
          users: parsed.users || defaultData.users,
        });
      } catch {
        setImportErr("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const setS = (k: keyof typeof studio, v: string) => setStudio(s => ({ ...s, [k]: v }));
  const setA = (k: keyof typeof account, v: string) => setAccount(a => ({ ...a, [k]: v }));
  const clearErr = (k: string) => setErrors(e => { const n = { ...e }; delete n[k]; return n; });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (step === 1 && !studio.name.trim()) errs.name = "Pflichtfeld";
    if (step === 2) {
      if (!account.displayName.trim()) errs.displayName = "Pflichtfeld";
      if (!account.username.trim())    errs.username = "Pflichtfeld";
      if (account.password.length < 8) errs.password = "Mindestens 8 Zeichen";
      if (account.password !== account.confirm) errs.confirm = "Passwörter stimmen nicht überein";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next   = () => { if (validate()) setStep(s => s + 1); };
  const back   = () => setStep(s => s - 1);

  const [busy, setBusy] = useState(false);
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const empId = generateId();
      const { hash, salt } = await hashPassword(account.password);
      onComplete({
        ...defaultData,
        settings: {
          ...defaultData.settings,
          setupCompleted: true,
          name:    studio.name.trim(),
          address: studio.address.trim() || defaultData.settings.address,
          email:   studio.email.trim()   || defaultData.settings.email,
          phone:   studio.phone.trim()   || defaultData.settings.phone,
        },
        users: [{
          id: "admin",
          username:    account.username.trim(),
          passwordHash: hash,
          passwordSalt: salt,
          role:        "admin",
          displayName: account.displayName.trim(),
          appRoleId:   "r-admin",
          employeeId:  empId,
        }],
        // FIXME(karim): `aktiv` ist nicht das Feld `active` aus dem Datenmodell (Employee.active);
        // der Cast verdeckt, dass hier Pflichtfelder (role, pensum) fehlen. Verhalten unverändert.
        employees: [{
          id: empId,
          name: account.displayName.trim(),
          email: studio.email.trim() || "",
          wochenstunden: defaultData.settings.defaultWochenstunden || 35,
          ferienWochen:  defaultData.settings.defaultFerienWochen  || 5,
          eintrittsdatum: localISODate(),
          aktiv: true,
          appUserId: "admin",
        } as unknown as Employee],
      });
    } finally {
      setBusy(false);
    }
  };

  const progressEl = (
    <div style={S.progress}>
      {Array.from({ length: TOTAL }, (_, i) => (
        <div key={i} style={S.dot(i + 1 === step, i + 1 < step)} />
      ))}
    </div>
  );

  const renderHeader = (n: number, title: string, lead?: string) => (
    <>
      <div style={S.logo}>RAPPORT</div>
      <div style={S.sub}>SCHRITT {n} VON {TOTAL}</div>
      {progressEl}
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, color: C.text, marginBottom: 6 }}>{title}</div>
      {lead && <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.65, marginBottom: 20 }}>{lead}</div>}
    </>
  );

  // ── Step 1: Studio ──────────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(1, "Willkommen.", "Lass uns Rapport für dein Studio einrichten. Das dauert weniger als zwei Minuten.")}

        <label style={S.label}>STUDIO / UNTERNEHMEN *</label>
        <input
          style={{ ...S.input, ...(errors.name ? S.inputErr : {}) }}
          placeholder="Muster Architektur GmbH"
          autoFocus
          value={studio.name}
          onChange={e => { setS("name", e.target.value); clearErr("name"); }}
          onKeyDown={e => e.key === "Enter" && next()}
        />
        {errors.name && <div style={S.err}>{errors.name}</div>}

        <label style={S.label}>ADRESSE</label>
        <textarea
          style={S.textarea}
          placeholder={"Musterstrasse 1\n8001 Zürich"}
          value={studio.address}
          onChange={e => setS("address", e.target.value)}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>E-MAIL</label>
            <input style={S.input} type="email" placeholder="mail@studio.ch"
              value={studio.email} onChange={e => setS("email", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>TELEFON</label>
            <input style={S.input} placeholder="+41 44 000 00 00"
              value={studio.phone} onChange={e => setS("phone", e.target.value)} />
          </div>
        </div>

        <button style={S.btnPrimary} onClick={next}>Weiter →</button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 4px" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ fontSize: 10, color: C.text4, letterSpacing: "0.1em" }}>ODER</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
        <button style={S.btnGhost} onClick={() => { setImportErr(""); importRef.current?.click(); }}>
          Backup importieren
        </button>
        {importErr && <div style={{ ...S.err, textAlign: "center", marginTop: 8 }}>{importErr}</div>}
      </div>
    </div>
  );

  // ── Step 2: Admin-Account ───────────────────────────────────────────────────
  if (step === 2) return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(2, "Dein Account.", "Dieser Account hat vollen Systemzugriff. Weitere Mitarbeitende können später mit eingeschränkten Berechtigungen hinzugefügt werden.")}

        <label style={S.label}>DEIN NAME *</label>
        <input
          style={{ ...S.input, ...(errors.displayName ? S.inputErr : {}) }}
          placeholder="Anna Muster"
          autoFocus
          value={account.displayName}
          onChange={e => { setA("displayName", e.target.value); clearErr("displayName"); }}
        />
        {errors.displayName && <div style={S.err}>{errors.displayName}</div>}
        <div style={S.hint}>Wird als Mitarbeiterprofil angelegt und im System angezeigt.</div>

        <label style={S.label}>BENUTZERNAME *</label>
        <input
          style={{ ...S.input, ...(errors.username ? S.inputErr : {}) }}
          placeholder="admin"
          value={account.username}
          onChange={e => { setA("username", e.target.value.toLowerCase().replace(/\s/g, "")); clearErr("username"); }}
        />
        {errors.username && <div style={S.err}>{errors.username}</div>}

        <label style={S.label}>PASSWORT *</label>
        <div style={{ position: "relative" }}>
          <input
            style={{ ...S.input, ...(errors.password ? S.inputErr : {}), paddingRight: 80 }}
            type={showPw ? "text" : "password"}
            placeholder="Mindestens 8 Zeichen"
            value={account.password}
            onChange={e => { setA("password", e.target.value); clearErr("password"); }}
          />
          <button onClick={() => setShowPw(v => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.text4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
            {showPw ? "verbergen" : "anzeigen"}
          </button>
        </div>
        {errors.password && <div style={S.err}>{errors.password}</div>}

        <label style={S.label}>PASSWORT BESTÄTIGEN *</label>
        <input
          style={{ ...S.input, ...(errors.confirm ? S.inputErr : {}) }}
          type={showPw ? "text" : "password"}
          placeholder="Nochmals eingeben"
          value={account.confirm}
          onChange={e => { setA("confirm", e.target.value); clearErr("confirm"); }}
          onKeyDown={e => e.key === "Enter" && next()}
        />
        {errors.confirm && <div style={S.err}>{errors.confirm}</div>}

        <button style={S.btnPrimary} onClick={next}>Weiter →</button>
        <button style={S.btnGhost} onClick={back}>← Zurück</button>
      </div>
    </div>
  );

  // ── Step 3: Done ────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(3, "Alles bereit.")}

        {[
          { label: "STUDIO", value: studio.name },
          { label: "MITARBEITER", value: account.displayName },
          { label: "BENUTZERNAME", value: account.username },
          { label: "ADRESSE", value: studio.address || "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border2}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontSize: 9, color: C.text4, letterSpacing: "0.12em", flexShrink: 0 }}>{label}</div>
            <div style={{ fontSize: 12, color: C.text, textAlign: "right" }}>{value}</div>
          </div>
        ))}

        <div style={{ marginTop: 20, padding: "12px 14px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 11, color: C.text3, lineHeight: 1.65 }}>
          Projekte, Mitarbeitende, Einstellungen und Berechtigungen können jederzeit in der App angepasst werden.
        </div>

        <button style={S.btnPrimary} onClick={finish} disabled={busy}>{busy ? "…" : "Rapport starten →"}</button>
        <button style={S.btnGhost} onClick={back}>← Zurück</button>
      </div>
    </div>
  );
}
