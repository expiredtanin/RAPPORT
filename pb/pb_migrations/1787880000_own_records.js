/// <reference path="../pb_data/types.d.ts" />
// Eigene Datensätze ohne Personal-/Spesenrecht (24.11.2026). Bisher sah ein Mitarbeiter ohne Recht «mitarbeiter»
// im Cloud-Betrieb nicht einmal den eigenen Mitarbeiter-Datensatz (Soll, Pensum → Zeiterfassung ohne Saldo), keine
// eigenen Ferien/Absenzen und konnte weder Ferien beantragen noch Spesen erfassen.
//
// Neu, zusätzlich zum Recht der Rolle (Regeln aus 1787860000_role_rules.js werden erweitert, nicht ersetzt):
//  - employees: den eigenen Datensatz lesen (appUser = ich).
//  - vacationEntries, absences: eigene lesen; eigene ANTRÄGE anlegen, ändern und zurückziehen, solange sie
//    «pending» sind und bleiben — genehmigen (status «approved») kann nur, wer das Recht «mitarbeiter» hat.
//  - overtimeClosings: eigene lesen.
//  - expenses: eigene lesen; eigene Spesen anlegen, ändern und löschen, solange sie «offen» sind und bleiben —
//    genehmigen/auszahlen nur mit Recht «expenses».
// Die Hooks in permissions.pb.js lassen eigene Datensätze entsprechend durch; Status und Besitz prüfen die Regeln.

migrate((app) => {
  const M = "studio.studioMembers_via_studio";
  const TAIL = `|| ${M}.perms ?~ '|*|')`;
  // Zusatz an die Rechte-Klammer am Ende der Regel hängen: «(… || … '|*|')» → «(… || … '|*|' || (X))»
  const widen = (rule, extra) => {
    if (rule === null || rule === undefined) return rule;
    const s = String(rule);
    if (s.includes(extra)) return s;   // schon erweitert
    const i = s.lastIndexOf(TAIL);
    if (i < 0) throw new Error("Regel hat nicht die erwartete Form: " + s);
    return s.slice(0, i) + `|| ${M}.perms ?~ '|*|' || (${extra}))` + s.slice(i + TAIL.length);
  };
  const OWN = "employee.appUser = @request.auth.id";
  const noMove = "(@request.body.employee:isset = false || @request.body.employee.appUser = @request.auth.id)";
  const plan = {
    employees: { listRule: "appUser = @request.auth.id", viewRule: "appUser = @request.auth.id" },
    overtimeClosings: { listRule: OWN, viewRule: OWN },
  };
  for (const [name, st] of [["vacationEntries", "pending"], ["absences", "pending"], ["expenses", "offen"]]) {
    plan[name] = {
      listRule: OWN,
      viewRule: OWN,
      createRule: `${OWN} && status = '${st}'`,
      updateRule: `${OWN} && status = '${st}' && (@request.body.status:isset = false || @request.body.status = '${st}') && ${noMove}`,
      deleteRule: `${OWN} && status = '${st}'`,
    };
  }
  for (const [name, rules] of Object.entries(plan)) {
    const c = app.findCollectionByNameOrId(name);
    for (const [k, extra] of Object.entries(rules)) c[k] = widen(c[k], extra);
    app.save(c);
  }
}, (app) => {
  const strip = (rule) => {
    if (rule === null || rule === undefined) return rule;
    const s = String(rule);
    const i = s.lastIndexOf("'|*|' || (");
    if (i < 0) return s;
    // «'|*|' || (X))» am Ende → «'|*|')»
    let depth = 0, j = i + "'|*|' || ".length;
    for (; j < s.length; j++) { if (s[j] === "(") depth++; else if (s[j] === ")") { depth--; if (depth === 0) break; } }
    return s.slice(0, i) + "'|*|'" + s.slice(j + 1);
  };
  for (const name of ["employees", "overtimeClosings", "vacationEntries", "absences", "expenses"]) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) c[k] = strip(c[k]);
    app.save(c);
  }
});
