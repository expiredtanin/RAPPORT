// Gemeinsame Typen und reine Helfer der Projekt-Detailansicht (ProjectDetail.tsx und project-detail/*).

import { SIA_PHASES } from "../../constants";
import type { BillingType, Id, Project, ProjectPosition, TimeEntry } from "../../types";

/** Verknüpfte Offerte eines Projekts mit ihrer Rolle (Hauptofferte, Nachtrag, Referenz). */
export type LinkedQuote = { quoteId: string; role: string };

/** Entwurf des Budget-/Offerten-Modals. */
export type BudgetForm = {
  budgetHours: number;
  budgetAmount: number;
  linkedQuotes: { quoteId: Id; role: string }[];
  phasesBudget: { id: string; hours: number }[];
  enabledPhases: string[];
  billingType: BillingType;
  positions: ProjectPosition[];
};

/** Filter für Listen, die `null`-Einträge enthalten (nur null/undefined, nicht leere Strings). */
export const notNull = <T,>(x: T | null | undefined): x is T => x != null;

/** Phasen-Auswertung eines Projekts (nur aktivierte Phasen; aufgeteilt nach HO + Positionen). */
export function computePhaseStats(
  project: Project,
  entries: TimeEntry[],
  positions: ProjectPosition[],
  hoPhasesBudget: { id: string; hours: number }[],
  totalMinutes: number,
) {
  return (project.enabledPhases || []).map(phaseId => {
    const phase = SIA_PHASES.find(p => p.id === phaseId);
    const phaseEntries = entries.filter(e => e.phaseId === phaseId);
    const hoMins = phaseEntries.filter(e => !e.positionId).reduce((s, e) => s + (e.minutes || 0), 0);
    const totalPhaseMins = phaseEntries.reduce((s, e) => s + (e.minutes || 0), 0);
    const phaseBudget = hoPhasesBudget.find(pb => pb.id === phaseId)?.hours || 0;
    const byPosition = positions.map(pos => ({
      code: pos.code, label: pos.label,
      mins: phaseEntries.filter(e => e.positionId === pos.code).reduce((s, e) => s + (e.minutes || 0), 0),
    })).filter(p => p.mins > 0);
    return { ...phase, minutes: totalPhaseMins, hoMins, hours: totalPhaseMins / 60, phaseBudget, percent: totalMinutes > 0 ? (totalPhaseMins / totalMinutes) * 100 : 0, entries: phaseEntries.length, byPosition };
  });
}

/** Ergebnis von `computePhaseStats` für eine Phase. */
export type PhaseStat = ReturnType<typeof computePhaseStats>[number];
