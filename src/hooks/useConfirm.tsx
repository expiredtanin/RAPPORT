// Bestätigungsdialog als Hook (eigene Datei, weil UI.tsx nur Komponenten exportieren soll — sonst kein Fast Refresh).

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,26,24,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 8, padding: "24px 28px", maxWidth: 400, width: "90%", fontFamily: "inherit", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)", marginBottom: 22 }}>{pending.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => { pending.resolve(false); setPending(null); }}>Abbrechen</button>
          <button className="btn btn-danger" onClick={() => { pending.resolve(true); setPending(null); }}>{pending.confirmLabel}</button>
        </div>
      </div>
    </div>
  ) : null;
  return { askConfirm, ConfirmModalEl };
}
