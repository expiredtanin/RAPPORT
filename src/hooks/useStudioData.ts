// Studiodaten: der gesamte App-Zustand (`data`), sein Laden, Speichern und Abgleichen.
//
//  - Laden beim Start über `storage.load()` (+ `applyMigrations`); im Cloud-Modus zuerst die
//    Studio-Liste der Instanz. `loading` hält den Boot-Spinner, bis das fertig ist.
//  - `save(newData)` ersetzt den ganzen Stand, `update(key, value)` ein Top-Level-Feld; beide
//    setzen den React-State sofort («optimistisch») und schreiben danach in den Adapter.
//  - Datenordner (Desktop): Änderungen der anderen Person (iCloud/NAS) kommen über
//    `fileStorage.onExternalChange` als neuer Gesamtstand; Ladefehler (Ordner nicht
//    synchronisiert, Datei beschädigt) landen in `loadError`, statt mit leeren Daten zu starten.
//  - Musste die Formprüfung beim Laden etwas reparieren oder fehlen Anhänge im Datenordner, sammelt
//    `dataNotices` das für einen Hinweis in App.tsx (ausgeblendete Hinweise kommen nicht wieder).
//  - Cloud: Realtime-Abgleich mit anderen Browsern (gezielte Teil-Reloads, Debounce 500 ms;
//    wartet auf laufende Schreibvorgänge und verrechnet währenddessen gemachte Eingaben per
//    Drei-Wege-Merge), Passwort-Reset-Link aus dem URL-Hash erkennen.
//  - Einmal pro Tag werden versendete Rechnungen nach Fälligkeit auf «überfällig» gesetzt.
//
// Wer den angemeldeten Nutzer hält, ist App.tsx; er wird nur für die Realtime-Subscription
// gebraucht (erst nach der Anmeldung). Login selbst bleibt dort, weil es `save`/`setData` nutzt.

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultData } from "../constants";
import { storage, cloudStorage, isCloudBackend, isFileBackend, fileStorage } from "../storage/adapter";
import { applyMigrations, type RawData } from "../storage/migrations";
import { jsonEqual, mergeValue } from "../storage/merge";
import { RejectedSaveError } from "../storage/pocketbase-adapter";
import type { AppData, CurrentUser, Invoice } from "../types";
import { localISODate } from "../utils";
import { registerUndoSaver } from "../undo";

/** Cloud: Token aus dem Passwort-Reset-Link "{APP_URL}/#/reset-password/{TOKEN}" (PocketBase-Mailtemplate, pb/pb_migrations); sonst null. */
function readResetToken(): string | null {
  if (!isCloudBackend || typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#\/reset-password\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Versendete Rechnung, deren Fälligkeit vor `today` liegt. */
const isNowOverdue = (inv: Invoice, today: string) => inv.status === "gesendet" && !!inv.dueDate && inv.dueDate < today;

/** Speicherfehler als kurze Meldung für die Kopfzeile. */
function describeSaveError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "QuotaExceededError" || /quota/i.test(err?.message || ""))
    return "Speicher voll – Änderungen werden nicht mehr gespeichert. Grosse Belege oder Bilder entfernen oder in einen Datenordner wechseln.";
  // PocketBase meldet fehlende Verbindung (Status 0) als «Something went wrong.»
  const status = (e as { status?: number })?.status;
  if (status === 0 || /something went wrong|failed to fetch|network/i.test(err?.message || ""))
    return "Keine Verbindung zum Server – Änderungen werden gespeichert, sobald die Verbindung zurück ist (Fenster bis dahin offen lassen).";
  return "Speichern fehlgeschlagen: " + (err?.message || String(e));
}

/** Hinweis zum geladenen Stand: von der Formprüfung repariert bzw. Anhang im Datenordner fehlt. */
export interface DataNotice { kind: "repaired" | "missing"; text: string }

/** Hinweis auf Anhänge, deren Datei im Datenordner (noch) fehlt. */
function missingFilesNotice(paths: string[]): string {
  const names = paths.slice(0, 3).map(p => p.slice(p.lastIndexOf("/") + 1)).join(", ");
  return `${paths.length === 1 ? "Ein Anhang fehlt" : `${paths.length} Anhänge fehlen`} im Datenordner unter «Dateien/» (${names}${paths.length > 3 ? " …" : ""}). `
    + "Vermutlich sind sie noch nicht synchronisiert; sie bleiben verknüpft und erscheinen, sobald sie da sind (Logo und Bilder nach einem Neustart von Rapport).";
}

/** Hält den gesamten App-Zustand samt Laden, Speichern und Abgleich (siehe Dateikopf). */
export function useStudioData(currentUser: CurrentUser | null) {
  // Initial-Load läuft asynchron, damit derselbe Pfad später Cloud-Backends bedienen kann.
  // `data` wird mit defaultData initialisiert (statt null), damit alle synchronen Reads
  // wie `data.appRoles` während des Initial-Renders nicht crashen. `loading` zeigt den
  // Boot-Spinner, bis der echte Snapshot da ist (LocalStorage <50ms, Cloud ggf. länger).
  const [data, setDataState] = useState<AppData>(defaultData);
  // Immer der neueste Stand, auch zwischen zwei Renders: `update()`/`save()` bauen darauf auf,
  // damit mehrere Änderungen kurz hintereinander (oder nach einem await) sich nicht gegenseitig überschreiben.
  const dataRef = useRef<AppData>(defaultData);
  // Letzter Stand, der sicher im Speicher liegt (geladen, von aussen übernommen oder erfolgreich gespeichert).
  // Basis für den Abgleich beim Nachladen: was hier noch fehlt, ist eine eigene, ungespeicherte Änderung (z.B.
  // offline gemacht) — die darf der Serverstand nicht still ersetzen (Test gleichzeitiges Arbeiten 25.11.2026).
  const syncedRef = useRef<AppData>(defaultData);
  /** Stand nur lokal setzen (eigene Änderung, Speichern läuft). */
  const setLocal = useCallback((next: AppData) => {
    dataRef.current = next;
    setDataState(next);
  }, []);
  /** Neuen Stand übernehmen, ohne zu speichern (Laden, Änderungen von aussen) — gilt als gespeichert. */
  const setData = useCallback((next: AppData) => {
    syncedRef.current = next;
    if (isCloudBackend) cloudStorage.markSynced?.(next);
    setLocal(next);
  }, [setLocal]);
  /** Letzter Speicherfehler (z.B. Speicher voll, Server nicht erreichbar); null = zuletzt erfolgreich. */
  const [saveError, setSaveErrorState] = useState<string | null>(null);
  // derselbe Stand ohne Render-Verzögerung: Abmelden prüft ihn direkt nach dem Schreiben (App.tsx handleLogout)
  const saveErrorRef = useRef<string | null>(null);
  const setSaveError = useCallback((v: string | null) => { saveErrorRef.current = v; setSaveErrorState(v); }, []);
  /** Letzter Speicherfehler, sofort aktuell (auch zwischen zwei Renders). */
  const lastSaveError = useCallback(() => saveErrorRef.current, []);
  const [loading, setLoading] = useState(true);
  const [isNewInstall, setIsNewInstall] = useState(false);
  /** Datenordner: Meldung, warum nicht geladen werden konnte (null = alles gut). */
  const [loadError, setLoadError] = useState<string | null>(null);
  // Cloud-spezifisch: Liste der Studios auf der Instanz (für Erst-Setup-Check).
  // null = noch nicht geladen; Array = geladen.
  const [cloudStudios, setCloudStudios] = useState<{ id: string; name: string; slug: string }[] | null>(null);
  // true, wenn listStudios() fehlschlug (Kong/API nicht erreichbar). Wird
  // genutzt, um NICHT fälschlich den Init-/Registrierungs-Screen zu zeigen —
  // ein API-Fehler ist nicht dasselbe wie "Instanz hat 0 Studios".
  const [cloudUnreachable, setCloudUnreachable] = useState(false);
  // Passwort-Reset-Flow: Klick auf den Reset-Link in der Mail führt zurück zur
  // App mit "#/reset-password/{TOKEN}" im Hash (siehe PocketBase-Mailtemplate in pb/pb_migrations)
  // → wir zeigen dann das Reset-Formular und lösen den Token mit ein.
  // Der Token wird beim ersten Render direkt aus dem URL-Hash gelesen (kein Server-Roundtrip nötig).
  const [resetToken, setResetToken] = useState<string | null>(readResetToken);
  const [passwordRecovery, setPasswordRecovery] = useState(() => resetToken !== null);
  /** Hinweise zum zuletzt geladenen Stand (reparierte Daten, fehlende Anhänge); leer = nichts zu melden. */
  const [dataNotices, setDataNotices] = useState<DataNotice[]>([]);
  const dismissedNotices = useRef(new Set<string>());
  const dismissDataNotices = useCallback(() => {
    setDataNotices(prev => { prev.forEach(n => dismissedNotices.current.add(n.text)); return []; });
  }, []);
  /** Geladene Rohdaten → aktueller Stand; sammelt dabei die Hinweise für `dataNotices`. */
  const migrate = useCallback((raw: RawData) => {
    const notices: DataNotice[] = [];
    const next = applyMigrations(raw, defaultData, problems => notices.push(...problems.map(text => ({ kind: "repaired" as const, text }))));
    if (isFileBackend && fileStorage.missingFiles.length) notices.push({ kind: "missing", text: missingFilesNotice(fileStorage.missingFiles) });
    const fresh = notices.filter(n => !dismissedNotices.current.has(n.text));
    if (fresh.length) setDataNotices(fresh);
    return next;
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isCloudBackend) {
        // Cloud-Reload-Fall: wenn sowohl Session (sessionStorage.rapport_user)
        // als auch das gewählte Studio (rapport_studio_id) noch vorhanden sind,
        // stellen wir den Adapter wieder her und laden direkt — ohne dass der
        // User sich neu einloggen muss.
        const sessionUser = (() => {
          try { return JSON.parse(sessionStorage.getItem("rapport_user") || "null"); } catch { return null; }
        })();
        const savedStudioId = sessionStorage.getItem("rapport_studio_id");
        if (sessionUser && savedStudioId) {
          cloudStorage.setStudioId(savedStudioId);
          try {
            const parsed = await storage.load();
            if (!cancelled && parsed) {
              setData(migrate(parsed));
            }
          } catch (e) {
            console.error("Cloud-Resume load failed:", e);
          }
        }
        // Studios der Instanz holen — entscheidet später, ob CloudSetup oder Login zeigt.
        // Bei Fehler (Kong/API down): NICHT [] setzen (das hieße "Instanz leer" →
        // fälschlich Init-Screen). Stattdessen Unreachable-Flag → Login bleibt.
        try {
          const list = await cloudStorage.listStudios?.();
          if (!cancelled) { setCloudStudios(list || []); setCloudUnreachable(false); }
        } catch (e) {
          console.error("listStudios failed:", e);
          if (!cancelled) { setCloudStudios(null); setCloudUnreachable(true); }
        }
        if (!cancelled) setLoading(false);
        return;
      }
      let hasData: boolean, parsed;
      try {
        hasData = await storage.hasExistingData();
        parsed = hasData ? await storage.load() : null;
      } catch (e) {
        // Nur der Datenordner kann hier scheitern; nie mit leeren Daten weiterarbeiten (würde Dateien überschreiben)
        console.error("Laden fehlgeschlagen:", e);
        if (!cancelled) { setLoadError((e as Error).message || "Der Datenordner konnte nicht gelesen werden."); setLoading(false); }
        return;
      }
      if (cancelled) return;
      setIsNewInstall(!hasData);
      setData(parsed ? migrate(parsed) : defaultData);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [setData, migrate]);
  const save = useCallback((next: AppData | ((prev: AppData) => AppData)) => {
    const newData = typeof next === "function" ? next(dataRef.current) : next;
    const syncedAtStart = syncedRef.current;
    setLocal(newData);
    storage.save(newData).then(
      () => {
        // nur Bereiche nachführen, die nicht inzwischen per Nachladen (adopt) neuer geworden sind — sonst wurde der
        // frische Serverstand eines anderen Bereichs wieder durch den älteren ersetzt (Review 25.11.2026)
        const synced = { ...syncedRef.current } as Record<string, unknown>;
        for (const k of Object.keys(newData)) if (syncedRef.current[k as keyof AppData] === syncedAtStart[k as keyof AppData]) synced[k] = (newData as unknown as Record<string, unknown>)[k];
        syncedRef.current = synced as unknown as AppData;
        setSaveError(null);
      },
      e => {
        console.error("Storage save failed:", e);
        setSaveError(describeSaveError(e) + (e instanceof RejectedSaveError && e.keys.length ? " Die abgelehnte Änderung wurde zurückgesetzt." : ""));
        // Vom Server abgelehnt (z.B. abgeschlossener Monat): betroffene Bereiche vom Server übernehmen, damit die
        // abgelehnte Änderung nicht stehen bleibt und bei jedem weiteren Speichern erneut scheitert
        if (e instanceof RejectedSaveError && e.keys.length && cloudStorage.loadPartial) {
          cloudStorage.loadPartial(e.keys).then(partial => {
            if (!partial) return;
            saveErrorRef.current = null;   // abgelehnte Änderung zurückgesetzt: nichts mehr ungespeichert (Banner bleibt sichtbar)
            const cur = dataRef.current;
            const next = migrate({ ...cur, ...(partial as RawData) });
            const synced = { ...syncedRef.current } as Record<string, unknown>;
            for (const k of Object.keys(partial)) synced[k] = (next as unknown as Record<string, unknown>)[k];
            syncedRef.current = synced as unknown as AppData;
            setLocal(next);
          }).catch(err => console.error("Neuladen nach Ablehnung fehlgeschlagen:", err));
        }
      },
    );
  }, [setLocal, setSaveError, migrate]);

  const update = useCallback(<K extends keyof AppData>(key: K, value: AppData[K] | ((prev: AppData[K]) => AppData[K])) => {
    save(prev => ({ ...prev, [key]: typeof value === "function" ? (value as (p: AppData[K]) => AppData[K])(prev[key]) : value }));
  }, [save]);

  // Cloud: Fenster schliessen, während noch geschrieben wird → Rückfrage des Browsers (sonst gingen die letzten
  // Eingaben verloren; Speichern sammelt 250 ms und braucht bei langsamem Netz länger)
  useEffect(() => {
    if (!isCloudBackend) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (cloudStorage.isBusy) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // «Rückgängig» für Löschungen (undo.ts) speichert über denselben Weg
  useEffect(() => registerUndoSaver(save), [save]);

  // Datenordner: Änderungen der anderen Person übernehmen (neuer Gesamtstand, bereits mit unseren Änderungen verrechnet).
  useEffect(() => {
    if (!isFileBackend || loading || loadError) return;
    return fileStorage.onExternalChange(raw => setData(migrate(raw)));
  }, [loading, loadError, setData, migrate]);

  // Cloud: Realtime-Subscription + Refresh bei Tab-Focus / Visibility-Change.
  // Damit sieht User A live, wenn User B im anderen Browser was ändert — und
  // wenn der Tab im Hintergrund war, holen wir beim Zurückkommen den aktuellen
  // Stand. Refresh ist debounced (500ms), damit Batch-Inserts nicht 25 Loads
  // hintereinander triggern.
  //
  // Realtime-Events kommen mit dem betroffenen data-Key (siehe
  // PocketBaseAdapter.subscribeToChanges) — dafür reicht ein gezieltes
  // loadPartial() statt jedes Mal alle ~20 Collections neu zu laden. Tab-Focus/
  // Wiedereinstieg liefert dagegen KEINEN data-Key (während der Tab im
  // Hintergrund war, können beliebig viele Collections betroffen sein, ohne
  // dass wir das Realtime-Event überhaupt mitbekommen haben) — das erzwingt
  // weiterhin den vollen load(). Mischen sich beide Trigger-Arten innerhalb des
  // Debounce-Fensters, gewinnt sicherheitshalber immer der volle Reload.
  useEffect(() => {
    if (!isCloudBackend || !currentUser) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirtyKeys = new Set<keyof AppData>();
    let needsFull = false;

    // Nachgeladenes übernehmen, ohne eigene Änderungen zu verlieren: Basis ist der letzte sicher gespeicherte
    // Stand (`syncedRef`). Wer einen Key seither geändert hat — während des Ladens getippt, oder offline bzw. bei
    // einem Speicherfehler —, bekommt einen Drei-Wege-Merge (merge.ts) statt des Serverstands, und das Ergebnis
    // wird gleich wieder gespeichert. Vorher war die Basis der Stand beim Start der Anfrage: eine offline
    // gemachte Änderung galt danach als «gespeichert» und sprang beim Wieder-online-Gehen zurück.
    const adopt = (loaded: RawData) => {
      const cur = dataRef.current;
      const base = syncedRef.current;
      const theirs = migrate({ ...cur, ...loaded });
      const next = { ...cur } as Record<string, unknown>;
      const synced = { ...base } as Record<string, unknown>;
      let pending = false;
      for (const k of Object.keys(loaded) as (keyof AppData)[]) {
        if (!(k in theirs)) continue;
        synced[k] = theirs[k];
        if (cur[k] === base[k]) { next[k] = theirs[k]; continue; }
        next[k] = mergeValue(base[k], cur[k], theirs[k]);
        if (!jsonEqual(next[k], theirs[k])) pending = true;
      }
      syncedRef.current = synced as unknown as AppData;
      if (pending) save(next as unknown as AppData);
      else setLocal(next as unknown as AppData);
    };

    const applyFull = async () => {
      try {
        await cloudStorage.whenIdle?.(); // zuerst eigene Änderungen fertig schreiben
        const parsed = await storage.load();
        if (!cancelled && parsed) adopt(parsed);
      } catch (e) {
        console.error("Cloud refresh failed:", e);
      }
    };

    const applyPartial = async (keys: Set<keyof AppData>) => {
      try {
        await cloudStorage.whenIdle?.();
        const partial = await cloudStorage.loadPartial(Array.from(keys));
        if (!cancelled && partial) adopt(partial as RawData);
      } catch (e) {
        console.error("Cloud partial refresh failed:", e);
      }
    };

    const scheduleRefresh = (dataKey?: keyof AppData | null) => {
      if (dataKey) dirtyKeys.add(dataKey);
      else needsFull = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const full = needsFull;
        const keys = dirtyKeys;
        needsFull = false;
        dirtyKeys = new Set();
        if (full || !cloudStorage.loadPartial || keys.size === 0) applyFull();
        else applyPartial(keys);
      }, 500);
    };

    cloudStorage.subscribeToChanges?.(scheduleRefresh);

    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    // scheduleRefresh() ohne Argument aufrufen, NICHT direkt als Listener
    // registrieren — sonst würde das FocusEvent selbst als dataKey durchgereicht
    // und fälschlich einen gezielten statt vollen Reload auslösen.
    const onFocus = () => scheduleRefresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    // wieder online: Stand holen; ungespeicherte eigene Änderungen werden dabei verrechnet und neu gespeichert
    window.addEventListener("online", onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cloudStorage.unsubscribeFromChanges?.();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [currentUser, setLocal, save, migrate]);

  // Auto-überfällig: nach dem Laden und danach stündlich prüfen, höchstens einmal pro Tag schreiben.
  const lastOverdueCheck = useRef<string | null>(null);
  useEffect(() => {
    if (loading || loadError) return;
    const check = () => {
      const today = localISODate();
      if (lastOverdueCheck.current === today) return;
      lastOverdueCheck.current = today;
      const invoices = dataRef.current.invoices;
      if (invoices.some(inv => isNowOverdue(inv, today))) {
        update("invoices", prev => prev.map(inv => isNowOverdue(inv, today) ? { ...inv, status: "überfällig" } : inv));
      }
    };
    const t = setTimeout(check, 0);
    const iv = setInterval(check, 60 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [loading, loadError, update]);

  return {
    data, setData, loading, loadError, saveError, lastSaveError, isNewInstall, cloudStudios, cloudUnreachable,
    passwordRecovery, setPasswordRecovery, resetToken, setResetToken, save, update,
    dataNotices, dismissDataNotices,
  };
}
