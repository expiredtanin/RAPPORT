// Dokument-Design: Schriften, Farben und eigenes CSS für alle Druckansichten.
//
// Die Druckvorlagen (PrintComponents.tsx) verwenden keine festen Schriften/Farben,
// sondern CSS-Variablen, die `buildDocCss()` am Element `.print-page` setzt:
//   --doc-font-heading  Titel, Dokumentnummern, Totale     (Standard Playfair Display)
//   --doc-font-body     Fliesstext                         (Standard DM Mono)
//   --doc-font-plain    Protokoll (bewusst nüchtern)       (Standard Inter, sonst = body)
//   --doc-font-logo     Studioname, wenn kein Logo-Bild    (Standard Inter, sonst = heading)
//   --doc-ink           Textfarbe                          (Standard #1a1a18)
//   --doc-accent        Titel und kräftige Linien           (Standard = Textfarbe)
// Ohne `settings.docDesign` sieht jedes Dokument genau so aus wie vor dem Design-Feature.
//
// Schriften sind CSS-Familiennamen. Mitgeliefert sind Google Fonts (werden nur bei
// Bedarf per @import geladen, brauchen also Internet) und macOS-Systemschriften;
// hochgeladene Schriften liegen als Data-URL in `data.docAssets` und funktionieren offline.
//
// Der QR-Zahlteil ist ausgenommen: seine Schrift (Arial) ist von der Norm vorgegeben
// und wird hier gegen eigenes CSS abgesichert.

import type { DocAsset, DocDesign, Settings } from "../types";

/** Eine wählbare Schrift. `google` = Familien-Spezifikation für die Google-Fonts-CSS2-API. */
export interface DocFont {
  family: string;
  stack: string;
  group: "Google Fonts" | "Systemschriften (macOS)";
  google?: string;
}

export const DOC_FONTS: DocFont[] = [
  { family: "Playfair Display", stack: "'Playfair Display', serif", group: "Google Fonts", google: "Playfair+Display:ital,wght@0,400;0,700;1,400" },
  { family: "DM Mono", stack: "'DM Mono', monospace", group: "Google Fonts", google: "DM+Mono:wght@300;400;500" },
  { family: "Inter", stack: "'Inter', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "Inter:wght@400;500;600;700" },
  { family: "DM Sans", stack: "'DM Sans', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "DM+Sans:ital,wght@0,400;0,500;0,700;1,400" },
  { family: "IBM Plex Sans", stack: "'IBM Plex Sans', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400" },
  { family: "IBM Plex Mono", stack: "'IBM Plex Mono', monospace", group: "Google Fonts", google: "IBM+Plex+Mono:wght@400;500;600" },
  { family: "Space Grotesk", stack: "'Space Grotesk', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "Space+Grotesk:wght@400;500;700" },
  { family: "Work Sans", stack: "'Work Sans', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "Work+Sans:ital,wght@0,400;0,500;0,600;1,400" },
  { family: "Jost", stack: "'Jost', Futura, sans-serif", group: "Google Fonts", google: "Jost:ital,wght@0,400;0,500;0,600;1,400" },
  { family: "Archivo", stack: "'Archivo', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "Archivo:ital,wght@0,400;0,500;0,700;1,400" },
  { family: "Libre Franklin", stack: "'Libre Franklin', Helvetica, Arial, sans-serif", group: "Google Fonts", google: "Libre+Franklin:ital,wght@0,400;0,500;0,700;1,400" },
  { family: "EB Garamond", stack: "'EB Garamond', Garamond, serif", group: "Google Fonts", google: "EB+Garamond:ital,wght@0,400;0,600;1,400" },
  { family: "Cormorant Garamond", stack: "'Cormorant Garamond', Garamond, serif", group: "Google Fonts", google: "Cormorant+Garamond:ital,wght@0,400;0,600;1,400" },
  { family: "Source Serif 4", stack: "'Source Serif 4', Georgia, serif", group: "Google Fonts", google: "Source+Serif+4:ital,wght@0,400;0,600;1,400" },
  { family: "Helvetica Neue", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif", group: "Systemschriften (macOS)" },
  { family: "Avenir Next", stack: "'Avenir Next', Avenir, 'Helvetica Neue', sans-serif", group: "Systemschriften (macOS)" },
  { family: "Futura", stack: "Futura, 'Century Gothic', sans-serif", group: "Systemschriften (macOS)" },
  { family: "Gill Sans", stack: "'Gill Sans', 'Gill Sans MT', sans-serif", group: "Systemschriften (macOS)" },
  { family: "Optima", stack: "Optima, Candara, sans-serif", group: "Systemschriften (macOS)" },
  { family: "Baskerville", stack: "Baskerville, 'Baskerville Old Face', Georgia, serif", group: "Systemschriften (macOS)" },
  { family: "Didot", stack: "Didot, 'Bodoni 72', Georgia, serif", group: "Systemschriften (macOS)" },
  { family: "Georgia", stack: "Georgia, serif", group: "Systemschriften (macOS)" },
  { family: "Times New Roman", stack: "'Times New Roman', Times, serif", group: "Systemschriften (macOS)" },
  { family: "Menlo", stack: "Menlo, 'Courier New', monospace", group: "Systemschriften (macOS)" },
];

/** Standardwerte, wenn `settings.docDesign` ein Feld nicht setzt (= Aussehen vor dem Design-Feature). */
export const DEFAULT_DOC_DESIGN = {
  headingFont: "Playfair Display",
  bodyFont: "DM Mono",
  plainFont: "Inter",
  inkColor: "#1a1a18",
};

/** Entfernt Zeichen, die aus einem Familiennamen in CSS ausbrechen könnten. */
export function cleanFamilyName(name: string): string {
  return name.replace(/["'`;{}<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** CSS-Font-Stack für eine Familie: mitgeliefert → definierter Stack, hochgeladen → Name + generischer Rückfall. */
export function fontStack(family: string): string {
  const known = DOC_FONTS.find(f => f.family === family);
  if (known) return known.stack;
  return `"${cleanFamilyName(family)}", sans-serif`;
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

/** Aufgelöstes Design: jedes Feld gesetzt, Briefpapier nur, wenn wirklich ein Bild vorhanden ist. */
export interface ResolvedDocDesign {
  heading: string;
  body: string;
  ink: string;
  accent: string;
  letterheadFirst: string | null;
  letterheadFollow: string | null;
  hideSender: boolean;
  /** mm; Folgeseiten */
  followTop: number;
  followBottom: number;
  customCss: string;
  design: DocDesign;
}

/** Fasst Einstellungen und hochgeladene Dateien zu einem vollständigen Design zusammen. */
export function resolveDocDesign(settings: Settings, assets: DocAsset[] | undefined): ResolvedDocDesign {
  const d: DocDesign = settings.docDesign || {};
  const ink = isColor(d.inkColor) ? d.inkColor : DEFAULT_DOC_DESIGN.inkColor;
  const lhOn = !!d.letterhead;
  const first = lhOn ? (assets || []).find(a => a.kind === "letterheadFirst")?.data || null : null;
  const follow = lhOn ? (assets || []).find(a => a.kind === "letterheadFollow")?.data || null : null;
  return {
    heading: d.headingFont || DEFAULT_DOC_DESIGN.headingFont,
    body: d.bodyFont || DEFAULT_DOC_DESIGN.bodyFont,
    ink,
    accent: isColor(d.accentColor) ? d.accentColor : ink,
    letterheadFirst: first,
    letterheadFollow: follow,
    hideSender: (first || follow) ? d.letterheadHideSender !== false : false,
    followTop: d.followMarginTop ?? settings.pageMarginTop ?? 20,
    followBottom: d.followMarginBottom ?? settings.pageMarginBottom ?? 20,
    customCss: d.customCss || "",
    design: d,
  };
}

/** @font-face der hochgeladenen Schriften. Eigene Funktion, weil die Data-URLs gross sind und nur von `assets` abhängen. */
export function buildFontFaces(assets: DocAsset[] | undefined): string {
  return (assets || [])
    .filter(a => a.kind === "font" && a.family && a.data.startsWith("data:"))
    .map(a => `@font-face { font-family: "${cleanFamilyName(a.family as string)}"; src: url("${a.data}"); font-weight: ${a.weight || 400}; font-style: ${a.style === "italic" ? "italic" : "normal"}; font-display: block; }`)
    .join("\n");
}

/**
 * CSS für die Druckansicht: Google-Fonts-Imports (nur für gewählte Schriften),
 * die `--doc-*`-Variablen und das eigene CSS (die @font-face dazu: `buildFontFaces`).
 * `scope` legt das eigene CSS in `@scope (…)` — für die Vorschau in den Einstellungen,
 * damit es nicht auf die App-Oberfläche wirkt (die Druckansicht ist exklusiv und braucht das nicht).
 * @returns `imports` gehören in ein eigenes <style> (müssen am Anfang eines Stylesheets stehen), `css` in ein zweites.
 */
export function buildDocCss(r: ResolvedDocDesign, scope?: string): { imports: string; css: string } {
  const d = r.design;
  const google = [...new Set([r.heading, r.body])]
    .map(f => DOC_FONTS.find(x => x.family === f)?.google)
    .filter(Boolean)
    .map(spec => `@import url('https://fonts.googleapis.com/css2?family=${spec}&display=swap');`);

  const plain = d.bodyFont ? fontStack(r.body) : fontStack(DEFAULT_DOC_DESIGN.plainFont);
  const logo = d.headingFont ? fontStack(r.heading) : "'Inter', sans-serif";
  const vars = `.print-page {
  --doc-font-heading: ${fontStack(r.heading)};
  --doc-font-body: ${fontStack(r.body)};
  --doc-font-plain: ${plain};
  --doc-font-logo: ${logo};
  --doc-ink: ${r.ink};
  --doc-accent: ${r.accent};
}
.qr-bill-wrapper svg, .qr-bill-wrapper svg * { font-family: Arial, Helvetica, sans-serif !important; }`;

  const custom = r.customCss.trim() ? (scope ? `@scope (${scope}) {\n${r.customCss}\n}` : r.customCss) : "";
  return { imports: google.join("\n"), css: [vars, custom].filter(Boolean).join("\n") };
}
