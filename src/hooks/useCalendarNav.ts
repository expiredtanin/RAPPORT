// Zustand für Kalender-Dropdowns (offen/zu, Klick ausserhalb schliesst).

import { useEffect, useRef, useState } from "react";

/** Zustand für ein Kalender-Dropdown: offen/zu, plus `ref` für «Klick ausserhalb schliesst». */
export function useCalendarNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return { open, setOpen, ref };
}
