// Datenordner wählen und aktivieren (Desktop-App): Dialog, Umzug aus dem lokalen Speicher, Umschalten.
//
// Der Datenordner ist der Standard für eine Einzelplatz-Installation: «Rapport-Ordner anlegen» erstellt
// `~/Documents/Rapport` (Zugriff fest erlaubt in src-tauri/capabilities/default.json) oder einen
// Ordner «Rapport» an einem gewählten Ort. Die Ordnerwahl per Dialog gibt der App Zugriff auf genau
// diesen Ordner (fs-Scope, bleibt über Neustarts erhalten, siehe lib.rs). Aktivieren heisst:
// `rapport_backend=file` und `rapport_data_dir` setzen und neu laden — storage/adapter.ts wählt
// dann den FileStorageAdapter.

import type { AppData } from "../types";
import { FileStorageAdapter, tauriFs } from "./file-adapter";

/** Zufällige Gerätekennung (für Backup-Dateinamen im Datenordner), einmal pro Gerät erzeugt. */
export function getDeviceId(): string {
  let id = localStorage.getItem("rapport_device_id");
  if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem("rapport_device_id", id); }
  return id;
}

/** true, wenn die App als Desktop-App läuft (nur dort gibt es Datenordner). */
export const canUseDataFolder = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/** Ordnerdialog; gibt den gewählten Pfad zurück oder null bei Abbruch. */
export async function chooseDataFolder(title = "Datenordner wählen"): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, recursive: true, canCreateDirectories: true, title });
  return typeof picked === "string" ? picked : null;
}

/** Name des Ordners, den «Rapport-Ordner anlegen» erstellt. */
export const RAPPORT_FOLDER_NAME = "Rapport";

/** Vorschlag für den Rapport-Ordner: `<Dokumente>/Rapport`. */
export async function defaultRapportFolder(): Promise<string> {
  const { documentDir } = await import("@tauri-apps/api/path");
  return `${(await documentDir()).replace(/[\\/]+$/, "")}/${RAPPORT_FOLDER_NAME}`;
}

/**
 * Ordner, in dem Rapport an einem gewählten Ort liegen soll: enthält der gewählte Ordner schon
 * Rapport-Daten oder heisst er bereits «Rapport», wird er selbst verwendet, sonst `<Ort>/Rapport`.
 */
export async function rapportFolderIn(parent: string): Promise<string> {
  const base = parent.replace(/[\\/]+$/, "");
  if (base.split(/[\\/]/).pop() === RAPPORT_FOLDER_NAME || await folderHasData(base)) return base;
  return `${base}/${RAPPORT_FOLDER_NAME}`;
}

/** true, wenn im Ordner schon Rapport-Daten liegen. */
export async function folderHasData(dir: string): Promise<boolean> {
  return new FileStorageAdapter(dir, tauriFs()).hasExistingData();
}

/** Legt den Ordner an (samt Eltern); kein Fehler, wenn er existiert. */
export async function ensureFolder(dir: string): Promise<void> {
  await tauriFs().mkdir(dir);
}

/** Schreibt `data` als neuen Bestand in den Ordner (für den Umzug aus dem lokalen Speicher). */
export async function writeDataToFolder(dir: string, data: AppData): Promise<void> {
  await new FileStorageAdapter(dir, tauriFs(), getDeviceId()).save(data);
}

/** Pfad des aktiven Datenordners (leer, wenn keiner gewählt ist). */
export const getDataDir = () => localStorage.getItem("rapport_data_dir") || "";

/** Schaltet auf den Ordner um und lädt die App neu. */
export function activateDataFolder(dir: string): void {
  localStorage.setItem("rapport_backend_chosen", "1");
  localStorage.setItem("rapport_backend", "file");
  localStorage.setItem("rapport_data_dir", dir);
  window.location.reload();
}

/** Ordnerdialog und danach umschalten (Erststart, Fehlerbildschirm). Bei Abbruch passiert nichts. */
export async function pickAndActivateDataFolder(): Promise<void> {
  const dir = await chooseDataFolder();
  if (dir) activateDataFolder(dir);
}
