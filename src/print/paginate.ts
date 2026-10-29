// Seitenumbruch für die Druckansicht: sorgt dafür, dass auf jeder A4-Seite oben und
// unten der eingestellte Rand frei bleibt (auf Folgeseiten auch für ein Briefpapier).
//
// Warum selbst gemacht: Die Druckansicht läuft mit `@page { margin: 0 }`, damit ein
// Briefpapier randlos auf jeder Seite liegen kann. WebKit (Tauri auf macOS) schneidet
// den Inhalt beim Drucken dann einfach alle 297 mm ab: Folgeseiten hätten keinen
// oberen Rand, und `position: fixed` / `box-decoration-break` werden im Druck nicht
// pro Seite wiederholt (beides mit WKWebView + NSPrintOperation geprüft).
//
// Vorgehen: Der Inhalt wird am Bildschirm in genau der Druckbreite (210 mm) gesetzt.
// Wir zerlegen ihn in «Atome» (Tabellenzeilen, Textblöcke, Flex-/Grid-Blöcke), messen
// jedes und schieben eines, das in einen Randbereich ragen würde, mit einem leeren
// Abstandselement (`[data-doc-spacer]`) auf die nächste Seite. Weil WebKit
// Tabellenköpfe nicht wiederholt und genau alle 297 mm trennt, stimmt die Messung am
// Bildschirm mit dem Druck überein.
//
// Kleine Atome direkt vor einer Tabelle (Abschnittstitel), Tabellenköpfe und Elemente
// mit `break-after: avoid` bleiben mit dem Folgenden zusammen. Ein erzwungener Umbruch
// (`.qr-bill-newpage`, der QR-Zahlteil) beginnt exakt am Seitenanfang.

/** Geometrie in Millimetern. */
export interface PageGeometry {
  /** Unterer Rand der ersten Seite (der obere ist das Padding des Blatts). */
  firstBottom: number;
  followTop: number;
  followBottom: number;
}

/** Ergebnis: Anzahl Seiten, und (falls vorhanden) die Seite (0-basiert), auf der der QR-Zahlteil beginnt. */
export interface PageResult {
  pages: number;
  qrPage: number | null;
}

const MM = 96 / 25.4;
export const PAGE_HEIGHT_MM = 297;

interface Atom { el: Element; glueToNext: boolean; forceNewPage: boolean }

const BLOCKISH = new Set(["block", "flex", "grid", "table", "list-item", "flow-root"]);

function isSkipped(el: Element, cs: CSSStyleDeclaration) {
  return el.hasAttribute("data-doc-spacer") || cs.display === "none" || cs.position === "absolute" || cs.position === "fixed"
    || el.tagName === "STYLE" || el.tagName === "SCRIPT";
}

function hasBlockChildren(el: Element) {
  for (const c of Array.from(el.children)) {
    const cs = getComputedStyle(c);
    if (!isSkipped(c, cs) && BLOCKISH.has(cs.display)) return true;
  }
  return false;
}

function avoids(v: string) { return v === "avoid" || v === "avoid-page"; }

/** Zerlegt `root` in Atome (Dokumentreihenfolge). `maxH` = höchstes Atom, das noch ganz auf eine Seite passt (px). */
function collect(root: Element, out: Atom[], maxH: number) {
  for (const el of Array.from(root.children)) {
    const cs = getComputedStyle(el);
    if (isSkipped(el, cs)) continue;
    const forceNewPage = el.classList.contains("qr-bill-newpage");
    if (cs.display === "table" && !forceNewPage) {
      // Abschnittstitel direkt vor einer Tabelle nicht allein am Seitenende stehen lassen
      const prev = out[out.length - 1];
      if (prev && prev.el === el.previousElementSibling && prev.el.getBoundingClientRect().height < 40) prev.glueToNext = true;
      for (const row of Array.from((el as HTMLTableElement).rows)) {
        const rcs = getComputedStyle(row);
        if (isSkipped(row, rcs)) continue;
        const inHead = row.parentElement?.tagName === "THEAD";
        out.push({ el: row, glueToNext: inHead || avoids(rcs.breakAfter) || avoids(rcs.pageBreakAfter), forceNewPage: false });
      }
      continue;
    }
    const tall = el.getBoundingClientRect().height > maxH;
    const keepTogether = avoids(cs.breakInside) || avoids(cs.pageBreakInside);
    if (!forceNewPage && (cs.display === "block" || cs.display === "flow-root" || cs.display === "list-item")
      && hasBlockChildren(el) && (!keepTogether || tall)) {
      collect(el, out, maxH);
      continue;
    }
    out.push({ el, glueToNext: avoids(cs.breakAfter) || avoids(cs.pageBreakAfter), forceNewPage });
  }
}

/** Entfernt alle Abstandselemente eines früheren Durchlaufs. */
export function clearPagination(content: Element) {
  content.querySelectorAll("[data-doc-spacer]").forEach(n => n.remove());
}

function makeSpacer(before: Element, heightPx: number) {
  if (before.tagName === "TR") {
    const tr = document.createElement("tr");
    tr.setAttribute("data-doc-spacer", "");
    const td = document.createElement("td");
    td.colSpan = 999;
    td.style.cssText = `height:${heightPx}px;padding:0;border:none;background:none`;
    tr.appendChild(td);
    before.parentElement!.insertBefore(tr, before);
  } else {
    const div = document.createElement("div");
    div.setAttribute("data-doc-spacer", "");
    div.style.cssText = `height:${heightPx}px;margin:0;padding:0;border:none;flex:none`;
    before.parentElement!.insertBefore(div, before);
  }
}

/**
 * Verteilt den Inhalt von `content` auf A4-Seiten, gemessen ab der Oberkante von `sheet`
 * (= Seitenanfang). Muss nach jedem Neu-Rendern des Inhalts erneut laufen; räumt die
 * eigenen Abstände vorher selbst weg.
 */
export function paginate(sheet: HTMLElement, content: HTMLElement, geo: PageGeometry): PageResult {
  clearPagination(content);
  // Skalierung (z.B. transform in der Vorschau): gemessene px → CSS-px
  const rect = sheet.getBoundingClientRect();
  const scale = sheet.offsetWidth ? rect.width / sheet.offsetWidth : 1;
  const pageH = PAGE_HEIGHT_MM * MM;
  const firstBottom = geo.firstBottom * MM, followTop = geo.followTop * MM, followBottom = geo.followBottom * MM;
  const topLimit = (k: number) => k * pageH + (k === 0 ? 0 : followTop);
  const bottomLimit = (k: number) => (k + 1) * pageH - (k === 0 ? firstBottom : followBottom);
  const usable = pageH - followTop - followBottom;

  const atoms: Atom[] = [];
  collect(content, atoms, usable * scale);

  const pos = (el: Element) => {
    const r = el.getBoundingClientRect();
    const top = sheet.getBoundingClientRect().top;
    return { t: (r.top - top) / scale, b: (r.bottom - top) / scale };
  };

  let qrPage: number | null = null;
  let lastMovedIndex = -1;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const { t, b } = pos(a.el);
    const k = Math.floor(t / pageH);

    if (a.forceNewPage) {
      // Seitenanfang ohne Rand (der QR-Zahlteil bringt seine eigenen Ränder mit)
      const target = (t <= k * pageH + 0.5) ? k * pageH : (k + 1) * pageH;
      if (target - t > 0.5) makeSpacer(a.el, target - t);
      if (a.el.classList.contains("qr-bill-newpage")) qrPage = Math.round(target / pageH);
      lastMovedIndex = i;
      continue;
    }
    if (a.el.querySelector(".qr-bill-wrapper") || a.el.classList.contains("qr-bill-wrapper")) {
      // QR-Zahlteil ohne eigene Seite: nicht zerschneiden, sonst unverändert
      if (b > (k + 1) * pageH && b - t <= pageH) { makeSpacer(a.el, (k + 1) * pageH - t); qrPage = k + 1; }
      lastMovedIndex = i;
      continue;
    }

    if (k >= 1 && t < topLimit(k) - 0.5) {
      makeSpacer(a.el, topLimit(k) - t);
      lastMovedIndex = i;
      continue;
    }
    if (b > bottomLimit(k) + 0.5 && b - t <= usable) {
      // Zusammengehörige Vorgänger mitnehmen (Titel + erste Zeile, Tabellenkopf + Zeile)
      let j = i;
      while (j - 1 > lastMovedIndex && atoms[j - 1].glueToNext) {
        const pt = pos(atoms[j - 1].el).t;
        if (Math.floor(pt / pageH) !== k || b - pt > usable) break;
        j--;
      }
      const tj = j === i ? t : pos(atoms[j].el).t;
      // Die Atome j..i liegen danach am Anfang der nächsten Seite; weiter mit i+1.
      makeSpacer(atoms[j].el, topLimit(k + 1) - tj);
      lastMovedIndex = i;
    }
  }

  const end = pos(content).b;
  const pages = Math.max(1, Math.ceil((end - 0.5) / pageH));
  return { pages, qrPage };
}
