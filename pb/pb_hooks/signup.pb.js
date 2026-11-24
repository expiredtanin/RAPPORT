/// <reference path="../pb_data/types.d.ts" />
// Registrierung schliessen (Audit 20.11.2026): Die users-Collection hatte eine offene
// createRule (""), d.h. jeder, der die Server-Adresse kennt, konnte ein Konto anlegen,
// danach die Namen aller Nutzer der Instanz lesen (users.listRule) und — über den
// create-studio-Hook — eigene Studios anlegen.
//
// Die App legt Konten nur auf zwei Wegen an:
//   - Ersteinrichtung (CloudSetup → PocketBaseAdapter.signUp): ohne Anmeldung, aber nur
//     solange es auf der Instanz noch kein Studio gibt;
//   - Einladen (PocketBaseAdapter.inviteMember): angemeldet als Admin eines Studios.
// Alles andere wird abgelehnt; Superuser (Admin-Dashboard /_/) sind nicht betroffen.
// Als Hook statt als createRule, weil eine Regel die Zahl der Studios nicht prüfen kann.
// Seit 24.11.2026 braucht die Ersteinrichtung zusätzlich den Einrichtungscode (siehe unten).

onRecordCreateRequest((e) => {
  // Ersteinrichtung nur mit Einrichtungscode (RAPPORT_SETUP_TOKEN, im Container beim ersten Start erzeugt und ins
  // Log geschrieben): sonst konnte, wer nach dem Start als Erster die Adresse aufrief, das erste Konto und Büro
  // anlegen und Admin werden (Audit 24.11.2026). Ohne gesetzte Variable (z.B. Server-App) wie bisher offen.
  if (!e.hasSuperuserAuth() && e.app.countRecords("studios") === 0) {
    const want = $os.getenv("RAPPORT_SETUP_TOKEN") || "";
    const got = (e.requestInfo().headers || {})["x_rapport_setup"] || "";   // Header X-Rapport-Setup (requestInfo: klein, «_»)
    if (want && got !== want) throw new ForbiddenError("Einrichtungscode fehlt oder ist falsch (steht im Log des Servers).");
  }
  if (!e.hasSuperuserAuth() && e.app.countRecords("studios") > 0) {
    let isAdmin = false;
    if (e.auth && e.auth.collection().name === "users") {
      try {
        e.app.findFirstRecordByFilter(
          "studioMembers", "user = {:uid} && appRoleId = 'r-admin' && active = true",
          { uid: e.auth.id },
        );
        isAdmin = true;
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) throw new ForbiddenError("Konten legt ein Admin über «Team» an.");
  }
  e.next();
}, "users");
