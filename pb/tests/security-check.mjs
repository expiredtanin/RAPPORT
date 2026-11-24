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
r = await api("DELETE", `/api/collections/blogPosts/records/${post}`, tM);
check("M: fremden Pinnwand-Beitrag nicht löschbar", r.status >= 400, `HTTP ${r.status}`);

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
  check("M: Monatsabschluss (erlaubtes Feld) änderbar", r.status === 200, `HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.json) : ""}`);
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

// ── Ergebnis ─────────────────────────────────────────────────────────────────────────────────────────────────
let bad = 0;
for (const x of results) { if (!x.ok) bad++; console.log(`${x.ok ? "OK  " : "FAIL"}  ${x.name}${x.detail ? `  (${x.detail})` : ""}`); }
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
