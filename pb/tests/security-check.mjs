// Sicherheitsprüfung der PocketBase-Regeln und -Hooks gegen eine FRISCHE Test-Instanz (nie gegen Produktion:
// legt Konten, ein Büro und Testdaten an).
//
//   ./pocketbase migrate up --dir /tmp/pbsec --migrationsDir pb/pb_migrations
//   ./pocketbase superuser upsert su@test.local SuperGeheim123 --dir /tmp/pbsec
//   ./pocketbase serve --dir /tmp/pbsec --migrationsDir pb/pb_migrations --hooksDir pb/pb_hooks --http 127.0.0.1:8099
//   PB=http://127.0.0.1:8099 SU_EMAIL=su@test.local SU_PASS=SuperGeheim123 node pb/tests/security-check.mjs
//   (läuft der Server mit RAPPORT_SETUP_TOKEN, denselben Wert als SETUP_TOKEN mitgeben)
//
// Spielt die Angriffe des Audits vom 24.11.2026 nach (Mitarbeiter liest Löhne über expand/Filter, ändert
// Büro-IBAN, fremde Zeiteinträge und Pinnwand-Beiträge) und prüft zugleich, dass der Admin und der Mitarbeiter
// in ihrem erlaubten Bereich weiter arbeiten können. Exit-Code 1, wenn eine Prüfung fehlschlägt.

const PB = process.env.PB || "http://127.0.0.1:8099";
const SU_EMAIL = process.env.SU_EMAIL || "su@test.local";
const SU_PASS = process.env.SU_PASS || "SuperGeheim123";
const run = Date.now().toString(36);

async function api(method, path, token, body) {
  const res = await fetch(PB + path, {
    method,
    headers: { "content-type": "application/json", ...(process.env.SETUP_TOKEN ? { "X-Rapport-Setup": process.env.SETUP_TOKEN } : {}), ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* leer */ }
  return { status: res.status, json };
}
const login = async (coll, identity, password) => {
  const r = await api("POST", `/api/collections/${coll}/auth-with-password`, null, { identity, password });
  if (r.status !== 200) throw new Error(`Login ${identity}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token;
};
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };
/** true, wenn die Antwort keine geheimen Werte enthält */
const leaks = (r, ...needles) => { const s = JSON.stringify(r.json || ""); return needles.some(n => s.includes(n)); };

const su = await login("_superusers", SU_EMAIL, SU_PASS);

// ── Aufbau: Admin A (Ersteinrichtung oder per Superuser), Büro S, Mitarbeiter M ──────────────────────────────
const pw = "Test-Passwort-123";
const aEmail = `a-${run}@test.local`, mEmail = `m-${run}@test.local`;
must(await api("POST", "/api/collections/users/records", su, { email: aEmail, username: `a${run}`, password: pw, passwordConfirm: pw, displayName: "Admin A" }), "User A");
const mUser = must(await api("POST", "/api/collections/users/records", su, { email: mEmail, username: `m${run}`, password: pw, passwordConfirm: pw, displayName: "Mitarbeiter M" }), "User M");
const tA = await login("users", aEmail, pw);
const studio = must(await api("POST", "/api/rapport/create-studio", tA, { name: `Büro ${run}`, slug: `buero-${run}` }), "create-studio");
const sid = studio.studioId || studio.id || (studio.studio && studio.studio.id);
if (!sid) throw new Error("Studio-ID fehlt: " + JSON.stringify(studio));
must(await api("POST", "/api/rapport/invite-member", tA, { userId: mUser.id, studioId: sid, appRoleId: "r-mitarbeiter" }), "invite M");
const tM = await login("users", mEmail, pw);

const rid = (p) => `${p}${run}`.slice(0, 15).padEnd(15, "0");
const SECRET_AHV = "756.9999.8888.77", SECRET_LOHN = 23456;
const empOther = rid("empo"), empM = rid("empm"), inv = rid("inv"), pay = rid("pay"), teOther = rid("teo"), teM = rid("tem"), post = rid("post");
must(await api("POST", "/api/collections/employees/records", tA, { id: empOther, studio: sid, name: "Andere Person", ahvNr: SECRET_AHV, monatslohn: SECRET_LOHN }), "employee anders");
must(await api("POST", "/api/collections/employees/records", tA, { id: empM, studio: sid, name: "Mitarbeiter M", appUser: mUser.id, monatslohn: 7000 }), "employee M");
must(await api("POST", "/api/collections/invoices/records", tA, { id: inv, studio: sid, number: "GEHEIM-001" }), "invoice");
must(await api("POST", "/api/collections/payrollEntries/records", tA, { id: pay, studio: sid, employee: empOther, monat: "2026-11", data: { brutto: SECRET_LOHN } }), "payroll");
must(await api("POST", "/api/collections/timeEntries/records", tA, { id: teOther, studio: sid, employee: empOther, invoice: inv, date: "2026-11-20", minutes: 60 }), "timeEntry anders");
must(await api("POST", "/api/collections/blogPosts/records", tA, { id: post, studio: sid, author: (await api("GET", "/api/collections/users/records?filter=" + encodeURIComponent(`email="${aEmail}"`), su)).json.items[0].id, title: "Admin-Beitrag", type: "beitrag", status: "published" }), "blogPost");

// ── Mitarbeiter M: gesperrte Daten auf keinem Weg lesbar ─────────────────────────────────────────────────────
const enc = encodeURIComponent;
let r = await api("GET", `/api/collections/employees/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("M: employees direkt gesperrt", r.status === 403 || (r.status === 200 && !leaks(r, SECRET_AHV)), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio="${sid}"`)}&expand=employee,invoice`, tM);
check("M: expand Zeiteintrag→Mitarbeiter/Rechnung leakt nichts", !leaks(r, SECRET_AHV, String(SECRET_LOHN), "GEHEIM-001"), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/studios/records/${sid}?expand=${enc("payrollEntries_via_studio,employees_via_studio,invoices_via_studio")}`, tM);
check("M: expand Studio→Löhne/Mitarbeiter/Rechnungen leakt nichts", !leaks(r, SECRET_AHV, String(SECRET_LOHN), "GEHEIM-001"), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/projects/records?expand=invoices_via_project`, tM);
check("M: expand Projekt→Rechnungen leakt nichts", !leaks(r, "GEHEIM-001"), `HTTP ${r.status}`);
const orc = async (f) => { const x = await api("GET", `/api/collections/studios/records?filter=${enc(f)}`, tM); return x.json && x.json.items ? x.json.items.length : -1; };
const o1 = await orc(`employees_via_studio.monatslohn > ${SECRET_LOHN - 1}`), o2 = await orc(`employees_via_studio.monatslohn > ${SECRET_LOHN + 1}`);
check("M: Filter-Orakel über Lohn verrät nichts", !(o1 === 1 && o2 === 0), `>${SECRET_LOHN - 1}: ${o1}, >${SECRET_LOHN + 1}: ${o2}`);
const o3 = await orc(`employees_via_studio.ahvNr ~ "756.9999%"`);
check("M: Filter-Orakel über AHV verrät nichts", o3 !== 1, `Treffer: ${o3}`);
const t1 = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio = "${sid}" && employee.monatslohn > ${SECRET_LOHN - 1}`)}`, tM);
check("M: Filter-Orakel Zeiteintrag→Lohn verrät nichts", !(t1.json && t1.json.items && t1.json.items.length > 0), `HTTP ${t1.status}`);
const t1a = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio = "${sid}" && employee.monatslohn > ${SECRET_LOHN - 1}`)}`, tA);
check("A: derselbe Filter findet den Eintrag (Gegenprobe)", t1a.json && t1a.json.items && t1a.json.items.length === 1, `HTTP ${t1a.status}`);

// ── Mitarbeiter M: keine Büro-Stammdaten, keine fremden Einträge ändern ───────────────────────────────────────
const settings = (await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}`, tA)).json.items[0];
if (settings) {
  r = await api("PATCH", `/api/collections/studioSettings/records/${settings.id}`, tM, { iban: "CH5604835012345678009" });
  check("M: Büro-Einstellungen (IBAN) nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
}
r = await api("PATCH", `/api/collections/timeEntries/records/${teOther}`, tM, { minutes: 600 });
check("M: fremden Zeiteintrag nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/timeEntries/records/${teOther}`, tM);
check("M: fremden Zeiteintrag nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/timeEntries/records", tM, { id: rid("tex"), studio: sid, employee: empOther, date: "2026-11-21", minutes: 60 });
check("M: keinen Zeiteintrag für andere anlegen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tM, { title: "übernommen" });
check("M: fremden Pinnwand-Beitrag nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
await api("PATCH", `/api/collections/blogPosts/records/${post}`, tA, { poll: { question: "Wohin?", options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }], votes: {} } });
r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tM, { poll: { question: "Wohin?", options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }], votes: { [mUser.id]: "o2" } } });
check("M: in fremder Umfrage abstimmen", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tM, { poll: { question: "Wohin?", options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }], votes: { [mUser.id]: "o2", fremd123: "o1" } } });
check("M: keine fremden Stimmen setzen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tM, { poll: { question: "Wohin?", options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }], votes: { [mUser.id]: "o2", ["__proto__"]: { x: "y".repeat(40) } } } });
check("M: kein «__proto__» in poll.votes", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/blogPosts/records/${post}`, tM);
check("M: fremden Pinnwand-Beitrag nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
// Entwürfe anderer Autoren nicht lesbar (Migration 1787950000)
const draft = rid("drf");
must(await api("POST", "/api/collections/blogPosts/records", tA, { id: draft, studio: sid, author: (await api("GET", "/api/collections/users/records?filter=" + encodeURIComponent(`email="${aEmail}"`), su)).json.items[0].id, title: "Admin-Entwurf", type: "beitrag", status: "entwurf" }), "Entwurf");
r = await api("GET", `/api/collections/blogPosts/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("M: fremde Pinnwand-Entwürfe nicht in der Liste", r.status === 200 && !r.json.items.some(x => x.id === draft) && r.json.items.some(x => x.id === post), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/blogPosts/records/${draft}`, tM);
check("M: fremden Entwurf nicht direkt lesbar", r.status === 404, `HTTP ${r.status}`);
r = await api("GET", `/api/collections/blogPosts/records/${draft}`, tA);
check("A: eigenen Entwurf lesbar", r.status === 200, `HTTP ${r.status}`);
// Projektnummern-Zähler: mit Recht «projects» nur vorwärts (memberperms.pb.js)
{
  const st0 = (await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}`, tA)).json.items[0];
  r = await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { lastProjectSeq: (st0.lastProjectSeq || 0) + 1, lastProjectYear: st0.lastProjectYear || 2026 });
  check("M: Projektzähler hochzählen (Projekt anlegen)", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
  const before = (await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tA)).json;
  await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { lastProjectSeq: 0 });
  await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { lastProjectYear: 99999, lastProjectSeq: 999999 });
  const after = (await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tA)).json;
  check("M: Projektzähler nicht zurücksetzen/vergiften (still verworfen)", after.lastProjectSeq === before.lastProjectSeq && after.lastProjectYear === before.lastProjectYear, `${before.lastProjectYear}/${before.lastProjectSeq} → ${after.lastProjectYear}/${after.lastProjectSeq}`);
  // Rolle mit «projects», ohne «settings» (Migration 1787960000): nur der Zähler, sonst nichts
  const roleM0 = (await api("GET", `/api/collections/appRoles/records?filter=${enc(`studio="${sid}" && roleId="r-mitarbeiter"`)}`, tA)).json.items[0];
  must(await api("PATCH", `/api/collections/appRoles/records/${roleM0.id}`, tA, { permissions: ["dashboard", "projects", "time", "mitarbeiter"] }), "Rolle ohne settings");
  const st1 = (await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tA)).json;
  r = await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { lastProjectSeq: (st1.lastProjectSeq || 0) + 1, lastProjectYear: st1.lastProjectYear || 2026 });
  check("M (projects ohne settings): Projektzähler hochzählen", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
  r = await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { ui: { ...(st1.ui || {}), closedMonths: ["2026-01"] } });
  check("M (projects ohne settings): sonst keine Einstellungen", r.status >= 400, `HTTP ${r.status}`);
  r = await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { ui: { ...(st1.ui || {}), ["__proto__"]: { evil: "x".repeat(50) } } });
  check("M: kein «__proto__»-Schlüssel in ui", r.status >= 400, `HTTP ${r.status}`);
  must(await api("PATCH", `/api/collections/appRoles/records/${roleM0.id}`, tA, { permissions: roleM0.permissions }), "Rolle zurück");
}

const o4 = await orc(`payrollEntries_via_studio.monat = "2026-11"`);
check("M: Filter-Orakel über Lohnabrechnungen verrät nichts", o4 !== 1, `Treffer: ${o4}`);
const myMember = (await api("GET", `/api/collections/studioMembers/records?filter=${enc(`user="${mUser.id}"`)}`, tM)).json.items[0];
r = await api("PATCH", `/api/collections/studioMembers/records/${myMember.id}`, tM, { perms: "|*|", appRoleId: "r-admin" });
check("M: eigene Mitgliedschaft (Rolle/Rechte) nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
if (settings) {
  r = await api("PATCH", `/api/collections/studioSettings/records/${settings.id}`, tM, { ui: { ...(settings.ui || {}), mahngebuehren: [0, 999, 999] } });
  check("M: Mahngebühren (ui) nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
}

// ── erlaubte Arbeit bleibt möglich ────────────────────────────────────────────────────────────────────────────
r = await api("POST", "/api/collections/timeEntries/records", tM, { id: teM, studio: sid, employee: empM, date: "2026-11-21", minutes: 90 });
check("M: eigenen Zeiteintrag anlegen", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tM, { minutes: 120 });
check("M: eigenen Zeiteintrag ändern", r.status === 200, `HTTP ${r.status}`);
r = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio="${sid}"`)}&expand=employee`, tM);
check("M: Zeiteinträge des Büros lesen", r.status === 200 && r.json.items.length >= 2, `HTTP ${r.status}, ${r.json && r.json.items ? r.json.items.length : "?"} Einträge`);
r = await api("POST", "/api/collections/blogPosts/records", tM, { id: rid("postm"), studio: sid, author: mUser.id, title: "Mein Beitrag", type: "beitrag", status: "published" });
check("M: eigenen Pinnwand-Beitrag anlegen", r.status === 200, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tM, { employee: empOther });
check("M: eigenen Eintrag nicht auf andere umhängen", r.status >= 400, `HTTP ${r.status}`);
if (settings) {
  const cur = (await api("GET", `/api/collections/studioSettings/records/${settings.id}`, tA)).json;
  r = await api("PATCH", `/api/collections/studioSettings/records/${settings.id}`, tM, { ui: { ...(cur.ui || {}), closedMonths: ["2026-10"] } });
  check("M: Monatsabschluss nicht änderbar (kein Personal-Recht)", r.status >= 400, `HTTP ${r.status}`);
}
// Rolle erweitern → Recht gilt sofort, zurücknehmen → wieder gesperrt
const roleM = (await api("GET", `/api/collections/appRoles/records?filter=${enc(`studio="${sid}" && roleId="r-mitarbeiter"`)}`, tA)).json.items[0];
const basePerms = roleM.permissions;
must(await api("PATCH", `/api/collections/appRoles/records/${roleM.id}`, tA, { permissions: [...basePerms, "invoices"] }), "Rolle erweitern");
r = await api("GET", `/api/collections/projects/records?expand=invoices_via_project`, tM);
r = await api("GET", `/api/collections/invoices/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("Rolle erweitert: M liest Rechnungen", r.status === 200 && leaks(r, "GEHEIM-001"), `HTTP ${r.status}`);
must(await api("PATCH", `/api/collections/appRoles/records/${roleM.id}`, tA, { permissions: [...basePerms, "*"] }), "Rolle mit *");
r = await api("GET", `/api/collections/invoices/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("Rechtename «*» gibt keinen Vollzugriff", !leaks(r, "GEHEIM-001"), `HTTP ${r.status}`);
must(await api("PATCH", `/api/collections/appRoles/records/${roleM.id}`, tA, { permissions: basePerms }), "Rolle zurück");
r = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio="${sid}"`)}&expand=invoice`, tM);
check("Rolle zurückgenommen: M wieder gesperrt", !leaks(r, "GEHEIM-001"), `HTTP ${r.status}`);
// Büro-Budget: Kosten je Person nur mit «loehne»/Vollzugriff; Speichern ohne «loehne» erhält sie (Rechte-Test Runde 42)
{
  const st0 = (await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}`, tA)).json.items[0];
  must(await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tA, {
    studioBudget: { reserve: 10, empRows: [{ id: "e1", kostenOverride: true, kostenManual: 123456 }] },
    studioBudgetVersions: [{ name: "V1", savedAt: "2026-11-01T00:00:00Z", empSnapshot: [{ name: "X", kosten: 98765, stunden: 1700 }] }],
  }), "Budget setzen");
  r = await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tM);
  check("M: Budget ohne Kosten je Person (kostenManual/kosten)", r.status === 200 && !JSON.stringify(r.json).includes("123456") && !JSON.stringify(r.json).includes("98765"), `HTTP ${r.status}`);
  r = await api("GET", `/api/collections/studios/records/${sid}?expand=studioSettings_via_studio`, tM);
  check("M: auch per expand ohne Kosten je Person", !JSON.stringify(r.json || {}).includes("123456"), `HTTP ${r.status}`);
  // Filter-Orakel (Review Runde 43): Filter/Sortierung über Budget-Felder abgelehnt, auch über Relationen
  for (const f of [`studioBudget.empRows.0.kostenManual > 123000`, `studioBudgetVersions ~ "98765"`]) {
    r = await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}" && (${f})`)}`, tM);
    check(`M: kein Filter-Orakel auf Budget (${f.slice(0, 30)}…)`, r.status >= 400 || !(r.json && r.json.items && r.json.items.length), `HTTP ${r.status}`);
  }
  r = await api("GET", `/api/collections/studios/records?filter=${enc(`studioSettings_via_studio.studioBudget ~ "123456"`)}`, tM);
  check("M: kein Filter-Orakel über Relation", r.status >= 400 || !(r.json && r.json.items && r.json.items.length), `HTTP ${r.status}`);
  r = await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}&sort=-studioBudget`, tM);
  check("M: keine Sortierung nach Budget", r.status >= 400, `HTTP ${r.status}`);
  // Rolle mit settings + studio-budget, ohne loehne: speichert Budget (z.B. Reserve) — Kosten bleiben erhalten
  must(await api("PATCH", `/api/collections/appRoles/records/${roleM.id}`, tA, { permissions: [...basePerms, "settings", "studio-budget"] }), "Rolle Budget");
  const seen = (await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tM)).json;
  r = await api("PATCH", `/api/collections/studioSettings/records/${st0.id}`, tM, { studioBudget: { ...seen.studioBudget, reserve: 15 }, studioBudgetVersions: seen.studioBudgetVersions });
  const after = (await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tA)).json;
  check("M (studio-budget ohne loehne): Speichern erhält Kosten je Person", r.status === 200 && after.studioBudget.reserve === 15 && after.studioBudget.empRows[0].kostenManual === 123456 && after.studioBudgetVersions[0].empSnapshot[0].kosten === 98765, `HTTP ${r.status} ${JSON.stringify(after.studioBudget)}`);
  must(await api("PATCH", `/api/collections/appRoles/records/${roleM.id}`, tA, { permissions: basePerms }), "Rolle zurück 2");
  r = await api("GET", `/api/collections/studioSettings/records/${st0.id}`, tA);
  check("A: sieht Kosten je Person", JSON.stringify(r.json).includes("123456"), `HTTP ${r.status}`);
}
// ── eigene Datensätze ohne Personal-/Spesenrecht (1787880000_own_records.js) ─────────────────────────────────
r = await api("GET", `/api/collections/employees/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("M: eigenen Mitarbeiter-Datensatz lesen, fremde nicht", r.status === 200 && r.json.items.length === 1 && r.json.items[0].id === empM, `HTTP ${r.status}, ${r.json && r.json.items ? r.json.items.length : "?"} Datensätze`);
const vac = rid("vac"), vac2 = rid("vacx");
r = await api("POST", "/api/collections/vacationEntries/records", tM, { id: vac, studio: sid, employee: empM, dateFrom: "2026-12-21", dateTo: "2026-12-24", status: "pending" });
check("M: eigene Ferien beantragen (pending)", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("POST", "/api/collections/vacationEntries/records", tM, { id: vac2, studio: sid, employee: empM, dateFrom: "2026-12-28", dateTo: "2026-12-31", status: "approved" });
check("M: eigene Ferien nicht direkt genehmigt anlegen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "approved" });
check("M: eigenen Antrag nicht selbst genehmigen", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/vacationEntries/records", tM, { id: rid("vacy"), studio: sid, employee: empOther, dateFrom: "2026-12-28", dateTo: "2026-12-31", status: "pending" });
check("M: keine Ferien für andere beantragen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { dateTo: "2026-12-23" });
check("M: eigenen Antrag ändern, solange pendent", r.status === 200, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tA, { status: "approved" });
check("A: Antrag genehmigen", r.status === 200, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { dateTo: "2026-12-31" });
check("M: genehmigte Ferien nicht mehr ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/vacationEntries/records/${vac}`, tM);
check("M: genehmigte Ferien nicht löschen", r.status >= 400, `HTTP ${r.status}`);
// Änderungsantrag zu genehmigten Ferien (1787930000_vacation_change_requests.js) und verwerfen
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "approved", dateTo: "2026-12-31", originalData: { dateFrom: "2026-12-21", dateTo: "2026-12-23" } });
check("M: genehmigte Ferien nicht ohne Antrag ändern (approved bleibt)", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "pending", dateTo: "2026-12-31", originalData: { dateFrom: "2026-12-21", dateTo: "2026-12-23", note: "" } });
check("M: genehmigte Ferien als Änderungsantrag ändern", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "approved", dateTo: "2026-12-31", originalData: null });
check("M: Änderungsantrag nicht mit neuen Daten «verwerfen» (= selbst genehmigen)", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "approved", dateTo: "2026-12-23", originalData: null });
check("M: eigenen Änderungsantrag verwerfen (bisherige Daten zurück)", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
// Angriffe über selbst gewähltes originalData (Review 25.11.2026)
const vac3 = rid("vacz");
r = await api("POST", "/api/collections/vacationEntries/records", tM, { id: vac3, studio: sid, employee: empM, dateFrom: "2027-01-04", dateTo: "2027-01-08", status: "pending", originalData: { dateFrom: "2027-01-04", dateTo: "2027-01-08" } });
check("M: neuer Antrag nicht mit erfundenen «bisherigen Daten»", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/vacationEntries/records", tM, { id: vac3, studio: sid, employee: empM, dateFrom: "2027-01-04", dateTo: "2027-01-08", status: "pending" });
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac3}`, tM, { originalData: { dateFrom: "2027-01-04", dateTo: "2027-01-08" } });
check("M: «bisherige Daten» nicht nachträglich in einen Antrag schreiben", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac3}`, tM, { status: "approved", originalData: null });
check("M: eigenen Antrag nicht über «verwerfen» genehmigen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vac}`, tM, { status: "pending", dateTo: "2026-12-31", originalData: { dateFrom: "2026-12-21", dateTo: "2026-12-31" } });
check("M: Änderungsantrag nur mit den wirklich genehmigten Daten als «bisher»", r.status >= 400, `HTTP ${r.status}`);
r = await api("GET", `/api/collections/vacationEntries/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("M: eigene Ferien lesen", r.status === 200 && r.json.items.length === 2, `HTTP ${r.status}`);
const sp = rid("sp");
r = await api("POST", "/api/collections/expenses/records", tM, { id: sp, studio: sid, employee: empM, date: "2026-11-20", description: "Zug", amount: 12.4, status: "offen" });
check("M: eigene Spese erfassen (offen)", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("POST", "/api/collections/expenses/records", tM, { id: rid("spx"), studio: sid, employee: empM, date: "2026-11-20", description: "x", amount: 999, status: "ausbezahlt" });
check("M: Spese nicht direkt als ausbezahlt anlegen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/expenses/records/${sp}`, tM, { status: "genehmigt" });
check("M: eigene Spese nicht selbst genehmigen", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/expenses/records", tM, { id: rid("spy"), studio: sid, employee: empOther, date: "2026-11-20", description: "x", amount: 5, status: "offen" });
check("M: keine Spesen für andere", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empM}`, tM, { adresse: "Neue Gasse 1", ort: "8001 Zürich" });
check("M: eigene Adresse ändern («Mein Profil»)", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("PATCH", `/api/collections/employees/records/${empM}`, tM, { lohnIban: "CH9300762011623852957" });
check("M: eigenes Lohnkonto nicht selbst ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empM}`, tM, { monatslohn: 99999 });
check("M: eigenen Lohn nicht ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/expenses/records", tM, { id: rid("sp0"), studio: sid, employee: empM, date: "2026-11-20", description: "noch ohne Betrag", amount: 0, status: "offen" });
check("M: Spese zuerst ohne Betrag", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
r = await api("POST", "/api/collections/expenses/records", tM, { id: rid("spn"), studio: sid, employee: empM, date: "2026-11-20", description: "x", amount: -50, status: "offen" });
check("M: keine negative Spese", r.status >= 400, `HTTP ${r.status}`);
r = await api("GET", `/api/collections/payrollEntries/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("M: Löhne weiterhin gesperrt", r.status === 403 || (r.status === 200 && !leaks(r, String(SECRET_LOHN))), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio="${sid}"`)}&expand=employee`, tM);
check("M: expand zeigt nur den eigenen Mitarbeiter", !leaks(r, SECRET_AHV), `HTTP ${r.status}`);

r = await api("GET", `/api/collections/employees/records?filter=${enc(`studio="${sid}"`)}`, tA);
check("A: Mitarbeiter lesen", r.status === 200 && leaks(r, SECRET_AHV), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/timeEntries/records?filter=${enc(`studio="${sid}"`)}&expand=employee,invoice`, tA);
check("A: expand Zeiteintrag→Mitarbeiter/Rechnung", r.status === 200 && leaks(r, "GEHEIM-001"), `HTTP ${r.status}`);
r = await api("GET", `/api/collections/payrollEntries/records?filter=${enc(`studio="${sid}"`)}`, tA);
check("A: Löhne lesen", r.status === 200 && r.json.items.length === 1, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/timeEntries/records/${teOther}`, tA, { minutes: 75 });
check("A: fremden Zeiteintrag ändern", r.status === 200, `HTTP ${r.status}`);
if (settings) {
  r = await api("PATCH", `/api/collections/studioSettings/records/${settings.id}`, tA, { iban: "CH9300762011623852957" });
  check("A: Büro-Einstellungen ändern", r.status === 200, `HTTP ${r.status}`);
}
r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tA, { title: "Admin-Beitrag 2" });
check("A: eigenen Beitrag ändern", r.status === 200, `HTTP ${r.status}`);

// ── Datenintegrität (integrity.pb.js, 1787890000_field_validation.js) ──────────────────────────────────────────
const stg = (await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}`, tA)).json.items[0];
must(await api("PATCH", `/api/collections/studioSettings/records/${stg.id}`, tA, { ui: { ...(stg.ui || {}), closedMonths: ["2026-10"] } }), "Monat schliessen");
r = await api("POST", "/api/collections/timeEntries/records", tM, { id: rid("tcl"), studio: sid, employee: empM, date: "2026-10-15", minutes: 60 });
check("M: kein Eintrag im abgeschlossenen Monat", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tM, { date: "2026-10-16" });
check("M: Eintrag nicht in abgeschlossenen Monat verschieben", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/timeEntries/records", tA, { id: rid("tca"), studio: sid, employee: empOther, date: "2026-10-15", minutes: 60 });
check("A: Eintrag im abgeschlossenen Monat (Admin)", r.status === 200, `HTTP ${r.status}`);
for (const [what, body] of [["negative Minuten", { minutes: -500 }], ["100000 Minuten", { minutes: 100000 }], ["Uhrzeit 99:99", { startTime: "99:99" }], ["Datum 2099", { date: "2099-12-31" }], ["Datum 1900", { date: "1900-01-01" }]]) {
  r = await api("POST", "/api/collections/timeEntries/records", tM, { id: rid("tv" + what.length), studio: sid, employee: empM, date: "2026-11-21", minutes: 60, ...body });
  check(`M: Zeiteintrag mit ${what} abgelehnt`, r.status >= 400, `HTTP ${r.status}`);
}
r = await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tM, { invoice: inv });
check("M: eigenen Eintrag keiner Rechnung zuordnen", r.status >= 400, `HTTP ${r.status}`);
must(await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tA, { invoice: inv }), "A verrechnet Eintrag");
r = await api("PATCH", `/api/collections/timeEntries/records/${teM}`, tM, { minutes: 900 });
check("M: verrechneten Eintrag nicht ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/timeEntries/records/${teM}`, tM);
check("M: verrechneten Eintrag nicht löschen", r.status >= 400, `HTTP ${r.status}`);
// Projektleiter P: Recht «mitarbeiter», aber nicht für sich selbst genehmigen, keine Lohnfelder
const pEmail = `p-${run}@test.local`;
const pUser = must(await api("POST", "/api/collections/users/records", su, { email: pEmail, username: `p${run}`, password: pw, passwordConfirm: pw, displayName: "Projektleiter P" }), "User P");
must(await api("POST", "/api/rapport/invite-member", tA, { userId: pUser.id, studioId: sid, appRoleId: "r-projektleiter" }), "invite P");
const tP = await login("users", pEmail, pw);
const empP = rid("empp");
must(await api("POST", "/api/collections/employees/records", tA, { id: empP, studio: sid, name: "Projektleiter P", appUser: pUser.id, monatslohn: 9000 }), "employee P");
r = await api("POST", "/api/collections/vacationEntries/records", tP, { id: rid("vp1"), studio: sid, employee: empP, dateFrom: "2026-12-21", dateTo: "2026-12-24", status: "approved" });
check("P: eigene Ferien nicht selbst genehmigen", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/vacationEntries/records", tP, { id: rid("vp2"), studio: sid, employee: empOther, dateFrom: "2026-12-21", dateTo: "2026-12-24", status: "approved" });
check("P: Ferien anderer genehmigen (Recht Personal)", r.status === 200, `HTTP ${r.status}`);
// Projektleiter (Recht «mitarbeiter»): Antrag für eine Kollegin mit originalData anlegen, dann sich selbst
// zuordnen und «verwerfen» (= selbst genehmigen) — Review 25.11.2026
const vacP = rid("vacp");
r = await api("POST", "/api/collections/vacationEntries/records", tP, { id: vacP, studio: sid, employee: empOther, dateFrom: "2027-02-01", dateTo: "2027-02-05", status: "pending", originalData: { dateFrom: "2027-02-01", dateTo: "2027-02-05" } });
r = await api("PATCH", `/api/collections/vacationEntries/records/${vacP}`, tP, { employee: empP, status: "approved", originalData: null });
check("P: fremden Antrag nicht sich selbst zuordnen und genehmigen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/vacationEntries/records/${vacP}`, tP, { employee: empP });
check("P: Ferien nicht einer anderen Person zuordnen", r.status >= 400, `HTTP ${r.status}`);
const vacR = rid("vacr");
r = await api("POST", "/api/collections/vacationEntries/records", tA, { id: vacR, studio: sid, employee: empP, dateFrom: "2027-03-01", dateTo: "2027-03-05", status: "rejected" });
r = await api("PATCH", `/api/collections/vacationEntries/records/${vacR}`, tP, { status: "pending", originalData: { dateFrom: "2027-03-01", dateTo: "2027-03-05" } });
check("P: abgelehnte eigene Ferien nicht zum «Änderungsantrag» machen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empP}`, tP, { monatslohn: 25000 });
check("P: eigenen Lohn nicht ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empOther}`, tP, { monatslohn: 1 });
check("P: Lohn anderer nicht ändern (ohne Recht Löhne)", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empOther}`, tP, { role: "Bauleiterin" });
check("P: andere Angaben anderer ändern (Recht Personal)", r.status === 200, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/overtimeClosings/records", tP, { id: rid("ocp"), studio: sid, employee: empP, year: 2026, type: "payout", hoursSettled: 10, auszahlungBetrag: 99999 });
check("P: eigene Überstunden nicht selbst auszahlen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/employees/records/${empOther}`, tP, { appUser: pUser.id });
check("P: Kontoverknüpfung fremder Mitarbeiter nicht ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/rapport/set-member-role", tP, { userId: mUser.id, studioId: sid, appRoleId: "r-projektleiter" });
check("P: keine Rollen ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("POST", "/api/rapport/set-member-role", tA, { userId: mUser.id, studioId: sid, appRoleId: "r-projektleiter" });
const mMem = (await api("GET", `/api/collections/studioMembers/records?filter=${enc(`user="${mUser.id}" && studio="${sid}"`)}`, su)).json.items[0];
check("A: Rolle von M ändern, Rechte sofort neu", r.status === 200 && mMem.appRoleId === "r-projektleiter" && mMem.perms.includes("|quotes|"), `HTTP ${r.status}, perms ${mMem && mMem.perms}`);
must(await api("POST", "/api/rapport/set-member-role", tA, { userId: mUser.id, studioId: sid, appRoleId: "r-mitarbeiter" }), "M zurück");
const aId = (await api("GET", "/api/collections/users/records?filter=" + enc(`email="${aEmail}"`), su)).json.items[0].id;
r = await api("POST", "/api/rapport/set-member-role", tA, { userId: aId, studioId: sid, appRoleId: "r-mitarbeiter" });
check("A: letzten Admin nicht herabstufen", r.status >= 400, `HTTP ${r.status}`);
// Stammdaten mit Verweisen
const cust = rid("cust");
must(await api("POST", "/api/collections/persons/records", tA, { id: cust, studio: sid, name: "Kunde mit Rechnung" }), "Kunde");
must(await api("PATCH", `/api/collections/invoices/records/${inv}`, tA, { client: cust }), "Rechnung → Kunde");
r = await api("DELETE", `/api/collections/persons/records/${cust}`, tM);
check("M: Kunde mit Rechnung nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/persons/records/${cust}`, tA);
check("A: Kunde mit Rechnung auch als Admin nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
// Rechnungsnummern
r = await api("POST", "/api/collections/invoices/records", tA, { id: rid("d1"), studio: sid, number: "" });
const r2 = await api("POST", "/api/collections/invoices/records", tA, { id: rid("d2"), studio: sid, number: "" });
check("A: zwei Entwürfe ohne Nummer", r.status === 200 && r2.status === 200, `HTTP ${r.status}/${r2.status}`);
r = await api("POST", "/api/collections/invoices/records", tA, { id: rid("d3"), studio: sid, number: "GEHEIM-001 " });
check("Rechnungsnummer mit Leerzeichen am Rand abgelehnt", r.status >= 400, `HTTP ${r.status}`);

// ── Sicherheits-Test Runde 25 ───────────────────────────────────────────────────────────────────────────────────
{
  const st = (await api("GET", `/api/collections/studioSettings/records?filter=${enc(`studio="${sid}"`)}`, tA)).json.items[0];
  r = await api("DELETE", `/api/collections/studioSettings/records/${st.id}`, tM);
  check("M: Büro-Einstellungen nicht löschbar (danach mit eigener IBAN neu anlegen)", r.status >= 400, `HTTP ${r.status}`);
  r = await api("PATCH", `/api/collections/studioSettings/records/${st.id}`, tP, { ui: { ...(st.ui || {}), closedMonths: 5 } });
  check("P: Monatsabschluss nur als Liste JJJJ-MM", r.status >= 400, `HTTP ${r.status}`);
  r = await api("DELETE", `/api/collections/employees/records/${empOther}`, tP);
  check("P (ohne Vollzugriff): Mitarbeiter nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
  r = await api("DELETE", `/api/collections/employees/records/${empOther}`, tA);
  check("A: Mitarbeiter mit Lohnabrechnungen nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
  r = await api("POST", "/api/collections/employees/records", tP, { id: rid("empx"), studio: sid, name: "Neu mit Lohn", monatslohn: 99999, lohnIban: "CH9300762011623852957" });
  check("P (ohne Löhne): neuer Mitarbeiter ohne Lohnangaben", r.status >= 400, `HTTP ${r.status}`);
  // wie die App ihn sendet (toDB.employee: leere Verläufe, Standardsätze, null-Felder) — Review Runde 26
  r = await api("POST", "/api/collections/employees/records", tP, { id: rid("empy"), studio: sid, name: "Neu ohne Lohn", monatslohn: 0, lohnIban: "", lohnVerlauf: [], pensumVerlauf: [],
    ahvSatz: 5.3, alvSatz: 1.1, bvgSatz: 8, nbuSatz: 1.5, ktgSatz: 0.5, quellensteuerSatz: 10, pkAgSatz: 8, pkBeitragAN: null, pkBeitragAG: null, familienzulagen: null, dreizehnterLohn: false });
  check("P (ohne Löhne): neuer Mitarbeiter wie aus der App (leere Verläufe, Standardsätze) erlaubt", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
  r = await api("POST", "/api/collections/employees/records", tP, { id: rid("empz"), studio: sid, name: "Neu mit Satz", ahvSatz: 0, dreizehnterLohn: true });
  check("P (ohne Löhne): neuer Mitarbeiter ohne abweichende Sätze/13. Lohn", r.status >= 400, `HTTP ${r.status}`);
  r = await api("POST", "/api/collections/overtimeClosings/records", tP, { id: rid("otx"), studio: sid, employee: empOther, year: 2026, auszahlungBetrag: 99999, imLohn: true });
  check("P (ohne Löhne): keine Überstunden-Auszahlung", r.status >= 400, `HTTP ${r.status}`);
  r = await api("POST", "/api/collections/overtimeClosings/records", tP, { id: rid("oty"), studio: sid, employee: empOther, year: 2026, hoursSettled: 100 });
  check("P (ohne Löhne): kein Überstunden-Abschluss ohne Betrag", r.status >= 400, `HTTP ${r.status}`);
  const otA = rid("ota");
  must(await api("POST", "/api/collections/overtimeClosings/records", tA, { id: otA, studio: sid, employee: empOther, year: 2026, date: "2026-11-20", type: "payout", hoursSettled: 5, auszahlungBetrag: 300, imLohn: true }), "Auszahlung A");
  r = await api("DELETE", `/api/collections/overtimeClosings/records/${otA}`, tP);
  check("P (ohne Löhne): Überstunden-Auszahlung nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
  for (const [f, v] of [["employee", empM], ["type", "other"], ["year", 2020]]) {
    r = await api("PATCH", `/api/collections/overtimeClosings/records/${otA}`, tP, { [f]: v });
    check(`P (ohne Löhne): Überstunden-Abschluss nicht ändern (${f})`, r.status >= 400, `HTTP ${r.status}`);
  }
  // Mitarbeiter nur mit Stunden: Kaskade/Leeren verwaiste sonst die Zeiteinträge (Review Runde 27)
  const empT = rid("empt");
  must(await api("POST", "/api/collections/employees/records", tA, { id: empT, studio: sid, name: "Nur Stunden" }), "Mitarbeiter T");
  must(await api("POST", "/api/collections/timeEntries/records", tA, { id: rid("tet"), studio: sid, employee: empT, date: "2026-11-10", minutes: 60 }), "Stunden T");
  r = await api("DELETE", `/api/collections/employees/records/${empT}`, tA);
  check("A: Mitarbeiter mit Zeiteinträgen nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
  const empU = rid("empu");
  must(await api("POST", "/api/collections/employees/records", tA, { id: empU, studio: sid, name: "Ohne alles" }), "Mitarbeiter U");
  r = await api("DELETE", `/api/collections/employees/records/${empU}`, tA);
  check("A: Mitarbeiter ohne Einträge löschbar", r.status === 204, `HTTP ${r.status}`);
  r = await api("DELETE", `/api/collections/employees/records/${empM}`, tA);
  check("A: Mitarbeiter mit Ferien/Absenzen nicht löschbar (Kaskade)", r.status >= 400, `HTTP ${r.status}`);
  const q = rid("quo");
  must(await api("POST", "/api/collections/quotes/records", tA, { id: q, studio: sid, number: "Q-REF" }), "Offerte");
  must(await api("PATCH", `/api/collections/invoices/records/${inv}`, tA, { quote: q }), "Rechnung → Offerte");
  r = await api("DELETE", `/api/collections/quotes/records/${q}`, tA);
  check("A: Offerte mit Rechnung nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
  r = await api("POST", "/api/collections/absences/records", tM, { id: rid("absx"), studio: sid, employee: empM, date: "2026-10-05", dateFrom: "2026-12-02", dateTo: "2026-12-02", status: "pending" });
  const ab2 = await api("POST", "/api/collections/absences/records", tM, { id: rid("absy"), studio: sid, employee: empM, dateFrom: "2026-12-05", dateTo: "2026-12-01", status: "pending" });
  check("M: Absenz mit date im abgeschlossenen Monat bzw. Bis vor Von abgelehnt", r.status >= 400 && ab2.status >= 400, `HTTP ${r.status}/${ab2.status}`);
  r = await api("POST", "/api/rapport/invite-member", tA, { userId: mUser.id, studioId: sid, appRoleId: "gibtsnicht" });
  const r3 = await api("POST", "/api/rapport/invite-member", tA, { userId: aId, studioId: sid, appRoleId: "r-mitarbeiter" });
  check("Einladen: unbekannte Rolle bzw. letzten Admin herabstufen abgelehnt", r.status >= 400 && r3.status >= 400, `HTTP ${r.status}/${r3.status}`);
  const myPost = rid("mpost");
  must(await api("POST", "/api/collections/blogPosts/records", tP, { id: myPost, studio: sid, author: pUser.id, title: "Meins", type: "beitrag", status: "published" }), "Beitrag P");
  r = await api("PATCH", `/api/collections/blogPosts/records/${myPost}`, tP, { author: aId });
  check("P: Autor des eigenen Beitrags nicht änderbar", r.status >= 400, `HTTP ${r.status}`);
  r = await api("PATCH", `/api/collections/blogPosts/records/${post}`, tM, { poll: { question: "Wohin?", options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }], votes: { [mUser.id]: "o1" }, closed: true } });
  check("M: in fremder Umfrage keine Zusatzfelder", r.status >= 400, `HTTP ${r.status}`);
}

// ── Änderungsprotokoll (audit.pb.js) ───────────────────────────────────────────────────────────────────────────
must(await api("PATCH", `/api/collections/invoices/records/${inv}`, tA, { number: "GEHEIM-002" }), "Rechnung umnummerieren");
r = await api("GET", `/api/collections/auditLog/records?filter=${enc(`studio="${sid}" && coll="invoices" && recordId="${inv}"`)}&sort=-created`, tA);
const lastLog = r.json && r.json.items && r.json.items[0];
check("Protokoll: Rechnungsänderung mit alt → neu und Person", !!lastLog && lastLog.action === "update" && JSON.stringify(lastLog.changes).includes("GEHEIM-002") && lastLog.userName === aEmail, `HTTP ${r.status} ${lastLog && lastLog.userName}`);
r = await api("GET", `/api/collections/auditLog/records?filter=${enc(`studio="${sid}"`)}`, tM);
check("Protokoll: Mitarbeiter liest es nicht", r.status >= 400 || (r.json && r.json.items && r.json.items.length === 0), `HTTP ${r.status}`);
r = await api("POST", "/api/collections/auditLog/records", tA, { studio: sid, coll: "invoices", action: "update", changes: {} });
check("Protokoll: niemand schreibt von aussen hinein", r.status >= 400, `HTTP ${r.status}`);
if (lastLog) {
  r = await api("DELETE", `/api/collections/auditLog/records/${lastLog.id}`, tA);
  check("Protokoll: Einträge nicht löschbar", r.status >= 400, `HTTP ${r.status}`);
}

// ── geteilte Kontakte über zwei Büros (personStudioLinks) ──────────────────────────────────────────────────────
const shared = rid("shp");
must(await api("POST", "/api/collections/persons/records", tA, { id: shared, studio: sid, name: "Geteilter Kontakt" }), "Kontakt für Teilen");
const studioB = must(await api("POST", "/api/rapport/create-studio", tA, { name: `Büro B ${run}`, slug: `buero-b-${run}`, sharePersonsFrom: [sid] }), "Büro B");
const sidB = studioB.studioId || studioB.id;
const m2Email = `m2-${run}@test.local`;
const m2 = must(await api("POST", "/api/collections/users/records", su, { email: m2Email, username: `m2${run}`, password: pw, passwordConfirm: pw, displayName: "Mitarbeiter B" }), "User M2");
must(await api("POST", "/api/rapport/invite-member", tA, { userId: m2.id, studioId: sidB, appRoleId: "r-mitarbeiter" }), "invite M2");
const roleB = (await api("GET", `/api/collections/appRoles/records?filter=${enc(`studio="${sidB}" && roleId="r-mitarbeiter"`)}`, tA)).json.items[0];
must(await api("PATCH", `/api/collections/appRoles/records/${roleB.id}`, tA, { permissions: ["dashboard", "time"] }), "Rolle B ohne Kontakte");
const tM2 = await login("users", m2Email, pw);
r = await api("GET", `/api/collections/persons/records/${shared}`, tM2);
check("M2 (Büro B): geteilten Kontakt lesen", r.status === 200, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/persons/records/${shared}`, tM2, { name: "übernommen" });
check("M2 ohne Kontakte-Recht: geteilten Kontakt nicht ändern", r.status >= 400, `HTTP ${r.status}`);
r = await api("DELETE", `/api/collections/persons/records/${shared}`, tM2);
check("M2 ohne Kontakte-Recht: geteilten Kontakt nicht löschen", r.status >= 400, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/persons/records/${shared}`, tM, { name: "Geteilter Kontakt (geändert)" });
check("M (Büro A, Recht Kontakte): geteilten Kontakt ändern", r.status === 200, `HTTP ${r.status}`);
r = await api("PATCH", `/api/collections/persons/records/${shared}`, tA, { name: "Geteilter Kontakt (Admin)" });
check("A: geteilten Kontakt ändern", r.status === 200, `HTTP ${r.status}`);
must(await api("PATCH", `/api/collections/appRoles/records/${roleB.id}`, tA, { permissions: ["dashboard", "time", "personen"] }), "Rolle B mit Kontakten");
r = await api("PATCH", `/api/collections/persons/records/${shared}`, tM2, { name: "Geteilter Kontakt (Büro B)" });
check("M2 mit Kontakte-Recht in Büro B: geteilten Kontakt ändern", r.status === 200, `HTTP ${r.status}`);
r = await api("POST", "/api/collections/persons/records", tM2, { id: rid("pb2"), studio: sid, name: "In fremdes Büro" });
check("M2: keinen Kontakt in Büro A anlegen", r.status >= 400, `HTTP ${r.status}`);

// ── Deaktiviert und Mengenlimits (am Schluss, ändert den Zustand) ─────────────────────────────────────────────
r = await api("GET", "/api/collections/users/records", tM);
check("M (aktiv): sieht Kolleginnen", r.status === 200 && r.json.items.length >= 2, `${r.json && r.json.items ? r.json.items.length : "?"} Konten`);
must(await api("PATCH", `/api/collections/studioMembers/records/${myMember.id}`, su, { active: false }), "M deaktivieren");
r = await api("GET", "/api/collections/users/records", tM);
check("M (deaktiviert): sieht nur das eigene Konto", r.status === 200 && r.json.items.length === 1, `${r.json && r.json.items ? r.json.items.length : "?"} Konten`);
let last = 0;
for (let i = 0; i < 5; i++) last = (await api("POST", "/api/collections/users/request-password-reset", null, { email: mEmail })).status;
check("Passwort-Reset: Mengenlimit greift", last === 429, `5. Anfrage HTTP ${last}`);

// ── Ergebnis ─────────────────────────────────────────────────────────────────────────────────────────────────
let bad = 0;
for (const x of results) { if (!x.ok) bad++; console.log(`${x.ok ? "OK  " : "FAIL"}  ${x.name}${x.detail ? `  (${x.detail})` : ""}`); }
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
