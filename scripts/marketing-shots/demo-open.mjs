// Öffnet Rapport mit den Demo-Daten in einem sichtbaren Browserfenster.
//
//   npm run dev                                  # Vite auf :3000 muss laufen
//   node scripts/marketing-shots/demo-open.mjs
//
// Eigenes Browser-Profil unter /tmp, Demo-Daten per addInitScript. Die echten
// Daten in der Tauri-App und im eigenen Browser werden nicht angefasst —
// darum NICHT `npx tauri dev` dafür benutzen: dessen Webview teilt den
// localStorage mit der installierten App und würde studio_data_v1
// überschreiben.
//
// Fenster schliessen beendet das Skript.
import { chromium } from "playwright";
import { demoData, initScript, report } from "./demo-data.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROFILE = join(tmpdir(), "rapport-demo-profile");

report();
console.log(`\nProfil: ${PROFILE}`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: null,
  args: ["--window-size=1680,1050"],
});
await ctx.addInitScript(initScript, demoData);
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(process.env.DEMO_URL || "http://localhost:3000/", { waitUntil: "domcontentloaded" });
console.log("Fenster offen — Schliessen beendet das Skript.");

await new Promise(resolve => ctx.on("close", resolve));
console.log("Beendet.");
