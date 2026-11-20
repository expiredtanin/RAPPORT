// Anhang zum Anzeigen: `data:`-URL direkt, Verweis (Datenordner `rapport-datei:…`, Cloud `rapport-pb:…`) erst lesen.
//
// Im Datenordner und in der Cloud bleiben Belege in `data` Verweise (storage/file-assets.ts, LAZY_DIR bzw.
// storage/pocketbase-files.ts), damit nicht alle Belege im Speicher liegen. Wer einen Beleg anzeigt, holt ihn
// über diesen Hook; gelesen wird nur, solange die Komponente sichtbar ist, zwischengespeichert wird nichts.
// Cloud: Download mit kurzlebigem Datei-Token (geschütztes Dateifeld), Ergebnis als `data:`-URL.

import { useEffect, useState } from "react";
import { cloudStorage, fileStorage, isCloudBackend, isFileBackend } from "../storage/adapter";
import { isFileRef } from "../storage/file-assets";
import { isPbRef } from "../storage/pocketbase-files";

/** Zustand eines Anhangs: kein Anhang, wird gelesen, bereit (`url`), Datei fehlt. */
export type AttachmentState =
  | { status: "none"; url: null }
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "missing"; url: null };

/** Liest einen Verweis über den passenden Speicher; null = dieser Speicher kennt ihn nicht. */
function readerFor(value: string): (() => Promise<string | null>) | null {
  if (isFileRef(value) && isFileBackend) return () => fileStorage.readAttachment(value);
  if (isPbRef(value) && isCloudBackend) return () => cloudStorage.readAttachment(value);
  return null;
}

/**
 * Liefert den Anhang als anzeigbare URL.
 *
 * @param value `data:`-URL, Verweis `rapport-datei:…` / `rapport-pb:…` oder leer.
 */
export function useAttachment(value: string | null | undefined): AttachmentState {
  const isRef = isFileRef(value) || isPbRef(value);
  const [loaded, setLoaded] = useState<{ ref: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!isRef) return;
    const read = readerFor(value);
    if (!read) return;
    let cancelled = false;
    read().then(
      url => { if (!cancelled) setLoaded({ ref: value, url }); },
      () => { if (!cancelled) setLoaded({ ref: value, url: null }); },
    );
    return () => { cancelled = true; };
  }, [isRef, value]);

  if (!value) return { status: "none", url: null };
  if (!isRef) return { status: "ready", url: value };
  if (!readerFor(value)) return { status: "missing", url: null };
  if (loaded?.ref !== value) return { status: "loading", url: null };
  return loaded.url ? { status: "ready", url: loaded.url } : { status: "missing", url: null };
}
