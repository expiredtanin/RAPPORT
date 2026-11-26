/// <reference path="../pb_data/types.d.ts" />
// Optimistische Sperre (pb_hooks/concurrency.pb.js): Kontakte und Projekte hatten als einzige synchronisierte
// Daten-Collections kein Feld `updated` — ohne Zeitstempel kann der Server nicht erkennen, dass ein Update auf einem
// veralteten Stand beruht. Neu: `updated` (autodate) wie bei den übrigen Collections; bestehende Datensätze bekommen
// den Zeitpunkt der Migration, damit die Prüfung sofort greift (leer = keine Prüfung). `created` bewusst nicht: die
// Projektliste gruppiert ohne Startdatum nach `createdAt`, ein nachgetragenes Datum verschöbe alte Projekte.

migrate((app) => {
  for (const name of ["persons", "projects"]) {
    const c = app.findCollectionByNameOrId(name);
    if (!c.fields.getByName("updated")) c.fields.add(new Field({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }));
    app.save(c);
    app.db().newQuery(`UPDATE ${name} SET updated = strftime('%Y-%m-%d %H:%M:%fZ', 'now') WHERE updated IS NULL OR updated = ''`).execute();
  }
}, (app) => {
  for (const name of ["persons", "projects"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("updated");
    app.save(c);
  }
});
