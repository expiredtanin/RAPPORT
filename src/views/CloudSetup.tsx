// Cloud-Erst-Einrichtung — der Wizard, der erscheint, wenn der Browser auf
// eine leere Cloud-Instanz trifft (0 Studios). Designs / Schritt-Struktur ist
// bewusst parallel zum lokalen Setup.tsx, nur die Endpunkte sind anders:
//   Schritt 1: Studio-Stammdaten
//   Schritt 2: Admin-Account (Email + Passwort + Anzeigename)
//   Schritt 3: Buchhaltung (optional) + Übersicht + Abschluss
//
// Bei Submit wird der `cloudInit`-Prop aus App.jsx aufgerufen — der orchestriert
// signUp + ensureProfile + createStudio + load + handleLogin.
// Optionale Studio-Angaben (Adresse, IBAN, …) werden nur mitgeschickt, wenn
// ausgefüllt (`extras`); alles lässt sich später in den Einstellungen ändern.

import React, { useState } from "react";
import type { CSSProperties } from "react";
import type { Settings } from "../types";

const C = {
  bg: "#ebe7e1", surface: "#fdfcfa", surface2: "#f7f4f0",
  border: "#ddd8d0", border2: "#e6e1da",
  text: "#1a1a18", text3: "#6a6660", text4: "#8c8880",
  danger: "#8a1a1a", dangerBg: "#fdf2f2", dangerBorder: "#e0b0b0",
};

const S = {
  wrap: { background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", color: C.text, padding: "32px 16px" },
  card: { width: "100%", maxWidth: 460, background: C.surface, borderRadius: 14, padding: "44px 40px", boxShadow: "0 2px 24px rgba(60,50,40,0.10)", border: `1px solid ${C.border}`, maxHeight: "92vh", overflowY: "auto" },
  logo: { fontFamily: "Krungthep,'Archivo Black',sans-serif", fontSize: 34, color: C.text, letterSpacing: "-0.02em", textAlign: "center", marginBottom: 4 },
  sub: { textAlign: "center", fontSize: 10, color: C.text4, letterSpacing: "0.14em", marginBottom: 32 },
  progress: { display: "flex", gap: 6, justifyContent: "center", marginBottom: 32 },
  dot: (active: boolean, done: boolean): CSSProperties => ({ width: active ? 22 : 8, height: 8, borderRadius: 4, background: done ? C.text : active ? C.text : C.border, opacity: done ? 1 : active ? 1 : 0.4, transition: "all 0.3s" }),
  label: { fontSize: 9, letterSpacing: "0.14em", color: C.text4, display: "block", marginBottom: 5, marginTop: 16 },
  input: { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "9px 12px", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 13, outline: "none", transition: "border-color 0.15s" },
  inputErr: { border: `1px solid ${C.dangerBorder}` },
  textarea: { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "9px 12px", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 13, outline: "none", resize: "vertical", minHeight: 64 },
  err: { fontSize: 11, color: C.danger, marginTop: 4 },
  hint: { fontSize: 11, color: C.text4, marginTop: 5, lineHeight: 1.5 },
  btnPrimary: { width: "100%", background: C.text, border: "none", borderRadius: 20, padding: "12px 0", color: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer", marginTop: 28, letterSpacing: "0.04em", transition: "opacity 0.15s" },
  btnGhost: { width: "100%", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 20, padding: "10px 0", color: C.text4, fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer", marginTop: 10 },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;

/** Optionale Studio-Felder, die beim Anlegen mitgeschickt werden. */
type StudioExtras = Partial<Pick<Settings, "street" | "zip" | "city" | "email" | "phone" | "iban" | "mwst" | "defaultHourlyRate">>;

/**
 * @param cloudInit legt User, Profil und Studio an und meldet an (siehe App.jsx);
 *   liefert `{ ok: false, error }` bei Fehler, bei Erfolg übernimmt App.jsx
 * @param cloudUrl Server-Adresse, nur zur Anzeige
 */
export default function CloudSetup({ cloudInit, cloudUrl }: {
  cloudInit: (email: string, password: string, displayName: string, studioName: string, extras: StudioExtras) => Promise<{ ok: boolean; error?: string } | undefined>;
  cloudUrl?: string;
}) {
  const TOTAL = 3;
  const [step, setStep] = useState(1);
  const [studio, setStudio]   = useState({ name: "", street: "", zip: "", city: "", email: "", phone: "", iban: "", mwst: "", hourlyRate: "" });
  const [account, setAccount] = useState({ displayName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [showPw, setShowPw]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  const setS = (k: keyof typeof studio, v: string) => setStudio(s => ({ ...s, [k]: v }));
  const setA = (k: keyof typeof account, v: string) => setAccount(a => ({ ...a, [k]: v }));
  const clearErr = (k: string) => setErrors(e => { const n = { ...e }; delete n[k]; return n; });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!studio.name.trim()) errs.name = "Pflichtfeld";
    }
    if (step === 2) {
      if (!account.displayName.trim()) errs.displayName = "Pflichtfeld";
      if (!account.email.trim() || !/.+@.+\..+/.test(account.email)) errs.email = "Gültige Email";
      if (account.password.length < 6) errs.password = "Mindestens 6 Zeichen";
      if (account.password !== account.confirm) errs.confirm = "Passwörter stimmen nicht überein";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validate()) setStep(s => s + 1); };
  const back = () => setStep(s => s - 1);

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setSubmitErr("");
    const extras: StudioExtras = {};
    if (studio.street.trim()) extras.street = studio.street.trim();
    if (studio.zip.trim()) extras.zip = studio.zip.trim();
    if (studio.city.trim()) extras.city = studio.city.trim();
    if (studio.email.trim()) extras.email = studio.email.trim();
    if (studio.phone.trim()) extras.phone = studio.phone.trim();
    if (studio.iban.trim()) extras.iban = studio.iban.trim().replace(/\s+/g, "");
    if (studio.mwst.trim()) extras.mwst = studio.mwst.trim();
    if (studio.hourlyRate.trim()) {
      const n = Number(studio.hourlyRate);
      if (!Number.isNaN(n) && n > 0) extras.defaultHourlyRate = n;
    }
    const res = await cloudInit(account.email.trim(), account.password, account.displayName.trim(), studio.name.trim(), extras);
    if (!res?.ok) {
      setSubmitErr(res?.error || "Einrichtung fehlgeschlagen.");
      setBusy(false);
    }
    // bei Erfolg übernimmt App.jsx (currentUser setzen) — keine weitere Aktion nötig
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
      <div style={S.sub}>SCHRITT {n} VON {TOTAL} · CLOUD</div>
      {progressEl}
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, color: C.text, marginBottom: 6 }}>{title}</div>
      {lead && <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.65, marginBottom: 20 }}>{lead}</div>}
    </>
  );

  // ── Step 1: Studio ─────────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(1, "Willkommen.", "Lass uns dein Studio einrichten. Adresse und Buchhaltung sind optional und können später ergänzt werden.")}
        {cloudUrl && (
          <div style={{ fontSize: 10, color: C.text4, marginBottom: 6, letterSpacing: "0.04em" }}>
            Cloud-Server: <code style={{ color: C.text3 }}>{(() => { try { return new URL(cloudUrl).host; } catch { return cloudUrl; } })()}</code>
          </div>
        )}

        <label style={S.label}>STUDIO / UNTERNEHMEN *</label>
        <input style={{ ...S.input, ...(errors.name ? S.inputErr : {}) }} placeholder="Muster Architektur GmbH" autoFocus
          value={studio.name} onChange={e => { setS("name", e.target.value); clearErr("name"); }}
          onKeyDown={e => e.key === "Enter" && next()} />
        {errors.name && <div style={S.err}>{errors.name}</div>}

        <label style={S.label}>STRASSE</label>
        <input style={S.input} placeholder="Musterstrasse 1" value={studio.street} onChange={e => setS("street", e.target.value)} />

        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>PLZ</label>
            <input style={S.input} placeholder="8001" value={studio.zip} onChange={e => setS("zip", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>ORT</label>
            <input style={S.input} placeholder="Zürich" value={studio.city} onChange={e => setS("city", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>E-MAIL</label>
            <input style={S.input} type="email" placeholder="mail@studio.ch" value={studio.email} onChange={e => setS("email", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>TELEFON</label>
            <input style={S.input} placeholder="+41 44 000 00 00" value={studio.phone} onChange={e => setS("phone", e.target.value)} />
          </div>
        </div>

        <button style={S.btnPrimary} onClick={next}>Weiter →</button>
      </div>
    </div>
  );

  // ── Step 2: Account ────────────────────────────────────────────────────────
  if (step === 2) return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(2, "Dein Account.", "Mit dieser Email loggst du dich künftig ein. Du wirst Admin des Studios — weitere Mitarbeitende können später eingeladen werden.")}

        <label style={S.label}>DEIN NAME *</label>
        <input style={{ ...S.input, ...(errors.displayName ? S.inputErr : {}) }} placeholder="Karim Varano" autoFocus
          value={account.displayName} onChange={e => { setA("displayName", e.target.value); clearErr("displayName"); }} />
        {errors.displayName && <div style={S.err}>{errors.displayName}</div>}

        <label style={S.label}>EMAIL *</label>
        <input style={{ ...S.input, ...(errors.email ? S.inputErr : {}) }} type="email" placeholder="karim@studio.ch"
          value={account.email} onChange={e => { setA("email", e.target.value); clearErr("email"); }} />
        {errors.email && <div style={S.err}>{errors.email}</div>}

        <label style={S.label}>PASSWORT *</label>
        <div style={{ position: "relative" }}>
          <input style={{ ...S.input, ...(errors.password ? S.inputErr : {}), paddingRight: 80 }} type={showPw ? "text" : "password"} placeholder="Mindestens 6 Zeichen"
            value={account.password} onChange={e => { setA("password", e.target.value); clearErr("password"); }} />
          <button onClick={() => setShowPw(v => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.text4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
            {showPw ? "verbergen" : "anzeigen"}
          </button>
        </div>
        {errors.password && <div style={S.err}>{errors.password}</div>}

        <label style={S.label}>PASSWORT BESTÄTIGEN *</label>
        <input style={{ ...S.input, ...(errors.confirm ? S.inputErr : {}) }} type={showPw ? "text" : "password"} placeholder="Nochmals eingeben"
          value={account.confirm} onChange={e => { setA("confirm", e.target.value); clearErr("confirm"); }}
          onKeyDown={e => e.key === "Enter" && next()} />
        {errors.confirm && <div style={S.err}>{errors.confirm}</div>}

        <button style={S.btnPrimary} onClick={next}>Weiter →</button>
        <button style={S.btnGhost} onClick={back}>← Zurück</button>
      </div>
    </div>
  );

  // ── Step 3: Buchhaltung + Übersicht + Abschluss ───────────────────────────
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        {renderHeader(3, "Buchhaltung & Abschluss.", "Alle Felder sind optional. Du kannst sie auch später in den Einstellungen ergänzen.")}

        <label style={S.label}>IBAN</label>
        <input style={S.input} placeholder="CH00 0000 0000 0000 0000 0" value={studio.iban} onChange={e => setS("iban", e.target.value)} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 12 }}>
          <div>
            <label style={S.label}>MWST-NR</label>
            <input style={S.input} placeholder="CHE-000.000.000 MWST" value={studio.mwst} onChange={e => setS("mwst", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>STD-ANSATZ</label>
            <input style={S.input} type="number" placeholder="120" min="0" step="5" value={studio.hourlyRate} onChange={e => setS("hourlyRate", e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 24, padding: "14px 16px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.text4, letterSpacing: "0.12em", marginBottom: 10 }}>ÜBERSICHT</div>
          {[
            { label: "Studio", value: studio.name },
            { label: "Account", value: `${account.displayName} · ${account.email}` },
            { label: "Adresse", value: [studio.street, [studio.zip, studio.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: "6px 0", borderBottom: `1px solid ${C.border2}`, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
              <div style={{ fontSize: 10, color: C.text4, letterSpacing: "0.1em", flexShrink: 0 }}>{label.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: C.text, textAlign: "right" }}>{value}</div>
            </div>
          ))}
        </div>

        {submitErr && <div style={{ marginTop: 14, padding: "10px 14px", background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, borderRadius: 8, fontSize: 11, color: C.danger }}>{submitErr}</div>}

        <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={finish} disabled={busy}>{busy ? "Wird eingerichtet …" : "Rapport starten →"}</button>
        <button style={S.btnGhost} onClick={back} disabled={busy}>← Zurück</button>
      </div>
    </div>
  );
}
