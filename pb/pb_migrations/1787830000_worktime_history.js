/// <reference path="../pb_data/types.d.ts" />
// Zeiterfassung mit Vorgeschichte (RAPPORT-APP: worktime.ts):
//   employees.saldoStichtag          Stichtag des Saldo-Übertrags (Umstieg von Excel o.ä.); davor zählt nichts.
//   employees.saldoUebertragStunden  Überstundensaldo per Stichtag in Stunden (kann negativ sein).
//   employees.pensumVerlauf          Pensumwechsel [{ ab, pensum, wochenstunden? }] (JSON).
// Ferienguthaben per Stichtag nutzt das bestehende ferienUebertragVorjahr; der Kanton der Feiertags-Vorlage
// liegt in studioSettings.ui (freies JSON, keine Spalte nötig).
// Rechte wie die übrigen Felder der Collection (pb_hooks/permissions.pb.js), keine eigene Regel nötig.

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.add(new Field({ name: "saldoStichtag", type: "date" }));
  employees.fields.add(new Field({ name: "saldoUebertragStunden", type: "number" }));
  employees.fields.add(new Field({ name: "pensumVerlauf", type: "json" }));
  app.save(employees);
}, (app) => {
  const employees = app.findCollectionByNameOrId("employees");
  for (const n of ["saldoStichtag", "saldoUebertragStunden", "pensumVerlauf"]) employees.fields.removeByName(n);
  app.save(employees);
});
