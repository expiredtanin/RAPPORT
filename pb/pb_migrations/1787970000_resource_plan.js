/// <reference path="../pb_data/types.d.ts" />
// Interner Ressourcenplan (AppData.resourcePlan): wer arbeitet an was von–bis zu wie viel Prozent.
// Collection resourcePlans (App-Ids wie bei absences, kein Audit-Zwang):
//  - employee: Pflicht, cascadeDelete — wer gelöscht wird, nimmt seine Plan-Einträge mit (der Löschschutz für
//    Mitarbeitende in integrity.pb.js prüft Plan-Einträge bewusst nicht)
//  - project: optional, kein cascadeDelete (Projekt löschen leert nur den Verweis; PocketBase setzt ihn auf leer)
//  - pensum 1…100, Datum im selben Bereich wie Absenzen (1787890000_field_validation.js)
// Regeln wie in 1787860000_role_rules.js (Rechte der eigenen Mitgliedschaft über studio.studioMembers_via_studio.perms):
//  - Lesen: «termine», «projects», «mitarbeiter» oder Vollzugriff
//  - Anlegen/Ändern/Löschen: «mitarbeiter» oder Vollzugriff
// dateTo ≥ dateFrom, gleiches Büro bei Mitarbeiter/Projekt prüft pb_hooks/integrity.pb.js.

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");
  const employees = app.findCollectionByNameOrId("employees");
  const projects = app.findCollectionByNameOrId("projects");
  const M = "studio.studioMembers_via_studio";
  const member =
    "@request.auth.id != '' && " +
    `${M}.user ?= @request.auth.id && ` +
    `${M}.active = true`;
  const has = (p) => `${M}.perms ?~ '|${p}|'`;
  const full = `${M}.perms ?~ '|*|'`;
  const readRule = `(${member}) && (${has("termine")} || ${has("projects")} || ${has("mitarbeiter")} || ${full})`;
  const writeRule = `(${member}) && (${has("mitarbeiter")} || ${full})`;
  const uuidId = { name: "id", type: "text", primaryKey: true, required: true, system: true, autogeneratePattern: "", pattern: "^[a-zA-Z0-9-]+$", min: 1, max: 64 };
  const rel = (name, target, required, cascadeDelete) =>
    ({ name, type: "relation", required, collectionId: target.id, cascadeDelete, maxSelect: 1 });
  const dmin = new DateTime("2000-01-01 00:00:00.000Z"), dmax = new DateTime("2100-12-31 23:59:59.999Z");

  const c = new Collection({
    type: "base", name: "resourcePlans",
    fields: [
      uuidId,
      rel("studio", studios, true, true),
      rel("employee", employees, true, true),
      rel("project", projects, false, false),
      { name: "label", type: "text", max: 200 },
      { name: "dateFrom", type: "date", min: dmin, max: dmax },
      { name: "dateTo", type: "date", min: dmin, max: dmax },
      { name: "pensum", type: "number", min: 1, max: 100 },
      { name: "note", type: "text", max: 2000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_resourcePlans_studio ON resourcePlans (studio)"],
    listRule: readRule, viewRule: readRule, createRule: writeRule, updateRule: writeRule, deleteRule: writeRule,
  });
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("resourcePlans");
  if (c) app.delete(c);
});
