// Leiste über dem Druckblatt eines Terminprogramms (nicht im Ausdruck): Papierformat (A4–A0 quer oder
// «nach Bedarf»), Ausschnitt (verschieben mit Pfeilen, Regler oder Ziehen in der Vorschau; Daten von/bis)
// und Massstab der Zeitachse (− / + / Auswahl, «Alles» setzt zurück). Rechnung siehe scheduleLayout.ts.

import { DateInput } from "../../components/UI";
import { dayNum, numToDate } from "../../schedule";
import {
  DEFAULT_MM_PER_DAY, SCHEDULE_PAPERS, SCHEDULE_SCALES, movePrintWindowTo, printScaleLabel, shiftPrintWindow, zoomPrint,
  type SchedulePrintLayout, type SchedulePrintOptions,
} from "./scheduleLayout";

const chip = (on: boolean): React.CSSProperties => ({
  border: `1.5px solid ${on ? "#252520" : "#bdb8b0"}`, background: on ? "#252520" : "#fff", color: on ? "#f0ede8" : "#2a2a22",
  borderRadius: 14, padding: "4px 11px", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1.4,
});
/** quadratischer Knopf (Pfeile, Zoom) */
const sq = (disabled = false): React.CSSProperties => ({
  ...chip(false), width: 30, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontSize: 15, borderRadius: 8, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer",
});
const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Formatwahl, Ausschnitt und Massstab für den Druck eines Terminprogramms. */
export function ScheduleFormatBar({ opts, setOpts, layout, pageH, usableMm }: {
  opts: SchedulePrintOptions;
  setOpts: (o: SchedulePrintOptions) => void;
  layout: SchedulePrintLayout;
  /** tatsächliche Blatthöhe in mm (bei «nach Bedarf» gemessen) */
  pageH: number;
  /** Breite des Zeitstrahls auf dem A-Format, mm (für den Zoom) */
  usableMm: number;
}) {
  const bedarf = opts.paper === "bedarf";
  const span = dayNum(layout.to) - dayNum(layout.from) + 1;
  /** Schritt der Pfeile: etwa ein Viertel des Ausschnitts, in ganzen Wochen */
  const step = Math.max(7, Math.round(span / 4 / 7) * 7);
  const full = layout.full;
  const sliderMin = full ? dayNum(full.start) - 30 : 0;
  const sliderMax = full ? Math.max(sliderMin, dayNum(full.end) - span + 31) : 0;
  const isAll = !opts.from && !opts.to && (bedarf || !opts.mmPerDay);
  const scaleValue = bedarf ? String(opts.mmPerDay || DEFAULT_MM_PER_DAY) : String(opts.mmPerDay || 0);
  const zoomIn = zoomPrint(opts, layout, 1, usableMm), zoomOut = zoomPrint(opts, layout, -1, usableMm);
  const label = { color: "#777", minWidth: 62 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", background: "#f4f2ee", borderRadius: 6, fontSize: 12, color: "#2a2a22", fontFamily: "var(--font-ui)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={label}>Papier</span>
        {SCHEDULE_PAPERS.map(p => (
          <button key={p.id} style={chip(opts.paper === p.id)} onClick={() => setOpts({ ...opts, paper: p.id, mmPerDay: bedarf ? 0 : opts.mmPerDay, to: bedarf ? "" : opts.to })} title={`${p.w} × ${p.h} mm`}>{p.label}</button>
        ))}
        <button style={chip(bedarf)} onClick={() => setOpts({ ...opts, paper: "bedarf", mmPerDay: opts.mmPerDay || DEFAULT_MM_PER_DAY, to: opts.from ? layout.to : "" })}
          title="Breite nach Zeitraum und Massstab, Höhe nach Inhalt — für Plotter und Rollenpapier">Nach Bedarf</button>
        <span style={{ marginLeft: "auto", color: "#555", fontWeight: 600 }}>
          Blatt {Math.round(layout.pageW)} × {Math.round(pageH)} mm
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={label}>Massstab</span>
        <button style={sq(zoomOut === opts)} disabled={zoomOut === opts} onClick={() => setOpts(zoomOut)} title="Schwächer zoomen: mehr Zeit aufs Blatt" aria-label="Schwächer zoomen">−</button>
        <select value={scaleValue} aria-label="Massstab der Zeitachse"
          onChange={e => {
            const mm = Number(e.target.value);
            setOpts(mm ? { ...opts, mmPerDay: mm, from: opts.from || layout.from, to: bedarf ? opts.to : "" } : { ...opts, mmPerDay: 0, from: "", to: "" });
          }}
          style={{ height: 30, fontSize: 12, width: "auto", padding: "0 30px 0 10px", fontFamily: "inherit" }}>
          {!bedarf && <option value="0">Eingepasst ({printScaleLabel(layout.dayWidth * 25.4 / 96).replace("=", "≈")})</option>}
          {SCHEDULE_SCALES.map(s => <option key={s.label} value={String(s.mmPerDay)}>{s.label}</option>)}
        </select>
        <button style={sq(zoomIn === opts)} disabled={zoomIn === opts} onClick={() => setOpts(zoomIn)} title="Stärker zoomen: weniger Zeit, mehr Platz je Woche" aria-label="Stärker zoomen">+</button>
        <button style={{ ...chip(isAll), marginLeft: 4 }} onClick={() => setOpts({ ...opts, from: "", to: "", mmPerDay: bedarf ? opts.mmPerDay : 0 })}
          title="Ganzes Programm aufs Blatt">Alles</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={label}>Ausschnitt</span>
        <button style={sq()} onClick={() => setOpts(shiftPrintWindow(opts, layout, -step))} title={`${step / 7} Wochen früher`} aria-label="Früher">‹</button>
        {full && (
          <input type="range" min={sliderMin} max={sliderMax} step={7} value={Math.max(sliderMin, Math.min(sliderMax, dayNum(layout.from)))}
            aria-label="Ausschnitt verschieben"
            onChange={e => setOpts(movePrintWindowTo(opts, layout, numToDate(Number(e.target.value))))}
            style={{ width: 200, accentColor: "#252520", padding: 0, height: 20 }} />
        )}
        <button style={sq()} onClick={() => setOpts(shiftPrintWindow(opts, layout, step))} title={`${step / 7} Wochen später`} aria-label="Später">›</button>
        <div style={{ width: 120 }}><DateInput value={opts.from || layout.from} onChange={e => e.target.value && setOpts({ ...opts, from: e.target.value, to: !bedarf && opts.mmPerDay > 0 ? "" : opts.to || layout.to })} placeholder="Beginn" /></div>
        <span>–</span>
        {!bedarf && opts.mmPerDay > 0
          ? <span title="Ende ergibt sich aus Blattbreite und Massstab" style={{ minWidth: 80 }}>{fmt(layout.to)}</span>
          : <div style={{ width: 120 }}><DateInput value={opts.to || layout.to} onChange={e => e.target.value && setOpts({ ...opts, to: e.target.value, from: opts.from || layout.from })} placeholder="Ende" /></div>}
        <span style={{ color: "#888", marginLeft: 6 }}>{span} Tage · in der Vorschau ziehen verschiebt</span>
      </div>
    </div>
  );
}
