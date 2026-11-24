/// <reference path="../pb_data/types.d.ts" />
// Härtung Runde 2 (Audit 24.11.2026):
//  - users: Namen und Konten der Büro-Kolleginnen sieht nur, wer im Büro noch AKTIV ist (vorher auch deaktivierte
//    Mitglieder mit gültigem Token). «?=» auf demselben Pfad → gilt für die eigene Mitgliedschaftszeile.
//  - users.avatar: kein SVG (aktive Inhalte), höchstens 2 MB, geschützt (nur mit Datei-Token). Die App nutzt das
//    Feld nicht; es stammt aus der PocketBase-Vorlage.
//  - Mengenlimits für Mail auslösende und Bestätigungs-Endpunkte (Passwort-Reset, Verifizierung, E-Mail-Wechsel,
//    OTP): vorher galt nur das allgemeine /api/-Limit (300 pro 10 s) — man konnte einem Nutzer Hunderte
//    Reset-Mails schicken oder Bestätigungs-Tokens durchprobieren.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const ACTIVE = " && studioMembers_via_user.studio.studioMembers_via_studio.active ?= true";
  for (const k of ["listRule", "viewRule"]) {
    const r = users[k] === null || users[k] === undefined ? null : String(users[k]);
    if (r && r.includes("studioMembers_via_studio.user ?= @request.auth.id") && !r.includes(".active ?= true")) {
      users[k] = r.replace("studioMembers_via_studio.user ?= @request.auth.id)", "studioMembers_via_studio.user ?= @request.auth.id" + ACTIVE + ")");
    }
  }
  const avatar = users.fields.getByName("avatar");
  if (avatar) {
    avatar.mimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    avatar.maxSize = 2 * 1024 * 1024;
    avatar.protected = true;
  }
  app.save(users);

  const settings = app.settings();
  const want = [
    { label: "*:requestPasswordReset", duration: 60, maxRequests: 3 },
    { label: "*:confirmPasswordReset", duration: 60, maxRequests: 5 },
    { label: "*:requestVerification", duration: 60, maxRequests: 3 },
    { label: "*:confirmVerification", duration: 60, maxRequests: 5 },
    { label: "*:requestEmailChange", duration: 60, maxRequests: 3 },
    { label: "*:confirmEmailChange", duration: 60, maxRequests: 5 },
    { label: "*:requestOTP", duration: 60, maxRequests: 3 },
  ];
  const have = (settings.rateLimits.rules || []).map((r) => r.label);
  const rules = (settings.rateLimits.rules || []).slice();
  for (const w of want) if (have.indexOf(w.label) < 0) rules.push(w);
  settings.rateLimits.rules = rules;
  settings.rateLimits.enabled = true;
  app.save(settings);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const ACTIVE = " && studioMembers_via_user.studio.studioMembers_via_studio.active ?= true";
  for (const k of ["listRule", "viewRule"]) {
    const r = users[k] === null || users[k] === undefined ? null : String(users[k]);
    if (r && r.includes(ACTIVE)) users[k] = r.replace(ACTIVE, "");
  }
  app.save(users);
  const settings = app.settings();
  const drop = ["*:requestPasswordReset", "*:confirmPasswordReset", "*:requestVerification", "*:confirmVerification",
    "*:requestEmailChange", "*:confirmEmailChange", "*:requestOTP"];
  settings.rateLimits.rules = (settings.rateLimits.rules || []).filter((r) => drop.indexOf(r.label) < 0);
  app.save(settings);
});
