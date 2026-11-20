/// <reference path="../pb_data/types.d.ts" />
// Korrigiert zwei Lücken in den Studio-Zugriffsregeln aller Collections
// (empirisch gegen PocketBase 0.39.11 nachgewiesen, Audit 20.11.2026):
//
// 1. «active = true» ohne «?» heisst in PocketBase bei mehrwertigen Pfaden
//    (Back-Relation studioMembers_via_studio) «ALLE Mitglieder des Studios sind
//    aktiv» — nicht «MEINE Mitgliedschaft ist aktiv». Sobald ein einziges Mitglied
//    deaktiviert wurde (active = false, z.B. im Admin-Dashboard), sah niemand im
//    Studio mehr Daten (Listen leer, Anlegen scheiterte). Richtig ist «?= true»:
//    Bedingungen mit «?=» auf demselben Pfad werden von PocketBase über denselben
//    Join ausgewertet, gelten also für dieselbe Mitgliedschaftszeile wie
//    «user ?= @request.auth.id» (gleiches Verhalten wie bei appRoleId ?= "r-admin"
//    in 1787681205_updated_appRoles.js, dort ebenfalls nachgeprüft).
//
// 2. Die updateRule prüfte nur das Studio des BESTEHENDEN Datensatzes. Ein Mitglied
//    konnte einen Datensatz per PATCH {studio: "<fremdes Studio>"} in ein Studio
//    verschieben, in dem es gar nicht Mitglied ist (z.B. einen Pinnwand-Beitrag in
//    ein fremdes Büro einschleusen). Neu darf «studio» bei einem Update nicht
//    geändert werden. Die App schickt das Feld bei Updates entweder unverändert
//    (gleicher Wert, erlaubt) oder gar nicht (Personen, siehe _syncPersons()).
//
// Generisch über alle Collections, damit auch per Admin-UI geänderte Regeln
// (z.B. appRoles) erfasst werden. Gesperrte Regeln (null = nur Superuser) bleiben
// unverändert.

migrate((app) => {
  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
  const GUARD = " && (@request.body.studio:isset = false || @request.body.studio = studio)";
  // Regeln sind in der JSVM Go-Zeiger (*string): typeof "object", null = gesperrt.
  const ruleText = (r) => (r === null || r === undefined ? null : String(r));
  for (const c of app.findAllCollections()) {
    if (c.system) continue;
    let changed = false;
    for (const k of RULES) {
      const rule = ruleText(c[k]);
      if (rule === null || !rule.includes("studioMembers_via_studio.active = true")) continue;
      c[k] = rule.split("studioMembers_via_studio.active = true").join("studioMembers_via_studio.active ?= true");
      changed = true;
    }
    const studioField = c.fields.getByName("studio");
    const upd = ruleText(c.updateRule);
    if (studioField && studioField.type() === "relation" && upd !== null && upd !== "" && !upd.endsWith(GUARD)) {
      c.updateRule = "(" + upd + ")" + GUARD;
      changed = true;
    }
    if (changed) app.save(c);
  }
}, (app) => {
  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
  const GUARD = " && (@request.body.studio:isset = false || @request.body.studio = studio)";
  // Regeln sind in der JSVM Go-Zeiger (*string): typeof "object", null = gesperrt.
  const ruleText = (r) => (r === null || r === undefined ? null : String(r));
  for (const c of app.findAllCollections()) {
    if (c.system) continue;
    let changed = false;
    const upd = ruleText(c.updateRule);
    if (upd !== null && upd.endsWith(GUARD) && upd.startsWith("(")) {
      c.updateRule = upd.slice(1, upd.length - GUARD.length - 1);
      changed = true;
    }
    for (const k of RULES) {
      const rule = ruleText(c[k]);
      if (rule === null || !rule.includes("studioMembers_via_studio.active ?= true")) continue;
      c[k] = rule.split("studioMembers_via_studio.active ?= true").join("studioMembers_via_studio.active = true");
      changed = true;
    }
    if (changed) app.save(c);
  }
});
