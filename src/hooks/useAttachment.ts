// Anhang zum Anzeigen: `data:`-URL direkt, Verweis aus dem Datenordner (`rapport-datei:…`) erst lesen.
//
// Im Datenordner bleiben Belege in `data` Verweise (storage/file-assets.ts, LAZY_DIR), damit nicht alle
// Belege im Speicher liegen. Wer einen Beleg anzeigt, holt ihn über diesen Hook; gelesen wird nur,
// solange die Komponente sichtbar ist, zwischengespeichert wird nichts.

import { useEffect, useState } from "react";
import { fileStorage, isFileBackend } from "../storage/adapter";
import { isFileRef } from "../storage/file-assets";

/** Zustand eines Anhangs: kein Anhang, wird gelesen, bereit (`url`), Datei fehlt. */
export type AttachmentState =
  | { status: "none"; url: null }
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "missing"; url: null };

/**
 * Liefert den Anhang als anzeigbare URL.
 *
 * @param value `data:`-URL, Verweis `rapport-datei:…` oder leer.
 */
export function useAttachment(value: string | null | undefined): AttachmentState {
  const isRef = isFileRef(value);
  const [loaded, setLoaded] = useState<{ ref: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!isRef || !isFileBackend) return;
    let cancelled = false;
    fileStorage.readAttachment(value).then(
      url => { if (!cancelled) setLoaded({ ref: value, url }); },
      () => { if (!cancelled) setLoaded({ ref: value, url: null }); },
    );
    return () => { cancelled = true; };
  }, [isRef, value]);

  if (!value) return { status: "none", url: null };
  if (!isRef) return { status: "ready", url: value };
  if (!isFileBackend) return { status: "missing", url: null };
  if (loaded?.ref !== value) return { status: "loading", url: null };
  return loaded.url ? { status: "ready", url: loaded.url } : { status: "missing", url: null };
}
