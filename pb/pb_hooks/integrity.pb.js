/// <reference path="../pb_data/types.d.ts" />
// Datenintegrität (Audit 24.11.2026, alle Fälle gegen eine lokale Instanz nachgewiesen, Prüfskript
// pb/tests/security-check.mjs). Die Oberfläche verhinderte das, der Server nicht:
//  1. Abgeschlossene Monate (studioSettings.ui.closedMonths): Zeiteinträge, Absenzen und Ferien in einem
//     geschlossenen Monat anlegen/ändern/löschen nur mit Recht «mitarbeiter» oder Vollzugriff.
//  2. Verrechnete Zeiteinträge (invoice gesetzt): ändern/löschen und die Rechnungs-Zuordnung setzen nur mit Recht
//     «invoices» oder Vollzugriff.
//  3. Eigene Ferien/Absenzen ohne Vollzugriff nur als Antrag («pending»), auch mit Recht «mitarbeiter»
//     (Standardrolle Projektleiter genehmigte sich sonst selbst); eigene Überstunden-Abschlüsse/Auszahlungen
//     ohne Vollzugriff gar nicht.
//  4. Mitarbeiter-Datensätze: den eigenen ändert nur ein Admin; Lohnfelder anderer nur mit Recht «loehne».
//  5. Kunden (persons) und Projekte nicht löschen, solange Rechnungen, Offerten, Verträge oder Zeiteinträge
//     darauf verweisen (PocketBase leerte sonst still die Verweise in bezahlten Rechnungen).
// Superuser sind ausgenommen. Wie in permissions.pb.js: jeder Callback ist in sich geschlossen.

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const name = e.collection.name, r = e.record, sid = r.get("studio"), uid = e.auth ? e.auth.id : "";
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: sid, u: uid }).getString("perms"); } catch { perms = ""; }
  const has = (p) => perms.indexOf("|*|") >= 0 || perms.indexOf("|" + p + "|") >= 0;
  const full = perms.indexOf("|*|") >= 0;
  let own = false;
  try { own = e.app.findRecordById("employees", r.get("employee")).get("appUser") === uid; } catch { own = false; }
  if (name === "employees") {
    if (!full && r.getString("appUser")) throw new ForbiddenError("Die Verknüpfung mit einem Konto setzt ein Admin (Einstellungen → Team).");
    return e.next();
  }
  // 1. abgeschlossene Monate
  if (!has("mitarbeiter")) {
    let closed = [];
    try { closed = (JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths) || []; } catch { closed = []; }
    const from = (r.getString("dateFrom") || r.getString("date")).slice(0, 7);
    const to = (r.getString("dateTo") || r.getString("date") || from).slice(0, 7);
    for (const m of closed) if (from && m >= from && m <= (to || from)) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
  }
  // Zeiteinträge höchstens ein Jahr im Voraus (sonst Saldo/Auszahlung per Eintrag im Jahr 2099 aufblähbar)
  if (name === "timeEntries" && r.getString("date") && new Date(r.getString("date").slice(0, 10) + "T00:00:00Z").getTime() > Date.now() + 366 * 86400000) {
    throw new ForbiddenError("Zeiteinträge höchstens ein Jahr im Voraus.");
  }
  // 2. Rechnungs-Zuordnung
  if (name === "timeEntries" && r.getString("invoice") && !has("invoices")) throw new ForbiddenError("Zeiteinträge einer Rechnung zuordnen braucht das Recht Rechnungen.");
  // 3. eigene Anträge / Abschlüsse
  if (own && !full) {
    if ((name === "vacationEntries" || name === "absences") && r.getString("status") !== "pending") throw new ForbiddenError("Eigene Ferien und Absenzen nur als Antrag.");
    if (name === "overtimeClosings") throw new ForbiddenError("Eigene Überstunden schliesst ein Admin ab.");
  }
  e.next();
}, "timeEntries", "absences", "vacationEntries", "overtimeClosings", "employees");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const name = e.collection.name, r = e.record, o = e.record.original(), sid = o.get("studio"), uid = e.auth ? e.auth.id : "";
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: sid, u: uid }).getString("perms"); } catch { perms = ""; }
  const has = (p) => perms.indexOf("|*|") >= 0 || perms.indexOf("|" + p + "|") >= 0;
  const full = perms.indexOf("|*|") >= 0;
  if (name === "employees") {
    // Verknüpfung mit einem Konto nur mit Vollzugriff: sonst konnte ein Projektleiter Konten abtrennen oder einem
    // fremden Mitarbeiter-Datensatz (samt dessen Zeiterfassung und Ferien) zuordnen (E2E 25.11.2026)
    if (!full && JSON.stringify(r.get("appUser")) !== JSON.stringify(o.get("appUser"))) throw new ForbiddenError("Die Verknüpfung mit einem Konto ändert ein Admin (Einstellungen → Team).");
    // eigener Datensatz: ohne Vollzugriff nur die Adresse («Mein Profil»); Lohnkonto, Lohn, Pensum, Saldo nicht
    if (!full && o.get("appUser") === uid) {
      for (const f of e.record.collection().fields) {
        const n = f.name;
        if (n === "adresse" || n === "ort" || n === "updated") continue;
        if (JSON.stringify(r.get(n)) !== JSON.stringify(o.get(n))) throw new ForbiddenError("Am eigenen Mitarbeiter-Datensatz lässt sich nur die Adresse ändern (" + n + ").");
      }
    }
    if (!has("loehne")) {
      const SAL = ["monatslohn", "lohnVerlauf", "lohnIban", "dreizehnterLohn", "ahvSatz", "alvSatz", "bvgSatz", "nbuSatz", "ktgSatz",
        "quellensteuerPflichtig", "quellensteuerSatz", "pkBeitragAN", "pkBeitragAG", "pkAgSatz", "familienzulagen", "ahvRentner"];
      for (const f of SAL) if (JSON.stringify(r.get(f)) !== JSON.stringify(o.get(f))) throw new ForbiddenError("Lohnangaben ändern braucht das Recht Löhne (" + f + ").");
    }
    return e.next();
  }
  let own = false;
  try { own = e.app.findRecordById("employees", o.get("employee")).get("appUser") === uid; } catch { own = false; }
  let ownNew = own;
  try { ownNew = e.app.findRecordById("employees", r.get("employee")).get("appUser") === uid; } catch { ownNew = false; }
  // 1. abgeschlossene Monate — alter und neuer Stand
  if (!has("mitarbeiter")) {
    let closed = [];
    try { closed = (JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths) || []; } catch { closed = []; }
    for (const x of [o, r]) {
      const from = (x.getString("dateFrom") || x.getString("date")).slice(0, 7);
      const to = (x.getString("dateTo") || x.getString("date") || from).slice(0, 7);
      for (const m of closed) if (from && m >= from && m <= (to || from)) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
    }
  }
  if (name === "timeEntries" && r.getString("date") && r.getString("date") !== o.getString("date") && new Date(r.getString("date").slice(0, 10) + "T00:00:00Z").getTime() > Date.now() + 366 * 86400000) {
    throw new ForbiddenError("Zeiteinträge höchstens ein Jahr im Voraus.");
  }
  // 2. verrechnete Einträge
  if (name === "timeEntries" && !has("invoices") && (o.getString("invoice") || r.getString("invoice"))) {
    throw new ForbiddenError("Verrechnete Zeiteinträge ändert nur, wer das Recht Rechnungen hat.");
  }
  // 3. eigene Anträge / Abschlüsse
  if ((own || ownNew) && !full) {
    // erlaubt: Antrag bleibt Antrag; aus genehmigt nur als Änderungsantrag (pending mit originalData, FerienTab)
    const od = r.getString("originalData");
    const changeRequest = !!od && od !== "null" && od !== "{}";
    if ((name === "vacationEntries" || name === "absences") && (r.getString("status") !== "pending" || (o.getString("status") !== "pending" && !changeRequest))) {
      throw new ForbiddenError("Eigene Ferien und Absenzen nur als Antrag; genehmigt wird von einer anderen Person.");
    }
    if (name === "overtimeClosings") throw new ForbiddenError("Eigene Überstunden schliesst ein Admin ab.");
  }
  e.next();
}, "timeEntries", "absences", "vacationEntries", "overtimeClosings", "employees");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const name = e.collection.name, r = e.record, sid = r.get("studio"), uid = e.auth ? e.auth.id : "";
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: sid, u: uid }).getString("perms"); } catch { perms = ""; }
  const has = (p) => perms.indexOf("|*|") >= 0 || perms.indexOf("|" + p + "|") >= 0;
  const full = perms.indexOf("|*|") >= 0;
  // 5. Stammdaten mit Verweisen
  if (name === "persons" || name === "projects") {
    const refs = name === "persons"
      ? [["invoices", "client"], ["quotes", "client"], ["contracts", "client"]]
      : [["invoices", "project"], ["quotes", "project"], ["contracts", "project"], ["timeEntries", "project"]];
    // Rechnungen, Offerten, Verträge: auch mit Vollzugriff nicht — PocketBase leert sonst den Verweis in der
    // (bezahlten) Rechnung, und «Rückgängig» stellt ihn nicht wieder her (E2E 25.11.2026). Nur Stunden: Admin darf.
    const LABEL = { invoices: "Rechnungen", quotes: "Offerten", contracts: "Verträge", timeEntries: "Zeiteinträge" };
    for (const [coll, field] of refs) {
      let used = false;
      try { e.app.findFirstRecordByFilter(coll, field + " = {:id}", { id: r.id }); used = true; } catch { used = false; }
      if (used && (coll !== "timeEntries" || !full)) throw new ForbiddenError("Wird noch verwendet (" + LABEL[coll] + ") und kann darum nicht gelöscht werden.");
    }
    return e.next();
  }
  let own = false;
  try { own = e.app.findRecordById("employees", r.get("employee")).get("appUser") === uid; } catch { own = false; }
  if (!has("mitarbeiter")) {
    let closed = [];
    try { closed = (JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths) || []; } catch { closed = []; }
    const from = (r.getString("dateFrom") || r.getString("date")).slice(0, 7);
    const to = (r.getString("dateTo") || r.getString("date") || from).slice(0, 7);
    for (const m of closed) if (from && m >= from && m <= (to || from)) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
  }
  if (name === "timeEntries" && r.getString("invoice") && !has("invoices")) throw new ForbiddenError("Verrechnete Zeiteinträge löscht nur, wer das Recht Rechnungen hat.");
  if (own && !full) {
    if ((name === "vacationEntries" || name === "absences") && r.getString("status") !== "pending") throw new ForbiddenError("Genehmigte eigene Einträge ändert ein Admin.");
    if (name === "overtimeClosings") throw new ForbiddenError("Eigene Überstunden schliesst ein Admin ab.");
  }
  e.next();
}, "timeEntries", "absences", "vacationEntries", "overtimeClosings", "persons", "projects");
