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

// Filter/Sortierung über die Budget-Felder sperren: die Maskierung unten wirkt nur auf die Ausgabe, ein Filter wie
// «studioBudget.empRows.0.kostenManual > 123000» lief auf den echten Werten und verriet sie per Bisektion (Review
// Runde 43). Die App filtert nie danach — gilt für alle Collections (auch über Relationen wie studioSettings_via_studio).
onRecordsListRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const q = e.requestInfo().query || {};
    if (/studiobudget/i.test(String(q.filter || "") + " " + String(q.sort || ""))) throw new BadRequestError("Filter oder Sortierung über das Büro-Budget ist nicht erlaubt.");
  }
  e.next();
});
onRealtimeSubscribeRequest((e) => {
  // auch Lohnfelder (Filter in Abos verrieten sie per Bisektion; die App filtert nie danach)
  if (!e.hasSuperuserAuth() && (e.subscriptions || []).some((t) => /studiobudget|monatslohn|lohnverlauf|lohniban|ahvnr|pkbeitrag|familienzulagen|quellensteuer|auszahlungbetrag|stundenlohn|personalnr|adresse|geburtsdatum|ferienwochen|ferienuebertrag|saldostichtag|saldouebertrag/i.test(String(t))
    || /^(employees|absences)\//.test(String(t)) && /(email|ort|note)/i.test(decodeURIComponent(String(t).split("?options=")[1] || "")))) throw new BadRequestError("Filter über Budget, Lohn- oder Personalangaben ist nicht erlaubt.");
  e.next();
});

// Büro-Budget: Kosten je Person (≈ Lohn + AG-Beiträge) nur für Vollzugriff oder Recht «loehne» ausliefern — die App
// blendete sie lokal aus, der Server lieferte sie aber jedem Mitglied (REST, expand, Realtime; Rechte-Test Runde 42).
// Beim Speichern ohne «loehne» werden die maskierten Werte unten wieder aus dem gespeicherten Stand eingesetzt.
onRecordEnrich((e) => {
  const info = e.requestInfo;
  const auth = info && info.auth;
  if (!auth || (auth.collection && auth.collection().name === "_superusers")) return e.next();
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: e.record.get("studio"), u: auth.id }).getString("perms"); } catch { perms = ""; }
  if (perms.indexOf("|*|") >= 0 || perms.indexOf("|loehne|") >= 0) return e.next();
  const parse = (f) => { try { return JSON.parse(e.record.getString(f) || "null"); } catch { return null; } };
  const b = parse("studioBudget");
  if (b && Array.isArray(b.empRows)) {
    b.empRows = b.empRows.map((r) => (r && typeof r === "object") ? Object.assign({}, r, { kostenManual: null }) : r);
    e.record.set("studioBudget", b);
  }
  const v = parse("studioBudgetVersions");
  if (Array.isArray(v)) {
    e.record.set("studioBudgetVersions", v.map((x) => (x && typeof x === "object" && Array.isArray(x.empSnapshot))
      ? Object.assign({}, x, { empSnapshot: x.empSnapshot.map((p) => (p && typeof p === "object") ? Object.assign({}, p, { kosten: null }) : p) }) : x));
  }
  e.next();
}, "studioSettings");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const sid = e.record.get("studio");
  // ohne «loehne»: maskierte Kosten je Person (siehe onRecordEnrich oben) aus dem gespeicherten Stand übernehmen —
  // sonst löschte das Speichern des Budgets die Werte, die diese Rolle gar nicht sieht
  {
    let p0 = "";
    try { p0 = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: sid, u: e.auth ? e.auth.id : "" }).getString("perms"); } catch { p0 = ""; }
    if (p0.indexOf("|*|") < 0 && p0.indexOf("|loehne|") < 0) {
      const o = e.record.original();
      const parse = (rec, f) => { try { return JSON.parse(rec.getString(f) || "null"); } catch { return null; } };
      const nb = parse(e.record, "studioBudget"), ob = parse(o, "studioBudget");
      if (nb && Array.isArray(nb.empRows)) {
        const oldRows = (ob && Array.isArray(ob.empRows)) ? ob.empRows : [];
        nb.empRows = nb.empRows.map((r) => {
          if (!r || typeof r !== "object") return r;
          const prev = oldRows.find((x) => x && x.id === r.id);
          return Object.assign({}, r, { kostenManual: prev ? (prev.kostenManual === undefined ? null : prev.kostenManual) : null });
        });
        e.record.set("studioBudget", nb);
      }
      const nv = parse(e.record, "studioBudgetVersions"), ov = parse(o, "studioBudgetVersions");
      if (Array.isArray(nv)) {
        const oldV = Array.isArray(ov) ? ov : [];
        e.record.set("studioBudgetVersions", nv.map((x) => {
          if (!x || typeof x !== "object" || !Array.isArray(x.empSnapshot)) return x;
          const prev = oldV.find((y) => y && y.savedAt === x.savedAt && y.name === x.name);
          return Object.assign({}, x, { empSnapshot: x.empSnapshot.map((p, i) => {
            if (!p || typeof p !== "object") return p;
            const pp = prev && Array.isArray(prev.empSnapshot) ? (prev.empSnapshot.find((q) => q && q.name === p.name) || prev.empSnapshot[i]) : null;
            return Object.assign({}, p, { kosten: pp ? (pp.kosten === undefined ? null : pp.kosten) : null });
          }) });
        }));
      }
    }
  }
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
    // Projektnummern-Zähler: wer Projekte anlegt (auch aus einer Offerte), zählt ihn hoch — vorher meldete «Neues
    // Projekt» ohne Admin «Speichern fehlgeschlagen» (Cloud-Test Runde 15). Nur vorwärts und plausibel (Jahr höchstens
    // nächstes Jahr, Zähler < 100000); ein Rückschritt (zweiter Client mit älterem Stand) oder Unsinn wird still
    // verworfen statt abgelehnt — sonst sähe der zweite Client ein Fehlerbanner bzw. ein «vergifteter» Zähler
    // sperrte das Anlegen für alle.
    const counterOk = has("projects") || has("quotes");
    if (counterOk) {
      const ny = e.record.getInt("lastProjectYear"), oy = old.getInt("lastProjectYear");
      const ns = e.record.getInt("lastProjectSeq"), os = old.getInt("lastProjectSeq");
      const maxYear = new Date().getFullYear() + 1;
      // höchstens +50 auf einmal (sonst liess sich der Zähler auf 99999 setzen und blieb dort stehen)
      const ok = ny <= maxYear && ns >= 0 && (ny > oy ? ns <= 50 : ny === oy && ns >= os && ns <= os + 50);
      if (!ok) { e.record.set("lastProjectYear", old.get("lastProjectYear")); e.record.set("lastProjectSeq", old.get("lastProjectSeq")); }
    }
    // ohne «settings» (Zugang nur über «projects»/«quotes», Migration 1787960000) ausschliesslich der Zähler
    const settingsRight = has("settings");
    const changed = [];
    for (const f of e.record.collection().fields) {
      const n = f.name;
      if (n === "ui" || n === "updated") continue;
      if (settingsRight && OPEN_FIELDS[n] && has(OPEN_FIELDS[n])) continue;
      if (counterOk && (n === "lastProjectSeq" || n === "lastProjectYear")) continue;
      if (JSON.stringify(e.record.get(n)) !== JSON.stringify(old.get(n))) changed.push(n);
    }
    let uiNew = {}, uiOld = {};
    try { uiNew = JSON.parse(e.record.getString("ui") || "{}") || {}; } catch { uiNew = {}; }
    // Monatsabschluss: nur eine Liste «JJJJ-MM» (eine Zahl brachte die Prüfung zum Absturz und sperrte die Zeiterfassung)
    if (uiNew.closedMonths !== undefined && !(Array.isArray(uiNew.closedMonths) && uiNew.closedMonths.every((m) => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)))) {
      throw new BadRequestError("Monatsabschluss: ungültige Monate.");
    }
    try { uiOld = JSON.parse(old.getString("ui") || "{}") || {}; } catch { uiOld = {}; }
    // Schlüssel als Set (ein Objekt verschluckte «__proto__»: damit liessen sich beliebige Daten in ui ablegen)
    const keys = new Set([...Object.keys(uiNew), ...Object.keys(uiOld)]);
    for (const k of keys) {
      if (settingsRight && Object.prototype.hasOwnProperty.call(OPEN_UI, k) && has(OPEN_UI[k])) continue;
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
  let full = false;
  try {
    e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true && perms ~ '|*|'", { s: old.get("studio"), u: authId });
    full = true;
  } catch { full = false; }
  if (full) return e.next();
  // Autor bleibt Autor (sonst wirkte ein Beitrag wie von jemand anderem verfasst)
  if (JSON.stringify(e.record.get("author")) !== JSON.stringify(old.get("author"))) throw new ForbiddenError("Den Autor eines Beitrags ändert nur ein Admin.");
  if (old.get("author") === authId) return e.next();
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
    // ausser den Stimmen bleibt die Umfrage unverändert (auch keine Zusatzfelder)
    const rest = (p) => { const c = {}; for (const k of Object.keys(p)) if (k !== "votes") c[k] = p[k]; return JSON.stringify(c); };
    if (rest(pNew) !== rest(pOld)) bad.push("poll");
    const vN = pNew.votes || {}, vO = pOld.votes || {};
    // eigene Stimme: nur die Id einer Option (oder keine)
    const mine = vN[authId];
    if (mine !== undefined && !(typeof mine === "string" && (pOld.options || []).some((o) => o && o.id === mine))) bad.push("poll.votes");
    // Set statt Objekt: «__proto__» fiel sonst aus der Prüfung (fremde Daten in poll.votes)
    const keys = new Set([...Object.keys(vN), ...Object.keys(vO)]);
    for (const k of keys) if (k !== authId && JSON.stringify(vN[k]) !== JSON.stringify(vO[k])) bad.push("poll.votes");
  }
  if (bad.length) throw new ForbiddenError("Fremde Beiträge können nur ihre Autorin, ihr Autor oder ein Admin ändern.");
  e.next();
}, "blogPosts");

// Büro-Einstellungen anlegen/löschen nur mit Vollzugriff: vorher löschte ein Mitglied mit Recht «settings» den
// Datensatz und legte ihn mit eigener IBAN neu an — die Feldprüfung oben greift nur beim Ändern (Sicherheits-Test R25)
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  try {
    e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true && perms ~ '|*|'", { s: e.record.get("studio"), u: e.auth ? e.auth.id : "" });
  } catch {
    throw new ForbiddenError("Büro-Einstellungen legt ein Admin an.");
  }
  e.next();
}, "studioSettings");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  try {
    e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true && perms ~ '|*|'", { s: e.record.get("studio"), u: e.auth ? e.auth.id : "" });
  } catch {
    throw new ForbiddenError("Büro-Einstellungen löscht ein Admin.");
  }
  e.next();
}, "studioSettings");
