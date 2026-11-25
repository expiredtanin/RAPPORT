// Mehrzeiliger Freitext im Druck (Bemerkungen, Bestimmungen): jede Zeile ein eigener Block, damit paginate.ts
// zwischen den Zeilen umbrechen kann. Ein einzelner Block, höher als eine Seite, lief sonst über den unteren und
// oberen Seitenrand (Gegentest Runde 14: Vertrag mit langen «Weiteren Bestimmungen»).

import React from "react";

/** Text mit Zeilenumbrüchen als Folge von Zeilen-Blöcken; Leerzeilen bleiben als Abstand. */
export function PrintText({ text, style }: { text: string; style?: React.CSSProperties }) {
  // sehr lange Absätze (ohne Zeilenumbruch) zusätzlich an Satzenden teilen — sonst wieder ein Block über die Seite
  // (Notlösung ohne Satzzeichen: an einem Leerzeichen um 500 Zeichen)
  const chunk = (l: string): string[] => {
    if (l.length <= 600) return [l];
    const cut = l.lastIndexOf(" ", 500);
    return cut > 100 ? [l.slice(0, cut), ...chunk(l.slice(cut + 1))] : [l];
  };
  const lines = String(text).split("\n").flatMap(l => l.length > 600 ? l.split(/(?<=[.!?;])\s+/).flatMap(chunk) : [l]);
  return (
    <div style={style}>
      {lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", minHeight: "1em" }}>{l || " "}</div>)}
    </div>
  );
}
