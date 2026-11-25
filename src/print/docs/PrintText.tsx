// Mehrzeiliger Freitext im Druck (Bemerkungen, Bestimmungen): jede Zeile ein eigener Block, damit paginate.ts
// zwischen den Zeilen umbrechen kann. Ein einzelner Block, höher als eine Seite, lief sonst über den unteren und
// oberen Seitenrand (Gegentest Runde 14: Vertrag mit langen «Weiteren Bestimmungen»).

import React from "react";
import { printLines } from "./printLines";

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
