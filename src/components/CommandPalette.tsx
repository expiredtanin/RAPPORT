// Befehlspalette (⌘K / Ctrl+K): springen zu Ansichten und Datensätzen, häufige Aktionen auslösen.
// Suche und Einträge in commandPalette.ts; was ein Treffer tut, übergibt App.tsx als `onRun`.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData } from "../types";
import type { NavItem } from "../constants";
import { buildPaletteEntries, searchPalette, type PaletteTarget } from "../commandPalette";

/** Palette als Overlay; schliesst mit Escape, Klick daneben oder nach Auswahl. */
export default function CommandPalette({ data, navItems, onRun, onClose }: {
  data: AppData;
  navItems: NavItem[];
  onRun: (target: PaletteTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => buildPaletteEntries(data, navItems), [data, navItems]);
  const results = useMemo(() => searchPalette(entries, query), [entries, query]);
  const sel = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (i: number) => { const r = results[i]; if (!r) return; onClose(); onRun(r.target); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(sel + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(sel - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(sel); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div className="palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Befehlspalette" onKeyDown={onKeyDown}>
        <div className="palette-search">
          <span className="msr" style={{ fontSize: 20, color: "var(--text4)" }}>search</span>
          <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Suchen oder Befehl, z. B. Projekt, Rechnung, Kontakt oder «Neue Offerte»" aria-label="Suchen" />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="palette-empty">Nichts gefunden für «{query}»</div>}
          {results.map((r, i) => {
            const head = i === 0 || results[i - 1].group !== r.group ? r.group : null;
            return (
              <div key={r.key}>
                {head && <div className="palette-group">{head}</div>}
                <button data-idx={i} role="option" aria-selected={i === sel} className={`palette-item${i === sel ? " active" : ""}`}
                  onMouseMove={() => { if (i !== sel) setActive(i); }} onClick={() => run(i)}>
                  <span className="msr" style={{ fontSize: 18 }}>{r.icon}</span>
                  <span className="palette-label">{r.label}</span>
                  {r.hint && <span className="palette-hint">{r.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> auswählen</span><span><kbd>↩</kbd> öffnen</span><span><kbd>⌘K</kbd> jederzeit</span></div>
      </div>
    </div>
  );
}
