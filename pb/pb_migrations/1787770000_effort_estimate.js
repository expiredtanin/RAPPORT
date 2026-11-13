/// <reference path="../pb_data/types.d.ts" />
// Aufwandschätzung aus eigenen Projekten (RAPPORT-APP: utils calcOfficeBenchmarks/estimateEffort,
// Offerten-Modus «Aufwand» → quotes/EffortEstimatePanel):
//   projects.usage     Nutzung (wohnen | arbeiten | industrie | lager | bildung | gesundheit; leer = keine Angabe).
//                      Freies Textfeld wie persons.category: die Liste kennt die App (PROJECT_USAGES).
//   projects.floorArea Geschossfläche GF nach SIA 416 in m².
//   quotes.estimate    Grundlage einer übernommenen Schätzung { usage, floorArea, factor, sampleCount, hoursPerM2 }.
// Rechte wie die übrigen Felder der Collections (pb_hooks/permissions.pb.js), keine eigene Regel nötig.

migrate((app) => {
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.add(new Field({ name: "usage", type: "text", max: 40 }));
  projects.fields.add(new Field({ name: "floorArea", type: "number", min: 0 }));
  app.save(projects);

  const quotes = app.findCollectionByNameOrId("quotes");
  quotes.fields.add(new Field({ name: "estimate", type: "json", maxSize: 4000 }));
  app.save(quotes);
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.removeByName("usage");
  projects.fields.removeByName("floorArea");
  app.save(projects);

  const quotes = app.findCollectionByNameOrId("quotes");
  quotes.fields.removeByName("estimate");
  app.save(quotes);
});
