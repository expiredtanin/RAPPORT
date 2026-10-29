// Bereich «Updates & Support» in den Einstellungen: zeigt die aktuelle Version und
// den Zeitpunkt der letzten Prüfung, erlaubt manuelles Suchen/Installieren von
// Updates. Im Browser (ohne Tauri) erscheint stattdessen ein Hinweis «nicht verfügbar».
//
// Hinweis: Die Update-Logik ist fast identisch in UpdateNotifier.tsx (Auto-Dialog)
// vorhanden; bei Änderungen beide anpassen. Ablauf/Signatur: ARCHITECTURE.md §9.

import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForAppUpdate,
  installAppUpdate,
  skipUpdateVersion,
  getLastUpdateCheck,
  formatLastCheck,
  isTauri,
} from "../utils/updater";

function Section({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid #ece8e2" }}>{title}</div>
      {children}
    </div>
  );
}

type UpdateState = "idle" | "checking" | "available" | "no-update" | "not-tauri" | "downloading" | "installing";

/** @param fallbackVersion Version, die angezeigt wird, solange (oder falls) die native Version nicht lesbar ist, z.B. im Browser. */
export default function UpdatesSupport({ fallbackVersion }: { fallbackVersion?: string }) {
  const [version, setVersion] = useState(fallbackVersion || "");
  const [lastCheck, setLastCheck] = useState(() => getLastUpdateCheck());
  const [state, setState] = useState<UpdateState>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/api/app").then(({ getVersion }) => {
      getVersion().then(setVersion).catch(() => {});
    });
  }, []);

  const runCheck = useCallback(async () => {
    setError(null);
    if (!isTauri()) {
      setState("not-tauri");
      return;
    }
    setState("checking");
    try {
      const res = await checkForAppUpdate({ respectSkip: false });
      setLastCheck(getLastUpdateCheck());
      if (res.available) {
        setUpdate(res.update ?? null);
        setState("available");
      } else {
        setUpdate(null);
        setState("no-update");
      }
    } catch (e) {
      console.error("Update-Check fehlgeschlagen:", e);
      setError(String((e as Error)?.message || e));
      setState("idle");
    }
  }, []);

  const install = async () => {
    if (!update) return;
    setError(null);
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

  const isBusy = state === "downloading" || state === "installing";
  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
      <div className="card">
        <Section title="UPDATES">
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: "1px solid #f0ede8" }}>
            <span style={{ color: "var(--text4)" }}>Aktuelle Version</span>
            <strong style={{ color: "var(--text2)" }}>{version || "—"}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: "1px solid #f0ede8", marginBottom: 16 }}>
            <span style={{ color: "var(--text4)" }}>Letzte Prüfung</span>
            <span style={{ color: "var(--text2)" }}>{formatLastCheck(lastCheck)}</span>
          </div>

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginBottom: 10 }}
            onClick={runCheck}
            disabled={state === "checking" || isBusy}
          >
            {state === "checking" ? "Wird geprüft …" : "Nach Updates suchen"}
          </button>

          {state === "no-update" && (
            <div style={{ marginTop: 6, padding: "10px 12px", background: "#f0f7f0", border: "1px solid #c8e0c8", borderRadius: 8, fontSize: 12, color: "var(--positive)", lineHeight: 1.5 }}>
              ✓ Rapport ist auf dem neuesten Stand.
            </div>
          )}

          {state === "available" && update && (
            <div style={{ marginTop: 10, padding: "14px 14px 12px", background: "#fbf6ef", border: "1px solid #e6d4b3", borderRadius: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#b07848", fontWeight: 600, marginBottom: 4 }}>UPDATE VERFÜGBAR</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Rapport {update.version}</div>
              {update.body && (
                <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 10, maxHeight: 160, overflowY: "auto" }}>
                  {update.body}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: "100%", marginBottom: 8 }} onClick={install} disabled={isBusy}>
                {isBusy ? "Bitte warten …" : "Installieren und neu starten"}
              </button>
              <button className="btn btn-ghost" style={{ width: "100%", fontSize: 12 }} onClick={skipVersion} disabled={isBusy}>
                Diese Version überspringen
              </button>
            </div>
          )}

          {isBusy && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6, letterSpacing: "0.04em" }}>
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
                  animation: pct === null ? "rapport-us-pulse 1.2s ease-in-out infinite" : undefined,
                }} />
              </div>
              <style>{`@keyframes rapport-us-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
            </div>
          )}

          {state === "not-tauri" && (
            <div style={{ marginTop: 6, padding: "10px 12px", background: "#f5f5f0", border: "1px solid #e0dbd4", borderRadius: 8, fontSize: 12, color: "var(--text3)" }}>
              Updates sind nur in der Desktop-App verfügbar.
            </div>
          )}

          {error && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "#fdf0f0", border: "1px solid #f3c4c4", borderRadius: 6, fontSize: 12, color: "var(--negative)" }}>
              {error}
            </div>
          )}

          <p style={{ fontSize: 11, color: "var(--text4)", lineHeight: 1.6, marginTop: 16 }}>
            Updates werden automatisch beim Start der App geprüft. Hier kannst du manuell suchen — z.B. wenn die App selten geschlossen wird.
          </p>
        </Section>
      </div>

      <div className="card">
        <Section title="SUPPORT & DOKUMENTATION">
          <p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 16 }}>
            Anleitungen, Dokumentation und Support findest du auf der offiziellen Website:
          </p>
          <a
            href="https://rapport.kgva.ch/"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ width: "100%", textDecoration: "none", marginBottom: 10 }}
          >
            rapport.kgva.ch ↗
          </a>
          <p style={{ fontSize: 11, color: "var(--text4)", lineHeight: 1.6, marginTop: 16 }}>
            Dort findest du auch das Changelog, Fehlerberichte und Kontaktmöglichkeiten für direkten Support.
          </p>
        </Section>
      </div>
    </div>
  );
}
