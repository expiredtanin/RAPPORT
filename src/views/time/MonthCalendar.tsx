// Zeiterfassung: Monatskalender rechts als kompakte Heatmap — Tönung (Akzent) nach erfassten Stunden im
// Verhältnis zum Tages-Soll, heute umrandet, gewählte Woche als Band, Ferien grün, beantragte orange,
// Absenzen grau, vergangene Arbeitstage unter Soll mit orangem Punkt. Klick wählt den Tag.

import type { CSSProperties } from "react";
import { formatHours, localISODate } from "../../utils";
import type { Employee } from "../../types";
import type { MonthCell } from "./timeUtils";

/** Props des Monatskalenders. */
interface MonthCalendarProps {
  currentDate: string;
  setCurrentDate: (ds: string) => void;
  monthLabel: string;
  monthCells: (MonthCell | null)[];
  monthTotalMins: number;
  selectedEmp: Employee | null;
  /** Montag–Sonntag der gewählten Woche (Band in der Heatmap) */
  weekDays?: string[];
}

/** «7.5» bzw. «8» (eine Dezimale, ohne «.0»). */
const h1 = (h: number) => { const r = Math.round(h * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };

/** Monatskarte: Tag anklicken wählt ihn aus. */
export function MonthCalendar({ currentDate, setCurrentDate, monthLabel, monthCells, monthTotalMins, selectedEmp, weekDays = [] }: MonthCalendarProps) {
  const todayStr = localISODate();
  const shiftMonth = (delta: number) => {
    const [y, m] = currentDate.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1)); d.setUTCMonth(d.getUTCMonth() + delta);
    setCurrentDate(d.toISOString().slice(0, 10));
  };
  const weekFirst = weekDays[0], weekLast = weekDays[6];

  return (
    <div className="card">
      <div className="zeit-mc-head">
        <div className="zeit-mc-title">{monthLabel}</div>
        <button className="btn-icon" onClick={() => shiftMonth(-1)} aria-label="Vorheriger Monat" title="Vorheriger Monat"><span className="msr" style={{ fontSize: 18 }}>chevron_left</span></button>
        <button className="btn-icon" onClick={() => shiftMonth(1)} aria-label="Nächster Monat" title="Nächster Monat"><span className="msr" style={{ fontSize: 18 }}>chevron_right</span></button>
      </div>

      <div className="zeit-mc-grid">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => <div key={d} className="zeit-mc-wd">{d}</div>)}
        {monthCells.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const col = i % 7;
          const inWeek = !!weekFirst && cell.dateStr >= weekFirst && cell.dateStr <= weekLast;
          const noWork = cell.isWeekend || !!cell.isFeiertag;
          const istH = cell.mins / 60;
          // Bezugsgrösse der Tönung: Tages-Soll der Person, ohne Person (alle) 8 h
          const ref = cell.sollH && cell.sollH > 0 ? cell.sollH : 8;
          const heat = istH > 0 ? Math.round(8 + Math.min(1.15, istH / ref) * 22) : 0;
          const miss = !!selectedEmp && !noWork && !cell.isFerien && !cell.isAbsenz && !!cell.sollH && cell.dateStr < todayStr && cell.sollH - istH > 0.5;
          const state = cell.isFerien ? " ferien" : cell.isPendingFerien ? " pending" : (cell.isAbsenz || cell.isPendingAbsenz) && istH === 0 ? " abs" : "";
          const dayCls = `zeit-mc-day${noWork && istH === 0 ? " off" : ""}${state}${miss && !state ? " miss" : ""}${cell.dateStr === todayStr ? " is-today" : cell.dateStr === currentDate ? " sel" : ""}`;
          const tip = [
            new Date(cell.dateStr + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "long" }),
            istH > 0 || (cell.sollH ?? 0) > 0 ? `${h1(istH)} h${cell.sollH ? ` von ${h1(cell.sollH)} h Soll` : ""}` : "",
            cell.ft?.label && !cell.isVortag ? cell.ft.label : cell.isVortag ? "Vortag Feiertag (−1 h)" : "",
            cell.isFerien ? "Ferien" : cell.isPendingFerien ? "Ferien beantragt" : cell.isAbsenz ? "Absenz" : cell.isPendingAbsenz ? "Absenz beantragt" : "",
          ].filter(Boolean).join(" · ");
          return (
            <button key={i} className={`zeit-mc-cell${inWeek ? " wk" : ""}${inWeek && (col === 0 || cell.day === 1) ? " first" : ""}${inWeek && (col === 6 || i === monthCells.length - 1) ? " last" : ""}`}
              onClick={() => setCurrentDate(cell.dateStr)} title={tip}>
              <span className={dayCls} style={heat && !state ? { "--heat": `${heat}%` } as CSSProperties : undefined}>{cell.day}</span>
            </button>
          );
        })}
      </div>

      <div className="zeit-mc-foot">
        <span>Monatstotal <b className="num">{formatHours(monthTotalMins)}</b></span>
        <span className="zeit-mc-legend" title="Tönung: erfasste Stunden im Verhältnis zum Tages-Soll">
          wenig
          {[10, 20, 30].map(h => <i key={h} style={{ "--heat": `${h}%` } as CSSProperties} />)}
          Soll
        </span>
      </div>
    </div>
  );
}
