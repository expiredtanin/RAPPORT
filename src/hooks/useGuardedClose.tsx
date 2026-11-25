// Schliessen per Esc / Klick neben den Dialog mit Rückfrage, sobald darin Text getippt (oder ein Datum gewählt)
// wurde. Gemeinsam für `Modal` (components/UI.tsx) und eigene Overlays (Pinnwand-Beitrag, Akonto-Plan).
// Esc kommt zentral aus App.tsx als Klick auf das oberste `.modal-overlay`.

import { useRef } from "react";
import type React from "react";
import { useConfirm } from "./useConfirm";

/**
 * `overlayProps` an das `.modal-overlay`, `watchProps` an den Dialog-Inhalt; `ConfirmModalEl` ins Overlay rendern.
 * `enabled = false`: ohne Rückfrage (Auswahl-/Assistenten-Dialoge).
 */
export function useGuardedClose(onClose: () => void, enabled = true) {
  const dirty = useRef(false);
  const { askConfirm, ConfirmModalEl } = useConfirm();
  // nur getippter Text zählt (Textfelder, Zahlen, Notizen, Editor, Datumsfeld) — Auswahl und Häkchen nicht
  const markDirty = (e: React.SyntheticEvent) => {
    if (!enabled) return;
    const t = e.target as HTMLElement;
    const type = (t as HTMLInputElement).type;
    if (t.tagName === "TEXTAREA" || t.isContentEditable || (t.tagName === "INPUT" && !["checkbox", "radio", "file", "range", "color", "button", "submit"].includes(type))) dirty.current = true;
  };
  const requestClose = async () => {
    if (dirty.current && !(await askConfirm("Ungespeicherte Eingaben verwerfen?", "Verwerfen"))) return;
    onClose();
  };
  return {
    ConfirmModalEl,
    overlayProps: { onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) void requestClose(); } },
    watchProps: { onChangeCapture: markDirty, onInputCapture: markDirty },
  };
}
