/// <reference path="../pb_data/types.d.ts" />
// Fehlende Indizes für die Abfragen, die die App bei JEDEM Laden/Speichern stellt
// (Audit 20.11.2026):
//
// - Jede synchronisierte Collection wird mit `studio = "<id>"` gelesen (load(),
//   loadPartial(), _syncTable()); die Zugriffsregeln laufen zusätzlich über die
//   studio-Relation. absences, vacationEntries, payrollEntries und overtimeClosings
//   hatten keinen Index mit `studio` vorne (nur employee-zuerst bzw. gar keinen) →
//   SQLite musste die ganze Tabelle lesen.
// - studioMembers wird beim Login nach `user` gefiltert (signIn()/myStudios()), der
//   bestehende Unique-Index beginnt mit `studio` und hilft dort nicht.
// - personStudioLinks wird über `studio` gesucht (Personen-Filter
//   personStudioLinks_via_person.studio ?= …, create-studio-Hook); der Unique-Index
//   beginnt mit `person`.
// - overtimeClosings.employee: Relation ohne Index (Kaskadenlöschung beim Löschen
//   eines Mitarbeiters sucht danach).
//
// Nur additive Indizes, keine Schemaänderung.

migrate((app) => {
  const ADD = {
    absences: ["CREATE INDEX idx_absences_studio ON absences (studio)"],
    vacationEntries: ["CREATE INDEX idx_vacationEntries_studio ON vacationEntries (studio)"],
    payrollEntries: ["CREATE INDEX idx_payrollEntries_studio ON payrollEntries (studio)"],
    overtimeClosings: [
      "CREATE INDEX idx_overtimeClosings_studio ON overtimeClosings (studio)",
      "CREATE INDEX idx_overtimeClosings_employee ON overtimeClosings (employee)",
    ],
    studioMembers: ["CREATE INDEX idx_studioMembers_user ON studioMembers (user)"],
    personStudioLinks: ["CREATE INDEX idx_personStudioLinks_studio ON personStudioLinks (studio)"],
  };
  for (const name in ADD) {
    const c = app.findCollectionByNameOrId(name);
    for (const idx of ADD[name]) {
      if (!c.indexes.includes(idx)) c.indexes.push(idx);
    }
    app.save(c);
  }
}, (app) => {
  const DROP = {
    absences: ["idx_absences_studio"],
    vacationEntries: ["idx_vacationEntries_studio"],
    payrollEntries: ["idx_payrollEntries_studio"],
    overtimeClosings: ["idx_overtimeClosings_studio", "idx_overtimeClosings_employee"],
    studioMembers: ["idx_studioMembers_user"],
    personStudioLinks: ["idx_personStudioLinks_studio"],
  };
  for (const name in DROP) {
    const c = app.findCollectionByNameOrId(name);
    c.indexes = c.indexes.filter((idx) => !DROP[name].some((n) => idx.includes(" " + n + " ")));
    app.save(c);
  }
});
