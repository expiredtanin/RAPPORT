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
  return currentUser.permissions || null; // Fallback für alte Einträge ohne Rolle
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
    return userPermissions.includes(item.id) ? item : null;
  }).filter((item): item is NavItem => !!item);
}
