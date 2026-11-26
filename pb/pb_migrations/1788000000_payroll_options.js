/// <reference path="../pb_data/types.d.ts" />
// Lohn-Optionen (RAPPORT-APP: utils.ts calcLohn, accounting.ts lohnVorperioden):
//   employees.dreizehnterModus  Auszahlung des 13. Monatslohns nur für diese Person übersteuern
//                               ("" = Einstellung des Büros; monatlich | november | dezember)
//   employees.lohnVorsystem     [{ jahr, bisMonat, brutto, alvBasis, dreizehnter, monatslohnSumme }] (JSON):
//                               Lohnsummen aus dem Vorsystem bei einem Umstieg mitten im Jahr
// Die Büro-Einstellungen (dreizehnterModus, lohnAuszahlungRunden5) liegen im freien JSON studioSettings.ui
// (keine Spalte) und sind dort wie die übrigen Lohn-Einstellungen nur für Admins änderbar.
migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  if (!employees.fields.getByName("dreizehnterModus")) {
    employees.fields.add(new Field({ name: "dreizehnterModus", type: "select", maxSelect: 1, values: ["monatlich", "november", "dezember"] }));
  }
  if (!employees.fields.getByName("lohnVorsystem")) {
    employees.fields.add(new Field({ name: "lohnVorsystem", type: "json" }));
  }
  app.save(employees);
}, (app) => {
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.removeByName("dreizehnterModus");
  employees.fields.removeByName("lohnVorsystem");
  app.save(employees);
});
