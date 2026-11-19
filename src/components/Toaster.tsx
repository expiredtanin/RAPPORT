// Zeigt die Meldungen aus toast.ts (unten in der Mitte, über allem). Einmal in App.tsx eingebunden.

import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast } from "../toast";

/** Meldungsstapel; Handlung (z.B. «Rückgängig») schliesst die Meldung. */
export default function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  if (list.length === 0) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && <button className="toast-action" onClick={() => { t.action?.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="toast-close" aria-label="Schliessen" onClick={() => dismissToast(t.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
        </div>
      ))}
    </div>
  );
}
