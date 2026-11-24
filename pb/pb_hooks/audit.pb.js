/// <reference path="../pb_data/types.d.ts" />
// Änderungsprotokoll (siehe pb_migrations/1787910000_audit_log.js): nach jeder erfolgreichen Änderung über die API
// an den unten genannten Collections ein Eintrag in auditLog mit Person, Aktion und den geänderten Feldern
// (alt → neu; lange Werte gekürzt). Ein Fehler beim Protokollieren bricht die eigentliche Änderung nicht ab.
// Wie in den anderen Hooks: jeder Callback in sich geschlossen.

onRecordCreateRequest((e) => {
  e.next();
  try {
    const r = e.record, uid = e.auth ? e.auth.id : "";
    const changes = {};
    for (const f of r.collection().fields) {
      const n = f.name;
      if (n === "id" || n === "created" || n === "updated" || n === "studio") continue;
      let v = JSON.stringify(r.get(n));
      if (v === undefined || v === '""' || v === "null" || v === "[]" || v === "{}" || v === "0" || v === "false") continue;
      if (v.length > 2000) v = v.slice(0, 2000) + "…";
      changes[n] = { neu: v };
    }
    const log = new Record(e.app.findCollectionByNameOrId("auditLog"));
    log.set("studio", r.get("studio")); log.set("user", uid && !e.hasSuperuserAuth() ? uid : "");
    log.set("userName", e.hasSuperuserAuth() ? "Superuser" : (e.auth ? (e.auth.getString("displayName") || e.auth.getString("email")) : ""));
    log.set("coll", r.collection().name); log.set("recordId", r.id); log.set("action", "create"); log.set("changes", changes);
    e.app.save(log);
  } catch (err) {
    console.log("audit create: " + err);
  }
}, "invoices", "payrollEntries", "overtimeClosings", "employees", "expenses", "vacationEntries");

onRecordUpdateRequest((e) => {
  const o = e.record.original();
  const before = {};
  for (const f of e.record.collection().fields) before[f.name] = JSON.stringify(o.get(f.name));
  e.next();
  try {
    const r = e.record, uid = e.auth ? e.auth.id : "";
    const changes = {};
    for (const f of r.collection().fields) {
      const n = f.name;
      if (n === "updated") continue;
      let a = before[n], b = JSON.stringify(r.get(n));
      if (a === b) continue;
      if (a && a.length > 2000) a = a.slice(0, 2000) + "…";
      if (b && b.length > 2000) b = b.slice(0, 2000) + "…";
      changes[n] = { alt: a, neu: b };
    }
    if (Object.keys(changes).length === 0) return;
    const log = new Record(e.app.findCollectionByNameOrId("auditLog"));
    log.set("studio", r.get("studio")); log.set("user", uid && !e.hasSuperuserAuth() ? uid : "");
    log.set("userName", e.hasSuperuserAuth() ? "Superuser" : (e.auth ? (e.auth.getString("displayName") || e.auth.getString("email")) : ""));
    log.set("coll", r.collection().name); log.set("recordId", r.id); log.set("action", "update"); log.set("changes", changes);
    e.app.save(log);
  } catch (err) {
    console.log("audit update: " + err);
  }
}, "invoices", "payrollEntries", "overtimeClosings", "employees", "expenses", "vacationEntries", "studioSettings");

onRecordDeleteRequest((e) => {
  const r = e.record;
  const snapshot = {};
  for (const f of r.collection().fields) {
    let v = JSON.stringify(r.get(f.name));
    if (v && v.length > 2000) v = v.slice(0, 2000) + "…";
    snapshot[f.name] = { alt: v };
  }
  const sid = r.get("studio"), coll = r.collection().name, rid = r.id;
  e.next();
  try {
    const uid = e.auth ? e.auth.id : "";
    const log = new Record(e.app.findCollectionByNameOrId("auditLog"));
    log.set("studio", sid); log.set("user", uid && !e.hasSuperuserAuth() ? uid : "");
    log.set("userName", e.hasSuperuserAuth() ? "Superuser" : (e.auth ? (e.auth.getString("displayName") || e.auth.getString("email")) : ""));
    log.set("coll", coll); log.set("recordId", rid); log.set("action", "delete"); log.set("changes", snapshot);
    e.app.save(log);
  } catch (err) {
    console.log("audit delete: " + err);
  }
}, "invoices", "payrollEntries", "overtimeClosings", "employees", "expenses", "vacationEntries");
