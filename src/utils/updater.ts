// Hilfsfunktionen für den Tauri-App-Updater.
//
// Genutzt vom Auto-Check-Dialog (UpdateNotifier) und vom manuellen Check in
// Einstellungen → Updates & Support. Der Updater existiert nur in der nativen
// App; im Browser (`npm run dev`) liefern alle Checks "nicht verfügbar".
// Pipeline und Signatur: ARCHITECTURE.md §9.

import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";

/** localStorage: Version, die der Nutzer mit «Überspringen» abgewählt hat. */
export const SKIP_KEY = "rapport_update_skipped_version";
/** localStorage: ISO-Zeitstempel des letzten erfolgreichen Update-Checks. */
export const LAST_CHECK_KEY = "rapport_update_last_check";

export interface UpdateCheckResult {
  available: boolean;
  isTauri: boolean;
  update?: Update | null;
  /** true = Update existiert, wurde aber vom Nutzer übersprungen. */
  skipped?: boolean;
}

declare global {
  interface Window {
    /** Wird nur von Tauri injiziert; dient als Erkennung «läuft in der nativen App». */
    __TAURI_INTERNALS__?: unknown;
  }
}

/** true, wenn die App im Tauri-Fenster läuft (nicht im Browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

/**
 * Fragt den Update-Server (`latest.json`) ab und merkt sich den Zeitpunkt.
 * @param respectSkip true = eine übersprungene Version gilt als «nicht verfügbar»
 *   (Auto-Check); false = immer anzeigen (manueller Check).
 */
export async function checkForAppUpdate(
  { respectSkip = true }: { respectSkip?: boolean } = {},
): Promise<UpdateCheckResult> {
  if (!isTauri()) return { available: false, isTauri: false };
  // Dynamisch importiert: das Plugin existiert im Browser-Build nicht.
  const { check } = await import("@tauri-apps/plugin-updater");
  const result = await check();
  localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
  if (!result?.available) return { available: false, update: null, isTauri: true };
  if (respectSkip && localStorage.getItem(SKIP_KEY) === result.version) {
    return { available: false, update: result, isTauri: true, skipped: true };
  }
  return { available: true, update: result, isTauri: true };
}

/** Lädt das Update, installiert es und startet die App neu. */
export async function installAppUpdate(
  update: Update,
  onProgress?: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onProgress);
  // Neustart beendet hart (lib.rs lässt RESTART_EXIT_CODE durch) — offene Änderungen vorher schreiben
  const { flushStorage } = await import("../storage/adapter");
  await flushStorage().catch(() => {});
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Merkt sich, dass der Nutzer diese Version nicht installieren möchte. */
export function skipUpdateVersion(version?: string): void {
  if (version) localStorage.setItem(SKIP_KEY, version);
}

/** ISO-Zeitstempel des letzten Checks oder null, wenn noch nie geprüft. */
export function getLastUpdateCheck(): string | null {
  return localStorage.getItem(LAST_CHECK_KEY);
}

/** Formatiert einen ISO-Zeitstempel für die Anzeige («17. Oktober 2026, 09:30»). */
export function formatLastCheck(iso: string | null): string {
  if (!iso) return "noch nie";
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-CH", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
