// Gemeinsames der Einstellungs-Reiter (views/settings/): Abschnitt mit Titel, Props der Reiter,
// die den Entwurf `s` der Studio-Einstellungen bearbeiten (gespeichert wird in Settings.tsx).

import React from "react";
import type { Settings as StudioSettings } from "../../types";

/** Props der Reiter, die den gemeinsamen Entwurf bearbeiten; `setField` ändert ihn, «Speichern» übernimmt ihn. */
export interface DraftProps {
  s: StudioSettings;
  setField: (changes: Partial<StudioSettings>) => void;
}

/** Abschnitt mit kleiner Überschrift in Grossbuchstaben. */
export function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>{title}</div>
      {children}
    </div>
  );
}
