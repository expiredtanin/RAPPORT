/// <reference path="../pb_data/types.d.ts" />
// Personen-Sharing über Studios hinweg — Ersatz für Postgres' `person_studio_links`
// + die `persons_member_access`-RLS-Policy (siehe RAPPORT-APP git-history
// supabase/migrations/0001_initial.sql + 0007_share_persons_on_studio_create.sql).
//
// Mechanik: eine "geteilte" Person hat `persons.studio = ""` (statt einer echten
// Studio-Relation) und wird stattdessen über `personStudioLinks`-Zeilen sichtbar
// gemacht — eine Zeile pro Studio, das Zugriff hat. `primaryStudio` markiert, in
// welchem Studio die Person ursprünglich lebte (informativ, keine Zugriffslogik).
//
// Die persons-Zugriffsregel braucht daher zwei Pfade (ODER-verknüpft):
//   a) lokal:   studio ist gesetzt UND Caller ist Member dieses Studios
//   b) geteilt: über personStudioLinks_via_person (Back-Relation) verlinkt an
//               ein Studio, dessen Member der Caller ist
// Schreibzugriff bleibt beim gleichen Muster wie bisher (memberRule) — wer in
// einem der beiden Pfade berechtigt ist, darf auch schreiben. Das eigentliche
// Globalisieren (studio -> "" + Link anlegen) passiert ausschliesslich über den
// create-studio-Hook (studios.pb.js), nicht durch Client-Direct-Writes.

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");
  const persons = app.findCollectionByNameOrId("persons");

  const personStudioLinks = new Collection({
    type: "base",
    name: "personStudioLinks",
    fields: [
      { name: "person", type: "relation", required: true, collectionId: persons.id, cascadeDelete: true, maxSelect: 1 },
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "primaryStudio", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_personStudioLinks_person_studio ON personStudioLinks (person, studio)"],
    // Sichtbar für Member des verlinkten Studios — Schreiben nur über den
    // create-studio-Hook (kein Direkt-Write vom Client, gleiches Muster wie studioMembers).
    listRule: "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true",
    viewRule: "@request.auth.id != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(personStudioLinks);

  const localRule =
    "@request.auth.id != '' && " +
    "studio != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true";
  const personRule =
    "@request.auth.id != '' && (" +
    "(studio != '' && studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true)" +
    " || " +
    "(personStudioLinks_via_person.studio.studioMembers_via_studio.user ?= @request.auth.id && personStudioLinks_via_person.studio.studioMembers_via_studio.active = true)" +
    ")";
  persons.listRule = personRule;
  persons.viewRule = personRule;
  // createRule kann KEINE Back-Relation (`_via_`) verwenden — der Record existiert
  // zum Zeitpunkt der Rule-Auswertung noch nicht, es gibt nichts, von dem aus
  // personStudioLinks zurückverlinken könnte ("create rule build expression
  // failure: invalid collection reference of a back relation field"). Praktisch
  // kein Problem: neue Personen entstehen im Client immer lokal (studio gesetzt)
  // — geteilt werden sie ausschliesslich serverseitig über den create-studio-Hook
  // (läuft mit vollen Rechten, umgeht Rules).
  persons.createRule = localRule;
  persons.updateRule = personRule;
  persons.deleteRule = personRule;
  app.save(persons);
}, (app) => {
  const persons = app.findCollectionByNameOrId("persons");
  const memberRule =
    "@request.auth.id != '' && " +
    "studio.studioMembers_via_studio.user ?= @request.auth.id && " +
    "studio.studioMembers_via_studio.active = true";
  persons.listRule = memberRule;
  persons.viewRule = memberRule;
  persons.createRule = memberRule;
  persons.updateRule = memberRule;
  persons.deleteRule = memberRule;
  app.save(persons);

  const personStudioLinks = app.findCollectionByNameOrId("personStudioLinks");
  if (personStudioLinks) app.delete(personStudioLinks);
});
