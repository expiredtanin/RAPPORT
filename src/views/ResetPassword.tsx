// Empfangsseite des Passwort-Reset-Links (nur Cloud-Betrieb). App.jsx zeigt diese
// Komponente, sobald der "#/reset-password/{TOKEN}"-Hash aus der Reset-Mail erkannt
// wird. Der Token wird beim Submit an storage.confirmPasswordReset() durchgereicht.
// Es entsteht KEINE Session: nach dem Setzen muss man sich normal anmelden.
// Mindestlänge 6 Zeichen wird nur hier geprüft (der Server prüft ggf. strenger).

import React, { useState } from "react";

/**
 * Vollbild-Formular «Neues Passwort».
 * @param onComplete bekommt das neue Passwort, liefert `{ ok }` oder `{ ok: false, error }`
 * @param onCancel zurück zur Anmeldung (auch nach Erfolg)
 */
export default function ResetPassword({ onComplete, onCancel }: {
  onComplete: (password: string) => Promise<{ ok: boolean; error?: string } | undefined>;
  onCancel: () => void;
}) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (pw1.length < 6) { setErr("Mindestens 6 Zeichen."); return; }
    if (pw1 !== pw2)    { setErr("Passwörter stimmen nicht überein."); return; }
    setBusy(true); setErr("");
    try {
      const res = await onComplete(pw1);
      if (res?.ok) setDone(true);
      else setErr(res?.error || "Konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      minHeight: "100vh", minWidth: "100vw",
      background: "#ebe7e1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      position: "fixed", inset: 0, zIndex: 9999,
    }}>
      <div style={{
        background: "#fdfcfa", borderRadius: 20, padding: "48px 44px 32px",
        width: "100%", maxWidth: 400, margin: "0 20px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.07)",
        border: "1px solid #ddd8d0",
      }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 32, color: "#1a1a18", letterSpacing: "-0.02em", lineHeight: 1 }}>RAPPORT</div>
          <div style={{ fontSize: 9, color: "#b0aca4", letterSpacing: "0.2em", marginTop: 8, fontWeight: 500 }}>NEUES PASSWORT</div>
          <div style={{ width: 32, height: 1.5, background: "#ddd8d0", margin: "16px auto 0" }} />
        </div>

        {done ? (
          <>
            <div style={{ padding: "12px 14px", background: "#e8f5ee", border: "1px solid #b8dbc4", borderRadius: 8, fontSize: 12, color: "#2d6a4f", textAlign: "center", marginBottom: 16, lineHeight: 1.5 }}>
              Passwort aktualisiert. Sie können sich jetzt mit dem neuen Passwort anmelden.
            </div>
            <button onClick={onCancel} style={{ width: "100%", padding: 13, background: "#1a1a18", color: "#f0ede8", border: "none", borderRadius: 20, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
              Zur Anmeldung
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 18, lineHeight: 1.5, textAlign: "center" }}>
              Bitte vergeben Sie ein neues Passwort.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 6, fontWeight: 500 }}>NEUES PASSWORT</label>
              <input
                type="password" autoFocus value={pw1} onChange={e => { setPw1(e.target.value); setErr(""); }}
                style={{ width: "100%", boxSizing: "border-box", background: "#f7f4f0", border: "1.5px solid #ddd8d0", borderRadius: 20, padding: "11px 14px", fontFamily: "inherit", fontSize: 13, outline: "none" }}
                placeholder="Mindestens 6 Zeichen"
              />
            </div>
            <div style={{ marginBottom: err ? 12 : 24 }}>
              <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 6, fontWeight: 500 }}>BESTÄTIGEN</label>
              <input
                type="password" value={pw2} onChange={e => { setPw2(e.target.value); setErr(""); }}
                onKeyDown={e => e.key === "Enter" && submit()}
                style={{ width: "100%", boxSizing: "border-box", background: "#f7f4f0", border: "1.5px solid #ddd8d0", borderRadius: 20, padding: "11px 14px", fontFamily: "inherit", fontSize: 13, outline: "none" }}
                placeholder="Nochmals eingeben"
              />
            </div>
            {err && <div style={{ marginBottom: 16, padding: "9px 14px", background: "#fff5f0", borderRadius: 8, border: "1px solid #f5c9b0", fontSize: 11, color: "#b5621e", textAlign: "center" }}>{err}</div>}
            <button onClick={submit} disabled={busy} style={{ width: "100%", padding: 13, background: busy ? "#c4bbb0" : "#1a1a18", color: "#f0ede8", border: "none", borderRadius: 20, fontFamily: "inherit", fontSize: 13, cursor: busy ? "default" : "pointer" }}>
              {busy ? "Wird gespeichert …" : "Passwort speichern"}
            </button>
            <button onClick={onCancel} style={{ width: "100%", marginTop: 10, padding: 10, background: "transparent", color: "#888", border: "1px solid #ddd8d0", borderRadius: 20, fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
              Abbrechen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
