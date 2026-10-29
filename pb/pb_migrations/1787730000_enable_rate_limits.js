/// <reference path="../pb_data/types.d.ts" />
// Aktiviert PocketBase's Rate-Limiting (settings.rateLimits.enabled). Die
// Regeln selbst (Login-Brute-Force-Schutz *:auth, Create-Spam *:create, eine
// eigene enge Regel für /api/batch, plus ein generelles /api/-Limit) waren
// bereits konfiguriert, der Master-Schalter stand aber auf AUS — ohne
// Rate-Limiting ist der Login-Endpoint offen für Brute-Force-Versuche.
// trustedProxy bewusst NICHT angefasst: ob die produktive Instanz hinter
// einem Reverse-Proxy läuft, ist zum Zeitpunkt dieser Migration nicht
// geklärt (siehe RAPPORT-APP/ARCHITECTURE.md "Full-Diff-Sync-Optimierung").
// Läuft PocketBase hinter Nginx o.ä., muss trustedProxy zusätzlich gesetzt
// werden, sonst greifen die IP-basierten Regeln nur auf die Proxy-IP statt
// der echten Client-IP.

migrate((app) => {
  const settings = app.settings();
  settings.rateLimits.enabled = true;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.rateLimits.enabled = false;
  app.save(settings);
});
