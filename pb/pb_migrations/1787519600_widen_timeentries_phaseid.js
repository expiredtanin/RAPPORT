/// <reference path="../pb_data/types.d.ts" />
// timeEntries.phaseId war auf 20 Zeichen begrenzt — reicht für SIA-Phasen-IDs
// ("31", "52", …), aber nicht für Custom-Phasen: Projects.jsx generiert deren
// IDs als "cp_" + generateId() (crypto.randomUUID(), 36 Zeichen) = 39 Zeichen.
// Jeder Zeiteintrag auf einer Custom-Phase wäre bisher am Schema gescheitert.

migrate((app) => {
  const timeEntries = app.findCollectionByNameOrId("timeEntries");
  timeEntries.fields.getByName("phaseId").max = 64;
  app.save(timeEntries);
}, (app) => {
  const timeEntries = app.findCollectionByNameOrId("timeEntries");
  timeEntries.fields.getByName("phaseId").max = 20;
  app.save(timeEntries);
});
