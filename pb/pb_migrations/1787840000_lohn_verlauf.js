/// <reference path="../pb_data/types.d.ts" />
// Lohnänderungen über die Zeit (RAPPORT-APP: utils.ts monatslohnAm/lohnImMonat):
//   employees.lohnVerlauf  [{ ab, monatslohn }] (JSON); `monatslohn` am Mitarbeiter gilt ab Eintritt.
// Familienzulagen anteilig und Vortag-Stunden liegen in studioSettings.ui (freies JSON, keine Spalte).
// Rechte wie die übrigen Felder der Collection (pb_hooks/permissions.pb.js).

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.add(new Field({ name: "lohnVerlauf", type: "json" }));
  app.save(employees);
}, (app) => {
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.removeByName("lohnVerlauf");
  app.save(employees);
});
