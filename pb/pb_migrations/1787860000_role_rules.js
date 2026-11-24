/// <reference path="../pb_data/types.d.ts" />
// Rollenrechte in die API-Regeln (Audit 24.11.2026, nachgewiesen gegen PocketBase 0.39.11).
//
// Bisher prüften nur Hooks (permissions.pb.js) die App-Rolle, und nur bei direkten Abfragen der gesperrten
// Collection. PocketBase wendet bei `expand`, bei Filtern über Relationen/Rück-Relationen und bei Realtime aber
// nur die Regeln an — die verlangten bloss Mitgliedschaft im Büro. Ein Mitarbeiter ohne Lohnrecht las so mit
// `timeEntries?expand=employee` oder `studios/<id>?expand=payrollEntries_via_studio` AHV-Nummern, Löhne und
// Rechnungen; Filter wie `employees_via_studio.monatslohn > 12000` verrieten Werte ohne expand.
//
// Neu:
//  - studioMembers.perms: die Rechte der Rolle als «|invoices|time|», Vollzugriff als «|*|». Gesetzt NUR vom
//    Server (Hook memberperms.pb.js bei jeder Änderung an Mitgliedschaft oder Rolle); Clients können
//    studioMembers nicht schreiben (Regeln null).
//  - Die Regeln prüfen perms auf demselben Pfad wie die Mitgliedschaft. Bedingungen mit «?=»/«?~» auf
//    studio.studioMembers_via_studio werden über denselben Join ausgewertet, gelten also für MEINE
//    Mitgliedschaftszeile (nachgeprüft: der Vollzugriff eines anderen Mitglieds öffnet nichts).
//  - Gesperrte Collections: Lesen und Schreiben nur mit dem Recht (wie bisher die Hooks, jetzt auch über
//    expand/Filter/Realtime).
//  - Büro-Konfiguration (Rollen-Stundensätze, Feiertage, Absenztypen, Dashboard-Vorlagen, Briefpapier):
//    Schreiben nur mit Vollzugriff (vorher genügte «settings», das auch die Standardrolle Mitarbeiter hat).
//    studioSettings: Recht «settings»; welche Felder Nicht-Admins ändern dürfen, prüft memberperms.pb.js.
//  - timeEntries: Schreiben nur für den eigenen Mitarbeiter-Datensatz, ausser mit Recht «mitarbeiter» oder
//    Vollzugriff. blogPosts: nur eigene Beiträge anlegen/löschen (author), ausser mit Vollzugriff; beim Ändern
//    fremder Beiträge nur die eigene Stimme einer Umfrage (Hook memberperms.pb.js).

migrate((app) => {
  const M = "studio.studioMembers_via_studio";
  const has = (p) => `(${M}.perms ?~ '|${p}|' || ${M}.perms ?~ '|*|')`;
  const ADMIN = `${M}.perms ?~ '|*|'`;
  const READ_WRITE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
  };
  const WRITE = {
    persons: has("personen"), projects: has("projects"), protocols: has("protokolle"),
    deliveryNotes: has("lieferscheine"), letterTemplates: has("letters"), studioSettings: has("settings"),
    studioRoles: ADMIN, dashboardTemplates: ADMIN, absenceTypes: ADMIN, holidays: ADMIN, docAssets: ADMIN,
    timeEntries: `${has("time")} && (${M}.perms ?~ '|mitarbeiter|' || ${M}.perms ?~ '|*|' || employee.appUser = @request.auth.id)`,
  };
  const ownTimeOnUpdate = ` && (${M}.perms ?~ '|mitarbeiter|' || ${M}.perms ?~ '|*|' || @request.body.employee:isset = false || @request.body.employee.appUser = @request.auth.id)`;
  const blogOwn = `(author = @request.auth.id || ${ADMIN})`;

  // 1. Feld perms + Werte für bestehende Mitgliedschaften
  const members = app.findCollectionByNameOrId("studioMembers");
  if (!members.fields.getByName("perms")) {
    members.fields.add(new TextField({ name: "perms", max: 2000 }));
    app.save(members);
  }
  for (const m of app.findRecordsByFilter("studioMembers", "id != ''", "", 0, 0)) {
    const sid = m.get("studio"), rid = m.get("appRoleId");
    let perms = "";
    if (rid === "r-admin") perms = "|*|";
    else if (rid) {
      try {
        app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r} && permissions = null", { s: sid, r: rid });
        perms = "|*|";
      } catch {
        try {
          const role = app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r}", { s: sid, r: rid });
          let list = [];
          try { list = JSON.parse(role.getString("permissions") || "[]") || []; } catch { list = []; }
          perms = Array.isArray(list) && list.length ? "|" + list.map(String).join("|") + "|" : "";
        } catch { perms = ""; }
      }
    }
    m.set("perms", perms);
    app.saveNoValidate(m);
  }

  // 2. Regeln
  const add = (rule, clause) => (rule === null || rule === undefined ? null : `(${String(rule)}) && ${clause}`);
  const skip = (rule) => rule === null || rule === undefined || String(rule).includes(".perms ?~");
  for (const [name, perm] of Object.entries(READ_WRITE)) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) if (!skip(c[k])) c[k] = add(c[k], has(perm));
    app.save(c);
  }
  for (const [name, clause] of Object.entries(WRITE)) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["createRule", "updateRule", "deleteRule"]) {
      if (skip(c[k])) continue;
      c[k] = add(c[k], clause);
      if (name === "timeEntries" && k === "updateRule") c[k] += ownTimeOnUpdate;
    }
    app.save(c);
  }
  // updateRule ohne author-Zusatz: Abstimmen in Umfragen ändert fremde Beiträge (poll.votes); was Nicht-Autoren
  // dabei ändern dürfen (nur die eigene Stimme), prüft memberperms.pb.js
  const blog = app.findCollectionByNameOrId("blogPosts");
  for (const k of ["createRule", "deleteRule"]) if (!skip(blog[k])) blog[k] = add(blog[k], blogOwn);
  app.save(blog);
}, (app) => {
  // Zurück: Zusätze wieder abschneiden (alles ab dem ersten « && » nach der geklammerten Originalregel)
  const strip = (rule) => {
    if (rule === null || rule === undefined) return rule;
    const s = String(rule);
    if (!s.includes(".perms ?~") && !s.includes("author = @request.auth.id")) return s;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") { depth--; if (depth === 0) return s.slice(1, i); }
    }
    return s;
  };
  for (const name of ["invoices", "quotes", "contracts", "expenses", "internalExpenses", "payrollEntries", "employees", "absences",
    "vacationEntries", "overtimeClosings", "persons", "projects", "protocols", "deliveryNotes", "letterTemplates", "studioSettings",
    "studioRoles", "dashboardTemplates", "absenceTypes", "holidays", "docAssets", "timeEntries", "blogPosts"]) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) c[k] = strip(c[k]);
    app.save(c);
  }
  const members = app.findCollectionByNameOrId("studioMembers");
  const f = members.fields.getByName("perms");
  if (f) { members.fields.removeById(f.id); app.save(members); }
});
