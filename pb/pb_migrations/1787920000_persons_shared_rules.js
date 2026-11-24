/// <reference path="../pb_data/types.d.ts" />
// Geteilte Kontakte (Audit 24.11.2026, Runde 4): Beim Anlegen eines Büros mit «Kontakte teilen» werden Personen
// büroübergreifend (studio = '', Verknüpfung über personStudioLinks). Die Rechteprüfung aus 1787860000_role_rules.js
// hing an `studio.studioMembers_via_studio.perms` — bei leerem studio immer falsch: geteilte Kontakte konnte seither
// NIEMAND mehr ändern, auch der Admin nicht.
// Neu prüft jede der beiden Zugangsarten das Recht auf IHREM Pfad (eigenes Büro bzw. verknüpftes Büro), damit
// «?=»/«?~» auf derselben Mitgliedschaftszeile ausgewertet werden.

migrate((app) => {
  const A = "studio.studioMembers_via_studio";
  const B = "personStudioLinks_via_person.studio.studioMembers_via_studio";
  const inA = `studio != '' && ${A}.user ?= @request.auth.id && ${A}.active ?= true`;
  const inB = `${B}.user ?= @request.auth.id && ${B}.active ?= true`;
  const permA = `(${A}.perms ?~ '|personen|' || ${A}.perms ?~ '|*|')`;
  const permB = `(${B}.perms ?~ '|personen|' || ${B}.perms ?~ '|*|')`;
  const write = `@request.auth.id != '' && ((${inA} && ${permA}) || (${inB} && ${permB}))`;
  const c = app.findCollectionByNameOrId("persons");
  c.updateRule = `${write} && (@request.body.studio:isset = false || @request.body.studio = studio)`;
  c.deleteRule = write;
  c.createRule = `@request.auth.id != '' && ${inA} && ${permA}`;
  app.save(c);
}, (app) => {
  const M = "studio.studioMembers_via_studio";
  const read = `@request.auth.id != '' && ((studio != '' && ${M}.user ?= @request.auth.id && ${M}.active ?= true) || (personStudioLinks_via_person.studio.studioMembers_via_studio.user ?= @request.auth.id && personStudioLinks_via_person.studio.studioMembers_via_studio.active ?= true))`;
  const perm = `(${M}.perms ?~ '|personen|' || ${M}.perms ?~ '|*|')`;
  const c = app.findCollectionByNameOrId("persons");
  c.updateRule = `((${read}) && (@request.body.studio:isset = false || @request.body.studio = studio)) && ${perm}`;
  c.deleteRule = `(${read}) && ${perm}`;
  c.createRule = `(@request.auth.id != '' && studio != '' && ${M}.user ?= @request.auth.id && ${M}.active ?= true) && ${perm}`;
  app.save(c);
});
