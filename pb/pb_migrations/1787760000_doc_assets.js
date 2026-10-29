/// <reference path="../pb_data/types.d.ts" />
// Dokument-Design (RAPPORT-APP: data.docAssets, Einstellungen → Erscheinungsbild):
// hochgeladene Schriften und Briefpapier, eine Zeile pro Datei. `data` ist eine
// Base64-Data-URL als Text — gleiches Muster wie studioSettings.logo und
// expenses.receiptData (kein PocketBase-File-Upload, siehe 1787519900_calc_audit_fixes.js).
// kind: "font" | "letterheadFirst" | "letterheadFollow"; family/weight/style nur bei Schriften.
//
// Die übrigen Design-Einstellungen (Schriftwahl, Farben, eigenes CSS) liegen in
// studioSettings.ui.docDesign und brauchen keine Spalte.
// Rechte: lesbar für alle Mitglieder (jeder druckt), schreiben nur mit "settings"
// (pb_hooks/permissions.pb.js).

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");

  const memberRule =
    "@request.auth.id != '' && " +
    "studio.studioMembers_via_studio.user ?= @request.auth.id && " +
    "studio.studioMembers_via_studio.active = true";
  const rules = { listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule };
  const uuidId = { name: "id", type: "text", primaryKey: true, required: true, system: true, autogeneratePattern: "", pattern: "^[a-zA-Z0-9-]+$", min: 1, max: 64 };

  const docAssets = new Collection({
    type: "base", name: "docAssets",
    fields: [
      uuidId,
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["font", "letterheadFirst", "letterheadFollow"] },
      { name: "name", type: "text", max: 300 },
      { name: "family", type: "text", max: 120 },
      { name: "weight", type: "number", onlyInt: true },
      { name: "style", type: "text", max: 20 },
      { name: "data", type: "text", max: 15000000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_docAssets_studio ON docAssets (studio)"],
    ...rules,
  });
  app.save(docAssets);
}, (app) => {
  const docAssets = app.findCollectionByNameOrId("docAssets");
  if (docAssets) app.delete(docAssets);
});
