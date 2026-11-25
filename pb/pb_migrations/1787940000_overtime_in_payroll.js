/// <reference path="../pb_data/types.d.ts" />
// Überstunden-Auszahlungen laufen seit 25.11.2026 über den Lohnlauf (AHV/ALV/UVG/QST). Kennzeichen «imLohn» am
// Datensatz: nur damit erfasste Auszahlungen übernimmt der Lohnlauf (früher erfasste wurden separat bezahlt).
migrate((app) => {
  const c = app.findCollectionByNameOrId("overtimeClosings");
  if (!c.fields.getByName("imLohn")) c.fields.add(new Field({ name: "imLohn", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("overtimeClosings");
  c.fields.removeByName("imLohn");
  app.save(c);
});
