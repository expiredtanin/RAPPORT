/// <reference path="../pb_data/types.d.ts" />
// Büro-Einstellungen schreiben: neben «settings» auch mit Recht «projects» oder «quotes» — aber nur für den
// Projektnummern-Zähler (lastProjectSeq/Year). Welche Felder wer ändert, prüft pb_hooks/memberperms.pb.js: ohne
// «settings» ausschliesslich der Zähler. Vorher meldete eine eigene Rolle mit «Projekte», aber ohne «Einstellungen»
// beim Anlegen eines Projekts «Speichern fehlgeschlagen» (Review Runde 16, 25.11.2026).
const M = "studio.studioMembers_via_studio";
const OLD = `${M}.perms ?~ '|settings|'`;
const NEW = `(${M}.perms ?~ '|settings|' || ${M}.perms ?~ '|projects|' || ${M}.perms ?~ '|quotes|')`;

migrate((app) => {
  const c = app.findCollectionByNameOrId("studioSettings");
  const r = String(c.updateRule || "");
  if (!r.includes(NEW) && r.includes(OLD)) { c.updateRule = r.replace(OLD, NEW); app.save(c); }
}, (app) => {
  const c = app.findCollectionByNameOrId("studioSettings");
  const r = String(c.updateRule || "");
  if (r.includes(NEW)) { c.updateRule = r.replace(NEW, OLD); app.save(c); }
});
