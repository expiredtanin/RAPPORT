/// <reference path="../pb_data/types.d.ts" />
// E2E-Test Cloud 24.11.2026:
//  - «Mein Profil»: Mitarbeiter ohne Recht «mitarbeiter» konnten ihre Adresse nicht speichern (Regel 404, die App
//    meldete trotzdem Erfolg). Neu darf man den eigenen Mitarbeiter-Datensatz ändern; WELCHE Felder (nur adresse,
//    ort), prüft pb_hooks/integrity.pb.js.
//  - Spesen: amount war «required» — bei Zahlen heisst das in PocketBase «≠ 0». Eine Spese, die in der Tageserfassung
//    zuerst ohne Betrag angelegt wird, scheiterte mit 400 und blockierte alle späteren Speicherungen. Neu optional,
//    aber nicht negativ (expenses) bzw. optional (internalExpenses, Gutschriften möglich).

migrate((app) => {
  const M = "studio.studioMembers_via_studio";
  const TAIL = `|| ${M}.perms ?~ '|*|')`;
  const OWN = "appUser = @request.auth.id";
  const emp = app.findCollectionByNameOrId("employees");
  const u = emp.updateRule === null || emp.updateRule === undefined ? null : String(emp.updateRule);
  if (u && !u.includes(`|| (${OWN}))`)) {
    const i = u.lastIndexOf(TAIL);
    if (i < 0) throw new Error("employees.updateRule hat nicht die erwartete Form: " + u);
    emp.updateRule = u.slice(0, i) + `|| ${M}.perms ?~ '|*|' || (${OWN}))` + u.slice(i + TAIL.length);
  }
  app.save(emp);

  const ex = app.findCollectionByNameOrId("expenses");
  const a1 = ex.fields.getByName("amount");
  if (a1) { a1.required = false; a1.min = 0; }
  app.save(ex);
  const ie = app.findCollectionByNameOrId("internalExpenses");
  const a2 = ie.fields.getByName("amount");
  if (a2) a2.required = false;
  app.save(ie);
}, (app) => {
  const OWN = "appUser = @request.auth.id";
  const emp = app.findCollectionByNameOrId("employees");
  if (emp.updateRule) emp.updateRule = String(emp.updateRule).replace(` || (${OWN}))`, ")");
  app.save(emp);
  const ex = app.findCollectionByNameOrId("expenses");
  const a1 = ex.fields.getByName("amount");
  if (a1) { a1.required = true; a1.min = null; }
  app.save(ex);
  const ie = app.findCollectionByNameOrId("internalExpenses");
  const a2 = ie.fields.getByName("amount");
  if (a2) a2.required = true;
  app.save(ie);
});
