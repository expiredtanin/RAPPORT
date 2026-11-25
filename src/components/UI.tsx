// Gemeinsame UI-Bausteine (Badges, Modal, Formularfelder, Datumsfelder, Rich-Text-Editor, …).
//
// Wird von fast allen Views verwendet. Stil: Inline-Styles plus die globalen
// Klassen aus App.jsx (.btn, .card, .modal, …) und CSS-Variablen für Dark Mode.
// Die Datumsfelder (DateInput/DatePicker) rufen `onChange` mit einem Objekt der
// Form `{ target: { value: "YYYY-MM-DD" } }` auf, damit sie wie ein normales
// <input> in bestehende Handler passen. Farben von Kalender und Bestätigungs-
// dialog sind bewusst fest (hell), unabhängig vom Theme.

import React, { useState, useEffect, useRef } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { STATUS_COLORS, STATUS_BG, statusVar } from "../constants";
import type { Settings } from "../types";
import { localISODate, sanitizeHtml } from "../utils";

/** Rückgabe der Datumsfelder: ein Mini-Event, das wie bei <input> `e.target.value` liefert. */
export type DateChangeEvent = { target: { value: string } };

/**
 * Farben eines Status als CSS-Werte. Die Variablen `--st-c-*`/`--st-bg-*` (Light und
 * Dark) erzeugt App.tsx aus constants.ts; die Hex-Werte sind nur Rückfall für unbekannte Status.
 */
function statusStyle(status: string) {
  const key = statusVar(status);
  return {
    color: `var(--st-c-${key}, ${STATUS_COLORS[status] || "#888"})`,
    bg: `var(--st-bg-${key}, ${STATUS_BG[status] || "var(--surface2)"})`,
    border: `color-mix(in srgb, var(--st-c-${key}, ${STATUS_COLORS[status] || "#888"}) 25%, transparent)`,
  };
}

/** Farbige Status-Pille. Farben kommen aus STATUS_COLORS/STATUS_BG; unbekannter Status wird grau. */
/** @param label Anzeigetext, falls er vom Status-Schlüssel abweichen soll (z.B. «Offerte» statt `offerte`). */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { color, bg, border } = statusStyle(status);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px 2px 8px", borderRadius: 999,
      fontSize: 11.5, fontWeight: 550, whiteSpace: "nowrap",
      color, background: bg, border: `1px solid ${border}`,
    }}><span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />{label ?? status}</span>
  );
}

/**
 * Dropdown im Stil der StatusBadge. Klick stoppt die Weitergabe, damit es in klickbaren Zeilen funktioniert.
 * Mindestbreite nach der längsten Option, damit enge Tabellenspalten den Text nicht abschneiden.
 */
export function StatusSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  const { color, bg, border } = statusStyle(value);
  const longest = Math.max(value.length, ...options.map(o => o.length));
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      aria-label="Status"
      style={{
        fontSize: 11.5, height: 26, padding: "0 24px 0 10px", width: "auto", minWidth: `calc(${longest}ch + 36px)`, flexShrink: 0,
        background: bg, color, border: `1px solid ${border}`, backgroundImage: "none",
        fontWeight: 550, borderRadius: 999, cursor: "pointer", boxShadow: "none",
        fontFamily: "inherit", appearance: "auto",
      }}
    >
      {options.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/**
 * Seitenkopf als weisses Band über die ganze Breite (wie der Projekt-Arbeitsraum): optional eine Zeile darüber
 * (`crumb`), Titel mit Aktionen rechts, eine Beschreibung (`sub`) und Reiter (`tabs`, z.B. `<PageTabs>`).
 * Die Ränder kommen aus `--pad-x`/`--pad-top` der `.main-content` (global.css), damit das Band bündig anschliesst.
 */
export function Header({ title, action, crumb, sub, tabs }: { title: ReactNode; action?: ReactNode; crumb?: ReactNode; sub?: ReactNode; tabs?: ReactNode }) {
  return (
    <header className={`page-head${tabs ? " has-tabs" : ""}`} data-tauri-drag-region>
      {crumb && <div className="page-crumb">{crumb}</div>}
      <div className="page-head-row" data-tauri-drag-region>
        <h1 data-tauri-drag-region>{title}</h1>
        {action && <div className="page-actions">{action}</div>}
      </div>
      {sub && <div className="page-sub">{sub}</div>}
      {/* Platz für die Bereichs-Reiter (Buchhaltung, Dokumente), die App.tsx per Portal einsetzt */}
      <div className="page-section-slot" />
      {tabs && <div className="page-tabs">{tabs}</div>}
    </header>
  );
}

/** Reiter im Seitenkopf (unterstrichen wie im Projekt-Arbeitsraum). `count` erscheint als kleine Zahl. */
export function PageTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <nav className="ws-tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "on" : ""} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className="ws-count">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** Sortierzustand einer Tabelle: Spalte und Richtung (1 = aufsteigend, -1 = absteigend). */
export type SortState = { col: string; dir: number };

/** Sortierbarer Tabellenkopf: Klick ruft `onSort(col)`, der Pfeil zeigt die aktive Spalte und Richtung. */
export function SortTh({ col, sort, onSort, children, style, className }: {
  col: string; sort: SortState; onSort: (col: string) => void;
  children?: ReactNode; style?: CSSProperties; className?: string;
}) {
  const active = sort.col === col;
  return (
    <th className={className} onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...style }}>
      {children} <span style={{ color: active ? "var(--accent)" : "var(--text5)", fontSize: 10 }}>{active ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}</span>
    </th>
  );
}

/** Beschriftetes Formularfeld (`label` + Eingabe als children). */
// FIXME(karim): Aufrufer übergeben teils `style` (z.B. flex: 3), das hier bisher ignoriert wird.
// Prop wird nur akzeptiert, damit TypeScript nicht abbricht; Layout-Verhalten bewusst unverändert.
export function FormField({ label, children }: { label: ReactNode; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

// hideFooter: für Aufrufer, die bereits einen eigenen kompletten Footer in
// children rendern (z.B. weil die Speichern-Aktion async ist und einen
// eigenen disabled-Zustand braucht) — ohne das würde zusätzlich zum eigenen
// Footer noch der Standard-Footer mit einem funktionslosen "Speichern"-Button
// (onSave === undefined) erscheinen.
export interface ModalProps {
  title?: ReactNode;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  hideSave?: boolean;
  hideFooter?: boolean;
  children?: ReactNode;
  /** breiterer Dialog (760px) */
  wide?: boolean;
  /** Inhalt darf überstehen (z.B. Kalender-Popup); der Inhalt scrollt dann nicht separat */
  overflow?: boolean;
  /** als Schublade von rechts statt mittig (Formulare zu Listeneinträgen: die Liste bleibt sichtbar) */
  drawer?: boolean;
  /** Live-Vorschau rechts neben dem Formular (z.B. PDF einer Rechnung); ein-/ausblendbar */
  preview?: ReactNode;
  /** links im Fuss, z.B. Summe oder Hinweis */
  footerStart?: ReactNode;
  /** Speichern-Knopf (und Enter) gesperrt, z.B. solange eine Pflichtwahl fehlt */
  saveDisabled?: boolean;
  /** Fensterbreite in px, ab der die Vorschau beim Öffnen sichtbar ist (Standard 1200) */
  previewFrom?: number;
}

/**
 * Dialog mit festem Kopf (Titel, Schliessen) und Fuss (Abbrechen/Speichern); nur der Inhalt scrollt.
 * Klick auf den Hintergrund oder Escape schliesst ihn (Escape für alle `.modal-overlay` zentral in App.tsx,
 * immer nur der oberste). Enter in einem einzeiligen Feld oder ⌘↩ speichert. Mit `preview` wird der Dialog
 * zum Editor mit Vorschau rechts (ab 1200 px Fensterbreite sichtbar, sonst per Knopf «Vorschau»).
 */
export function Modal({ title, onClose, onSave, saveLabel, hideSave, hideFooter, children, wide, overflow, drawer, preview, footerStart, saveDisabled, previewFrom = 1200 }: ModalProps) {
  const [showPreview, setShowPreview] = useState(() => typeof window === "undefined" || window.innerWidth >= previewFrom);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !onSave || hideSave || hideFooter || saveDisabled || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    const singleLine = t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "file"].includes((t as HTMLInputElement).type);
    if (e.metaKey || e.ctrlKey || (singleLine && !e.shiftKey)) { e.preventDefault(); onSave(); }
  };
  const withPreview = !!preview && showPreview;
  const cls = ["modal", "modal-x", drawer && "drawer", wide && "wide", withPreview && "has-preview", overflow && "allow-overflow"].filter(Boolean).join(" ");
  return (
    <div className={`modal-overlay${drawer ? " drawer-overlay" : ""}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={cls} role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
        <div className="modal-main">
          <div className="modal-head">
            {title ? <h2>{title}</h2> : <span />}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {preview && (
                <button className={`btn btn-quiet btn-sm${showPreview ? " on" : ""}`} onClick={() => setShowPreview(v => !v)} title="Vorschau ein-/ausblenden">
                  <span className="msr" style={{ fontSize: 17 }}>{showPreview ? "visibility_off" : "visibility"}</span>Vorschau
                </button>
              )}
              <button className="btn-icon" onClick={onClose} aria-label="Schliessen" title="Schliessen (esc)"><span className="msr">close</span></button>
            </div>
          </div>
          <div className="modal-body">{children}</div>
          {!hideFooter && (
            <div className="modal-foot">
              <div style={{ flex: 1, minWidth: 0 }}>{footerStart}</div>
              <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
              {!hideSave && <button className="btn btn-primary" onClick={onSave} disabled={saveDisabled}>{saveLabel || "Speichern"}</button>}
            </div>
          )}
        </div>
        {withPreview && <aside className="modal-preview" aria-label="Vorschau">{preview}</aside>}
      </div>
    </div>
  );
}

// Gemeinsame KPI-Kachel (Label + grosser Wert + optionale Sub-Zeile). Seit Beta 26.11 ohne farbigen
// Rand: `color` färbt nur noch einen Punkt vor dem Label (Bedeutung), der Wert bleibt in Textfarbe. War vorher in mehreren Views (Dashboard, Accounting, Invoices,
// Expenses, Projects) leicht unterschiedlich neu implementiert (fontSize 20/22/24,
// verschiedene marginBottom-Werte, teils hartkodierte statt Theme-Farben) —
// dadurch wirkten die Kacheln je nach Seite uneinheitlich. `go`/`setView` optional
// für klickbare Kacheln (siehe Dashboard).
export function KpiCard({ label, value, sub, color, go, setView }: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  /** Ziel-View; zusammen mit setView wird die Kachel klickbar */
  go?: string;
  setView?: (view: string) => void;
}) {
  return (
    <div className={`card kpi${go && setView ? " kpi-link" : ""}`}
      onClick={go && setView ? () => setView(go) : undefined}
      role={go && setView ? "button" : undefined} tabIndex={go && setView ? 0 : undefined}
      onKeyDown={go && setView ? e => { if (e.key === "Enter") setView(go); } : undefined}
    >
      <div className="kpi-label">{color && <span className="kpi-dot" style={{ background: color }} />}{label}</div>
      {/* «CHF 120'569.34»: nach «CHF» darf umbrechen (formatCHF setzt ein geschütztes Leerzeichen) */}
      <div className="kpi-value">{typeof value === "string" ? value.replace(/^CHF\u00a0/, "CHF ") : value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Ersetzt die frühere "PDF"/"CSV"-Textbutton-Reihe: ein Icon-Button mit
// Share-Symbol. Bei genau einer Option verhält er sich wie ein normaler
// Button (ein Klick löst sie direkt aus) — erst ab zwei Optionen öffnet sich
// ein Dropdown zur Formatwahl (z.B. PDF vs. CSV in Accounting.jsx).
export function ShareButton({ options, className = "btn btn-ghost", style, title = "Exportieren" }: {
  /** falsy-Einträge werden ignoriert (praktisch für bedingte Optionen) */
  options?: (({ label: string; onClick: (e: React.MouseEvent) => void }) | null | undefined | false)[];
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const opts = (options || []).filter((o): o is { label: string; onClick: (e: React.MouseEvent) => void } => !!o);
  if (opts.length === 0) return null;

  if (opts.length === 1) {
    return (
      <button className={className} style={style} title={opts[0].label} onClick={opts[0].onClick}>
        <span className="msr" style={{ fontSize: 16, verticalAlign: "middle" }}>ios_share</span>
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className={className} style={style} title={title} onClick={() => setOpen(o => !o)}>
        <span className="msr" style={{ fontSize: 16, verticalAlign: "middle" }}>ios_share</span>
      </button>
      {open && (
        <div className="menu-pop" style={{ right: 0 }}>
          {opts.map(o => (
            <button key={o.label} className="menu-item" onClick={(ev) => { setOpen(false); o.onClick(ev); }}>{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Studio-Logo (Bild) oder, ohne Logo, der Studioname in kursiver Schrift. */
export function StudioLogo({ settings, size = 24 }: { settings: Pick<Settings, "logo" | "logoSize" | "name">; size?: number }) {
  if (settings.logo) {
    const h = settings.logoSize || 60;
    return <img src={settings.logo} alt={settings.name} style={{ maxHeight: h, maxWidth: h * 5, display: "block" }} />;
  }
  // `--doc-font-logo` setzt nur die Druckansicht (print/docDesign.ts); sonst gilt Inter
  return <div style={{ fontFamily: "var(--doc-font-logo, var(--font-ui))", fontSize: size, fontWeight: 400, fontStyle: "italic", letterSpacing: "-0.01em" }}>{settings.name}</div>;
}

/**
 * Textfeld für Datumseingabe im Format TT.MM.JJJJ (Punkte werden automatisch
 * gesetzt). `value` und das Ergebnis von `onChange` sind ISO `YYYY-MM-DD`;
 * onChange feuert erst bei einem vollständigen, gültigen Datum.
 */
export function DateInput({ value, onChange, style, ...props }: {
  value?: string;
  onChange: (e: DateChangeEvent) => void;
  style?: CSSProperties;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "style">) {
  const toDE = (iso?: string) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  };
  const toISO = (de: string) => {
    const m = de.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return null;
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    // Round-Trip: «31.02.2027» rollt sonst auf den 3.3. weiter und wurde als «2027-02-31» gespeichert
    const d = new Date(`${iso}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && +m[3] >= 1900 && +m[3] <= 2100 ? iso : null;
  };
  const [text, setText] = React.useState(() => toDE(value));
  // Neuer Wert von aussen: Text direkt beim Rendern nachziehen (statt per Effekt, spart einen Render)
  const [prevValue, setPrevValue] = React.useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (toDE(value) !== text) setText(toDE(value));
  }
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    const fmt = digits.length <= 2 ? digits
      : digits.length <= 4 ? `${digits.slice(0, 2)}.${digits.slice(2)}`
      : `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    setText(fmt);
    const iso = toISO(fmt);
    if (iso) onChange({ target: { value: iso } });
  };
  return (
    <input
      type="text"
      value={text}
      onChange={handleChange}
      onBlur={() => { if (!toISO(text) && value) setText(toDE(value)); }}
      placeholder="TT.MM.JJJJ"
      style={style}
      {...props}
    />
  );
}

// Toolbar-Button des RichEditors. `s` = Zusatz-Styles (fett/kursiv/…). Früher wurde hier fälschlich `style` gelesen,
// wodurch B/I/U und die Padding-Werte nie angewendet wurden (beim Umstellen auf TS behoben).
function ToolbarButton({ exec, cmd, val, title, s, children }: { exec: (cmd: string, val?: string) => void; cmd: string; val?: string; title: string; s?: CSSProperties; children?: ReactNode }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); exec(cmd, val); }}
      title={title}
      style={{
        padding: "0 9px", height: 30, borderRadius: 4,
        border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
        background: "transparent", color: "var(--text3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.1s",
        ...s,
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--border2)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >{children}</button>
  );
}

function ToolbarSep() {
  return <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 3px", flexShrink: 0 }} />;
}

/**
 * Einfacher Rich-Text-Editor (fett/kursiv/unterstrichen, Ausrichtung, Grösse,
 * Farbe) auf Basis von contentEditable und `document.execCommand`. `value` und
 * `onChange` sind HTML. Gespeichertes HTML vor dem Anzeigen mit `sanitizeHtml`
 * (utils) bereinigen. Fügt nur Klartext ein (Paste wird bereinigt).
 */
export function RichEditor({ value, onChange, minHeight = 420, compact = false }: {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  compact?: boolean;
}) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const isInternalChange = React.useRef(false);
  const lastValue = React.useRef(value);
  const savedRange = React.useRef<Range | null>(null);
  const colorInputRef = React.useRef<HTMLInputElement>(null);
  const [colorValue, setColorValue] = React.useState("#000000");

  // Beim Einhängen den vorhandenen Text ins DOM schreiben. Ohne das blieb der Editor leer, sobald er
  // mit einem schon gefüllten `value` startet (z.B. gespeichertes Protokoll öffnen); der Effekt
  // darunter greift nur bei späteren Änderungen von aussen.
  React.useLayoutEffect(() => {
    // Gespeichertes HTML stammt evtl. von anderen (Cloud, Datenordner, Import) → nur bereinigt einsetzen (kein onerror & Co.)
    if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only push content into DOM when value changes from outside (template load)
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastValue.current && !isInternalChange.current) {
      editorRef.current.innerHTML = sanitizeHtml(value);
      lastValue.current = value;
    }
    isInternalChange.current = false;
  }, [value]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.anchorNode && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    if (!savedRange.current) {
      // Place cursor at end if no saved range
      const range = document.createRange();
      range.selectNodeContents(editorRef.current as Node);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      return;
    }
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
  };

  const exec = (cmd: string, val: string | undefined = undefined) => {
    restoreSelection();
    document.execCommand(cmd, false, val);
    saveSelection();
    // Sync content after command
    isInternalChange.current = true;
    const html = editorRef.current?.innerHTML || "";
    lastValue.current = html;
    onChange(html);
  };


  return (
    // `compact`: Leiste und Rahmen erscheinen erst beim Schreiben (CSS .rich-compact in styles/global.css),
    // damit viele Editoren untereinander (Protokollpositionen) wie Text wirken und nicht wie ein Formular.
    <div className={compact ? "rich-editor rich-compact" : "rich-editor"} style={{ border: "1.5px solid var(--input-border)", borderRadius: 8, overflow: "hidden" }}>
      <div className="rich-toolbar" style={{ display: "flex", alignItems: "center", gap: 1, padding: "5px 8px", borderBottom: "1px solid var(--border2)", background: "var(--surface2)" }}>
        <ToolbarButton exec={exec} cmd="bold" title="Fett (Ctrl+B)" s={{ fontWeight: 700, minWidth: 28 }}>B</ToolbarButton>
        <ToolbarButton exec={exec} cmd="italic" title="Kursiv (Ctrl+I)" s={{ fontStyle: "italic", minWidth: 28 }}>I</ToolbarButton>
        <ToolbarButton exec={exec} cmd="underline" title="Unterstrichen (Ctrl+U)" s={{ textDecoration: "underline", minWidth: 28 }}>U</ToolbarButton>
        <ToolbarSep />

        <ToolbarButton exec={exec} cmd="justifyLeft" title="Linksbündig" s={{ padding: "0 7px" }}>
          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
            <rect x="0" y="0" width="14" height="1.5" rx="0.75"/>
            <rect x="0" y="3.5" width="9" height="1.5" rx="0.75"/>
            <rect x="0" y="7" width="14" height="1.5" rx="0.75"/>
            <rect x="0" y="10.5" width="11" height="1.5" rx="0.75"/>
          </svg>
        </ToolbarButton>
        <ToolbarButton exec={exec} cmd="justifyCenter" title="Zentriert" s={{ padding: "0 7px" }}>
          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
            <rect x="0" y="0" width="14" height="1.5" rx="0.75"/>
            <rect x="2.5" y="3.5" width="9" height="1.5" rx="0.75"/>
            <rect x="0" y="7" width="14" height="1.5" rx="0.75"/>
            <rect x="1.5" y="10.5" width="11" height="1.5" rx="0.75"/>
          </svg>
        </ToolbarButton>
        <ToolbarButton exec={exec} cmd="justifyRight" title="Rechtsbündig" s={{ padding: "0 7px" }}>
          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
            <rect x="0" y="0" width="14" height="1.5" rx="0.75"/>
            <rect x="5" y="3.5" width="9" height="1.5" rx="0.75"/>
            <rect x="0" y="7" width="14" height="1.5" rx="0.75"/>
            <rect x="3" y="10.5" width="11" height="1.5" rx="0.75"/>
          </svg>
        </ToolbarButton>
        <ToolbarSep />

        {/* Font size */}
        <select
          onMouseDown={saveSelection}
          onChange={e => { exec("fontSize", e.target.value); e.target.value = ""; }}
          title="Schriftgrösse"
          style={{
            width: 80, height: 26, border: "1px solid var(--border2)", borderRadius: 4,
            background: "transparent", color: "var(--text3)", fontSize: 11,
            padding: "0 4px", cursor: "pointer", outline: "none",
          }}
        >
          <option value="">Grösse</option>
          <option value="1">Klein</option>
          <option value="3">Normal</option>
          <option value="5">Gross</option>
          <option value="7">Titel</option>
        </select>

        <ToolbarSep />

        {/* Color */}
        <button
          onMouseDown={e => { e.preventDefault(); saveSelection(); colorInputRef.current?.click(); }}
          title="Textfarbe"
          style={{
            padding: "0 8px", height: 30, borderRadius: 4, border: "none",
            cursor: "pointer", background: "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 2, transition: "background 0.1s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--border2)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", lineHeight: 1 }}>A</span>
          <div style={{ width: 14, height: 3, borderRadius: 1, background: colorValue }} />
        </button>
        <input
          ref={colorInputRef}
          type="color"
          value={colorValue}
          onChange={e => { setColorValue(e.target.value); exec("foreColor", e.target.value); }}
          style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
        />
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        className="rich-edit"
        contentEditable
        suppressContentEditableWarning
        onInput={() => {
          isInternalChange.current = true;
          const html = editorRef.current?.innerHTML || "";
          lastValue.current = html;
          onChange(html);
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={saveSelection}
        onPaste={e => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          restoreSelection();
          document.execCommand("insertText", false, text);
          saveSelection();
        }}
        style={{
          minHeight, padding: compact ? "8px 10px" : "20px 24px", outline: "none",
          fontSize: compact ? 12 : 13, lineHeight: 1.8, color: "var(--text)",
          background: "var(--surface)",
          fontFamily: "var(--font-ui)",
        }}
      />
    </div>
  );
}

/**
 * Monatskalender als Popup (absolut positioniert unter dem übergeordneten,
 * `position: relative` Element). `value`/`onChange` sind ISO-Daten; "" = gelöscht.
 */
export function CalendarPopup({ value, onChange, onClose, align = "left", showClear = true }: {
  value?: string;
  onChange: (isoDate: string) => void;
  onClose: () => void;
  align?: "left" | "right";
  showClear?: boolean;
}) {
  const [viewYM, setViewYM] = useState(() => {
    const d = value ? new Date(value + "T00:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const todayStr = localISODate();
  const { year, month } = viewYM;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  const prevMonth = () => { const d = new Date(year, month - 1, 1); setViewYM({ year: d.getFullYear(), month: d.getMonth() }); };
  const nextMonth = () => { const d = new Date(year, month + 1, 1); setViewYM({ year: d.getFullYear(), month: d.getMonth() }); };
  const select = (ds: string) => { onChange(ds); onClose(); };

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        [align === "right" ? "right" : "left"]: 0,
        zIndex: 2000,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
        width: 232,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button onMouseDown={e => { e.preventDefault(); prevMonth(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 8px", fontSize: 14, color: "var(--text4)", lineHeight: 1 }}>←</button>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text)" }}>
          {firstDay.toLocaleDateString("de-CH", { month: "long", year: "numeric" })}
        </div>
        <button onMouseDown={e => { e.preventDefault(); nextMonth(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 8px", fontSize: 14, color: "var(--text4)", lineHeight: 1 }}>→</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 3 }}>
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: "var(--text5)", padding: "2px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} />;
          const dow = new Date(ds + "T00:00:00").getDay();
          const isWeekend = dow === 0 || dow === 6;
          const isSelected = ds === value;
          const isToday = ds === todayStr;
          return (
            <button key={ds}
              onMouseDown={e => { e.preventDefault(); select(ds); }}
              style={{
                aspectRatio: "1", fontSize: 11, cursor: "pointer",
                fontFamily: "inherit", borderRadius: 4,
                border: isToday && !isSelected ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                background: isSelected ? "var(--text)" : "transparent",
                color: isSelected ? "var(--bg)" : isWeekend ? "var(--text5)" : "var(--text)",
                fontWeight: isToday && !isSelected ? 600 : 400,
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg2)"; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              {new Date(ds + "T00:00:00").getDate()}
            </button>
          );
        })}
      </div>
      {showClear && value && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border2)", textAlign: "center" }}>
          <button onMouseDown={e => { e.preventDefault(); onChange(""); onClose(); }}
            style={{ fontSize: 10, color: "var(--text4)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            Datum löschen
          </button>
        </div>
      )}
    </div>
  );
}

/** Schreibgeschütztes Datumsfeld, das beim Klick den Kalender (CalendarPopup) öffnet. Wie DateInput: ISO-Wert, `DateChangeEvent`. */
export function DatePicker({ value, onChange, style, placeholder, align = "left", ...props }: {
  value?: string;
  onChange: (e: DateChangeEvent) => void;
  style?: CSSProperties;
  placeholder?: string;
  align?: "left" | "right";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "style" | "placeholder">) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toDE = (iso?: string) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <input
        type="text"
        value={toDE(value)}
        readOnly
        onClick={() => setOpen(o => !o)}
        placeholder={placeholder || "TT.MM.JJJJ"}
        style={{ cursor: "pointer", ...style }}
        {...props}
      />
      {open && (
        <CalendarPopup
          value={value}
          onChange={ds => onChange({ target: { value: ds } })}
          onClose={() => setOpen(false)}
          align={align}
        />
      )}
    </div>
  );
}

/** Zwei Pfeile (‹ ›) zum Blättern, z.B. Wochen/Monate. `disabledNext` sperrt den Vorwärts-Pfeil (z.B. aktuelle Woche). */
export function NavArrows({ onPrev, onNext, disabledNext = false }: { onPrev: () => void; onNext: () => void; disabledNext?: boolean }) {
  const btn = (onClick: () => void, disabled: boolean, children: ReactNode) => (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        background: "none", border: "none", padding: "0 11px", height: 30,
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--border2)" : "var(--text3)",
        fontSize: 17, lineHeight: 1, display: "flex", alignItems: "center",
        fontFamily: "inherit", flexShrink: 0,
      }}
    >{children}</button>
  );
  return (
    <div style={{ display: "flex", border: "1px solid var(--border3)", borderRadius: "var(--r-ctl)", overflow: "hidden", background: "var(--surface)" }}>
      {btn(onPrev, false, <span className="msr" style={{ fontSize: 18 }} aria-label="Zurück">chevron_left</span>)}
      <div style={{ width: 1, background: "var(--border2)", alignSelf: "stretch" }} />
      {btn(onNext, disabledNext, <span className="msr" style={{ fontSize: 18 }} aria-label="Weiter">chevron_right</span>)}
    </div>
  );
}

/** Eintrag im Zeilenmenü. `danger` = rot (Löschen), `hidden` blendet ihn aus. */
export interface RowMenuItem { label: string; icon?: string; onClick: () => void; danger?: boolean; hidden?: boolean }

/**
 * «⋯»-Menü am Zeilenende (Bearbeiten, Exportieren, Löschen …). Ersetzt die Reihe sichtbarer Knöpfe pro Zeile:
 * die Zeile selbst öffnet per Klick, seltene Aktionen liegen im Menü. Klicks gehen nicht an die Zeile weiter.
 */
/** geschätzte Breite eines Aktionsmenüs (für die Öffnungsrichtung) */
const MENU_EST_W = 260;

export function RowMenu({ items, label = "Aktionen" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc, true); };
  }, [open]);
  // Menü fest am Fenster ausgerichtet (position: fixed): die Karte (overflow) schnitt es sonst ab, z.B. bei der
  // letzten Zeile einer kurzen Tabelle. Rechtsbündig unter dem Knopf; fehlt links Platz → linksbündig, fehlt unten
  // Platz → über dem Knopf. Beim Scrollen schliesst es (Position wäre veraltet).
  const [pos, setPos] = useState<CSSProperties>({});
  const toggle = (btn: HTMLElement) => {
    if (!open) {
      const r = btn.getBoundingClientRect();
      // Darstellungs-Zoom (Einstellungen, `zoom` auf .main-content/.sched-full): fixe Koordinaten im gezoomten
      // Bereich werden nochmals skaliert → Fensterkoordinaten durch den Zoom teilen
      let z = 1;
      for (let el: HTMLElement | null = btn; el; el = el.parentElement) { const v = parseFloat(el.style.zoom || ""); if (v > 0) z *= v; }
      const br = { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z };
      const W = window.innerWidth / z, H = window.innerHeight / z;
      const need = items.filter(i => !i.hidden).length * 36 + 16;
      const horiz: CSSProperties = br.right - MENU_EST_W < 4 ? { left: br.left } : { right: W - br.right };
      const vert: CSSProperties = br.bottom + 4 + need > H && br.top - 4 - need >= 0
        ? { top: "auto", bottom: H - br.top + 4 } : { top: br.bottom + 4 };
      setPos({ position: "fixed", ...horiz, ...vert });
    }
    setOpen(o => !o);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const visible = items.filter(i => !i.hidden);
  if (visible.length === 0) return null;
  return (
    <div ref={ref} className="row-menu" onClick={e => e.stopPropagation()}>
      <button className="btn-icon" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={e => toggle(e.currentTarget)}>
        <span className="msr" style={{ fontSize: 20 }}>more_horiz</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu" style={pos}>
          {visible.map((it, i) => (
            <button key={i} role="menuitem" className={`menu-item${it.danger ? " danger" : ""}`} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <span className="msr" style={{ fontSize: 17 }}>{it.icon}</span>}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Leerer Zustand einer Liste: Symbol, ein Satz Erklärung und die naheliegende Handlung. */
export function EmptyState({ icon = "inbox", title, text, action }: { icon?: string; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="msr empty-ico">{icon}</span>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/**
 * Kopfzeile einer Liste: links Anzahl/Summe, rechts der Umschalter «Gruppieren».
 * `detached`: steht direkt über einer `.card` mit Tabelle und verbindet sich mit ihr (Kopf der Karte).
 */
export function TableToolbar<T extends string>({ summary, groups, value, onChange, detached }: {
  summary: ReactNode;
  groups?: { id: T; label: string }[];
  value?: T;
  onChange?: (v: T) => void;
  detached?: boolean;
}) {
  return (
    <div className={`table-toolbar${detached ? " detached" : ""}`}>
      <span>{summary}</span>
      {groups && onChange && (
        <div className="seg seg-sm" role="tablist" aria-label="Gruppieren">
          <span className="seg-label">Gruppieren</span>
          {groups.map(g => (
            <button key={g.id} role="tab" aria-selected={value === g.id} className={value === g.id ? "on" : ""} onClick={() => onChange(g.id)}>{g.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
