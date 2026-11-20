// Lesen von CSV/Excel-Werten für den Stammdaten-Import (views/DataImport.tsx). Reine Funktionen ohne DOM.
//
// Exporte aus anderen Programmen kommen in vielen Formen: Excel «CSV (Trennzeichen-getrennt)» schreibt je nach
// System Windows-1252 statt UTF-8 (Umlaute), «Unicode-Text» UTF-16 mit Tabulatoren; Beträge stehen als
// «1'234.50», «1’234.50», «1.234,50» oder «CHF 1 234.–»; Daten als «31.12.2026», «31.12.26» oder mit Uhrzeit.

/** Eine Tabellenzeile als Texte. */
export type Row = string[];

/**
 * Dateiinhalt → Text. UTF-8 (mit/ohne BOM) und UTF-16 (mit BOM) werden erkannt; ist der Inhalt kein gültiges
 * UTF-8, wird Windows-1252 angenommen (ältere Excel-Exporte), damit Umlaute nicht zu «�» werden.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

/** Trennzeichen aus der ersten Zeile (Semikolon, Komma oder Tabulator; Zeichen in Anführungszeichen zählen nicht). */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const c of text) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) break;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  // Bei Gleichstand Semikolon: DE/CH-Excel trennt so (Komma ist dort oft Dezimalzeichen)
  return [";", "\t", ","].reduce((best, d) => (counts[d] > counts[best] ? d : best), ";");
}

/**
 * RFC-4180-naher CSV-Parser (Felder in Anführungszeichen, "" für ein Anführungszeichen, Zeilenumbrüche im Feld).
 * Trennzeichen automatisch (siehe detectDelimiter); BOM am Anfang wird entfernt; leere Zeilen fallen weg.
 */
export function parseCSV(input: string): Row[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: Row[] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/**
 * Zahl aus einer Zelle: Tausender-Apostroph (auch typografisch), Leerzeichen, Währung und «.–» werden ignoriert;
 * Dezimalzeichen Punkt oder Komma (stehen beide da, ist das letzte das Dezimalzeichen; mehrere gleiche sind
 * Tausendertrenner). Minus vorne/hinten oder Klammern = negativ. NaN, wenn keine Ziffer vorkommt.
 */
export function parseNumber(raw: string): number {
  let s = String(raw ?? "").trim();
  if (!/\d/.test(s)) return NaN;
  const negative = /^\(.*\)$/.test(s) || /^[^\d]*[-−–]/.test(s) || /\d\s*[-−]$/.test(s);
  s = s.replace(/[.,][-–—]$/, "");          // «1234.–»
  s = s.replace(/[^\d.,]/g, "");             // Währung, Apostrophe, Leerzeichen, Vorzeichen
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let decimal = "";
  if (lastDot !== -1 && lastComma !== -1) decimal = lastDot > lastComma ? "." : ",";
  else if (lastComma !== -1) decimal = s.indexOf(",") === lastComma ? "," : "";
  else if (lastDot !== -1) decimal = s.indexOf(".") === lastDot ? "." : "";
  const [intPart, frac = ""] = decimal ? [s.slice(0, s.lastIndexOf(decimal)), s.slice(s.lastIndexOf(decimal) + 1)] : [s, ""];
  const n = parseFloat(`${intPart.replace(/[.,]/g, "") || "0"}.${frac || "0"}`);
  return negative ? -n : n;
}

/**
 * Datum aus einer Zelle → `YYYY-MM-DD`; "" = nicht erkannt. Versteht ISO (auch mit Uhrzeit), `TT.MM.JJJJ`,
 * `TT/MM/JJJJ`, `TT-MM-JJJJ` und zweistellige Jahre (`31.12.26` → 2026), jeweils auch mit Uhrzeit dahinter.
 */
export function parseFlexibleDate(raw: string): string {
  const v = String(raw ?? "").trim();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  const ch = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:$|\s)/);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (ch) [y, m, d] = [ch[3].length === 2 ? 2000 + +ch[3] : +ch[3], +ch[2], +ch[1]];
  else return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ""; // 31.02. o.ä.
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Excel-Zellwert (ExcelJS) als Text: Datum, reine Uhrzeit, Formel-Ergebnis, Link und formatierter Text (richText). */
export function excelCellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // Excel legt reine Uhrzeit-Zellen (z.B. eine Von/Bis-Spalte) als Datum auf seinem internen Epoch-Tag
    // (30.12.1899) ab — sonst würde daraus fälschlich ein Datum statt einer Uhrzeit "HH:MM".
    const isPureTime = v.getUTCFullYear() === 1899 && v.getUTCMonth() === 11 && v.getUTCDate() === 30;
    return isPureTime
      ? `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`
      : v.toISOString().slice(0, 10);
  }
  if (typeof v === "object") {
    const o = v as { richText?: { text?: string }[]; text?: unknown; result?: unknown; error?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map(r => r.text ?? "").join("");
    if (o.text !== undefined) return excelCellText(o.text);
    if (o.result !== undefined) return excelCellText(o.result);
    return "";
  }
  return String(v);
}
