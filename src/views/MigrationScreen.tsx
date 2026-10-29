// Einmaliger Bildschirm beim Upgrade von sehr alten Datenständen (Version 0.5:
// neues Datenbank- und Anmeldesystem): erst Backup anbieten (JSON-Download des
// alten localStorage-Inhalts), dann das normale Setup durchlaufen. App.jsx zeigt
// ihn, wenn alte Daten ohne `setupCompleted` erkannt werden.

import React, { useState } from "react";
import Setup from "./Setup";
import type { AppData } from "../types";
import { localISODate } from "../utils";

/**
 * @param data bisheriger Datenstand (nur für Studioname und als Backup-Fallback)
 * @param onComplete wird vom Setup nach der Einrichtung aufgerufen
 */
export default function MigrationScreen({ data, onComplete }: {
  data: AppData;
  onComplete: (data: AppData) => void;
}) {
  const [backed, setBacked] = useState(false);
  const [goSetup, setGoSetup] = useState(false);

  const studioName = data.settings?.name || "Studio";

  if (goSetup) {
    return <Setup onComplete={onComplete} />;
  }

  const handleBackup = () => {
    try {
      const stored = localStorage.getItem("studio_data_v1") || JSON.stringify(data);
      const blob = new Blob([stored], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-backup-${localISODate()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBacked(true);
    } catch (e) {
      // Nicht als gesichert markieren, sonst glaubt man, ein Backup zu haben
      alert("Backup konnte nicht erstellt werden: " + ((e as Error).message || e));
    }
  };

  return (
    <div style={{
      minHeight: "100vh", minWidth: "100vw",
      background: "#ebe7e1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      position: "fixed", inset: 0, zIndex: 9999,
      overflowY: "auto", padding: "24px 0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes mig-fade-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .mig-card { animation: mig-fade-in 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .mig-btn-primary {
          width: 100%; padding: 13px;
          background: #1a1a18; color: #f0ede8;
          border: none; border-radius: 20px;
          font-family: 'Inter', sans-serif; font-size: 13px;
          font-weight: 500; letter-spacing: 0.04em;
          cursor: pointer; transition: background 0.18s;
        }
        .mig-btn-primary:hover { background: #2e2e28; }
        .mig-btn-backup {
          width: 100%; padding: 13px;
          background: transparent; color: #1a1a18;
          border: 2px solid #1a1a18; border-radius: 20px;
          font-family: 'Inter', sans-serif; font-size: 13px;
          font-weight: 500; letter-spacing: 0.04em;
          cursor: pointer; transition: background 0.18s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .mig-btn-backup:hover { background: #f0ece6; }
        .mig-btn-backup.done { border-color: #2d6a4f; color: #2d6a4f; background: #eaf5ee; cursor: default; }
        .mig-skip { background: none; border: none; font-family: inherit; font-size: 11px; color: #aaa; cursor: pointer; text-decoration: underline; padding: 0; }
        .mig-skip:hover { color: #888; }
      `}</style>

      <div className="mig-card" style={{
        background: "#fdfcfa",
        borderRadius: 20,
        padding: "44px 40px 36px",
        width: "100%", maxWidth: 440,
        boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.07)",
        border: "1px solid #ddd8d0",
        margin: "0 20px",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 30, color: "#1a1a18", letterSpacing: "-0.02em", lineHeight: 1 }}>
            RAPPORT
          </div>
          <div style={{ fontSize: 9, color: "#b0aca4", letterSpacing: "0.2em", marginTop: 6, fontWeight: 500 }}>
            {studioName.toUpperCase()}
          </div>
          <div style={{ width: 32, height: 1.5, background: "#ddd8d0", margin: "14px auto 0" }} />
        </div>

        {/* Info banner */}
        <div style={{ padding: "14px 16px", background: "#fff8ed", borderRadius: 10, border: "1px solid #f0e4c4", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#b07848", letterSpacing: "0.06em", marginBottom: 6 }}>
            VERSION 0.5 — NEUE INITIALISIERUNG
          </div>
          <div style={{ fontSize: 12, color: "#7a5a30", lineHeight: 1.65 }}>
            Diese Version enthält umfangreiche Datenbankänderungen und ein neues Anmeldesystem. Die App muss neu eingerichtet werden.
          </div>
        </div>

        {/* Recommendation */}
        <div style={{ padding: "12px 16px", background: "#f5f0e8", borderRadius: 10, border: "1px solid #e0d8cc", marginBottom: 24, fontSize: 12, color: "#5a5040", lineHeight: 1.65 }}>
          <strong style={{ display: "block", marginBottom: 4, fontSize: 11, letterSpacing: "0.06em", color: "#1a1a18" }}>EMPFEHLUNG</strong>
          Sichern Sie zuerst die bestehenden Daten. Alte Datenbankstrukturen sind zwar importierbar, das Einspielen von Backups zum Testen wird jedoch ausdrücklich abgeraten — umbenannte Felder können zu Fehlern führen.
        </div>

        {/* Step 1: Backup */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 8, fontWeight: 500 }}>
            SCHRITT 1 — DATEN SICHERN
          </div>
          <button
            className={`mig-btn-backup${backed ? " done" : ""}`}
            onClick={backed ? undefined : handleBackup}
          >
            {backed
              ? <><span>✓</span> Backup heruntergeladen</>
              : <><span style={{ fontSize: 16 }}>↓</span> Datenbank herunterladen</>
            }
          </button>
          {!backed && (
            <div style={{ textAlign: "right", marginTop: 6 }}>
              <button className="mig-skip" onClick={() => setBacked(true)}>
                Kein Backup nötig — überspringen
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Setup */}
        <div style={{ marginTop: 20, opacity: backed ? 1 : 0.3, transition: "opacity 0.3s", pointerEvents: backed ? "auto" : "none" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#8c8880", marginBottom: 8, fontWeight: 500 }}>
            SCHRITT 2 — NEU EINRICHTEN
          </div>
          <button className="mig-btn-primary" onClick={() => setGoSetup(true)}>
            Weiter zur Einrichtung
          </button>
        </div>
      </div>
    </div>
  );
}
