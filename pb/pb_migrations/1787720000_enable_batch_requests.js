/// <reference path="../pb_data/types.d.ts" />
// Aktiviert PocketBase's Batch-API (mehrere Create/Update/Delete-Requests in
// einem HTTP-Call, transaktional — schlägt eine Operation im Batch fehl, wird
// der komplette Batch zurückgerollt, siehe RAPPORT-APP/ARCHITECTURE.md
// "Full-Diff-Sync-Optimierung"). Standardmäßig AUS (settings.batch.enabled).
// PocketBaseAdapter._applyOps() nutzt Batches, wenn verfügbar, und fällt sonst
// automatisch auf sequenzielle Einzel-Requests zurück (alte Server ohne diese
// Migration funktionieren also weiterhin, nur ohne den Geschwindigkeitsgewinn).
// maxRequests bleibt beim PocketBase-Default (50) — RAPPORT-APP chunkt Batches
// auf genau diese Grösse.

migrate((app) => {
  const settings = app.settings();
  settings.batch.enabled = true;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.batch.enabled = false;
  app.save(settings);
});
