// Storage-Adapter: Auswahl zwischen LocalStorage und PocketBase (Cloud).
//
// Einstieg für die App: `storage` (Singleton), `isCloudBackend`, `isServerMode`.
// Beide Adapter erfüllen das Interface `StorageAdapter` (load/save/clear/
// hasExistingData). Der PocketBaseAdapter hat zusätzlich Cloud-Methoden
// (Login, Studios, Realtime, …), die nur gerufen werden, wenn `isCloudBackend`
// true ist. App.jsx hält den State; der Adapter speichert nur Snapshots davon.
//
// Ablauf beim Start: App.jsx ruft `storage.load()` → `applyMigrations()` →
// State. Jede Änderung ruft `storage.save(data)` mit dem ganzen Datenobjekt.
//
// Auswahl-Logik:
//   localStorage["rapport_backend"] === "cloud"  →  PocketBaseAdapter
//   localStorage["rapport_backend"] === "file"   →  FileStorageAdapter (nur Tauri, Ordner aus
//                                                   `rapport_data_dir`, siehe file-adapter.ts)
//   alles andere (default)                       →  LocalStorageAdapter
//
// Umschalten: `localStorage.setItem("rapport_backend", "cloud")` (später UI-Toggle).
// Cloud braucht zusätzlich VITE_POCKETBASE_URL in .env.local (kein Anon-Key nötig —
// PocketBase-Auth ist rein Token-basiert pro User).
// Fallback: wenn Cloud gewählt aber env fehlt, kommt LocalStorage zurück (mit Warning).
//
// Bewusst NICHT im Adapter:
// - UI-State (Dark Mode, Zoom, …) — per-Device, bleibt direkt in localStorage
// - Session/Auth — sessionStorage / PocketBase-Auth-eigenes Storage
// - Migrations — siehe migrations.js, läuft nach dem load auf den Rohdaten

import { STORAGE_KEY } from "../constants";
import type { AppData } from "../types";
import type { RawData } from "./migrations";
import { PocketBaseAdapter } from "./pocketbase-adapter";
import { FileStorageAdapter, tauriFs } from "./file-adapter";
import { getDeviceId, getDataDir } from "./data-folder";

/** Entprellung für localStorage: kurz genug, dass beim Wechseln/Schliessen nichts offen bleibt (flush). */
const LOCAL_SAVE_DELAY_MS = 250;

/** Gemeinsame Schnittstelle von LocalStorageAdapter und PocketBaseAdapter. */
export interface StorageAdapter {
  /** true, wenn schon Daten vorhanden sind (steuert Setup vs. Login). */
  hasExistingData(): Promise<boolean>;
  /** Rohdaten laden (noch nicht migriert); null = nichts gespeichert / unlesbar. */
  load(): Promise<RawData | null>;
  /** Gesamten Datenstand speichern. Wirft bei Fehler (z.B. Speicher voll). */
  save(data: AppData): Promise<void>;
  /** Lokale Daten löschen (Cloud: no-op). */
  clear(): Promise<void>;
}

declare global {
  interface Window {
    /** Dev-Helfer in der Browser-Konsole: `__rapport.useCloud()` / `.useLocal()` / `.storage`. */
    __rapport?: {
      storage?: StorageAdapter;
      useCloud?: () => void;
      useLocal?: () => void;
    };
  }
}

/**
 * Speichert alles als ein JSON-Blob unter `localStorage["studio_data_v1"]`.
 * `save()` ist entprellt (wie im Datenordner): bei schnellen Änderungen wird nur der letzte Stand
 * serialisiert, statt bei jeder Änderung den ganzen Datenbestand. `flush()` schreibt sofort.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private pending: AppData | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  async hasExistingData() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  /** Gibt bei fehlenden oder kaputten Daten null zurück (kein Fehler). */
  async load(): Promise<RawData | null> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  /** Wirft (über das Promise) z.B. bei vollem Speicher (QuotaExceededError). */
  save(data: AppData): Promise<void> {
    this.pending = data;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, LOCAL_SAVE_DELAY_MS);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Ausstehenden Stand sofort schreiben (Fenster wird ausgeblendet/geschlossen). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const data = this.pending;
    const waiters = this.waiters;
    this.pending = null;
    this.waiters = [];
    if (!data) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      waiters.forEach(w => w.resolve());
    } catch (e) {
      console.error("LocalStorage save failed:", e);
      waiters.forEach(w => w.reject(e));
      throw e;
    }
  }

  async clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}

// SERVER-MODUS: dieser Build ist die gehostete Web-GUI eines bestimmten
// Servers (gesetzt via VITE_SERVER_MODE=1 im Dockerfile.app). Dann ist die App
// FEST an diesen einen Server gebunden — keine Lokal/Server-Wahl, kein Wechsel
// der Server-Adresse, kein Verbinden auf andere Instanzen. Nur der Login auf
// genau diesem Server. Die lokale DMG (Tauri) setzt diese Flag NIE und behält
// die volle Wahl (Lokal / beliebige Server-IP).
const _isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
/** true = gehostete Web-GUI mit fest eingebautem Server (siehe Kommentar oben). */
export const isServerMode = import.meta.env.VITE_SERVER_MODE === "1" && !_isTauri;

/**
 * Wählt den Adapter anhand von Build-Flags und localStorage (siehe Kopfkommentar).
 * Enthält auch zwei einmalige Aufräum-/Default-Regeln für Upgrades (Kommentare unten).
 */
function createAdapter(): LocalStorageAdapter | PocketBaseAdapter | FileStorageAdapter {
  const isTauri = _isTauri;
  // Build-time-URL nur für Web-Deploy gültig. Tauri-Builds ignorieren den
  // eingebrannten Wert — Desktop-User geben die Server-URL aktiv ein.
  const envUrl = isTauri ? null : import.meta.env.VITE_POCKETBASE_URL;

  // ── Server-Modus: fest auf diesen Server, ohne Wahlmöglichkeit ───────────
  if (isServerMode) {
    if (!envUrl) {
      console.error("VITE_SERVER_MODE=1, aber VITE_POCKETBASE_URL fehlt — Fehlkonfiguration des Web-Builds.");
      return new LocalStorageAdapter();
    }
    // localStorage konsistent halten (Login liest cloud_url für listStudios),
    // aber der User kann nichts davon ändern — die Werte kommen aus dem Build.
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rapport_backend", "cloud");
      localStorage.setItem("rapport_backend_chosen", "1");
      localStorage.setItem("rapport_cloud_url", envUrl.replace(/\/+$/, ""));
    }
    return new PocketBaseAdapter(envUrl);
  }

  if (typeof localStorage !== "undefined") {
    // ── Auto-Recovery für 0.8.0-Upgrade-Bug ──────────────────────────────
    // 0.8.0 hat Cloud-Modus ungewollt gesetzt bei Lokal-Usern (siehe 0.8.1
    // CHANGELOG). 0.8.1 verhindert das nur prospektiv, behebt aber den
    // bestehenden Cloud-State nicht. Hier räumen wir nachträglich auf:
    //   Cloud-Modus gesetzt + lokale Daten vorhanden + keine Cloud-Session
    //   → Cloud-State löschen, User landet im BackendChoice oder Lokal-Modus.
    const RECOVERY_MARKER = "rapport_080_recovery";
    const backend = localStorage.getItem("rapport_backend");
    const hasLocalData = !!localStorage.getItem(STORAGE_KEY);
    const hasCloudSession = !!localStorage.getItem("rapport_pocketbase_auth");
    if (backend === "cloud" && hasLocalData && !hasCloudSession && !localStorage.getItem(RECOVERY_MARKER)) {
      console.warn("Auto-Recovery: Cloud-Modus gesetzt, aber Lokal-Daten vorhanden und kein Cloud-Login — räume Cloud-State auf.");
      localStorage.removeItem("rapport_backend");
      localStorage.removeItem("rapport_backend_chosen");
      localStorage.removeItem("rapport_cloud_url");
      localStorage.setItem(RECOVERY_MARKER, "1");
    }

    // ── Auto-Cloud-Default für Web-Deploy ────────────────────────────────
    // Nur wenn keine lokalen Daten existieren und der Browser auf einer
    // konfigurierten Web-Instanz landet (envUrl aus build).
    if (import.meta.env.PROD && envUrl && !localStorage.getItem("rapport_backend_chosen") && !hasLocalData) {
      localStorage.setItem("rapport_backend_chosen", "1");
      localStorage.setItem("rapport_backend", "cloud");
      if (!localStorage.getItem("rapport_cloud_url")) {
        localStorage.setItem("rapport_cloud_url", envUrl.replace(/\/+$/, ""));
      }
    }
  }

  const backend = (typeof localStorage !== "undefined"
    && localStorage.getItem("rapport_backend")) || "local";
  if (backend === "file") {
    const dir = getDataDir();
    if (isTauri && dir) return new FileStorageAdapter(dir, tauriFs(), getDeviceId());
    console.warn("rapport_backend=file, aber kein Datenordner oder keine Desktop-App — Fallback auf LocalStorage.");
  }
  if (backend === "cloud") {
    // URL kommt bevorzugt aus localStorage (vom User eingegeben). Tauri hat
    // gar keine env-URL; Web-Build hat sie ggf. als Fallback.
    const url = (typeof localStorage !== "undefined" && localStorage.getItem("rapport_cloud_url")) || envUrl;
    if (!url) {
      console.warn("rapport_backend=cloud, aber keine Server-URL gesetzt — Fallback auf LocalStorage.");
      return new LocalStorageAdapter();
    }
    console.info("Storage-Adapter: PocketBaseAdapter aktiv (URL:", url + ")");
    return new PocketBaseAdapter(url);
  }
  return new LocalStorageAdapter();
}

// Singleton — wird beim Modul-Load gewählt.
// Switch zur Laufzeit erfordert (vorerst) einen App-Reload.
/** Der aktive Adapter. */
export const storage = createAdapter();

/**
 * Der aktive Adapter als PocketBaseAdapter, für Cloud-Methoden (Login, Studios, Realtime, …).
 * Nur verwenden, wenn `isCloudBackend` true ist — im lokalen Modus fehlen diese Methoden zur Laufzeit.
 */
export const cloudStorage = storage as unknown as PocketBaseAdapter;

/** true = Daten liegen in einem Ordner (Desktop-App); dann gibt es `fileStorage.onExternalChange` etc. */
export const isFileBackend = storage instanceof FileStorageAdapter;
/** Der aktive Adapter als FileStorageAdapter. Nur verwenden, wenn `isFileBackend` true ist. */
export const fileStorage = storage as unknown as FileStorageAdapter;

// Entprelltes Speichern (Datenordner und localStorage) nicht verlieren, wenn das Fenster in den
// Hintergrund geht oder schliesst. Fehler meldet bereits das Promise von save() an die App.
if ((isFileBackend || storage instanceof LocalStorageAdapter) && typeof window !== "undefined") {
  const flushNow = () => { flushStorage().catch(() => {}); };
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("blur", flushNow);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
}

/** Schreibt entprellte Änderungen sofort (Datenordner, localStorage); bei PocketBase nichts zu tun. */
export function flushStorage(): Promise<void> {
  if (storage instanceof FileStorageAdapter || storage instanceof LocalStorageAdapter) return storage.flush();
  return Promise.resolve();
}

// Beenden über Tray oder Cmd+Q: Rust wartet auf `rapport:quit-ready`, bis offene Änderungen
// geschrieben sind (src-tauri/src/lib.rs, mit Timeout). Auch bei Fehlern antworten, sonst wartet Rust umsonst.
if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
  import("@tauri-apps/api/event").then(({ listen, emit }) => listen("rapport:quit-requested", () => {
    flushStorage().catch(() => {}).finally(() => { emit("rapport:quit-ready").catch(() => {}); });
  })).catch(() => {});
}

/** true = Daten liegen im localStorage (~5 MB Grenze, siehe `checkLocalBudget` in utils.ts). */
export const isLocalBackend = storage instanceof LocalStorageAdapter;

/** true = Daten liegen in PocketBase; dann stehen die Cloud-Methoden am Adapter zur Verfügung. */
export const isCloudBackend = storage instanceof PocketBaseAdapter;

// Für Dev-Tests im Browser: window.__rapport.storage und ein Helper, um die
// Cloud-Verbindung ohne UI zu testen.
if (typeof window !== "undefined") {
  window.__rapport = window.__rapport || {};
  window.__rapport.storage = storage;
  window.__rapport.useCloud = () => {
    localStorage.setItem("rapport_backend", "cloud");
    location.reload();
  };
  window.__rapport.useLocal = () => {
    localStorage.setItem("rapport_backend", "local");
    location.reload();
  };
}
