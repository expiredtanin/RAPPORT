// Bestätigungsdialog als Hook (eigene Datei, weil UI.tsx nur Komponenten exportieren soll — sonst kein Fast Refresh).
// Escape/Klick daneben = Abbrechen, Enter = bestätigen (Fokus liegt auf dem Bestätigen-Knopf).
// Für einfaches Löschen lieber `removeWithUndo` (undo.ts): löscht sofort und bietet «Rückgängig» an.

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Bestätigungsdialog als Hook. `await askConfirm("Wirklich löschen?")` liefert
 * true/false; `ConfirmModalEl` muss einmal im JSX der aufrufenden View stehen.
 */
export function useConfirm() {
  const [pending, setPending] = useState<{ msg: ReactNode; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null);
  const askConfirm = (msg: ReactNode, confirmLabel = "Löschen") =>
    new Promise<boolean>(resolve => setPending({ msg, confirmLabel, resolve }));
  const ConfirmModalEl = pending ? (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={e => { if (e.target === e.currentTarget) { pending.resolve(false); setPending(null); } }}>
      <div className="modal" role="alertdialog" aria-modal="true" style={{ maxWidth: 420, padding: "24px 26px" }}>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text)", marginBottom: 22 }}>{pending.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => { pending.resolve(false); setPending(null); }}>Abbrechen</button>
          <button className="btn btn-danger" autoFocus onClick={() => { pending.resolve(true); setPending(null); }}>{pending.confirmLabel}</button>
        </div>
      </div>
    </div>
  ) : null;
  return { askConfirm, ConfirmModalEl };
}
