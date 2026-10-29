// Dateiablage im Datenordner: Belege, Logo, Bilder und Schriften als echte Dateien statt im JSON.
//
// In der App bleiben Anhänge `data:`-URLs (Views, Druck und Belegerkennung ändern sich nicht). Erst
// beim Schreiben in den Ordner ersetzt `externalize` jede grössere Base64-`data:`-URL durch einen
// Verweis «rapport-datei:Dateien/<Bereich>/<Name>» und legt die Datei daneben ab; `internalize` macht
// beim Laden daraus wieder `data:`-URLs. So bleiben studio.json, Zeitdateien und Tagesbackups klein,
// und die Belege liegen lesbar im Finder:
//
//   <Ordner>/Dateien/Belege/<Belegname>-<Prüfsumme>.pdf
//   <Ordner>/Dateien/Studio/…, Dokument-Design/…, Pinnwand/…, Benutzer/…, Weitere/…
//
// Der Name enthält eine Prüfsumme des Inhalts (SHA-256): gleicher Inhalt = gleiche Datei, eine Datei
// wird nie überschrieben. Dadurch verweisen auch alte Tagesbackups weiter auf gültige Dateien.
// Nicht mehr verwendete Dateien entfernt nur das Aufräumen von Hand (FileStorageAdapter.cleanupFiles).
// Fehlt eine Datei (iCloud hat sie noch nicht geladen), bleibt der Verweis stehen und wird beim nächsten
// Speichern unverändert zurückgeschrieben.
//
// Dateityp: Die Endung ergibt sich aus dem MIME-Typ, sonst aus dem Originalnamen. Kann die Endung den
// Typ nicht eindeutig zurückgeben (unbekannter Typ, Alias wie «image/jpg»), steht er im Verweis:
// «rapport-datei:Dateien/Belege/Plan-<Prüfsumme>.dwg?typ=image%2Fvnd.dwg». So kommt beim Laden genau
// derselbe Typ zurück, wie er gespeichert wurde.

import type { FsApi } from "./file-adapter";

/** Präfix der Verweise im gespeicherten JSON. */
export const FILE_REF_PREFIX = "rapport-datei:";
/** Ordner der Dateiablage innerhalb des Datenordners. */
export const FILES_DIR = "Dateien";
/** Kleinere `data:`-URLs (Symbole o.ä.) bleiben im JSON. */
const MIN_EXTERNAL_LENGTH = 2048;

/** Unterordner je Datenbereich (oberste Ebene von `data`), damit die Ablage im Finder lesbar ist. */
const AREA_DIRS: Record<string, string> = {
  expenses: "Belege",
  internalExpenses: "Belege",
  timeEntries: "Belege",
  absences: "Belege",
  settings: "Studio",
  docAssets: "Dokument-Design",
  blogPosts: "Pinnwand",
  users: "Benutzer",
  employees: "Benutzer",
};

/** Dateiendung je MIME-Typ; Unbekanntes bekommt «.bin». */
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/svg+xml": "svg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "application/font-woff": "woff",
  "application/x-font-ttf": "ttf",
  "application/x-font-otf": "otf",
  "application/vnd.ms-opentype": "otf",
  "image/tiff": "tif",
  "image/bmp": "bmp",
  "image/heif": "heif",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/octet-stream": "bin",
};
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", svg: "image/svg+xml", ttf: "font/ttf", otf: "font/otf", woff: "font/woff",
  woff2: "font/woff2", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp", heif: "image/heif",
  txt: "text/plain", csv: "text/csv", zip: "application/zip", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  bin: "application/octet-stream",
};

const DATA_URL_RE = /^data:([^;,]*)(?:;[^,]*)?;base64,/;
/** Nur schlichte MIME-Typen aus Verweisen übernehmen. */
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

/** true für eine Base64-`data:`-URL, die gross genug für eine eigene Datei ist. */
export const isExternalizable = (v: unknown): v is string =>
  typeof v === "string" && v.length >= MIN_EXTERNAL_LENGTH && DATA_URL_RE.test(v);

/** true für einen Verweis auf eine Datei der Ablage. */
export const isFileRef = (v: unknown): v is string => typeof v === "string" && v.startsWith(FILE_REF_PREFIX);

/** Pfad relativ zum Datenordner aus einem Verweis (ohne Präfix und ohne «?typ=…»). */
export const refPath = (ref: string) => ref.slice(FILE_REF_PREFIX.length).split("?")[0];

/** Sammelt die Pfade aller Verweise in `value` (beliebig tief) in `into`. */
export function collectFileRefs(value: unknown, into: Set<string>): Set<string> {
  if (isFileRef(value)) into.add(refPath(value));
  else if (Array.isArray(value)) for (const v of value) collectFileRefs(v, into);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) collectFileRefs(v, into);
  return into;
}

/** Base64 → Bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → Base64 (in Stücken, damit grosse Dateien den Aufrufstapel nicht sprengen). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Dateinamen-taugliche Kurzform eines Belegnamens (ohne Endung, max. 40 Zeichen). */
const safeName = (s: string) => s.replace(/\.[A-Za-z0-9]{1,5}$/, "").normalize("NFC")
  .replace(/[^\p{L}\p{N} _-]+/gu, "_").replace(/\s+/g, " ").trim().slice(0, 40);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/** Originalname aus einem Nachbarfeld des Anhangs (Belegname, Dateiname, Bezeichnung); "" = keiner. */
function originalName(parent: Record<string, unknown> | null): string {
  if (!parent) return "";
  for (const key of ["receiptName", "fileName", "filename", "name", "title"]) {
    const v = parent[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Endung des Originalnamens in Kleinbuchstaben (nur einfache Endungen), sonst "". */
const nameExt = (name: string) => /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1].toLowerCase() || "";

/**
 * Hält die Zuordnung `data:`-URL ↔ Verweis für einen Datenordner und liest/schreibt die Dateien.
 * Die Zuordnung wird zwischengespeichert, damit nicht bei jedem Speichern jeder Anhang neu gehasht wird.
 */
export class FileAssetStore {
  private dir: string;
  private fs: FsApi;
  private refByUrl = new Map<string, string>();
  private urlByRef = new Map<string, string>();

  constructor(dir: string, fs: FsApi) {
    this.dir = dir;
    this.fs = fs;
  }

  private path(rel: string) { return `${this.dir}/${rel}`; }

  /** Speicherform: grosse `data:`-URLs → Verweise; fehlende Dateien werden vorher geschrieben. Eingabe bleibt unverändert. */
  async externalize<T>(value: T): Promise<T> {
    return (await this.walk(value, "", null, async (url, area, parent) => this.refFor(url, area, parent), isExternalizable)) as T;
  }

  /** App-Form: Verweise → `data:`-URLs. Nicht lesbare Dateien bleiben Verweis (siehe Dateikopf); `missing` zählt sie. */
  async internalize<T>(value: T): Promise<{ value: T; missing: string[] }> {
    const missing: string[] = [];
    const out = await this.walk(value, "", null, async ref => {
      const url = await this.urlFor(ref);
      if (url === null) { missing.push(refPath(ref)); return ref; }
      return url;
    }, isFileRef);
    return { value: out as T, missing };
  }

  /** Geht rekursiv durch Objekte/Listen und ersetzt passende Texte; unveränderte Teile behalten ihre Identität. */
  private async walk(
    v: unknown, area: string, parent: Record<string, unknown> | null,
    replace: (s: string, area: string, parent: Record<string, unknown> | null) => Promise<string>,
    match: (v: unknown) => v is string,
  ): Promise<unknown> {
    if (match(v)) return replace(v, area, parent);
    if (Array.isArray(v)) {
      let changed = false;
      const out: unknown[] = [];
      for (const item of v) {
        const next = await this.walk(item, area, parent, replace, match);
        if (next !== item) changed = true;
        out.push(next);
      }
      return changed ? out : v;
    }
    if (typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      let out: Record<string, unknown> | null = null;
      for (const [k, item] of Object.entries(obj)) {
        const next = await this.walk(item, area || k, obj, replace, match);
        if (next !== item) { out = out || { ...obj }; out[k] = next; }
      }
      return out || v;
    }
    return v;
  }

  private async refFor(url: string, area: string, parent: Record<string, unknown> | null): Promise<string> {
    const cached = this.refByUrl.get(url);
    if (cached) return cached;
    const m = DATA_URL_RE.exec(url)!;
    const mime = (m[1] || "application/octet-stream").toLowerCase();
    const bytes = base64ToBytes(url.slice(m[0].length));
    const hash = (await sha256Hex(bytes)).slice(0, 12);
    const name = originalName(parent);
    const hint = name ? safeName(name) : "";
    const ext = (mime !== "application/octet-stream" && EXT_BY_MIME[mime]) || nameExt(name) || "bin";
    const rel = `${FILES_DIR}/${AREA_DIRS[area] || "Weitere"}/${hint ? `${hint}-` : ""}${hash}.${ext}`;
    const path = this.path(rel);
    if (!(await this.fs.stat(path))) {
      await this.fs.mkdir(path.slice(0, path.lastIndexOf("/")));
      const tmp = `${path}.tmp-${Math.random().toString(36).slice(2, 8)}`;
      await this.fs.writeBytes(tmp, bytes);
      await this.fs.rename(tmp, path);
    }
    // Typ nur angeben, wenn die Endung ihn nicht genau zurückgibt (siehe Dateikopf)
    const ref = FILE_REF_PREFIX + rel + (MIME_BY_EXT[ext] === mime ? "" : `?typ=${encodeURIComponent(mime)}`);
    this.remember(url, ref);
    return ref;
  }

  private async urlFor(ref: string): Promise<string | null> {
    const cached = this.urlByRef.get(ref);
    if (cached) return cached;
    const rel = refPath(ref);
    const typParam = new URLSearchParams(ref.slice(FILE_REF_PREFIX.length + rel.length + 1)).get("typ");
    const typ = typParam && MIME_RE.test(typParam) ? typParam : null;
    // Nur Dateien innerhalb der Ablage (kein «..», keine absoluten Pfade aus manipulierten Daten)
    if (!rel.startsWith(`${FILES_DIR}/`) || rel.split("/").includes("..")) return null;
    try {
      const bytes = await this.fs.readBytes(this.path(rel));
      const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
      const url = `data:${typ || MIME_BY_EXT[ext] || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
      this.remember(url, ref);
      return url;
    } catch {
      return null;
    }
  }

  /** Vergisst zwischengespeicherte Anhänge, deren Datei nicht in `used` (Pfade wie bei refPath) steht. */
  forgetExcept(used: Set<string>) {
    for (const [ref, url] of this.urlByRef) {
      if (used.has(refPath(ref))) continue;
      this.urlByRef.delete(ref);
      this.refByUrl.delete(url);
    }
  }

  private remember(url: string, ref: string) {
    this.refByUrl.set(url, ref);
    this.urlByRef.set(ref, url);
  }
}
