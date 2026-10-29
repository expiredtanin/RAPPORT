// Hochgeladene Dateien für das Dokument-Design (`data.docAssets`): Schriften und Briefpapier.
//
// Alles wird als Data-URL gespeichert (gleiches Muster wie settings.logo und die
// Spesenbelege). Lokal liegt das im selben localStorage-Eintrag wie alle anderen
// Daten (~5 MB); deshalb prüft `checkLocalBudget()` (utils.ts) vor jedem Hinzufügen,
// ob noch Platz ist. In der Cloud liegt jede Datei als eigener Datensatz (Collection
// docAssets) und das Limit entfällt.
//
// Briefpapier aus einem PDF wird beim Hochladen einmal mit pdf.js gerastert (Seite 1 =
// erste Seite, Seite 2 = Folgeseiten), als JPEG oder PNG — je nachdem, was kleiner ist.

import { getPdfjs } from "../ocr";
import { cleanFamilyName } from "./docDesign";
import { readAsDataUrl } from "../utils";
import type { DocAsset } from "../types";

/** Obergrenze pro Datei im Cloud-Modus (PocketBase-Feld erlaubt 15 Mio. Zeichen). */
export const CLOUD_ASSET_LIMIT = 12_000_000;

/** Grösse in Zeichen, wie sie im Speicher landet. */
export const assetSize = (a: Pick<DocAsset, "data">) => a.data.length;

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300],
  [/medium/i, 500], [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800],
  [/black|heavy/i, 900], [/bold/i, 700],
];

/** Schnitt aus dem Dateinamen erraten («Brand-SemiBoldItalic.woff2» → Brand, 600, italic). */
export function guessFontFace(fileName: string): { family: string; weight: number; style: "normal" | "italic" } {
  const base = fileName.replace(/\.(woff2?|otf|ttf)$/i, "");
  const style = /italic|oblique/i.test(base) ? "italic" : "normal";
  const weight = WEIGHTS.find(([re]) => re.test(base))?.[1] ?? 400;
  const family = base
    .replace(/[-_ ]?(thin|hairline|extra.?light|ultra.?light|light|regular|book|normal|medium|semi.?bold|demi.?bold|extra.?bold|ultra.?bold|bold|black|heavy|italic|oblique|roman|webfont|variable|vf)+$/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return { family: cleanFamilyName(family) || cleanFamilyName(base) || "Eigene Schrift", weight, style };
}

/** Erlaubte Schriftdateien. */
export const FONT_ACCEPT = ".woff2,.woff,.otf,.ttf";

/** Schriftdatei → DocAsset (ohne id). Wirft bei falschem Format. */
export async function fontAssetFromFile(file: File): Promise<Omit<DocAsset, "id">> {
  if (!/\.(woff2?|otf|ttf)$/i.test(file.name)) throw new Error("Bitte eine Schriftdatei wählen (.woff2, .woff, .otf oder .ttf).");
  const face = guessFontFace(file.name);
  let data = await readAsDataUrl(file);
  // Browser liefern für Schriften oft application/octet-stream — korrekten Typ setzen, damit @font-face sie annimmt
  const ext = file.name.split(".").pop()!.toLowerCase();
  const mime = { woff2: "font/woff2", woff: "font/woff", otf: "font/otf", ttf: "font/ttf" }[ext] || "font/woff2";
  data = data.replace(/^data:[^;,]*/, `data:${mime}`);
  return { kind: "font", name: file.name, family: face.family, weight: face.weight, style: face.style, data };
}

/** Erlaubte Briefpapier-Dateien. */
export const LETTERHEAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.svg,application/pdf,image/png,image/jpeg,image/svg+xml";

function canvasToSmallest(canvas: HTMLCanvasElement): string {
  const jpg = canvas.toDataURL("image/jpeg", 0.9);
  const png = canvas.toDataURL("image/png");
  return png.length < jpg.length ? png : jpg;
}

/** Ergebnis eines Briefpapier-Uploads: 1–2 Seiten als Bild, plus Hinweis, falls das Format nicht A4 hoch ist. */
export interface LetterheadPages { pages: string[]; warning: string | null }

/**
 * Briefpapier-Datei → Bilder. PDF: Seite 1 und (falls vorhanden) Seite 2 werden mit `dpi`
 * gerastert. Bilder werden übernommen; sehr grosse Rasterbilder auf `dpi` verkleinert. SVG bleibt Vektor.
 */
export async function letterheadFromFile(file: File, dpi: number): Promise<LetterheadPages> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const a4 = (w: number, h: number) => Math.abs(w / h - 210 / 297) < 0.02;
  const notA4 = "Die Datei ist nicht im Format A4 hoch — sie wird auf die Seite gestreckt.";

  if (isPdf) {
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    let warning: string | null = null;
    for (let n = 1; n <= Math.min(2, pdf.numPages); n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: dpi / 72 });
      if (!a4(vp.width, vp.height)) warning = notA4;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent «print»: Druckdarstellung, und rendert ohne requestAnimationFrame (läuft auch in einem Hintergrundfenster)
      await page.render({ canvasContext: ctx, viewport: vp, canvas, intent: "print" }).promise;
      pages.push(canvasToSmallest(canvas));
    }
    return { pages, warning };
  }

  if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|svg)$/i.test(file.name)) {
    throw new Error("Bitte ein PDF, PNG, JPG oder SVG wählen.");
  }
  const data = await readAsDataUrl(file);
  const img = new Image();
  img.src = data;
  await img.decode().catch(() => { throw new Error("Das Bild konnte nicht gelesen werden."); });
  const warning = img.naturalWidth && img.naturalHeight && !a4(img.naturalWidth, img.naturalHeight) ? notA4 : null;
  const isSvg = /svg/.test(file.type) || /\.svg$/i.test(file.name);
  const maxW = Math.round(210 / 25.4 * dpi);
  if (isSvg || img.naturalWidth <= maxW * 1.1) return { pages: [data], warning };
  const canvas = document.createElement("canvas");
  canvas.width = maxW;
  canvas.height = Math.round(img.naturalHeight * maxW / img.naturalWidth);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { pages: [canvasToSmallest(canvas)], warning };
}
