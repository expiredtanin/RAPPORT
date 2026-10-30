// Anmeldebildschirm (Vollbild). Zwei Modi:
//   - Lokal: Benutzername + Passwort gegen `data.users` (Prüfung in App.jsx `verifyLogin`).
//   - Cloud (PocketBase): E-Mail + Passwort, Auswahl des Studios (falls mehrere),
//     Server-Adresse editierbar (ausser im Server-Modus, wo sie fest eingebaut ist),
//     «Passwort vergessen» schickt eine Reset-Mail.
// Schutz gegen Raten: nach 5 Fehlversuchen 60 s Sperre pro Browser-Tab
// (sessionStorage) — reiner Komfortschutz im Client, kein Ersatz für Server-Limits.
// Der Backend-Wechsel (Lokal/Cloud) lädt die App neu, damit der Storage-Adapter
// neu gewählt wird.

import React, { useEffect, useRef, useState } from "react";
import { storage, isCloudBackend, isServerMode } from "../storage/adapter";
import type { PocketBaseAdapter } from "../storage/pocketbase-adapter";
import type { CurrentUser, Settings } from "../types";

/** Cloud-Methoden des Adapters; nur vorhanden, wenn das Cloud-Backend aktiv ist. */
const cloud = storage as Partial<Pick<PocketBaseAdapter, "listStudios" | "requestPasswordReset">>;

const isValidEmail = (s: string) => /.+@.+\..+/.test(s);

// Simple per-tab rate limit: after MAX_ATTEMPTS failed tries, lock for LOCK_MS.
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;
const ATTEMPT_KEY = "rapport_login_attempts";

type AttemptState = { count: number; lockedUntil: number };

function readAttempts(): AttemptState {
  try { return JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null") || { count: 0, lockedUntil: 0 }; }
  catch { return { count: 0, lockedUntil: 0 }; }
}
function writeAttempts(state: AttemptState) {
  try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(state)); } catch { /* sessionStorage gesperrt: Sperre gilt dann nur bis zum Neuladen */ }
}

/**
 * @param verifyLogin prüft die Zugangsdaten (App.jsx); liefert den Nutzer oder null/false
 * @param settings nur für den Studionamen in der Kopfzeile
 * @param version Anzeige unten (z.B. «Beta 26.11», siehe versionLabel in changelog.ts)
 * @param cloudUnreachable true = Server nicht erreichbar (zeigt Hinweis)
 */
export default function Login({ verifyLogin, settings, version, cloudUnreachable = false }: {
  verifyLogin: (usernameOrEmail: string, password: string, opts?: { studioId: string | null }) => Promise<CurrentUser | null | false | undefined> | CurrentUser | null | false | undefined;
  settings?: Pick<Settings, "name">;
  version?: string;
  cloudUnreachable?: boolean;
}) {
  // Backend-Modus aus localStorage (per-Device, ähnlich Dark Mode).
  // Beim Wechsel wird die App neu geladen, damit der Storage-Adapter neu initialisiert.
  const [backend] = useState(() => localStorage.getItem("rapport_backend") || "local");
  const [cloudUrl, setCloudUrl] = useState(() => localStorage.getItem("rapport_cloud_url") || "");
  const [editUrl, setEditUrl] = useState(() => {
    const stored = localStorage.getItem("rapport_cloud_url") || "";
    return (localStorage.getItem("rapport_backend") === "cloud") && !stored;
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [shake, setShake] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(() => readAttempts().lockedUntil);
  const [now, setNow] = useState(() => Date.now());
  const submittingRef = useRef(false);

  // Cloud: Studios der Instanz für Multi-Studio-Dropdown
  const [studios, setStudios] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState("");
  // Passwort-Vergessen-Inline-Modus
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotErr, setForgotErr] = useState("");

  const isCloud = backend === "cloud";

  useEffect(() => {
    if (!isCloudBackend || !cloudUrl) return;
    let cancelled = false;
    (async () => {
      const list = await cloud.listStudios?.();
      if (cancelled) return;
      setStudios(list || []);
      if (list?.length === 1) setSelectedStudioId(list[0].id);
    })();
    return () => { cancelled = true; };
  }, [cloudUrl]);

  // Tick once a second while locked, so the countdown updates and unlocks automatically
  useEffect(() => {
    if (!lockedUntil || lockedUntil <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil, now]);

  const isLocked = lockedUntil > now;
  const remainingSec = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  const switchBackend = (next: string) => {
    if (next === backend) return;
    localStorage.setItem("rapport_backend", next);
    window.location.reload();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked || submittingRef.current) return;
    submittingRef.current = true;
    try {
      // Cloud: URL muss gesetzt sein, sonst kann der Adapter nicht initialisiert worden sein
      if (isCloud) {
        const trimmed = (cloudUrl || "").trim().replace(/\/+$/, "");
        if (!trimmed) {
          setError(true);
          setErrorMsg("Server-Adresse eingeben.");
          return;
        }
        const currentUrl = localStorage.getItem("rapport_cloud_url") || "";
        if (trimmed !== currentUrl) {
          localStorage.setItem("rapport_cloud_url", trimmed);
          window.location.reload();
          return;
        }
      }

      const user = await Promise.resolve(verifyLogin(username, password, { studioId: selectedStudioId || null }));
      if (user) {
        writeAttempts({ count: 0, lockedUntil: 0 });
      } else {
        const state = readAttempts();
        const count = state.count + 1;
        const next = count >= MAX_ATTEMPTS
          ? { count: 0, lockedUntil: Date.now() + LOCK_MS }
          : { count, lockedUntil: 0 };
        writeAttempts(next);
        setLockedUntil(next.lockedUntil);
        setNow(Date.now());
        setError(true);
        setErrorMsg(isCloud ? "Anmeldung fehlgeschlagen." : "Falscher Benutzername oder Passwort");
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const studioHeader = settings?.name || "Studio";
  const userLabel = isCloud ? "EMAIL" : "BENUTZER";
  const userPlaceholder = isCloud ? "name@studio.ch" : "admin";
  const userInputType = isCloud ? "email" : "text";

  // Im Server-Modus (gehostete Web-GUI) gibt es keine Server-Adress-Eingabe —
  // die App ist fest an diesen Server gebunden.
  const showUrlField = isCloud && editUrl && !isServerMode;
  const showUrlBadge = isCloud && !editUrl && cloudUrl && !isServerMode;

  // Hostname zur Anzeige (ohne Protokoll, ohne Port falls Standard)
  let urlDisplay = cloudUrl;
  try {
    const u = new URL(cloudUrl);
    urlDisplay = u.host;
  } catch { /* keine gültige URL: so anzeigen, wie eingegeben */ }

  return (
    <div style={{
      minHeight: "100vh", minWidth: "100vw",
      background: "#ebe7e1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      position: "fixed", inset: 0, zIndex: 9999,
    }}>
      <style>{`
        @keyframes login-shake {
          0%,100% { transform: translateX(0); }
          20%,60% { transform: translateX(-8px); }
          40%,80% { transform: translateX(8px); }
        }
        @keyframes login-fade-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .login-card {
          animation: login-fade-in 0.5s cubic-bezier(0.22,1,0.36,1) both;
        }
        .login-card.shake {
          animation: login-shake 0.45s ease;
        }
        .login-input {
          width: 100%; box-sizing: border-box;
          background: #f7f4f0; border: 1.5px solid #ddd8d0;
          border-radius: 20px; padding: 11px 14px;
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: #1a1a18; outline: none;
          transition: border-color 0.18s, box-shadow 0.18s;
        }
        .login-input:focus {
          border-color: #9a7858;
          box-shadow: 0 0 0 3px rgba(154,120,88,0.14);
        }
        .login-input.error {
          border-color: #b5621e;
          box-shadow: 0 0 0 3px rgba(181,98,30,0.12);
        }
        .login-input:disabled {
          opacity: 0.6;
        }
        .login-btn {
          width: 100%; padding: 13px;
          background: #1a1a18; color: #f0ede8;
          border: none; border-radius: 20px;
          font-family: 'Inter', sans-serif; font-size: 13px;
          font-weight: 500; letter-spacing: 0.04em;
          cursor: pointer; transition: background 0.18s, box-shadow 0.18s;
        }
        .login-btn:hover:not(:disabled) {
          background: #2e2e28;
          box-shadow: 0 4px 16px rgba(0,0,0,0.28);
        }
        .login-btn:active:not(:disabled) { background: #0e0e0c; }
        .login-btn:disabled {
          background: #c4bbb0;
          cursor: not-allowed;
        }
        .backend-select {
          background: transparent;
          border: none;
          color: #6a6660;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 2px 18px 2px 4px;
          margin: 0;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'><path d='M1 1l3 3 3-3' stroke='%236a6660' stroke-width='1.2' fill='none' stroke-linecap='round'/></svg>");
          background-repeat: no-repeat;
          background-position: right 4px center;
        }
        .backend-select:hover { color: #1a1a18; }
        .url-edit-link {
          background: none; border: none; padding: 0;
          color: #9a7858; font-family: inherit; font-size: 10px;
          letter-spacing: 0.08em; cursor: pointer; text-decoration: underline;
        }
        .url-edit-link:hover { color: #1a1a18; }
      `}</style>

      <div className={`login-card${shake ? " shake" : ""}`} style={{
        background: "#fdfcfa",
        borderRadius: 20,
        padding: "48px 44px 28px",
        width: "100%", maxWidth: 380,
        boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.07)",
        border: "1px solid #ddd8d0",
        margin: "0 20px",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 36, color: "#1a1a18", letterSpacing: "-0.02em", lineHeight: 1 }}>
            RAPPORT
          </div>
          <div style={{ fontSize: 9, color: "#b0aca4", letterSpacing: "0.2em", marginTop: 8, fontWeight: 500 }}>
            {studioHeader.toUpperCase()}
          </div>
          <div style={{ width: 32, height: 1.5, background: "#ddd8d0", margin: "16px auto 0" }} />
        </div>

        {cloudUnreachable && (
          <div style={{ marginBottom: 18, padding: "9px 14px", background: "#fff5f0", borderRadius: 8, border: "1px solid #f5c9b0", fontSize: 11, color: "#b5621e", textAlign: "center", lineHeight: 1.5 }}>
            Server nicht erreichbar. Bitte Verbindung prüfen und neu laden.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isCloud && studios.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 7, fontWeight: 500 }}>
                STUDIO
              </label>
              <select
                className={`login-input${error ? " error" : ""}`}
                disabled={isLocked}
                value={selectedStudioId}
                onChange={e => { setSelectedStudioId(e.target.value); setError(false); }}
                style={{ appearance: "none", paddingRight: 32, backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
              >
                <option value="">Studio auswählen…</option>
                {studios.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 7, fontWeight: 500 }}>
              {userLabel}
            </label>
            <input
              className={`login-input${error ? " error" : ""}`}
              type={userInputType}
              autoComplete={isCloud ? "email" : "username"}
              autoFocus
              disabled={isLocked}
              value={username}
              onChange={e => { setUsername(e.target.value); setError(false); }}
              placeholder={userPlaceholder}
            />
          </div>

          <div style={{ marginBottom: showUrlField ? 14 : 28 }}>
            <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 7, fontWeight: 500 }}>
              PASSWORT
            </label>
            <input
              className={`login-input${error ? " error" : ""}`}
              type="password"
              autoComplete="current-password"
              disabled={isLocked}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false); }}
              placeholder="••••••"
            />
          </div>

          {showUrlField && (
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: "block", fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 7, fontWeight: 500 }}>
                SERVER-ADRESSE
              </label>
              <input
                className="login-input"
                type="url"
                disabled={isLocked}
                value={cloudUrl}
                onChange={e => { setCloudUrl(e.target.value); setError(false); }}
                placeholder="http://mac-mini.local:8090"
              />
            </div>
          )}

          {isLocked ? (
            <div style={{ marginBottom: 18, padding: "9px 14px", background: "#fdf2f2", borderRadius: 8, border: "1px solid #e0b0b0", fontSize: 11, color: "#8a1a1a", textAlign: "center" }}>
              Zu viele Fehlversuche. Bitte {remainingSec}s warten.
            </div>
          ) : error && (
            <div style={{ marginBottom: 18, padding: "9px 14px", background: "#fff5f0", borderRadius: 8, border: "1px solid #f5c9b0", fontSize: 11, color: "#b5621e", textAlign: "center" }}>
              {errorMsg || (isCloud ? "Anmeldung fehlgeschlagen." : "Falscher Benutzername oder Passwort")}
            </div>
          )}

          <button className="login-btn" type="submit" disabled={isLocked}>
            Anmelden
          </button>
        </form>

        {/* Passwort vergessen — nur Cloud */}
        {isCloud && !isLocked && !forgotOpen && !forgotSent && (
          <div style={{ marginTop: 14, textAlign: "center", fontSize: 10 }}>
            <button type="button" className="url-edit-link" onClick={() => { setForgotOpen(true); setForgotErr(""); }}>
              Passwort vergessen?
            </button>
          </div>
        )}

        {isCloud && forgotOpen && !forgotSent && (
          <div style={{ marginTop: 18, padding: "14px 14px 12px", background: "#f7f4f0", border: "1px solid #ddd8d0", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 10, lineHeight: 1.5 }}>
              Wir senden Ihnen eine Email mit einem Link zum Zurücksetzen des Passworts.
            </div>
            <input
              className="login-input"
              type="email"
              placeholder="name@studio.ch"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {forgotErr && <div style={{ fontSize: 11, color: "#b5621e", marginBottom: 8 }}>{forgotErr}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="login-btn"
                style={{ flex: 1, padding: "9px", fontSize: 12 }}
                onClick={async () => {
                  if (!isValidEmail(username)) { setForgotErr("Bitte gültige Email eingeben."); return; }
                  const res = await cloud.requestPasswordReset?.(username.trim());
                  if (res?.ok) { setForgotSent(true); setForgotErr(""); }
                  else setForgotErr(res?.error || "Fehler beim Versand.");
                }}
              >
                Link senden
              </button>
              <button
                type="button"
                className="login-btn"
                style={{ flex: 1, padding: "9px", fontSize: 12, background: "transparent", color: "#888", border: "1px solid #ddd8d0" }}
                onClick={() => { setForgotOpen(false); setForgotErr(""); }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {isCloud && forgotSent && (
          <div style={{ marginTop: 14, padding: "10px 14px", background: "#e8f5ee", border: "1px solid #b8dbc4", borderRadius: 8, fontSize: 11, color: "#2d6a4f", textAlign: "center", lineHeight: 1.5 }}>
            Email gesendet — bitte Ihren Posteingang prüfen.
          </div>
        )}

        {/* Verbindung-Switch + Server-Anzeige (dezent darunter) */}
        {/* Verbindungs-Switch (Lokal/Server + Server-Adresse) nur in der lokalen
            DMG. Die gehostete Web-GUI (Server-Modus) ist fest an diesen Server
            gebunden — keine Wahl, kein Wechsel. */}
        {!isServerMode && (
        <div style={{
          marginTop: 22, paddingTop: 16,
          borderTop: "1px solid #ebe7e1",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#b0aca4", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Verbindung
            </span>
            <select
              className="backend-select"
              value={backend}
              onChange={e => switchBackend(e.target.value)}
            >
              <option value="local">Lokal</option>
              <option value="cloud">Cloud</option>
            </select>
          </div>
          {showUrlBadge && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#8c8880", letterSpacing: "0.05em" }}>
              <span title={cloudUrl}>{urlDisplay}</span>
              <button
                type="button"
                className="url-edit-link"
                onClick={() => setEditUrl(true)}
              >
                ändern
              </button>
            </div>
          )}
        </div>
        )}

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 9, color: "#c8c4be", letterSpacing: "0.08em" }}>
          {version || ""}
        </div>
      </div>
    </div>
  );
}
