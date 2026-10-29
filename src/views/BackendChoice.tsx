import { useState } from "react";
import { canUseDataFolder, pickAndActivateDataFolder } from "../storage/data-folder";

// Erst-Screen einer frischen Rapport-Installation: «Lokal oder Cloud?».
// Wird angezeigt, solange `localStorage["rapport_backend_chosen"]` nicht
// gesetzt ist UND noch keine lokalen Daten existieren. Sobald der User
// gewählt hat, reloaded die App und der jeweilige Wizard übernimmt:
//   Lokal → bestehender Setup.tsx
//   Cloud → Login mit Init-Modus oder Login-Modus (je nach Studio-Vorhandensein)

// Tauri-User geben die Server-URL immer aktiv ein. Build-time-URL ist nur
// für Web-Deploy gedacht (z.B. app.rapport.kgva.ch → 127.0.0.1:54321 lokal).
const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
// FIXME(karim): liest noch VITE_SUPABASE_URL, der Adapter (storage/adapter.ts) nutzt
// aber VITE_POCKETBASE_URL — vermutlich ein Überbleibsel der Supabase-Zeit. Nicht
// geändert, weil es das Verhalten von Web-Deployments ändern würde.
const envCloudUrl: string = isTauri ? "" : (import.meta.env.VITE_SUPABASE_URL || "");

/** Vollbild-Auswahl «Testmodus (lokal)» oder «Mit Cloud-Server verbinden». Keine Props; die Wahl wird in localStorage gespeichert und die App neu geladen. */
export default function BackendChoice() {
  // Tauri hat keine eingebrannte Server-URL (envCloudUrl leer) — ohne Adresse
  // würde pick("cloud") ohne URL reloaden, der Adapter fällt dann mangels URL
  // still auf LocalStorage zurück (siehe adapter.js) und der User landet
  // fälschlich im Lokal-Setup statt im Cloud-Login. Deshalb hier inline nach
  // der Adresse fragen, bevor reloaded wird.
  const [askUrl, setAskUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const pick = (backend: "local" | "cloud", cloudUrl = "") => {
    localStorage.setItem("rapport_backend_chosen", "1");
    localStorage.setItem("rapport_backend", backend);
    if (backend === "cloud" && cloudUrl) {
      localStorage.setItem("rapport_cloud_url", cloudUrl.replace(/\/+$/, ""));
    }
    window.location.reload();
  };

  const connectCloud = () => {
    if (!urlInput.trim()) return;
    pick("cloud", urlInput.trim());
  };

  return (
    <div style={{
      minHeight: "100vh", minWidth: "100vw",
      background: "#ebe7e1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      position: "fixed", inset: 0, zIndex: 9999,
      padding: 20,
    }}>
      <style>{`
        @keyframes bc-fade-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .bc-card { animation: bc-fade-in 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .bc-option {
          width: 100%;
          background: #fdfcfa;
          border: 1.5px solid #ddd8d0;
          border-radius: 16px;
          padding: 22px 24px;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: all 0.18s;
          margin-bottom: 12px;
        }
        .bc-option:hover {
          border-color: #9a7858;
          box-shadow: 0 4px 16px rgba(154,120,88,0.12);
          transform: translateY(-1px);
        }
        .bc-title {
          font-size: 14px; font-weight: 500; color: #1a1a18; margin-bottom: 4px;
          letter-spacing: 0.02em;
        }
        .bc-desc {
          font-size: 12px; color: #888; line-height: 1.5;
        }
      `}</style>

      <div className="bc-card" style={{
        background: "transparent",
        width: "100%", maxWidth: 460,
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 40, color: "#1a1a18", letterSpacing: "-0.02em", lineHeight: 1 }}>
            RAPPORT
          </div>
          <div style={{ fontSize: 10, color: "#b0aca4", letterSpacing: "0.22em", marginTop: 10, fontWeight: 500 }}>
            ERSTE EINRICHTUNG
          </div>
          <div style={{ width: 40, height: 1.5, background: "#ddd8d0", margin: "20px auto 0" }} />
        </div>

        <p style={{ fontSize: 13, color: "#666", marginBottom: 26, textAlign: "center", lineHeight: 1.6 }}>
          Wie möchten Sie Rapport nutzen?
        </p>

        {canUseDataFolder && (
          <button className="bc-option" onClick={pickAndActivateDataFolder}>
            <div className="bc-title">Datenordner (auf diesem Mac / iCloud)</div>
            <div className="bc-desc">
              Daten liegen als Dateien in einem Ordner Ihrer Wahl — ohne Speichergrenze, mit automatischem Tagesbackup.
              Liegt der Ordner in iCloud Drive oder auf einem NAS, können zwei Personen gleichzeitig damit arbeiten
              (z.B. eine pflegt alles, die andere trägt Stunden ein). Enthält der Ordner schon Daten, werden diese geöffnet.
            </div>
          </button>
        )}

        <button className="bc-option" onClick={() => pick("local")}>
          <div className="bc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Testmodus (lokal)
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#9a7858", background: "rgba(154,120,88,0.10)", borderRadius: 20, padding: "2px 6px" }}>TEST</span>
          </div>
          <div className="bc-desc">
            Daten liegen nur in diesem Browser. Kein Backup, kein Mehrbenutzer, begrenzt auf ~5 MB.
            Nur zum Ausprobieren — für den produktiven Einsatz einen Server verbinden.
          </div>
        </button>

        {envCloudUrl ? (
          <button className="bc-option" onClick={() => pick("cloud", envCloudUrl)}>
            <div className="bc-title">Mit Cloud-Server verbinden</div>
            <div className="bc-desc">
              Daten liegen auf dem konfigurierten Server. Mehrere Geräte / Mitarbeiter
              können gemeinsam arbeiten. Vorkonfiguriert: <code style={{ fontSize: 11, color: "#9a7858" }}>{(() => { try { return new URL(envCloudUrl).host; } catch { return envCloudUrl; } })()}</code>
            </div>
          </button>
        ) : askUrl ? (
          <div className="bc-option" style={{ cursor: "default" }}>
            <div className="bc-title">Server-Adresse</div>
            <div className="bc-desc" style={{ marginBottom: 12 }}>
              z.B. <code style={{ fontSize: 11, color: "#9a7858" }}>http://mac-mini.local:8090</code> oder eine öffentliche Domain.
            </div>
            <input
              type="url"
              autoFocus
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && connectCloud()}
              placeholder="http://mac-mini.local:8090"
              style={{
                width: "100%", boxSizing: "border-box", background: "#f7f4f0",
                border: "1.5px solid #ddd8d0", borderRadius: 20, padding: "9px 12px",
                fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 10,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="bc-option"
                style={{ margin: 0, padding: "10px 0", textAlign: "center", flex: 1 }}
                onClick={connectCloud}
                disabled={!urlInput.trim()}
              >
                Verbinden
              </button>
              <button
                className="bc-option"
                style={{ margin: 0, padding: "10px 0", textAlign: "center", flex: 1, color: "#888" }}
                onClick={() => { setAskUrl(false); setUrlInput(""); }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button className="bc-option" onClick={() => setAskUrl(true)}>
            <div className="bc-title">Mit Cloud-Server verbinden</div>
            <div className="bc-desc">
              Daten liegen auf einem PocketBase-Server (z.B. Mac Mini im Büro, Docker im LAN).
              Die Server-Adresse geben Sie im nächsten Schritt ein.
            </div>
          </button>
        )}

        <div style={{ marginTop: 24, fontSize: 11, color: "#aaa", textAlign: "center", lineHeight: 1.6 }}>
          Sie können später in den Einstellungen wechseln.
        </div>
      </div>
    </div>
  );
}
