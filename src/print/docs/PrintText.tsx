// Mehrzeiliger Freitext im Druck (Bemerkungen, Bestimmungen): jede Zeile ein eigener Block, damit paginate.ts
// zwischen den Zeilen umbrechen kann. Ein einzelner Block, höher als eine Seite, lief sonst über den unteren und
// oberen Seitenrand (Gegentest Runde 14: Vertrag mit langen «Weiteren Bestimmungen»).

import React from "react";

/** Zerlegt Freitext in druckbare Zeilen (siehe PrintText). */
export function printLines(text: string): string[] {
  // sehr lange Absätze (ohne Zeilenumbruch) zusätzlich an Satzenden teilen — sonst wieder ein Block über die Seite
  // (ohne Lookbehind-Regex: ältere WebKit-Versionen kennen ihn nicht, der ganze Druck-Chunk würde nicht laden);
  // Notlösung ohne Satzzeichen: an einem Leerzeichen um 500 Zeichen
  const chunk = (l: string): string[] => {
    if (l.length <= 600) return [l];
    const cut = l.lastIndexOf(" ", 500);
    return cut > 100 ? [l.slice(0, cut), ...chunk(l.slice(cut + 1))] : [l];
  };
  // Satzende = Satzzeichen + Leerraum (nicht «1.5 m», «z.B.», URLs); Trenner wieder anhängen, nichts geht verloren
  const sentences = (l: string) => {
    const parts = l.split(/([.!?;]+)\s+/);
    const out: string[] = [];
    for (let i = 0; i < parts.length; i += 2) out.push(parts[i] + (parts[i + 1] || ""));
    return out.filter(x => x.length);
  };
  return String(text).replace(/\r\n?/g, "\n").split("\n").flatMap(l => l.length > 600 ? sentences(l).flatMap(chunk) : [l]);
}

/**
 * Text mit Zeilenumbrüchen als Folge von Zeilen-Blöcken; Leerzeilen bleiben als Abstand. `lineStyle` gilt für jede
 * Zeile (z.B. Hintergrund/Randlinie einer Box: auf dem Container liefe beides beim Umbruch durch die Seitenränder).
 */
export function PrintText({ text, style, lineStyle }: { text: string; style?: React.CSSProperties; lineStyle?: React.CSSProperties }) {
  const lines = printLines(text);
  return (
    <div style={style}>
      {lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", minHeight: "1em", ...lineStyle,
        // Innenabstand oben/unten einer Box (lineStyle mit Hintergrund) nur an der ersten bzw. letzten Zeile
        ...(lineStyle?.background ? { paddingTop: i === 0 ? 12 : 0, paddingBottom: i === lines.length - 1 ? 12 : 0 } : {}) }}>{l || "\u00a0"}</div>)}
    </div>
  );
}
