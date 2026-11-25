// Mehrzeiliger Freitext im Druck (Bemerkungen, Bestimmungen): jede Zeile ein eigener Block, damit paginate.ts
// zwischen den Zeilen umbrechen kann. Ein einzelner Block, höher als eine Seite, lief sonst über den unteren und
// oberen Seitenrand (Gegentest Runde 14: Vertrag mit langen «Weiteren Bestimmungen»).

import React from "react";

/**
 * Text mit Zeilenumbrüchen als Folge von Zeilen-Blöcken; Leerzeilen bleiben als Abstand. `lineStyle` gilt für jede
 * Zeile (z.B. Hintergrund/Randlinie einer Box: auf dem Container liefe beides beim Umbruch durch die Seitenränder).
 */
export function PrintText({ text, style, lineStyle }: { text: string; style?: React.CSSProperties; lineStyle?: React.CSSProperties }) {
  // sehr lange Absätze (ohne Zeilenumbruch) zusätzlich an Satzenden teilen — sonst wieder ein Block über die Seite
  // (ohne Lookbehind-Regex: ältere WebKit-Versionen kennen ihn nicht, der ganze Druck-Chunk würde nicht laden);
  // Notlösung ohne Satzzeichen: an einem Leerzeichen um 500 Zeichen
  const chunk = (l: string): string[] => {
    if (l.length <= 600) return [l];
    const cut = l.lastIndexOf(" ", 500);
    return cut > 100 ? [l.slice(0, cut), ...chunk(l.slice(cut + 1))] : [l];
  };
  const sentences = (l: string) => (l.match(/[^.!?;]+(?:[.!?;]+|$)\s*/g) || [l]).map(x => x.trim()).filter(Boolean);
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").flatMap(l => l.length > 600 ? sentences(l).flatMap(chunk) : [l]);
  return (
    <div style={style}>
      {lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", minHeight: "1em", ...lineStyle }}>{l || "\u00a0"}</div>)}
    </div>
  );
}
