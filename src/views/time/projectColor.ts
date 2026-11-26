// Zeiterfassung: stabile, gedämpfte Projektfarbe aus der Projekt-Id (Wochen- und Tagesansicht).

/** Acht gedämpfte Farbtöne (Grad im HSL-Kreis): Kupfer, Petrol, Oliv, Pflaume, Schiefer, Ocker, Salbei, Ziegel. */
const HUES = [28, 195, 95, 310, 220, 45, 160, 8];

/** Farbe eines Projekts: `solid` für Randstreifen/Akzent, `tint` als Blockhintergrund, `text` für Beschriftung. */
export interface ProjectColor { solid: string; tint: string; text: string }

/**
 * Stabile Projektfarbe: dieselbe Id ergibt immer dieselbe Farbe. `solid` ist ein gedämpfter Ton
 * (Sättigung ~30 %, Helligkeit ~55 %), `tint` mischt ihn per `color-mix` in `var(--surface)` und passt sich
 * damit Hell/Dunkel automatisch an; `text` ist `var(--text)`. `dark` hellt `solid` leicht auf.
 */
export function projectColor(projectIdIn: string | null | undefined, dark = false): ProjectColor {
  // ohne Projekt (in der Cloud nach Löschen des Projekts null) neutral — vorher stürzte die Zeiterfassung ab (Runde 35)
  const projectId = projectIdIn || "";
  let h = 2166136261;
  for (let i = 0; i < projectId.length; i++) { h ^= projectId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const idx = (h >>> 0) % HUES.length;
  const sat = 25 + (((h >>> 8) & 0xff) % 11); // 25–35 %
  const solid = `hsl(${HUES[idx]}, ${sat}%, ${dark ? 62 : 55}%)`;
  return { solid, tint: `color-mix(in srgb, ${solid} 22%, var(--surface))`, text: "var(--text)" };
}
