// Studiodaten: der gesamte App-Zustand (`data`), sein Laden, Speichern und Abgleichen.
//
//  - Laden beim Start über `storage.load()` (+ `applyMigrations`); im Cloud-Modus zuerst die
//    Studio-Liste der Instanz. `loading` hält den Boot-Spinner, bis das fertig ist.
//  - `save(newData)` ersetzt den ganzen Stand, `update(key, value)` ein Top-Level-Feld; beide
//    setzen den React-State sofort («optimistisch») und schreiben danach in den Adapter.
//  - Datenordner (Desktop): Änderungen der anderen Person (iCloud/NAS) kommen über
//    `fileStorage.onExternalChange` als neuer Gesamtstand; Ladefehler (Ordner nicht
//    synchronisiert, Datei beschädigt) landen in `loadError`, statt mit leeren Daten zu starten.
//  - Cloud: Realtime-Abgleich mit anderen Browsern (gezielte Teil-Reloads, Debounce 500 ms),
//    Passwort-Reset-Link aus dem URL-Hash erkennen.
//  - Einmal pro Tag werden versendete Rechnungen nach Fälligkeit auf «überfällig» gesetzt.
//
// Wer den angemeldeten Nutzer hält, ist App.tsx; er wird nur für die Realtime-Subscription
// gebraucht (erst nach der Anmeldung). Login selbst bleibt dort, weil es `save`/`setData` nutzt.

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultData } from "../constants";
import { storage, cloudStorage, isCloudBackend, isFileBackend, fileStorage } from "../storage/adapter";
import { applyMigrations } from "../storage/migrations";
import type { AppData, CurrentUser, Invoice } from "../types";
import { localISODate } from "../utils";

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
  return "Speichern fehlgeschlagen: " + (err?.message || String(e));
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
  /** Neuen Stand übernehmen, ohne zu speichern (Laden, Änderungen von aussen). */
  const setData = useCallback((next: AppData) => {
    dataRef.current = next;
    setDataState(next);
  }, []);
  /** Letzter Speicherfehler (z.B. Speicher voll, Server nicht erreichbar); null = zuletzt erfolgreich. */
  const [saveError, setSaveError] = useState<string | null>(null);
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
              setData(applyMigrations(parsed, defaultData));
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
      setData(parsed ? applyMigrations(parsed, defaultData) : defaultData);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [setData]);
  const save = useCallback((next: AppData | ((prev: AppData) => AppData)) => {
    const newData = typeof next === "function" ? next(dataRef.current) : next;
    setData(newData);
    storage.save(newData).then(
      () => setSaveError(null),
      e => {
        console.error("Storage save failed:", e);
        setSaveError(describeSaveError(e));
      },
    );
  }, [setData]);

  const update = useCallback(<K extends keyof AppData>(key: K, value: AppData[K] | ((prev: AppData[K]) => AppData[K])) => {
    save(prev => ({ ...prev, [key]: typeof value === "function" ? (value as (p: AppData[K]) => AppData[K])(prev[key]) : value }));
  }, [save]);

  // Datenordner: Änderungen der anderen Person übernehmen (neuer Gesamtstand, bereits mit unseren Änderungen verrechnet).
  useEffect(() => {
    if (!isFileBackend || loading || loadError) return;
    return fileStorage.onExternalChange(raw => setData(applyMigrations(raw, defaultData)));
  }, [loading, loadError, setData]);

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

    const applyFull = async () => {
      try {
        const parsed = await storage.load();
        if (!cancelled && parsed) {
          setData(applyMigrations(parsed, defaultData));
        }
      } catch (e) {
        console.error("Cloud refresh failed:", e);
      }
    };

    const applyPartial = async (keys: Set<keyof AppData>) => {
      try {
        const partial = await cloudStorage.loadPartial(Array.from(keys));
        if (!cancelled && partial) {
          setData(applyMigrations({ ...dataRef.current, ...partial }, defaultData));
        }
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

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cloudStorage.unsubscribeFromChanges?.();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [currentUser, setData]);

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
    data, setData, loading, loadError, saveError, isNewInstall, cloudStudios, cloudUnreachable,
    passwordRecovery, setPasswordRecovery, resetToken, setResetToken, save, update,
  };
}
