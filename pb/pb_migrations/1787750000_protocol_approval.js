/// <reference path="../pb_data/types.d.ts" />
// Genehmigungsvermerk pro Protokoll (RAPPORT-APP: Protocol.approval / approvalHours).
// approval: "unterschrift" | "stillschweigend" | "keine", leer = Vorgabe des Büros
// (settings.protokollApproval, liegt im ui-JSON von studio_settings und braucht keine Spalte).
// approvalHours: Frist für die stillschweigende Genehmigung, leer = Büro-Vorgabe (Standard 24).
// Kürzel der Teilnehmer liegen im bestehenden JSON-Feld participants und brauchen ebenfalls keine Spalte.

migrate((app) => {
  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.add(
    new Field({ name: "approval", type: "text", max: 20 }),
    new Field({ name: "approvalHours", type: "number", min: 0, onlyInt: true }),
  );
  app.save(protocols);
}, (app) => {
  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.removeByName("approval");
  protocols.fields.removeByName("approvalHours");
  app.save(protocols);
});
