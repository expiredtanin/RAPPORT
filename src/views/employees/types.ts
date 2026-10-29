// Gemeinsame Typen der Mitarbeiter-Ansicht (Formulare, Modal-Art).

import type { Employee } from "../../types";

/** Formular eines Mitarbeiters; die `_app*`-Felder steuern den optionalen App-Zugang und werden nicht am Mitarbeiter gespeichert. */
export type EmpForm = Partial<Employee> & {
  _appAccess?: boolean; _appUsername?: string; _appPassword?: string; _appRoleId?: string; _appUserId?: string;
};
/** Eingaben im Jahresabschluss pro Mitarbeiter. */
export type AbschlussForm = { ubHours: number; ubZuschlag: number; ferienUebertrag?: number | string; [key: string]: unknown };
/** Welches Modal gerade offen ist (`null` = keines). */
export type ModalKind = "emp" | "abs" | "ferien" | null;
