// Anmeldefehler der Cloud (PocketBase), getrennt nach Ursache. Vorher meldete die Anmeldung bei
// jedem Fehler «Anmeldung fehlgeschlagen» bzw. zählte ihn als falsches Passwort — auch wenn das
// Netz weg, der Server überlastet (429) oder das Konto keinem Büro zugeordnet war.
// Falsche Zugangsdaten bleiben `null` (Rückgabe von signIn), alles andere wirft einen LoginError.

/** Ursache eines Anmeldefehlers (ausser falschen Zugangsdaten). */
export type LoginErrorReason = "offline" | "rate_limited" | "server" | "no_studio" | "not_member" | "unknown";

/** Anmeldefehler mit Ursache; `message` ist der Text für die Anmeldemaske. */
export class LoginError extends Error {
  readonly reason: LoginErrorReason;
  constructor(reason: LoginErrorReason, detail?: string) {
    super(loginErrorText(reason, detail));
    this.name = "LoginError";
    this.reason = reason;
  }
}

/** Text für die Anmeldemaske. */
export function loginErrorText(reason: LoginErrorReason, detail?: string): string {
  switch (reason) {
    case "offline": return "Server nicht erreichbar. Internetverbindung und Server-Adresse prüfen.";
    case "rate_limited": return "Zu viele Anmeldeversuche. Bitte einen Moment warten und erneut versuchen.";
    case "server": return "Der Server hat einen Fehler gemeldet. Später erneut versuchen oder den Server prüfen.";
    case "no_studio": return "Das Konto ist keinem Büro zugeordnet. Bitte die Administration fragen.";
    case "not_member": return "Das Konto gehört nicht zum gewählten Büro.";
    default: return detail ? `Anmeldung fehlgeschlagen: ${detail}` : "Anmeldung fehlgeschlagen.";
  }
}

/**
 * Ordnet einen Fehler des PocketBase-SDK einer Ursache zu. `null` = falsche Zugangsdaten
 * (400/401/403 bei authWithPassword).
 */
export function loginErrorFromStatus(status: number | undefined): LoginErrorReason | null {
  if (status === undefined || status === 0) return "offline";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status === 400 || status === 401 || status === 403 || status === 404) return null;
  return "unknown";
}
