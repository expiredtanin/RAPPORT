/// <reference path="../pb_data/types.d.ts" />
// Cloud-Test 25.11.2026: Ein Mitarbeiter ohne Recht «mitarbeiter» konnte genehmigte eigene Ferien nicht ändern —
// die Regel aus 1787880000_own_records.js verlangte «status = 'pending'» schon VOR der Änderung, der
// Änderungsantrag (approved → pending mit originalData, FerienTab/useFerienAntrag) scheiterte mit 404, und die App
// zeigte trotzdem die neuen Ferien. Neu darf der eigene Datensatz auch aus «approved» geändert werden, wenn die
// Anfrage originalData mitschickt; dass er dabei «pending» wird, prüft pb_hooks/integrity.pb.js. Ebenso darf ein
// eigener Änderungsantrag verworfen werden (pending mit originalData → approved mit den bisherigen Daten; der Hook
// prüft, dass genau originalData zurückkommt).

migrate((app) => {
  const OWN = "employee.appUser = @request.auth.id";
  const OLD = `${OWN} && status = 'pending' && (@request.body.status:isset = false || @request.body.status = 'pending')`;
  const NEW = `${OWN} && (status = 'pending' || (status = 'approved' && @request.body.originalData:isset = true)) && (@request.body.status:isset = false || @request.body.status = 'pending' || (status = 'pending' && @request.body.status = 'approved' && @request.body.originalData:isset = true))`;
  const c = app.findCollectionByNameOrId("vacationEntries");
  const u = String(c.updateRule || "");
  if (!u.includes(NEW)) {
    if (!u.includes(OLD)) throw new Error("vacationEntries.updateRule hat nicht die erwartete Form: " + u);
    c.updateRule = u.replace(OLD, NEW);
  }
  app.save(c);
}, (app) => {
  const OWN = "employee.appUser = @request.auth.id";
  const OLD = `${OWN} && status = 'pending' && (@request.body.status:isset = false || @request.body.status = 'pending')`;
  const NEW = `${OWN} && (status = 'pending' || (status = 'approved' && @request.body.originalData:isset = true)) && (@request.body.status:isset = false || @request.body.status = 'pending' || (status = 'pending' && @request.body.status = 'approved' && @request.body.originalData:isset = true))`;
  const c = app.findCollectionByNameOrId("vacationEntries");
  c.updateRule = String(c.updateRule || "").replace(NEW, OLD);
  app.save(c);
});
