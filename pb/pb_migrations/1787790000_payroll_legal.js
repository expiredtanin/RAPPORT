/// <reference path="../pb_data/types.d.ts" />
// Löhne und Buchhaltung nach Gesetz (RAPPORT-APP: utils calcLohn, accounting.ts):
//   employees.austrittsdatum   Austritt; letzter Monat anteilig nach Kalendertagen.
//   employees.pkBeitragAN/AG   Pensionskasse laut PK-Ausweis in CHF pro Monat (ersetzt den %-Satz).
//   employees.familienzulagen  Kinder-/Ausbildungszulagen CHF pro Monat (nicht AHV-pflichtig).
//   employees.ahvRentner       AHV-Rentner:in (Freibetrag, keine ALV/BVG); ab 65 auch aus dem Geburtsdatum.
//   internalExpenses.recurringUntil  Ende einer wiederkehrenden Ausgabe (leer = läuft weiter).
// MWST-Methode und weitere AG-Sätze liegen in studioSettings.ui (freies JSON, keine Spalte nötig).
// Rechte wie die übrigen Felder der Collections (pb_hooks/permissions.pb.js), keine eigene Regel nötig.

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.add(new Field({ name: "austrittsdatum", type: "date" }));
  employees.fields.add(new Field({ name: "pkBeitragAN", type: "number", min: 0 }));
  employees.fields.add(new Field({ name: "pkBeitragAG", type: "number", min: 0 }));
  employees.fields.add(new Field({ name: "familienzulagen", type: "number", min: 0 }));
  employees.fields.add(new Field({ name: "ahvRentner", type: "bool" }));
  app.save(employees);

  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.add(new Field({ name: "recurringUntil", type: "date" }));
  app.save(internalExpenses);
}, (app) => {
  const employees = app.findCollectionByNameOrId("employees");
  for (const n of ["austrittsdatum", "pkBeitragAN", "pkBeitragAG", "familienzulagen", "ahvRentner"]) employees.fields.removeByName(n);
  app.save(employees);

  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.removeByName("recurringUntil");
  app.save(internalExpenses);
});
