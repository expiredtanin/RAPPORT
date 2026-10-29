// Lokale Belegerkennung für Ausgaben (Expenses.jsx): extrahiert Text aus einem
// hochgeladenen PDF (Textlayer, oder OCR-Fallback für gescannte PDFs) oder
// Bild (OCR), und versucht per Regex-Heuristik Betrag/Datum/MWST-Satz/
// Lieferant rauszuziehen. Bewusst kein Cloud-Vision-API-Aufruf — komplett
// lokal, keine Belege verlassen die Maschine. Tesseract-Worker/Core/
// Sprachdaten liegen unter public/tesseract/, PDF.js-Worker unter
// public/pdf.worker.min.mjs — beides lokal gebündelt, kein CDN-Fetch.
//
// Genauigkeit ist bewusst "best effort": Ergebnisse füllen das Formular vor,
// überschreiben aber nie schon vorhandene Werte — der Mensch prüft/korrigiert.
//
// Einstieg: `extractReceiptText(dataUrl)` liefert den Rohtext, danach
// `parseReceiptFields(text)` die erkannten Felder. Die parse*-Funktionen sind
// rein (kein I/O) und lassen sich mit Beispieltexten einzeln prüfen.

import type { Worker } from "tesseract.js";

type PdfjsModule = typeof import("pdfjs-dist");

// pdfjs-dist/tesseract.js beide dynamisch importiert (nicht top-level) —
// beide sind mehrere hundert KB und werden sonst in jeden Chunk gezogen, der
// ocr.js importiert, obwohl die meisten Ausgaben-Sessions nie scannen.
let pdfjsLibPromise: Promise<PdfjsModule> | null = null;
/** Lädt pdf.js einmalig und richtet den lokal gebündelten Worker ein. Auch für das Briefpapier (print/docAssets.ts). */
export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then(mod => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsLibPromise;
}

let ocrWorkerPromise: Promise<Worker> | null = null;
/** Lädt den Tesseract-Worker (Deutsch) einmalig; wird für alle Scans wiederverwendet. */
function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("deu", 1 /* OEM.LSTM_ONLY */, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang-data",
        cacheMethod: "none",
      })
    );
  }
  return ocrWorkerPromise;
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

/** Text der ersten PDF-Seite: Textlayer wenn vorhanden, sonst OCR auf gerenderter Seite. */
async function extractPdfText(dataUrl: string): Promise<string> {
  const pdfjsLib = await getPdfjs();
  const bytes = await dataUrlToBytes(dataUrl);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  // items.join(" ") würfelt alle Zeilen einer Rechnung in einen einzigen
  // String — parseVendor (zeilenbasiert) und parseAmount (Zeilen-Priorität
  // für "Total") brauchen echte Zeilenumbrüche. pdf.js liefert keine eigenen
  // Zeilenenden, aber transform[5] ist die Y-Position der Baseline —
  // ein Sprung darin heisst neue Zeile.
  let text = "";
  let lastY: number | null = null;
  for (const it of textContent.items) {
    // TextMarkedContent (Strukturmarker ohne Text) überspringen.
    if (!("str" in it)) continue;
    const y = it.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += "\n";
    else if (text) text += " ";
    text += it.str;
    if (y !== undefined) lastY = y;
  }
  if (text.trim().length > 20) return text;

  // Kein/kaum Textlayer (gescanntes PDF) — Seite rendern, OCR drüberlaufen lassen.
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas-Kontext nicht verfügbar");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas.toDataURL("image/png"));
  return data.text;
}

async function extractImageText(dataUrl: string): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(dataUrl);
  return data.text;
}

/**
 * Liest den Text eines Belegs (PDF oder Bild).
 * @param dataUrl Beleg als `data:`-URL, wie ihn der Datei-Upload in Expenses liefert.
 */
export async function extractReceiptText(dataUrl: string): Promise<string> {
  const isPdf = dataUrl.startsWith("data:application/pdf");
  return isPdf ? extractPdfText(dataUrl) : extractImageText(dataUrl);
}

// ─── Feld-Heuristiken ──────────────────────────────────────────

/** Betrag in CHF/EUR oder null. Siehe Kommentar im Körper zur Auswahlregel. */
function parseAmount(text: string): number | null {
  // Bevorzugt Beträge in Zeilen mit "Total"/"Endbetrag"/etc. — sonst den
  // grössten plausiblen Betrag im Text (meist die Gesamtsumme, da
  // Positionsbeträge i.d.R. kleiner sind als die Summe).
  const amountRe = /(\d{1,3}(?:[’',.]\d{3})*[.,]\d{2})(?!\d)/g;
  const priorityWords = /total|endbetrag|zu zahlen|rechnungsbetrag|gesamtbetrag|summe/i;

  let best: number | null = null;
  let bestPriority = false;
  for (const line of text.split(/\n/)) {
    const isPriority = priorityWords.test(line);
    let m: RegExpExecArray | null;
    amountRe.lastIndex = 0;
    while ((m = amountRe.exec(line))) {
      const val = parseFloat(m[1].replace(/[’',]/g, "").replace(",", "."));
      if (Number.isNaN(val) || val <= 0 || val > 999999) continue;
      if (isPriority && !bestPriority) { best = val; bestPriority = true; }
      else if (isPriority === bestPriority && (best === null || val > best)) best = val;
    }
  }
  return best;
}

/** Erstes plausibles Datum als ISO-String `YYYY-MM-DD` oder null. */
function parseDate(text: string): string | null {
  // DD.MM.YYYY / DD.MM.YY / DD/MM/YYYY — erstes plausibles Datum im Dokument.
  const re = /\b(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    if (y < 2000 || y > new Date().getFullYear() + 1) continue;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** MWST-Satz in Prozent (z.B. 8.1) oder null. */
function parseMwstRate(text: string): number | null {
  const m = text.match(/MWST\.?\s*(\d{1,2}[.,]\d)\s*%|(\d{1,2}[.,]\d)\s*%\s*MWST/i);
  if (!m) return null;
  return parseFloat((m[1] || m[2]).replace(",", "."));
}

/** Lieferantenname (Briefkopf-Heuristik) oder null. */
function parseVendor(text: string): string | null {
  // Erste halbwegs textige Zeile — meist der Firmenname im Briefkopf.
  for (const raw of text.split(/\n/).slice(0, 5)) {
    const line = raw.trim();
    if (!line || /^[\d\s.,\-–—]+$/.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    return line;
  }
  return null;
}

export interface ReceiptFields {
  amount: number | null;
  /** ISO `YYYY-MM-DD` */
  date: string | null;
  /** Prozent, z.B. 8.1 */
  mwstRate: number | null;
  vendor: string | null;
}

/** Zieht Betrag, Datum, MWST-Satz und Lieferant aus dem Belegtext. Nicht erkannte Felder sind null. */
export function parseReceiptFields(text: string): ReceiptFields {
  return {
    amount: parseAmount(text),
    date: parseDate(text),
    mwstRate: parseMwstRate(text),
    vendor: parseVendor(text),
  };
}
