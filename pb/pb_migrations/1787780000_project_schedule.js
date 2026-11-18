/// <reference path="../pb_data/types.d.ts" />
// Terminprogramm eines Projekts (RAPPORT-APP: Project.schedule, src/schedule.ts, views/schedule):
// { items: ScheduleItem[], baselines?: { planung?, bau? } } als JSON am Projekt — Planung und Bau in
// einer Liste (ScheduleItem.track). Bewusst keine eigene Collection: das Programm wird immer als
// Ganzes bearbeitet und gespeichert, Abhängigkeiten verweisen nur innerhalb des Projekts.
// Rechte wie das Projekt (pb_hooks/permissions.pb.js).

migrate((app) => {
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.add(new Field({ name: "schedule", type: "json", maxSize: 2000000 }));
  app.save(projects);
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.removeByName("schedule");
  app.save(projects);
});
