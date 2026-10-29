/// <reference path="../pb_data/types.d.ts" />
// Fundament-Schema: Auth (users-Erweiterung) + Studios + Settings + Personen + Projekte.
// Siehe Plan "keen-wiggling-platypus.md" — Rest der ~29 Entities folgt in späteren Migrationen.

migrate((app) => {
  // ── users: um username/displayName erweitern (ersetzt separate profiles-Tabelle) ──
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(
    new Field({ name: "username", type: "text", required: true, min: 1, max: 60, presentable: true }),
    new Field({ name: "displayName", type: "text", required: true, min: 1, max: 120, presentable: true }),
  );
  users.indexes.push("CREATE UNIQUE INDEX idx_users_username ON users (username)");
  // Jeder eingeloggte User sieht Anzeigenamen aller anderen (wie profiles_authenticated_read in Supabase).
  users.listRule = "@request.auth.id != ''";
  users.viewRule = "@request.auth.id != ''";
  app.save(users);

  // ── studios ──────────────────────────────────────────────────────────────
  const studios = new Collection({
    type: "base",
    name: "studios",
    fields: [
      { name: "name", type: "text", required: true, min: 1, max: 200 },
      { name: "slug", type: "text", required: true, min: 1, max: 100 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_studios_slug ON studios (slug)"],
    // Mitgliedschaft wird unten gesetzt (Feld existiert erst nach studioMembers) — vorerst
    // nur Superuser/Hooks. Rules werden am Ende der Migration nachgezogen (siehe unten).
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(studios);

  // ── studioMembers ────────────────────────────────────────────────────────
  const studioMembers = new Collection({
    type: "base",
    name: "studioMembers",
    fields: [
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "appRoleId", type: "text", required: true, max: 60 },
      { name: "active", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_studioMembers_studio_user ON studioMembers (studio, user)"],
    // Nur eigene Mitgliedschaften ODER Mitgliedschaften im selben Studio sichtbar.
    listRule: "user = @request.auth.id || (studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true)",
    viewRule: "user = @request.auth.id || (studio.studioMembers_via_studio.user ?= @request.auth.id && studio.studioMembers_via_studio.active = true)",
    // Schreiben nur über Hooks (create-studio, künftig invite) — kein Direkt-Write vom Client.
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(studioMembers);

  // Jetzt, wo studioMembers existiert, die Member-Access-Rule auf studios nachtragen:
  studios.listRule = "studioMembers_via_studio.user ?= @request.auth.id && studioMembers_via_studio.active = true";
  studios.viewRule = studios.listRule;
  app.save(studios);

  // ── Wiederverwendbares Rule-Muster für alle direkt studio-gebundenen Collections ──
  const memberRule =
    "@request.auth.id != '' && " +
    "studio.studioMembers_via_studio.user ?= @request.auth.id && " +
    "studio.studioMembers_via_studio.active = true";

  // Frontend generiert IDs selbst (crypto.randomUUID(), siehe utils.js) und referenziert
  // sie quer über JSON-Blobs (z.B. project.positions, invoice.entrySelections) — nicht nur
  // über echte Relation-Felder. Damit diese IDs 1:1 als PocketBase-Record-ID durchgereicht
  // werden können, muss der Default-Id-Pattern (15 Zeichen a-z0-9) auf UUID-kompatibel
  // erweitert werden. Gilt für JEDE Collection, deren Records vom Frontend mit eigener id
  // angelegt werden (aktuell persons, projects — künftige Entities übernehmen das Muster).
  const uuidIdField = { name: "id", type: "text", primaryKey: true, required: true, system: true, autogeneratePattern: "", pattern: "^[a-zA-Z0-9-]+$", min: 1, max: 64 };

  // ── studioSettings (1 Zeile pro Studio) ─────────────────────────────────
  const studioSettings = new Collection({
    type: "base",
    name: "studioSettings",
    fields: [
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "name", type: "text", max: 200 },
      { name: "address", type: "text", max: 500 },
      { name: "street", type: "text", max: 200 },
      { name: "zip", type: "text", max: 20 },
      { name: "city", type: "text", max: 100 },
      { name: "country", type: "text", max: 5 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 60 },
      { name: "iban", type: "text", max: 60 },
      { name: "ibanType", type: "select", maxSelect: 1, values: ["qr", "normal"] },
      { name: "mwstNr", type: "text", max: 60 },
      { name: "mwstRate", type: "number" },
      { name: "defaultHourlyRate", type: "number" },
      { name: "defaultWochenstunden", type: "number" },
      { name: "defaultFerienWochen", type: "number" },
      { name: "formats", type: "json" },
      { name: "pageMargins", type: "json" },
      { name: "ui", type: "json" },
      { name: "protokollTypeAbbr", type: "json" },
      { name: "logoUrl", type: "file", maxSelect: 1 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_studioSettings_studio ON studioSettings (studio)"],
    listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule,
  });
  app.save(studioSettings);

  // ── studioRoles (Rate-Profile PL/TS/BL/AS pro Studio) ───────────────────
  const studioRoles = new Collection({
    type: "base",
    name: "studioRoles",
    fields: [
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "roleId", type: "text", required: true, max: 60 },
      { name: "label", type: "text", required: true, max: 120 },
      { name: "rate", type: "number" },
      { name: "sort", type: "number" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_studioRoles_studio_roleId ON studioRoles (studio, roleId)"],
    listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule,
  });
  app.save(studioRoles);

  // ── persons ──────────────────────────────────────────────────────────────
  // studio-Relation bewusst NICHT required — global geteilte Personen (studio = null)
  // sind ein späteres Feature (person_studio_links-Äquivalent), Feld ist schon vorbereitet.
  const persons = new Collection({
    type: "base",
    name: "persons",
    fields: [
      uuidIdField,
      { name: "studio", type: "relation", required: false, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "personType", type: "text", max: 100 },
      { name: "isAuftraggeber", type: "bool" },
      { name: "isPartner", type: "bool" },
      { name: "street", type: "text", max: 200 },
      { name: "zip", type: "text", max: 20 },
      { name: "city", type: "text", max: 100 },
      { name: "country", type: "text", max: 5 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 60 },
      { name: "website", type: "text", max: 200 },
      { name: "note", type: "text", max: 5000 },
      { name: "contacts", type: "json" },
      { name: "honorarOffers", type: "json" },
    ],
    indexes: ["CREATE INDEX idx_persons_studio ON persons (studio)"],
    listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule,
  });
  app.save(persons);

  // ── projects ─────────────────────────────────────────────────────────────
  const projects = new Collection({
    type: "base",
    name: "projects",
    fields: [
      uuidIdField,
      { name: "studio", type: "relation", required: true, collectionId: studios.id, cascadeDelete: true, maxSelect: 1 },
      { name: "number", type: "text", max: 60 },
      { name: "name", type: "text", required: true, max: 300 },
      { name: "client", type: "relation", required: false, collectionId: persons.id, cascadeDelete: false, maxSelect: 1 },
      { name: "category", type: "text", max: 100 },
      { name: "billingType", type: "select", maxSelect: 1, values: ["stundensatz", "pauschal"] },
      { name: "hourlyRate", type: "number" },
      { name: "budget", type: "number" },
      { name: "budgetHours", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["aktiv", "pausiert", "abgeschlossen"] },
      { name: "description", type: "text", max: 5000 },
      { name: "startDate", type: "date" },
      { name: "enabledPhases", type: "json" },
      { name: "positions", type: "json" },
      { name: "customPhases", type: "json" },
      { name: "projectContacts", type: "json" },
      { name: "internalMembers", type: "json" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_projects_studio_number ON projects (studio, number)",
      "CREATE INDEX idx_projects_client ON projects (client)",
    ],
    listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule,
  });
  app.save(projects);

}, (app) => {
  for (const name of ["projects", "persons", "studioRoles", "studioSettings", "studioMembers", "studios"]) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("username");
  users.fields.removeByName("displayName");
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  app.save(users);
});
