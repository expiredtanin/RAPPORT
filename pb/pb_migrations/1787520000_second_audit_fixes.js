/// <reference path="../pb_data/types.d.ts" />
// Zweite Audit-Runde: weitere Felder, die beim Cloud-Roundtrip verloren
// gingen, gefunden beim gezielten Nachprüfen von blogPosts/dashboardTemplates/
// studioSettings gegen die tatsächliche Feldnutzung in Pinboard.jsx/
// Dashboard.jsx/StudioBudget.jsx/Projects.jsx/Quotes.jsx/Vertraege.jsx.

migrate((app) => {
  // ── studioSettings ──────────────────────────────────────────────────────
  const studioSettings = app.findCollectionByNameOrId("studioSettings");

  // logoUrl war als "file"-Feld angelegt, die App speichert aber einen
  // Base64-Data-URL-String direkt im Objekt (kein echter Upload, siehe
  // Settings.jsx FileReader.readAsDataURL) — gleiches Muster wie
  // expenses.receiptData. Feld entfernen + als text (grosszügiges Limit)
  // neu unter dem tatsächlich genutzten Namen "logo" anlegen (UI.jsx/
  // Settings.jsx lesen/schreiben ausschliesslich settings.logo, nie logoUrl).
  studioSettings.fields.removeByName("logoUrl");
  studioSettings.fields.add(new Field({ name: "logo", type: "text", max: 15000000 }));

  // studioBudget (StudioBudget.jsx aktueller Stand) + studioBudgetVersions
  // (archivierte Snapshots) fehlten komplett — beide sind von Natur aus
  // wachsende, verschachtelte Strukturen, daher als freie JSON-Felder statt
  // einzeln nachgebildeter Spalten (analog payrollEntries.data).
  studioSettings.fields.add(
    new Field({ name: "studioBudget", type: "json" }),
    new Field({ name: "studioBudgetVersions", type: "json" }),
  );

  // Projektnummern-Zähler — ohne ihn restartet die Sequenz bei 0 nach jedem
  // Cloud-Reload, was zu doppelten Projektnummern führt (Projects.jsx,
  // Quotes.jsx createProjectFromQuote).
  studioSettings.fields.add(
    new Field({ name: "lastProjectSeq", type: "number" }),
    new Field({ name: "lastProjectYear", type: "number" }),
  );

  // vertragNumberFormat fehlte seit der Einführung des Vertragswesen-Features
  // (Vertraege.jsx) — Versehen beim ursprünglichen Bauen dieses Features.
  studioSettings.fields.add(new Field({ name: "vertragNumberFormat", type: "text", max: 40 }));

  // defaultPkAGSatz (Employees.jsx-Default für neue Mitarbeiter + StudioBudget-
  // Fallback) fehlte ebenfalls.
  studioSettings.fields.add(new Field({ name: "defaultPkAGSatz", type: "number" }));

  app.save(studioSettings);

  // ── blogPosts (Pinnwand) ────────────────────────────────────────────────
  const blogPosts = app.findCollectionByNameOrId("blogPosts");
  // status/poll/image/eventDate/authorName fehlten komplett: Entwürfe wurden
  // für alle sichtbar (kein Statusfeld), Umfragen komplett verworfen, Bild/
  // Termin/Autorenname beim Reload verloren.
  blogPosts.fields.add(
    new Field({ name: "status", type: "select", maxSelect: 1, values: ["entwurf", "published"] }),
    new Field({ name: "poll", type: "json" }),
    new Field({ name: "image", type: "text", max: 15000000 }),
    new Field({ name: "eventDate", type: "date" }),
    new Field({ name: "authorName", type: "text", max: 200 }),
  );
  app.save(blogPosts);

  // ── dashboardTemplates ──────────────────────────────────────────────────
  const dashboardTemplates = app.findCollectionByNameOrId("dashboardTemplates");
  const users = app.findCollectionByNameOrId("users");
  // createdBy fehlte — private (nicht-öffentliche) Dashboard-Vorlagen wurden
  // nach jedem Cloud-Reload unsichtbar/unauswählbar (Dashboard.jsx filtert
  // strikt auf t.createdBy === currentUser?.id), blieben aber als Datenleiche
  // in der Collection bestehen.
  dashboardTemplates.fields.add(
    new Field({ name: "createdBy", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 }),
  );
  app.save(dashboardTemplates);
}, (app) => {
  const studioSettings = app.findCollectionByNameOrId("studioSettings");
  studioSettings.fields.removeByName("logo");
  studioSettings.fields.add(new Field({ name: "logoUrl", type: "file", maxSelect: 1 }));
  for (const f of ["studioBudget", "studioBudgetVersions", "lastProjectSeq", "lastProjectYear", "vertragNumberFormat", "defaultPkAGSatz"]) {
    studioSettings.fields.removeByName(f);
  }
  app.save(studioSettings);

  const blogPosts = app.findCollectionByNameOrId("blogPosts");
  for (const f of ["status", "poll", "image", "eventDate", "authorName"]) {
    blogPosts.fields.removeByName(f);
  }
  app.save(blogPosts);

  const dashboardTemplates = app.findCollectionByNameOrId("dashboardTemplates");
  dashboardTemplates.fields.removeByName("createdBy");
  app.save(dashboardTemplates);
});
