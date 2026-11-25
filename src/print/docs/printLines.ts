// Zerlegung von Freitext in druckbare Zeilen für PrintText.tsx (eigene Datei: Komponenten-Dateien exportieren
// nur Komponenten, sonst bricht Fast Refresh).

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
