/// <reference path="../pb_data/types.d.ts" />
// Zwei Betriebs-/Datenschutz-Anpassungen (RAPPORT-APP: Speichern über pb.createBatch(), Benutzerliste):
//
// 1. Rate-Limit /api/batch von 3 auf 10 Anfragen pro Sekunde. Hinter einem gemeinsamen
//    Internetanschluss (NAT) bzw. Reverse-Proxy ohne trustedProxy teilen sich alle Geräte eines
//    Büros dieselbe IP und damit dieses Limit — 3/s führte schon mit einem Gerät zu 429.
//    Fehlt die Regel, wird sie angelegt.
//    Dazu Anmeldungen (*:auth) von 2 pro 3 s auf 5 pro 15 s: wer sich vertippt und sofort
//    korrigiert, bekam sonst schon beim zweiten Versuch 429. Weiterhin Schutz gegen Durchprobieren.
// 2. users.listRule/viewRule: statt «jeder angemeldete Nutzer sieht alle Nutzer der Instanz» nur
//    sich selbst und die Nutzer, mit denen man in einem gemeinsamen Studio Mitglied ist
//    (über studioMembers: user ← studioMembers.user → studio ← studioMembers.studio → user).
//    Superuser (Admin-UI, Hooks mit app.*) sind von Regeln nicht betroffen.

const BATCH_LABEL = "/api/batch";
const AUTH_LABEL = "*:auth";

migrate((app) => {
  const settings = app.settings();
  const rules = settings.rateLimits.rules || [];
  let found = false;
  for (const r of rules) {
    if (r.label === BATCH_LABEL) { r.maxRequests = 10; r.duration = 1; found = true; }
  }
  if (!found) rules.push({ label: BATCH_LABEL, maxRequests: 10, duration: 1, audience: "" });
  let authFound = false;
  for (const r of rules) {
    if (r.label === AUTH_LABEL) { r.maxRequests = 5; r.duration = 15; authFound = true; }
  }
  if (!authFound) rules.push({ label: AUTH_LABEL, maxRequests: 5, duration: 15, audience: "" });
  settings.rateLimits.rules = rules;
  app.save(settings);

  const users = app.findCollectionByNameOrId("users");
  const sameStudio = "id = @request.auth.id || " +
    "(@request.auth.id != '' && studioMembers_via_user.studio.studioMembers_via_studio.user ?= @request.auth.id)";
  users.listRule = sameStudio;
  users.viewRule = sameStudio;
  app.save(users);
}, (app) => {
  const settings = app.settings();
  for (const r of settings.rateLimits.rules || []) {
    if (r.label === BATCH_LABEL) r.maxRequests = 3;
    if (r.label === AUTH_LABEL) { r.maxRequests = 2; r.duration = 3; }
  }
  app.save(settings);

  const users = app.findCollectionByNameOrId("users");
  users.listRule = "@request.auth.id != ''";
  users.viewRule = "@request.auth.id != ''";
  app.save(users);
});
