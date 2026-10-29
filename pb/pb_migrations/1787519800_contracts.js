/// <reference path="../pb_data/types.d.ts" />
// Vertragswesen: neue Collection "contracts". Entweder aus einer angenommenen
// Offerte konvertiert (quote-Relation gesetzt) oder eigenständig angelegt
// (v.a. für Fachplaner-Unteraufträge, contractType "unterauftrag"). Siehe
// RAPPORT-APP/src/views/Vertraege.jsx + src/views/Quotes.jsx (convertToVertrag).

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");
  const persons = app.findCollectionByNameOrId("persons");
  const projects = app.findCollectionByNameOrId("projects");
  const quotes = app.findCollectionByNameOrId("quotes");

  const memberRule =
    "@request.auth.id != '' && " +
    "studio.studioMembers_via_studio.user ?= @request.auth.id && " +
    "studio.studioMembers_via_studio.active = true";
  const rules = { listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule };
  const uuidId = { name: "id", type: "text", primaryKey: true, required: true, system: true, autogeneratePattern: "", pattern: "^[a-zA-Z0-9-]+$", min: 1, max: 64 };
  const audit = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const rel1 = (name, target, required = false, cascadeDelete = false) =>
    ({ name, type: "relation", required, collectionId: target.id, cascadeDelete, maxSelect: 1 });

  const contracts = new Collection({
    type: "base", name: "contracts",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "number", type: "text", max: 60 },
      { name: "client", ...rel1("client", persons, false, false) },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "quote", ...rel1("quote", quotes, false, false) },
      { name: "contractType", type: "select", maxSelect: 1, values: ["haupt", "unterauftrag"] },
      { name: "legalBasis", type: "text", max: 300 },
      { name: "billingType", type: "select", maxSelect: 1, values: ["pauschal", "stundensatz"] },
      { name: "amount", type: "number" },
      { name: "hourlyRate", type: "number" },
      { name: "paymentTerms", type: "text", max: 2000 },
      { name: "date", type: "date" },
      { name: "signedDate", type: "date" },
      { name: "status", type: "select", maxSelect: 1, values: ["entwurf", "unterzeichnet", "beendet"] },
      { name: "notes", type: "text", max: 5000 },
      ...audit,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_contracts_studio_number ON contracts (studio, number)",
      "CREATE INDEX idx_contracts_project ON contracts (project)",
    ],
    ...rules,
  });
  app.save(contracts);
}, (app) => {
  const contracts = app.findCollectionByNameOrId("contracts");
  if (contracts) app.delete(contracts);
});
