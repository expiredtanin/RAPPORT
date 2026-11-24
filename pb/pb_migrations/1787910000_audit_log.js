/// <reference path="../pb_data/types.d.ts" />
// Änderungsprotokoll (24.11.2026): Rechnungen, Lohnabrechnungen, Überstunden-Abschlüsse, Mitarbeiter-Stammdaten,
// Spesen, Ferien und Büro-Einstellungen liessen sich ändern, ohne dass festgehalten wurde, wer was geändert hat
// (Revisionssicherheit, z.B. eine bezahlte Rechnung nachträglich umgeschrieben). Die App erlaubt das Bearbeiten
// weiterhin; der Server schreibt jede Änderung mit Person, Zeit und alt → neu (pb_hooks/audit.pb.js).
// Schreiben nur der Server (Regeln null), lesen nur Mitglieder mit Vollzugriff; Einträge sind unveränderlich.

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");
  const users = app.findCollectionByNameOrId("users");
  const M = "studio.studioMembers_via_studio";
  const adminRead = `@request.auth.id != '' && ${M}.user ?= @request.auth.id && ${M}.active ?= true && ${M}.perms ?~ '|*|'`;
  const c = new Collection({
    type: "base", name: "auditLog",
    fields: [
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "user", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "userName", type: "text", max: 200 },
      { name: "coll", type: "text", required: true, max: 64 },
      { name: "recordId", type: "text", max: 64 },
      { name: "action", type: "select", required: true, maxSelect: 1, values: ["create", "update", "delete"] },
      { name: "changes", type: "json", maxSize: 200000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_auditLog_studio_created ON auditLog (studio, created)", "CREATE INDEX idx_auditLog_record ON auditLog (coll, recordId)"],
    listRule: adminRead, viewRule: adminRead, createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("auditLog"));
});
