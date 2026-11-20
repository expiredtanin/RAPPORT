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

onRecordCreateRequest((e) => {
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
