// Leiste über dem Druckblatt eines Terminprogramms (nicht im Ausdruck): Papierformat (A4–A0 quer oder
// «nach Bedarf» mit Massstab) und Zeitraum. Ergebnis siehe scheduleLayout.ts.

import { DateInput } from "../../components/UI";
import { SCHEDULE_PAPERS, SCHEDULE_SCALES, type SchedulePrintLayout, type SchedulePrintOptions } from "./scheduleLayout";

const chip = (on: boolean): React.CSSProperties => ({
  border: `1.5px solid ${on ? "#252520" : "#bdb8b0"}`, background: on ? "#252520" : "#fff", color: on ? "#f0ede8" : "#2a2a22",
  borderRadius: 14, padding: "4px 11px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif", lineHeight: 1.4,
});

/** Formatwahl für den Druck eines Terminprogramms. */
export function ScheduleFormatBar({ opts, setOpts, layout, pageH }: {
  opts: SchedulePrintOptions;
  setOpts: (o: SchedulePrintOptions) => void;
  layout: SchedulePrintLayout;
  /** tatsächliche Blatthöhe in mm (bei «nach Bedarf» gemessen) */
  pageH: number;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "10px 12px", background: "#f4f2ee", borderRadius: 6, fontSize: 12, color: "#2a2a22", fontFamily: "'Inter', sans-serif" }}>
      <span style={{ color: "#777" }}>Papier</span>
      {SCHEDULE_PAPERS.map(p => (
        <button key={p.id} style={chip(opts.paper === p.id)} onClick={() => setOpts({ ...opts, paper: p.id })} title={`${p.w} × ${p.h} mm`}>{p.label}</button>
      ))}
      <button style={chip(opts.paper === "bedarf")} onClick={() => setOpts({ ...opts, paper: "bedarf" })}
        title="Breite nach Zeitraum und Massstab, Höhe nach Inhalt — für Plotter und Rollenpapier">Nach Bedarf</button>
      {opts.paper === "bedarf" && (
        <select value={opts.mmPerDay} onChange={e => setOpts({ ...opts, mmPerDay: Number(e.target.value) })} style={{ height: 34, fontSize: 12, width: "auto", padding: "0 30px 0 10px", fontFamily: "inherit" }}>
          {SCHEDULE_SCALES.map(s => <option key={s.label} value={s.mmPerDay}>{s.label}</option>)}
        </select>
      )}
      <span style={{ color: "#777", marginLeft: 10 }}>Zeitraum</span>
      <div style={{ width: 120 }}><DateInput value={opts.from} onChange={e => setOpts({ ...opts, from: e.target.value })} placeholder="Beginn" /></div>
      <span>–</span>
      <div style={{ width: 120 }}><DateInput value={opts.to} onChange={e => setOpts({ ...opts, to: e.target.value })} placeholder="Ende" /></div>
      {(opts.from || opts.to) && <button style={chip(false)} onClick={() => setOpts({ ...opts, from: "", to: "" })}>Ganzes Programm</button>}
      <span style={{ marginLeft: "auto", color: "#555", fontWeight: 600 }}>
        Blatt {Math.round(layout.pageW)} × {Math.round(pageH)} mm
      </span>
    </div>
  );
}
