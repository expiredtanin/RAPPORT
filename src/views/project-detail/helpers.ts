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

/**
 * Minuten ohne Phase ODER in einer Phase, die im Projekt nicht (mehr) aktiv ist (abgewählt, eigene Phase gelöscht, auch
 * nicht bei einem Nachtrag): sonst fehlten sie in der Phasenübersicht, und «Stunden total» liefe ohne Hinweis von der
 * Summe der Phasen weg.
 */
export function unassignedPhaseMinutes(
  project: Pick<Project, "enabledPhases" | "customPhases">,
  entries: Pick<TimeEntry, "phaseId" | "minutes">[],
  positions: Pick<ProjectPosition, "enabledPhases">[],
): number {
  const known = new Set<string>([
    ...(project.enabledPhases || []),
    ...(project.customPhases || []).map(c => c.id),
    ...positions.flatMap(pos => pos.enabledPhases || []),
  ]);
  return entries.filter(e => !e.phaseId || !known.has(e.phaseId)).reduce((s, e) => s + (e.minutes || 0), 0);
}

/**
 * Eigene Phase umbenennen: nur das Label ändert sich, die `id` bleibt — Zeiteinträge hängen über `phaseId` daran und
 * zählen so weiter zur Phase. Leerer Name oder unbekannte id: Liste unverändert.
 */
export function renameCustomPhase<T extends { id: Id; label: string }>(phases: T[], id: Id, label: string): T[] {
  const name = label.trim();
  if (!name || !phases.some(p => p.id === id)) return phases;
  return phases.map(p => p.id === id ? { ...p, label: name } : p);
}

/** Auf eine Phase gebuchte Minuten im Projekt (für die Rückfrage beim Löschen einer eigenen Phase); ohne Projekt-id 0. */
export function phaseBookedMinutes(entries: Pick<TimeEntry, "projectId" | "phaseId" | "minutes">[], projectId: Id | undefined, phaseId: Id): number {
  if (!projectId) return 0;
  return entries.filter(e => e.projectId === projectId && e.phaseId === phaseId).reduce((s, e) => s + (e.minutes || 0), 0);
}
