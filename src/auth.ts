// Rechte- und Anzeige-Ableitungen aus dem angemeldeten Nutzer. Reine Funktionen ohne State;
// App.tsx ruft sie bei jedem Render auf.
//
// `permissions === null` bedeutet «alles erlaubt» (Admin). Eine leere Liste heisst «nichts»
// — wichtig bei gelöschter Rolle: lieber fail closed als versehentlich Vollzugriff.

import { NAV_ITEMS } from "./constants";
import type { NavItem } from "./constants";
import type { AppData, CurrentUser } from "./types";

/** View-IDs, die der Nutzer öffnen darf; `null` = alle (Admin). */
export function getUserPermissions(currentUser: CurrentUser | null, data: AppData): string[] | null {
  if (!currentUser || currentUser.role === "admin") return null;
  if (currentUser.appRoleId) {
    const role = (data.appRoles || []).find(r => r.id === currentUser.appRoleId);
    // appRoleId gesetzt, aber Rolle wurde gelöscht → fail closed statt fail open
    // (sonst würde eine gelöschte Rolle den Nutzer versehentlich zum Vollzugriff-Admin machen)
    return role ? role.permissions : [];
  }
  // ohne Rolle: nur ausdrücklich gesetzte Rechte (Altbestand), sonst keine — vorher galt «keine Rolle» als
  // Vollzugriff (Konto mit «— Rolle wählen —» sah Buchhaltung, Löhne, Einstellungen; Test 25.11.2026)
  return Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
}

/** Initialen für den Avatar: erster + letzter Wortanfang, sonst erster Buchstabe, sonst «?». */
export function getUserInitials(currentUser: CurrentUser | null): string {
  const parts = ((currentUser?.displayName || currentUser?.username) || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || "?")[0].toUpperCase();
}

/** NAV_ITEMS gefiltert nach Rechten; Eltern ohne erlaubtes Kind fallen weg. */
export function getVisibleNavItems(userPermissions: string[] | null): NavItem[] {
  return userPermissions === null ? NAV_ITEMS : NAV_ITEMS.map(item => {
    if (item.children) {
      const ch = item.children.filter(c => userPermissions.includes(c.id));
      return ch.length > 0 ? { ...item, children: ch } : null;
    }
    return userPermissions.includes(item.id) || (item.alsoWith && userPermissions.includes(item.alsoWith)) ? item : null;
  }).filter((item): item is NavItem => !!item);
}

/**
 * Vorgeschlagene Rolle für ein neues Konto: die mit den wenigsten Rechten (Standard «Mitarbeiter»), nicht einfach
 * die erste Nicht-Admin-Rolle (das war «Projektleiter» mit Personal und Offerten).
 */
export function defaultAppRoleId(roles: AppData["appRoles"] | undefined): string {
  const cand = (roles || []).filter(r => r.id !== "r-admin" && Array.isArray(r.permissions));
  if (cand.some(r => r.id === "r-mitarbeiter")) return "r-mitarbeiter";
  return [...cand].sort((a, b) => (a.permissions || []).length - (b.permissions || []).length)[0]?.id || "";
}

/**
 * Cloud: Rolle und Verknüpfung mit dem Mitarbeitenden aus den geladenen Daten statt nur aus der Sitzung — Einstellungen
 * → Team ändert beides nach dem Login (vorher galten Menüs und «nicht verknüpft» bis zum Ab- und Anmelden; eine
 * entzogene Rolle zeigte weiter Menüs, deren Speichern der Server ablehnte). `users` kommt aus den Mitgliedschaften
 * (voller Reload, auch bei Tab-Fokus), `employees.appUserId` aus der Realtime. Ohne eigenen Eintrag bleibt die Sitzung;
 * ein inzwischen anders verknüpfter Mitarbeiter-Datensatz wird gelöst. Unverändert → dasselbe Objekt.
 */
export function syncCloudUser(user: CurrentUser, users: AppData["users"] | undefined, employees: AppData["employees"] | undefined): CurrentUser {
  const list = employees || [];
  const linked = list.find(e => e.appUserId === user.id)?.id;
  let employeeId = user.employeeId ?? null;
  if (linked) employeeId = linked;
  else if (employeeId && list.some(e => e.id === employeeId && e.appUserId !== user.id)) employeeId = null;
  const member = (users || []).find(u => u.id === user.id);
  const appRoleId = member?.appRoleId || user.appRoleId;
  const role = member?.appRoleId ? (member.appRoleId === "r-admin" ? "admin" : "user") : user.role;
  if (employeeId === (user.employeeId ?? null) && appRoleId === user.appRoleId && role === user.role) return user;
  return { ...user, employeeId, appRoleId, role };
}
