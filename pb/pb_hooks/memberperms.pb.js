/// <reference path="../pb_data/types.d.ts" />
// Hält studioMembers.perms aktuell (siehe pb_migrations/1787860000_role_rules.js): die API-Regeln der gesperrten
// Collections prüfen dieses Feld, damit die App-Rolle auch bei expand, Filtern und Realtime greift.
//   perms = «|*|» bei Vollzugriff (r-admin oder appRoles.permissions = null), sonst «|recht|recht|», sonst «».
// Gesetzt bei jedem Speichern einer Mitgliedschaft (Einladen, Rolle wechseln, Aktivieren) und neu berechnet für
// alle Mitglieder einer Rolle, wenn die Rolle sich ändert oder gelöscht wird.
//
// Ausserdem: Büro-Einstellungen (studioSettings) darf ohne Vollzugriff nur in den Feldern ändern, wer sie in
// seiner Ansicht braucht und das Recht dazu hat (Spesenkategorien: expenses, Ausgabenkategorien: internal-expenses,
// Monatsabschluss: mitarbeiter, Büro-Budget: studio-budget) — IBAN, Adresse, MWST,
// Mahnwesen usw. bleiben dem Admin vorbehalten (vorher änderte jeder mit dem Recht «settings», das auch die
// Standardrolle Mitarbeiter hat, die IBAN der QR-Rechnungen).
//
// Wie in permissions.pb.js: jede Callback-Funktion ist in sich geschlossen (Top-Level-Helfer sind in der
// PocketBase-JSVM aus Callbacks nicht erreichbar).

onRecordCreate((e) => {
  const sid = e.record.get("studio"), rid = e.record.get("appRoleId");
  let perms = "";
  if (rid === "r-admin") perms = "|*|";
  else if (rid) {
    try {
      e.app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r} && permissions = null", { s: sid, r: rid });
      perms = "|*|";
    } catch {
      try {
        const role = e.app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r}", { s: sid, r: rid });
        let list = [];
        try { list = JSON.parse(role.getString("permissions") || "[]") || []; } catch { list = []; }
        // nur echte Rechtenamen (a-z, 0-9, -): «*» oder «|» in einer Rolle dürfen keinen Vollzugriff ergeben
        list = Array.isArray(list) ? list.map(String).filter(x => /^[a-z0-9-]+$/.test(x)) : [];
        perms = list.length ? "|" + list.join("|") + "|" : "";
      } catch { perms = ""; }
    }
  }
  e.record.set("perms", perms);
  e.next();
}, "studioMembers");

onRecordUpdate((e) => {
  const sid = e.record.get("studio"), rid = e.record.get("appRoleId");
  let perms = "";
  if (rid === "r-admin") perms = "|*|";
  else if (rid) {
    try {
      e.app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r} && permissions = null", { s: sid, r: rid });
      perms = "|*|";
    } catch {
      try {
        const role = e.app.findFirstRecordByFilter("appRoles", "studio = {:s} && roleId = {:r}", { s: sid, r: rid });
        let list = [];
        try { list = JSON.parse(role.getString("permissions") || "[]") || []; } catch { list = []; }
        // nur echte Rechtenamen (a-z, 0-9, -): «*» oder «|» in einer Rolle dürfen keinen Vollzugriff ergeben
        list = Array.isArray(list) ? list.map(String).filter(x => /^[a-z0-9-]+$/.test(x)) : [];
        perms = list.length ? "|" + list.join("|") + "|" : "";
      } catch { perms = ""; }
    }
  }
  e.record.set("perms", perms);
  e.next();
}, "studioMembers");

// Rolle angelegt, geändert oder gelöscht → Mitglieder mit dieser Rolle neu speichern (onRecordUpdate oben rechnet)
onRecordAfterCreateSuccess((e) => {
  const sid = e.record.get("studio"), rid = e.record.get("roleId");
  for (const m of e.app.findRecordsByFilter("studioMembers", "studio = {:s} && appRoleId = {:r}", "", 0, 0, { s: sid, r: rid })) e.app.save(m);
  e.next();
}, "appRoles");
onRecordAfterUpdateSuccess((e) => {
  const sid = e.record.get("studio"), rid = e.record.get("roleId");
  const old = e.record.original();
  const ids = [rid];
  if (old && old.get("roleId") && old.get("roleId") !== rid) ids.push(old.get("roleId"));
  for (const r of ids) {
    for (const m of e.app.findRecordsByFilter("studioMembers", "studio = {:s} && appRoleId = {:r}", "", 0, 0, { s: sid, r: r })) e.app.save(m);
  }
  e.next();
}, "appRoles");
onRecordAfterDeleteSuccess((e) => {
  const sid = e.record.get("studio"), rid = e.record.get("roleId");
  for (const m of e.app.findRecordsByFilter("studioMembers", "studio = {:s} && appRoleId = {:r}", "", 0, 0, { s: sid, r: rid })) e.app.save(m);
  e.next();
}, "appRoles");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const sid = e.record.get("studio");
  const authId = e.auth ? e.auth.id : "";
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: sid, u: authId }).getString("perms"); } catch { perms = ""; }
  if (perms.indexOf("|*|") < 0) {
    // ohne Vollzugriff: nur die Felder der eigenen Ansichten, jeweils an deren Recht gebunden (Audit 24.11.2026:
    // vorher hob ein Mitarbeiter per API den Monatsabschluss auf oder leerte die Budget-Versionen)
    const has = (p) => perms.indexOf("|" + p + "|") >= 0;
    const OPEN_FIELDS = { studioBudget: "studio-budget", studioBudgetVersions: "studio-budget" };
    const OPEN_UI = { expenseCategories: "expenses", internalExpenseCategories: "internal-expenses", closedMonths: "mitarbeiter" };
    const old = e.record.original();
    const changed = [];
    for (const f of e.record.collection().fields) {
      const n = f.name;
      if (n === "ui" || n === "updated") continue;
      if (OPEN_FIELDS[n] && has(OPEN_FIELDS[n])) continue;
      // Projektnummern-Zähler: wer Projekte anlegt (auch aus einer Offerte), zählt ihn hoch — vorher meldete
      // «Neues Projekt» ohne Admin «Speichern fehlgeschlagen» (Cloud-Test Runde 15); nur vorwärts
      if ((n === "lastProjectSeq" || n === "lastProjectYear") && (has("projects") || has("quotes"))) {
        const ny = e.record.getInt("lastProjectYear"), oy = old.getInt("lastProjectYear");
        if (ny > oy || (ny === oy && e.record.getInt("lastProjectSeq") >= old.getInt("lastProjectSeq"))) continue;
      }
      if (JSON.stringify(e.record.get(n)) !== JSON.stringify(old.get(n))) changed.push(n);
    }
    let uiNew = {}, uiOld = {};
    try { uiNew = JSON.parse(e.record.getString("ui") || "{}") || {}; } catch { uiNew = {}; }
    try { uiOld = JSON.parse(old.getString("ui") || "{}") || {}; } catch { uiOld = {}; }
    const keys = {};
    for (const k of Object.keys(uiNew)) keys[k] = 1;
    for (const k of Object.keys(uiOld)) keys[k] = 1;
    for (const k of Object.keys(keys)) {
      if (OPEN_UI[k] && has(OPEN_UI[k])) continue;
      if (JSON.stringify(uiNew[k]) !== JSON.stringify(uiOld[k])) changed.push("ui." + k);
    }
    if (changed.length) throw new ForbiddenError("Diese Büro-Einstellungen kann nur ein Admin ändern (" + changed.slice(0, 5).join(", ") + ").");
  }
  e.next();
}, "studioSettings");

// Pinnwand: fremde Beiträge darf ohne Vollzugriff nur ändern, wer in einer Umfrage abstimmt — und dabei nur die
// eigene Stimme (poll.votes[eigene ID]); Titel, Text, Frage, Optionen und fremde Stimmen bleiben.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const authId = e.auth ? e.auth.id : "";
  const old = e.record.original();
  if (old.get("author") === authId) return e.next();
  let full = false;
  try {
    e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true && perms ~ '|*|'", { s: old.get("studio"), u: authId });
    full = true;
  } catch { full = false; }
  if (full) return e.next();
  const bad = [];
  for (const f of e.record.collection().fields) {
    const n = f.name;
    if (n === "poll" || n === "updated") continue;
    if (JSON.stringify(e.record.get(n)) !== JSON.stringify(old.get(n))) bad.push(n);
  }
  let pNew = null, pOld = null;
  try { pNew = JSON.parse(e.record.getString("poll") || "null"); } catch { pNew = null; }
  try { pOld = JSON.parse(old.getString("poll") || "null"); } catch { pOld = null; }
  if (!pOld || !pNew) { if (JSON.stringify(pNew) !== JSON.stringify(pOld)) bad.push("poll"); }
  else {
    if (pNew.question !== pOld.question || JSON.stringify(pNew.options) !== JSON.stringify(pOld.options)) bad.push("poll");
    const vN = pNew.votes || {}, vO = pOld.votes || {};
    const keys = {};
    for (const k of Object.keys(vN)) keys[k] = 1;
    for (const k of Object.keys(vO)) keys[k] = 1;
    for (const k of Object.keys(keys)) if (k !== authId && vN[k] !== vO[k]) bad.push("poll.votes");
  }
  if (bad.length) throw new ForbiddenError("Fremde Beiträge können nur ihre Autorin, ihr Autor oder ein Admin ändern.");
  e.next();
}, "blogPosts");
