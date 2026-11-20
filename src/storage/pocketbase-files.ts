// Dateiablage in PocketBase: Belege, Logo, Pinnwand-Bilder und Dokument-Design als Dateifelder.
//
// Gleiches Muster wie der Datenordner (file-assets.ts, hooks/useAttachment.ts), nur auf dem Server:
//
//   App-Daten           PocketBase-Zeile (Dateifeld)        Verweis in der App
//   receiptData   ↔     expenses.receiptFile = "beleg_x7.pdf"  «rapport-pb:expenses/<id>/beleg_x7.pdf»
//
// - Die fromDB-Mapper machen aus dem Dateinamen einen Verweis «rapport-pb:<Collection>/<Datensatz>/<Datei>»
//   (`pbFileRef`). Belege (expenses, internalExpenses: `lazy`) bleiben in der App Verweise und werden erst
//   beim Anzeigen mit einem Datei-Token geladen (`read`, über hooks/useAttachment.ts) — sonst käme bei jedem
//   Laden jeder Beleg aller Jahre mit.
// - Logo, Pinnwand-Bilder und Dokument-Design-Dateien lädt der Adapter beim Laden gleich als `data:`-URL
//   (`inline`): Druck, PDF und Vorschau brauchen sie sofort und ohne Netz (Datei-Token laufen nach wenigen
//   Minuten ab). Die Zuordnung `data:`-URL ↔ Verweis wird gemerkt, damit unveränderte Dateien beim
//   Speichern wieder als Verweis erscheinen (`toRefs`) und nicht erneut hochgeladen werden.
// - Neu hochgeladene Dateien sind in der App bis zum nächsten Laden `data:`-URLs. Beim Speichern macht
//   `prepareBody` daraus ein `File` (multipart, einzeln statt im Batch); `remember` ordnet danach die
//   `data:`-URL dem neuen Verweis zu. Leerer Wert = Datei entfernen. Ein Verweis auf eine Datei eines
//   anderen Datensatzes (kopierte Zeile) wird heruntergeladen und neu hochgeladen.
//
// Im Abgleich (pocketbase-sync.ts) stehen dadurch in `base` und in den neuen Zeilen dieselben kurzen
// Verweise; Server-Zeilen bringt `fromRecord` auf dieselbe Form (Dateiname → Verweis).
//
// Rechte: Dateifelder sind `protected` (Migration 1787820000_file_fields.js). Heruntergeladen wird nur mit
// Datei-Token eines Mitglieds des Studios (viewRule); Belege zusätzlich nur mit passender Rolle
// (pb_hooks/permissions.pb.js, onFileDownloadRequest).

import { base64ToBytes, bytesToBase64, EXT_BY_MIME, MIME_BY_EXT } from "./file-assets";
import type { SyncRow } from "./pocketbase-sync";

/** Präfix der Verweise auf Dateien in PocketBase. */
export const PB_REF_PREFIX = "rapport-pb:";

/** Ein zerlegter Verweis. */
export interface PbFileRef {
  collection: string;
  recordId: string;
  filename: string;
}

/** Dateifeld einer Collection (je Collection höchstens eines). */
export interface PbFileField {
  /** Feldname in der PocketBase-Zeile (Ausgabe der toDB-Mapper). */
  field: string;
  /** Nachbarfeld mit dem Originalnamen (wird zum Dateinamen beim Hochladen). */
  nameField?: string;
  /** Dateiname ohne Endung, wenn kein Originalname da ist. */
  fallbackName: string;
  /** true = bleibt in der App Verweis und wird erst beim Anzeigen geladen (Belege). */
  lazy: boolean;
}

/** Dateifelder je Collection; Feldnamen wie in der Migration 1787820000_file_fields.js. */
export const PB_FILE_FIELDS: Record<string, PbFileField> = {
  expenses: { field: "receiptFile", nameField: "receiptName", fallbackName: "beleg", lazy: true },
  internalExpenses: { field: "receiptFile", nameField: "receiptName", fallbackName: "beleg", lazy: true },
  studioSettings: { field: "logoFile", fallbackName: "logo", lazy: false },
  blogPosts: { field: "imageFile", fallbackName: "bild", lazy: false },
  docAssets: { field: "file", nameField: "name", fallbackName: "datei", lazy: false },
};

const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILENAME_RE = /^[^/\\?#\s]{1,255}$/;

/** Verweis aus Collection, Datensatz und Dateiname; "" wenn kein Dateiname da ist. */
export function pbFileRef(collection: string, recordId: string, filename: unknown): string {
  if (typeof filename !== "string" || !filename) return "";
  return `${PB_REF_PREFIX}${collection}/${recordId}/${filename}`;
}

/** Zerlegt einen Verweis; null, wenn es keiner ist oder er ungültige Teile enthält (manipulierte Daten). */
export function parsePbRef(v: unknown): PbFileRef | null {
  if (typeof v !== "string" || !v.startsWith(PB_REF_PREFIX)) return null;
  const parts = v.slice(PB_REF_PREFIX.length).split("/");
  if (parts.length !== 3) return null;
  const [collection, recordId, filename] = parts;
  if (!SEGMENT_RE.test(collection) || !SEGMENT_RE.test(recordId) || !FILENAME_RE.test(filename) || filename === "..") return null;
  return { collection, recordId, filename };
}

/** true für einen gültigen Verweis «rapport-pb:…». */
export const isPbRef = (v: unknown): v is string => parsePbRef(v) !== null;

const DATA_URL_RE = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/;

/** true für eine `data:`-URL (Base64 oder Prozent-kodiert). */
export const isDataUrl = (v: unknown): v is string => typeof v === "string" && DATA_URL_RE.test(v);

/** MIME-Typ und Inhalt einer `data:`-URL; null, wenn es keine ist. */
export function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = DATA_URL_RE.exec(url);
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const payload = url.slice(m[0].length);
  try {
    const bytes = m[3] ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** Dateiname für den Upload: Originalname (ohne Endung) + Endung passend zum Typ. */
export function uploadName(mime: string, original: string, fallback: string): string {
  const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || fallback;
  const origExt = /\.([A-Za-z0-9]{1,5})$/.exec(original)?.[1].toLowerCase() || "";
  const ext = (mime !== "application/octet-stream" && EXT_BY_MIME[mime]) || origExt || "bin";
  return `${base}.${ext}`;
}

/** `data:`-URL → File (für multipart-Uploads); null, wenn sie nicht lesbar ist. */
export function dataUrlToFile(url: string, original: string, fallback: string): File | null {
  const parsed = parseDataUrl(url);
  if (!parsed) return null;
  return new File([parsed.bytes as BlobPart], uploadName(parsed.mime, original, fallback), { type: parsed.mime });
}

/** Blob → Base64-`data:`-URL. Ohne Typ wird er aus der Dateiendung geraten. */
export async function blobToDataUrl(blob: Blob, filename = ""): Promise<string> {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const type = (blob.type || "").split(";")[0].trim() || MIME_BY_EXT[ext] || "application/octet-stream";
  return `data:${type};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/** Ersetzt alle Verweise «rapport-pb:…» in `value` (beliebig tief); unveränderte Teile behalten ihre Identität. */
export async function replacePbRefs<T>(value: T, fn: (ref: string) => Promise<string>): Promise<T> {
  const walk = async (v: unknown): Promise<unknown> => {
    if (isPbRef(v)) return fn(v);
    if (Array.isArray(v)) {
      const out = await Promise.all(v.map(walk));
      return out.some((x, i) => x !== v[i]) ? out : v;
    }
    if (typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      let out: Record<string, unknown> | null = null;
      for (const [k, item] of Object.entries(obj)) {
        const next = await walk(item);
        if (next !== item) { out = out || { ...obj }; out[k] = next; }
      }
      return out || v;
    }
    return v;
  };
  return (await walk(value)) as T;
}

/** Ergebnis von `prepareBody`. */
export interface PreparedBody {
  /** Body für create/update; enthält bei einem Upload ein `File`. */
  body: SyncRow;
  /** Hochgeladene `data:`-URL (für `remember` nach dem Schreiben), sonst null. */
  upload: string | null;
  /** true = muss als multipart einzeln geschrieben werden (nicht im Batch). */
  multipart: boolean;
}

/**
 * Hält die Zuordnung `data:`-URL ↔ Verweis und lädt Dateien über die mitgegebene Funktion
 * (im Adapter: Datei-Token + fetch). Ohne Netz testbar.
 */
export class PbFileStore {
  private download: (ref: PbFileRef) => Promise<Blob>;
  private refByUrl = new Map<string, string>();
  private urlByRef = new Map<string, string>();

  constructor(download: (ref: PbFileRef) => Promise<Blob>) {
    this.download = download;
  }

  /** Ersetzt in einer Zeile (Datenbankform) eine bekannte `data:`-URL durch ihren Verweis. Eingabe bleibt unverändert. */
  toRefs(table: string, row: SyncRow): SyncRow {
    const def = PB_FILE_FIELDS[table];
    const v = def ? row[def.field] : undefined;
    if (!def || !isDataUrl(v)) return row;
    const ref = this.refByUrl.get(v);
    return ref ? { ...row, [def.field]: ref } : row;
  }

  /** Server-Zeile → Abgleichsform: Dateiname im Dateifeld → Verweis (fehlt das Feld, bleibt die Zeile, wie sie ist). */
  fromRecord(table: string, record: SyncRow): SyncRow {
    const def = PB_FILE_FIELDS[table];
    if (!def || !(def.field in record)) return record;
    return { ...record, [def.field]: pbFileRef(table, String(record.id), record[def.field]) };
  }

  /**
   * Bereitet den Body einer create/update-Operation vor: `data:`-URL → File, eigener Verweis → Dateiname
   * (bleibt), fremder Verweis → herunterladen und neu hochladen, leer → Datei entfernen. Unbekannte Werte
   * (z.B. ein Verweis in einen Datenordner) werden nicht gesendet, damit die Datei auf dem Server bleibt.
   */
  async prepareBody(table: string, recordId: string, body: SyncRow): Promise<PreparedBody> {
    const def = PB_FILE_FIELDS[table];
    if (!def || !(def.field in body)) return { body, upload: null, multipart: false };
    const v = body[def.field];
    const out: SyncRow = { ...body };
    const original = def.nameField && typeof body[def.nameField] === "string" ? String(body[def.nameField]) : "";
    if (v === null || v === undefined || v === "") {
      out[def.field] = "";
      return { body: out, upload: null, multipart: false };
    }
    const ref = parsePbRef(v);
    if (ref && ref.collection === table && ref.recordId === recordId) {
      out[def.field] = ref.filename;
      return { body: out, upload: null, multipart: false };
    }
    if (ref) {
      // Nicht ladbar (gelöscht, anderes Büro, anderer Server): Datei nicht senden statt das Speichern
      // der ganzen Collection scheitern zu lassen (ein 404 hier gälte im Adapter als «keine Berechtigung»).
      const blob = await this.download(ref).catch((e: unknown) => {
        console.warn(`PocketBase-Dateiablage: ${v} nicht ladbar, Datei nicht übernommen:`, e);
        return null;
      });
      if (!blob) { delete out[def.field]; return { body: out, upload: null, multipart: false }; }
      out[def.field] = new File([blob], original || ref.filename, { type: blob.type });
      return { body: out, upload: null, multipart: true };
    }
    if (isDataUrl(v)) {
      const file = dataUrlToFile(v, original, def.fallbackName);
      if (file) {
        out[def.field] = file;
        return { body: out, upload: v, multipart: true };
      }
    }
    console.warn(`PocketBase-Dateiablage: Wert in ${table}.${def.field} ist weder Datei noch Verweis, nicht gesendet.`);
    delete out[def.field];
    return { body: out, upload: null, multipart: false };
  }

  /** Nach einem Upload: `data:`-URL ↔ neuer Verweis (aus dem zurückgegebenen Datensatz). Liefert den Verweis. */
  remember(table: string, record: SyncRow, url: string): string {
    const def = PB_FILE_FIELDS[table];
    const ref = def ? pbFileRef(table, String(record.id), record[def.field]) : "";
    if (!ref) return "";
    this.refByUrl.set(url, ref);
    if (!def.lazy) this.urlByRef.set(ref, url);
    return ref;
  }

  /** Datei eines Verweises als `data:`-URL, zwischengespeichert (Logo, Bilder, Schriften). null = nicht ladbar. */
  async inline(ref: string): Promise<string | null> {
    const cached = this.urlByRef.get(ref);
    if (cached) return cached;
    const url = await this.read(ref);
    if (url) {
      this.urlByRef.set(ref, url);
      this.refByUrl.set(url, ref);
    }
    return url;
  }

  /** Datei eines Verweises als `data:`-URL, ohne Zwischenspeicher (Belege beim Anzeigen). null = nicht ladbar. */
  async read(ref: string): Promise<string | null> {
    const parsed = parsePbRef(ref);
    if (!parsed) return null;
    try {
      return await blobToDataUrl(await this.download(parsed), parsed.filename);
    } catch (e) {
      console.warn("PocketBase-Dateiablage: Datei nicht ladbar:", ref, e);
      return null;
    }
  }

  /** Vergisst alle Zuordnungen, deren Verweis nicht in `keep` steht (nach einem vollen Laden). */
  retainOnly(keep: Set<string>) {
    for (const [url, ref] of this.refByUrl) if (!keep.has(ref)) this.refByUrl.delete(url);
    for (const ref of this.urlByRef.keys()) if (!keep.has(ref)) this.urlByRef.delete(ref);
  }

  /** Alles vergessen (Abmelden, Studio-Wechsel). */
  clear() {
    this.refByUrl.clear();
    this.urlByRef.clear();
  }
}
