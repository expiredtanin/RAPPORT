// Zeiterfassung: Monatskalender rechts (Monatsnavigation, Kacheln mit Stunden/Ferien/Absenz, Monatstotal).

import { formatHours, localISODate } from "../../utils";
import { NavArrows } from "../../components/UI";
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
}

/** Monatskarte: Tag anklicken wählt ihn aus. */
export function MonthCalendar({ currentDate, setCurrentDate, monthLabel, monthCells, monthTotalMins, selectedEmp }: MonthCalendarProps) {
  return (
    <div className="card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <NavArrows onPrev={() => { const [y,m]=currentDate.split("-").map(Number); const d=new Date(Date.UTC(y,m-1,1)); d.setUTCMonth(d.getUTCMonth()-1); setCurrentDate(d.toISOString().slice(0, 10)); }} onNext={() => { const [y,m]=currentDate.split("-").map(Number); const d=new Date(Date.UTC(y,m-1,1)); d.setUTCMonth(d.getUTCMonth()+1); setCurrentDate(d.toISOString().slice(0, 10)); }} />
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, textAlign: "center" }}>{monthLabel}</div>
      <div style={{ width: 55 }} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 6 }}>
      {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => (
        <div key={d} style={{ fontSize: 9, color: "var(--text5)", textAlign: "center", letterSpacing: "0.05em", padding: "4px 0" }}>{d}</div>
      ))}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
      {monthCells.map((cell, i) => {
        if (!cell) return <div key={i}></div>;
        const isSelected = cell.dateStr === currentDate;
        const isCurToday = cell.dateStr === localISODate();
        const hasEntries = cell.mins > 0;
        const noWork = cell.isWeekend || cell.isFeiertag;
        const isVortag = cell.isVortag && !cell.isFeiertag;

        let bg = "transparent";
        if (isSelected) bg = "#1a1a18";
        else if (cell.isFerien) bg = "#e8f5ee";
        else if (cell.isPendingFerien) bg = "#fff8e8";
        else if (cell.isAbsenz) bg = "#f0f0f0";
        else if (cell.isPendingAbsenz) bg = "#f5f0f8";
        else if (hasEntries && !noWork) bg = "#faf3e4";
        else if (hasEntries && noWork) bg = "#f5f0e8";

        const textColor = isSelected ? "#e8e5df" : (noWork && !hasEntries) ? "#ccc" : "#1a1a18";

        return (
          <button key={i} onClick={() => setCurrentDate(cell.dateStr)} style={{
            aspectRatio: "1", padding: 1,
            background: bg, color: textColor,
            border: isCurToday && !isSelected ? "1.5px solid var(--accent)" : "1px solid transparent",
            borderRadius: 4, fontFamily: "inherit",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.1s",
          }}>
            <div style={{ fontSize: 11, fontWeight: noWork ? 400 : 500 }}>{cell.day}</div>
            {!selectedEmp && hasEntries && (
              <div style={{ fontSize: 7, color: isSelected ? "#e8e5df" : "#8a6a3a", marginTop: 1 }}>
                {(cell.mins / 60).toFixed(1)}h
              </div>
            )}
            {selectedEmp && hasEntries && (
              <div style={{ fontSize: 7, color: isSelected ? "#e8e5df" : "var(--positive)", fontWeight: 600, marginTop: 1 }}>
                {(cell.mins / 60).toFixed(1)}h
              </div>
            )}
            {(cell.isFerien || cell.isPendingFerien) && !isSelected && (
              <div style={{ marginTop: 2, display: "flex", justifyContent: "center" }}>
                {cell.isPendingFerien ? (
                  <div style={{ fontSize: 7, color: "var(--warning)", lineHeight: 1 }}>?</div>
                ) : (
                  <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="2.5" fill="var(--positive)"/>
                    <line x1="6" y1="0" x2="6" y2="2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="6" y1="10" x2="6" y2="12" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="0" y1="6" x2="2" y2="6" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="10" y1="6" x2="12" y2="6" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="1.8" y1="1.8" x2="3.2" y2="3.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="8.8" y1="8.8" x2="10.2" y2="10.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="10.2" y1="1.8" x2="8.8" y2="3.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="3.2" y1="8.8" x2="1.8" y2="10.2" stroke="var(--positive)" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
            )}
            {(cell.isAbsenz || cell.isPendingAbsenz) && !isSelected && !cell.isFerien && !cell.isPendingFerien && (
              <div style={{ fontSize: 7, color: cell.isPendingAbsenz ? "#7a5a9a" : "var(--text4)", marginTop: 1 }}>
                {cell.isPendingAbsenz ? "?" : <span className="msr" style={{fontSize:8,verticalAlign:"middle"}}>close</span>}
              </div>
            )}
            {isVortag && !hasEntries && !cell.isFerien && !cell.isAbsenz && (
              <div style={{ fontSize: 7, color: "var(--text5)", marginTop: 1 }}>−1h</div>
            )}
          </button>
        );
      })}
    </div>

    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
      <span style={{ color: "var(--text4)" }}>Monatstotal</span>
      <strong>{formatHours(monthTotalMins)}</strong>
    </div>
  </div>
  );
}
