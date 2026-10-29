// Reiter «Monatsabschluss»: Monate schliessen/öffnen (`settings.closedMonths`).

import React from "react";
import type { ViewProps } from "../../types";
import { MONTHS as months } from "./calc";

interface MonthCloseTabProps {
  data: ViewProps["data"];
  closedMonths: string[];
  toggleMonth: (monthStr: string) => void;
  viewYear: number;
  setViewYear: React.Dispatch<React.SetStateAction<number>>;
}

/** Reiter «Monatsabschluss» der Mitarbeiter-Ansicht. */
export default function MonthCloseTab({ data, closedMonths, toggleMonth, viewYear, setViewYear }: MonthCloseTabProps) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 16 }}>
        Geschlossene Monate können in der Zeiterfassung nicht mehr bearbeitet werden. Monate können jederzeit wieder geöffnet werden.
      </div>
      {(() => {
        const allDates = [
          ...(data.timeEntries || []).map(e => e.date),
          ...(data.projects || []).map(p => p.startDate || p.createdAt),
          ...(data.invoices || []).map(i => i.date),
          ...(data.expenses || []).map(e => e.date),
        ].filter(Boolean).sort();
        const today = new Date();
        const earliest = allDates[0] ? new Date(allDates[0]) : today;
        const startYear = earliest.getFullYear();
        const startMonth = earliest.getMonth(); // 0-indexed
        const availableYears = [];
        for (let y = startYear; y <= today.getFullYear() + 1; y++) availableYears.push(y);
        return (
      <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {months.map((m, i) => {
          const monthStr = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
          const isClosed = closedMonths.includes(monthStr);
          const isFuture = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && i > today.getMonth());
          const isCurrent = viewYear === today.getFullYear() && i === today.getMonth();
          const isBeforeStart = viewYear < startYear || (viewYear === startYear && i < startMonth);
          if (isBeforeStart) return null;
          return (
            <div key={monthStr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: i < 11 ? "1px solid var(--border2)" : "none", background: isClosed ? "#f9f7f4" : "transparent", opacity: isFuture ? 0.4 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 500, minWidth: 100 }}>{m} {viewYear}</div>
                {isCurrent && <span style={{ fontSize: 10, color: "var(--st-c-gesendet)", background: "var(--st-bg-gesendet)", padding: "2px 7px", borderRadius: 20 }}>Aktuell</span>}
                {isClosed && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--st-c-abgeschlossen)", background: "var(--st-bg-abgeschlossen)", padding: "2px 7px", borderRadius: 20 }}>● Geschlossen</span>}
                {!isClosed && !isFuture && <span style={{ fontSize: 10, color: "var(--st-c-aktiv)", background: "var(--st-bg-aktiv)", padding: "2px 7px", borderRadius: 20 }}>○ Offen</span>}
              </div>
              {!isFuture && (
                <button
                  className={isClosed ? "btn btn-ghost" : "btn btn-ghost"}
                  style={{ fontSize: 11, padding: "4px 14px", color: isClosed ? "var(--positive)" : "var(--negative)", borderColor: isClosed ? "#b0d8c0" : "#e8b0b0" }}
                  onClick={() => toggleMonth(monthStr)}
                >
                  {isClosed ? "Öffnen" : "Schliessen"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      </>
      );
      })()}
    </div>
  );
}
