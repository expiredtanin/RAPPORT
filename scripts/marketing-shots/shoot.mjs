// Erzeugt die Marketing-Screenshots für rapport.gabrielevarano.ch.
//
//   npm run dev            # Vite auf :3000 muss laufen
//   node scripts/marketing-shots/shoot.mjs
//
// Läuft gegen den Dev-Server in einem frischen Browser-Profil mit fiktiven
// Demo-Daten (addInitScript) — die echten Daten im Browser/in der App werden
// nicht angefasst.
//
// NUR die Feature-Seiten brauchen noch Bilder. Die Kette "Der Weg eines
// Projekts" auf der Startseite ist seit der Vereinheitlichung durchgehend
// HTML (siehe README, Abschnitt "Nicht alles ist ein Bild").
//
// Fallstricke, die hier bewusst umgangen werden:
//  · waitUntil "networkidle" läuft in den Timeout (Vite-HMR-WebSocket bleibt offen)
//  · feste Pixel-Clips schneiden UI-Elemente an -> Crops über DOM-Bounding-Boxes
//  · Elemente ausserhalb des Viewports -> locator.screenshot() scrollt selbst
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { demoData, initScript, report, E_JULIAN } from "./demo-data.mjs";

const OUT = "/Users/karim/PROJECTS/RAPPORT-WEBSITE/static/images/screenshots";
mkdirSync(OUT, { recursive: true });
report();
console.log("");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 });
await page.addInitScript(initScript, demoData);
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Übersicht", { timeout: 20000 });
await page.waitForTimeout(700);

const navBtn = (t) => page.locator("button.nav-btn", { hasText: t }).first();

async function boxOfTexts(texts, { pad = 0, padTop = null, padBottom = null, padLeft = null, padRight = null } = {}) {
  const box = await page.evaluate((texts) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, found = 0;
    for (const t of texts) {
      // strong/b/a bewusst mit drin: Nummern stehen in <strong> innerhalb der Zelle
      const el = [...document.querySelectorAll("div,span,td,th,strong,b,a")]
        .filter(e => e.textContent.includes(t) && e.children.length === 0).pop();
      if (!el) continue;
      let node = el;
      for (let i = 0; i < 4 && node.parentElement; i++) {
        if (getComputedStyle(node).position === "absolute") break;
        node = node.parentElement;
      }
      const r = node.getBoundingClientRect();
      if (!r.width) continue;
      found++;
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    return found ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
  }, texts);
  if (!box) throw new Error("nicht gefunden: " + texts.join(" | "));
  const pl = padLeft ?? pad, pr = padRight ?? pad, pt = padTop ?? pad, pb = padBottom ?? pad;
  return {
    x: Math.max(0, Math.round(box.x - pl)), y: Math.max(0, Math.round(box.y - pt)),
    width: Math.round(box.width + pl + pr), height: Math.round(box.height + pt + pb),
  };
}

async function clipShot(name, clip) {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`  ✓ ${name}.png  ${clip.width}×${clip.height}`);
}

/** Gruppierung ausschalten, damit alle Zeilen in einer Tabelle stehen. */
async function ungroup() {
  const btn = page.getByRole("button", { name: "Keine", exact: true }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(500); }
}

// ═══ features/projekte.md ══════════════════════════════════════════════
console.log("Projekt-Detail");
await navBtn("Projekte").click();
await page.waitForTimeout(600);
await page.getByText("Sanierung Verwaltungsgebäude Limmatfeld", { exact: false }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/projekt-detail.png` });
console.log("  ✓ projekt-detail.png");

// ═══ features/zeiterfassung.md ═════════════════════════════════════════
console.log("Zeiterfassung");
await navBtn("Zeiterfassung").click();
await page.waitForTimeout(600);
const empSel = page.locator("select").first();
if (await empSel.count()) await empSel.selectOption({ value: E_JULIAN });
await page.waitForTimeout(700);
await clipShot("zeiterfassung", await boxOfTexts(
  ["Baustellenbegehung Fenstermontage", "Bautagebuch und Fotodokumentation"],
  { padLeft: 56, padRight: 300, padTop: 150, padBottom: 120 },
));

// ═══ features/rechnungen.md ════════════════════════════════════════════
console.log("Rechnungen");
await navBtn("Buchhaltung").click();
await page.waitForTimeout(300);
await navBtn("Rechnungen").click();
await page.waitForTimeout(800);
await ungroup();
await page.screenshot({ path: `${OUT}/rechnungen.png` });
console.log("  ✓ rechnungen.png");

// QR-Einzahlungsschein (Detail für die Feature-Seite)
await page.getByRole("button", { name: "PDF", exact: true }).first().click();
await page.waitForSelector(".qr-bill-wrapper svg", { timeout: 15000 });
await page.waitForTimeout(900);
await page.locator(".qr-bill-wrapper").screenshot({ path: `${OUT}/chain-qr-detail.png` });
console.log("  ✓ chain-qr-detail.png");

await browser.close();
console.log("\nFertig →", OUT);
