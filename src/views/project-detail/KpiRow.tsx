// Kennzahlen-Kacheln (Stunden, Verrechnet/Offen bzw. Kostenkontrolle, Status) der Projekt-Detailansicht.

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
  <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
    {(() => {
      const internalRate = project.hourlyRate || data.settings.defaultHourlyRate || 0;
      const internalCost = (totalMinutes / 60) * internalRate;
      if (isCostControl) return [
        { label: "STUNDEN TOTAL", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "#b07848" },
        isNonBilling
          ? { label: "NICHT VERRECHENBAR", value: project.category, sub: "Stunden fliessen ins Studio-Budget", color: "var(--text5)" }
          : { label: "INTERNER AUFWAND", value: internalRate > 0 ? formatCHF(internalCost) : "—", sub: internalRate > 0 ? `bei ${formatCHF(internalRate)}/h · Kostenkontrolle` : "Kein Stundensatz hinterlegt", color: "var(--text4)" },
        { label: "BUDGET GENUTZT", value: budget > 0 ? `${Math.min(Math.round(budgetPct), 999)}%` : "—", sub: budget > 0 ? `${totalHours.toFixed(1)}h / ${budget}h` : "Kein Stundenbudget", color: budget > 0 ? budgetColor : "var(--text5)" },
        { label: "STATUS", value: <StatusBadge status={project.status} />, color: "#b07848" },
      ];
      return [
        { label: "STUNDEN TOTAL", value: formatHours(totalMinutes), sub: budget > 0 ? `von ${budget}h Soll` : `${entries.length} Einträge`, color: "#b07848" },
        { label: "VERRECHNET", value: formatHours(invoicedMinutes), sub: formatCHF(invoicedMinutes / 60 * (project.hourlyRate as number)), color: "var(--positive)" },
        { label: "OFFEN", value: formatHours(openMinutes), sub: formatCHF(openMinutes / 60 * (project.hourlyRate as number)), color: openMinutes > 0 ? "var(--warning)" : "var(--text5)" },
        { label: "STATUS", value: <StatusBadge status={project.status} />, color: "#b07848" },
      ];
    })().map(c => (
      <KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} color={c.color} />
    ))}
  </div>
  );
}
