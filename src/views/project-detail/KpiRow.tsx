// Kennzahlen (Stunden, Verrechnet/Offen bzw. Kostenkontrolle, Status) der Projekt-Detailansicht, als Band wie im Überblick.

import { formatCHF, formatHours } from "../../utils";
import { StatusBadge, KpiCard } from "../../components/UI";
import { type ViewProps, type Project, type TimeEntry } from "../../types";

/** Vier Kennzahlen-Kacheln; bei Kostenkontroll-Projekten (Pauschal/nicht verrechenbar) mit Budgetverbrauch statt Verrechnet/Offen. */
export function KpiRow({ project, data, entries, totalMinutes, totalHours, budget, budgetPct, budgetColor, isCostControl, isNonBilling, invoicedMinutes, openMinutes }: {
  project: Project;
  data: ViewProps["data"];
  entries: TimeEntry[];
  totalMinutes: number;
  totalHours: number;
  budget: number;
  budgetPct: number;
  budgetColor: string;
  isCostControl: boolean;
  isNonBilling: boolean;
  invoicedMinutes: number;
  openMinutes: number;
}) {
  return (
  <div className="responsive-grid-4 kpi-band" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
    {(() => {
      const internalRate = project.hourlyRate || data.settings.defaultHourlyRate || 0;
      const internalCost = (totalMinutes / 60) * internalRate;
      if (isCostControl) return [
        { label: "Stunden total", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "var(--accent)" },
        isNonBilling
          ? { label: "Nicht verrechenbar", value: project.category, sub: "Stunden fliessen ins Studio-Budget", color: "var(--text5)" }
          : { label: "Interner Aufwand", value: internalRate > 0 ? formatCHF(Math.round(internalCost)).replace(/^(−?)CHF\s*/u, "$1").replace(/\.00$/, "") : "—", sub: internalRate > 0 ? `CHF, bei ${formatCHF(internalRate)}/h` : "Kein Stundensatz hinterlegt", color: "var(--text4)" },
        { label: "Budget genutzt", value: budget > 0 ? `${Math.min(Math.round(budgetPct), 999)}%` : "—", sub: budget > 0 ? `${totalHours.toFixed(1)}h / ${budget}h` : "Kein Stundenbudget", color: budget > 0 ? budgetColor : "var(--text5)" },
        { label: "Status", value: <StatusBadge status={project.status} />, color: "var(--accent)" },
      ];
      return [
        { label: "Stunden total", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "var(--accent)" },
        { label: "Verrechnet", value: formatHours(invoicedMinutes), sub: formatCHF(invoicedMinutes / 60 * (project.hourlyRate as number)), color: "var(--positive)" },
        { label: "Offen", value: formatHours(openMinutes), sub: formatCHF(openMinutes / 60 * (project.hourlyRate as number)), color: openMinutes > 0 ? "var(--warning)" : "var(--text5)" },
        { label: "Status", value: <StatusBadge status={project.status} />, color: "var(--accent)" },
      ];
    })().map(c => (
      <KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} color={c.color} />
    ))}
  </div>
  );
}
