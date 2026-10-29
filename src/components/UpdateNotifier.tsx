// Modal «Update verfügbar» für die native App (Tauri). Prüft 1.5 s nach dem
// Start still auf Updates (übersprungene Versionen werden ignoriert) und reagiert
// auf das Event `rapport:check-update`, das Einstellungen → «Nach Updates suchen»
// auslöst (dann zählt «Überspringen» nicht). Im Browser rendert die Komponente nichts.
//
// Hinweis: Die Update-Logik (Prüfen, Installieren, Fortschritt) ist fast identisch
// in UpdatesSupport.tsx (Einstellungen) vorhanden; bei Änderungen beide anpassen.
// Ablauf/Signatur der Updates: ARCHITECTURE.md §9.

import { useEffect, useState, useCallback } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForAppUpdate, installAppUpdate, skipUpdateVersion, isTauri } from "../utils/updater";

type UpdateState = "idle" | "checking" | "available" | "downloading" | "installing";

export default function UpdateNotifier() {
  const [update, setUpdate]   = useState<Update | null>(null);
  const [state,  setState]    = useState<UpdateState>("idle");
  const [downloaded, setDownloaded] = useState(0);
  const [total,      setTotal]      = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async ({ silent }: { silent: boolean }) => {
    if (!isTauri()) return;
    try {
      setState("checking");
      setError(null);
      const res = await checkForAppUpdate({ respectSkip: silent });
      if (!res.available) {
        setUpdate(null);
        setState("idle");
        return;
      }
      setUpdate(res.update ?? null);
      setState("available");
    } catch (e) {
      console.error("Update-Check fehlgeschlagen:", e);
      setError(String((e as Error)?.message || e));
      setState("idle");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runCheck({ silent: true }), 1500);
    return () => clearTimeout(t);
  }, [runCheck]);

  // Settings → "Nach Updates suchen" feuert dieses Event; wir lassen das Modal aufpoppen,
  // falls etwas gefunden wird (Skip-Flag wird dabei ignoriert).
  useEffect(() => {
    const handler = () => runCheck({ silent: false });
    window.addEventListener("rapport:check-update", handler);
    return () => window.removeEventListener("rapport:check-update", handler);
  }, [runCheck]);

  const install = async () => {
    if (!update) return;
    try {
      setState("downloading");
      setDownloaded(0);
      setTotal(0);
      await installAppUpdate(update, (event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength || 0);
        } else if (event.event === "Progress") {
          setDownloaded((d) => d + (event.data.chunkLength || 0));
        } else if (event.event === "Finished") {
          setState("installing");
        }
      });
    } catch (e) {
      console.error("Update-Installation fehlgeschlagen:", e);
      setError(String((e as Error)?.message || e));
      setState("available");
    }
  };

  const skipVersion = () => {
    skipUpdateVersion(update?.version);
    setUpdate(null);
    setState("idle");
  };

  const later = () => {
    setUpdate(null);
    setState("idle");
  };

  if (!isTauri() || !update || state === "idle" || state === "checking") return null;

  const isBusy = state === "downloading" || state === "installing";
  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(4px)" }}>
      <div style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 460, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ background: "#1a1a18", padding: "28px 32px 20px" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#b07848", marginBottom: 8, fontWeight: 600 }}>UPDATE VERFÜGBAR</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 26, color: "#f0ede8", fontWeight: 400, lineHeight: 1.1 }}>
              Rapport {update.version}
            </div>
            {update.currentVersion && (
              <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.04em" }}>von {update.currentVersion}</div>
            )}
          </div>
        </div>

        <div style={{ padding: "20px 32px 8px", maxHeight: 320, overflowY: "auto" }}>
          {update.body && (
            <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 4, flexShrink: 0, background: "#b07848", borderRadius: 2, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{update.body}</div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: "#fdf0f0", border: "1px solid #f3c4c4", borderRadius: 6, fontSize: 12, color: "#8a1a1a" }}>
              {error}
            </div>
          )}

          {isBusy && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 6, letterSpacing: "0.04em" }}>
                {state === "downloading"
                  ? (pct !== null ? `Wird heruntergeladen … ${pct}%` : "Wird heruntergeladen …")
                  : "Wird installiert …"}
              </div>
              <div style={{ height: 4, background: "#eee", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: pct !== null ? `${pct}%` : "100%",
                  background: "#b07848",
                  transition: "width 0.2s",
                  animation: pct === null ? "rapport-update-pulse 1.2s ease-in-out infinite" : undefined,
                }} />
              </div>
              <style>{`@keyframes rapport-update-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
            </div>
          )}
        </div>

        <div style={{ padding: "16px 32px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ width: "100%", fontSize: 13 }}
            onClick={install}
            disabled={isBusy}
          >
            {isBusy ? "Bitte warten …" : "Jetzt installieren"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1, fontSize: 12 }}
              onClick={later}
              disabled={isBusy}
            >
              Später
            </button>
            <button
              className="btn btn-ghost"
              style={{ flex: 1, fontSize: 12 }}
              onClick={skipVersion}
              disabled={isBusy}
            >
              Diese Version überspringen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
