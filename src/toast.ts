// Kurze Meldungen unten in der Mitte («Rechnung gelöscht · Rückgängig»), angezeigt von components/Toaster.tsx.
//
// Modul-Speicher statt Context (Single-Root-State bleibt in App.tsx): Views rufen `showToast()` direkt auf,
// der Toaster abonniert die Liste. Eine Meldung verschwindet nach `timeout` ms oder per Klick.

/** Eine Meldung mit optionaler Handlung (z.B. «Rückgängig»). */
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  timeout: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach(l => l(toasts));

/** Zeigt eine Meldung; liefert die id (zum vorzeitigen Schliessen). Höchstens drei gleichzeitig. */
export function showToast(text: string, opts: { action?: Toast["action"]; timeout?: number } = {}): number {
  const t: Toast = { id: nextId++, text, action: opts.action, timeout: opts.timeout ?? (opts.action ? 8000 : 4000) };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => dismissToast(t.id), t.timeout);
  return t.id;
}

/** Schliesst eine Meldung. */
export function dismissToast(id: number): void {
  if (!toasts.some(t => t.id === id)) return;
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

/** Abonniert die Liste der offenen Meldungen; Rückgabe meldet ab. */
export function subscribeToasts(fn: (t: Toast[]) => void): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => { listeners.delete(fn); };
}
