// Live-Vorschau eines Dokuments (Rechnung, Offerte) in der rechten Spalte eines Editor-Dialogs (Modal `preview`).
// Misst die verfügbare Breite und zeichnet das Blatt mit DocPreview (gleiche Vorlage und Gestaltung wie das PDF).

import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { DocPreview } from "../print/PrintComponents";

type Content = NonNullable<ComponentProps<typeof DocPreview>["content"]>;

/** Skaliert das A4-Blatt auf die Spaltenbreite (max. 620 px) und zeigt darunter einen Hinweis. */
export default function LivePreview({ settings, assets, content }: Pick<ComponentProps<typeof DocPreview>, "settings" | "assets"> & { content: Content }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, Math.min(620, el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", maxWidth: 620 }}>
      <DocPreview settings={settings} assets={assets} width={w} content={content} />
      <div style={{ fontSize: 11.5, color: "var(--text4)", marginTop: 10, textAlign: "center" }}>Vorschau des PDFs mit dem aktuellen Stand (Seitenumbrüche erst im Druck)</div>
    </div>
  );
}
