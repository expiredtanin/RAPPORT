// Auslastung je Person und Woche (Terminplanung → «Auslastung») aus dem internen Ressourcenplan (`resourcePlan`):
//   verfügbar = Soll der Woche (Pensum, Feiertage, Ein-/Austritt) ohne Ferien und Absenzen (createWorktime)
//   verplant  = je Tag verfügbare Stunden × Summe der Plan-Prozente an diesem Tag (über 100 % = Überlast)
//   erfasst   = Stunden der Zeiterfassung (vergangene Tage)

import { createWorktime, type WorkData, type WorkEmployee } from "./worktime";
import { addDays } from "./schedule";
import type { DateStr } from "./types";

/** Auslastung einer Woche. */
export interface WeekLoad {
  /** Montag der Woche */
  week: DateStr;
  /** Woche liegt ganz vor heute (Ist zählt), sonst Plan */
  past: boolean;
  /** verfügbare Stunden (Soll ohne Ferien/Absenzen) */
  available: number;
  /** erfasste Stunden (bis heute) */
  ist: number;
  /** verplante Stunden (ab morgen; verfügbare Stunden × Plan-Prozente) */
  planned: number;
  /** Tage mit mehr als 100 % verplant */
  overbooked: number;
}

/** Montag der Woche eines Datums. */
export function mondayOf(ds: DateStr): DateStr {
  const dow = (new Date(ds + "T12:00:00Z").getUTCDay() + 6) % 7;
  return addDays(ds, -dow);
}

/**
 * Wochen-Auslastung einer Person.
 * @param entries Plan-Einträge der Person (Zeitraum und Prozent der verfügbaren Zeit)
 * @param weeks Montage der gewünschten Wochen
 */
export function weeklyLoad(data: WorkData, emp: WorkEmployee, entries: { dateFrom: DateStr; dateTo: DateStr; pensum: number }[], weeks: DateStr[], today: DateStr,
  wt: ReturnType<typeof createWorktime> = createWorktime(data, today)): WeekLoad[] {
  return weeks.map(week => {
    const sunday = addDays(week, 6);
    let available = 0, planned = 0, overbooked = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      const p = wt.period(emp, d, d, d);
      const free = Math.max(0, p.soll - p.absenz);
      available += free;
      if (d <= today || free <= 0) continue;   // heute zählt schon als erfasst (ist bis heute), nicht doppelt
      const pct = entries.reduce((c, t) => c + (t.dateFrom <= d && t.dateTo >= d ? Math.max(0, Number(t.pensum) || 0) : 0), 0);
      planned += free * pct / 100;
      if (pct > 100) overbooked++;
    }
    const ist = week <= today ? wt.period(emp, week, sunday, today).ist : 0;
    return { week, past: sunday < today, available, ist, planned, overbooked };
  });
}
