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
//  5. Kunden, Projekte, Offerten und Mitarbeitende nicht löschen, solange etwas darauf verweist (Rechnungen, Offerten,
//     Verträge, Spesen, Protokolle, Lieferscheine, Projekte, Zeiteinträge; Lohnabrechnungen, Überstunden, Ferien,
//     Absenzen) — PocketBase leerte sonst still die Verweise bzw. löschte per Kaskade mit.
//  6. Lohnangaben beim Anlegen von Mitarbeitenden und Überstunden-Abschlüsse nur mit Recht «Löhne».
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
    // neu angelegt ohne Recht «Löhne»: keine Lohnangaben (Standard-Sozialsätze sind erlaubt) — vorher kam ein neuer
    // Mitarbeiter mit selbst gesetztem Lohn und Lohnkonto ins System (Sicherheits-Test Runde 25)
    if (!has("loehne")) {
      // über getString vergleichen: JSON-Felder (lohnVerlauf) liefert get() nicht als Array — ein leerer Verlauf «[]»
      // galt sonst als Lohnangabe und kein Projektleiter konnte jemanden anlegen (Review Runde 26)
      const empty = (f) => { const v = r.getString(f).trim(); return v === "" || v === "0" || v === "false" || v === "[]" || v === "null" || v === "{}"; };
      for (const f of ["monatslohn", "lohnVerlauf", "lohnIban", "pkBeitragAN", "pkBeitragAG", "familienzulagen", "dreizehnterLohn", "ahvRentner", "quellensteuerPflichtig"]) {
        if (!empty(f)) throw new ForbiddenError("Lohnangaben erfasst, wer das Recht Löhne hat (" + f + ").");
      }
      // Sätze nur leer oder Standard (wie der Dialog sie setzt)
      const DEF = { ahvSatz: 5.3, alvSatz: 1.1, bvgSatz: 8, nbuSatz: 1.5, ktgSatz: 0.5, quellensteuerSatz: 10 };
      for (const f of Object.keys(DEF)) { const v = r.getFloat(f); if (v !== 0 && Math.abs(v - DEF[f]) > 1e-9) throw new ForbiddenError("Lohnangaben erfasst, wer das Recht Löhne hat (" + f + ")."); }
      let defPk = 8;
      try { defPk = e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getFloat("defaultPkAGSatz") || 8; } catch { defPk = 8; }
      const pk = r.getFloat("pkAgSatz");
      if (pk !== 0 && Math.abs(pk - defPk) > 1e-9 && Math.abs(pk - 8) > 1e-9) throw new ForbiddenError("Lohnangaben erfasst, wer das Recht Löhne hat (pkAgSatz).");
    }
    return e.next();
  }
  // 1. abgeschlossene Monate
  if (!has("mitarbeiter")) {
    let closed = [];
    try { closed = JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths; } catch { closed = []; }
    closed = Array.isArray(closed) ? closed.filter((m) => typeof m === "string") : [];   // falscher Typ sperrte sonst alles bzw. nichts
    // alle drei Datumsfelder (date, dateFrom, dateTo) und ihr ganzer Bereich — vorher zählte date nicht, sobald
    // dateFrom gesetzt war, und ein umgekehrter Bereich war leer (Sicherheits-Test Runde 25)
    const ds = [r.getString("date"), r.getString("dateFrom"), r.getString("dateTo")].map((v) => String(v || "").slice(0, 7)).filter((v) => v).sort();
    for (const m of closed) if (ds.length && m >= ds[0] && m <= ds[ds.length - 1]) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
  }
  if ((name === "absences" || name === "vacationEntries") && r.getString("dateFrom") && r.getString("dateTo") && r.getString("dateTo").slice(0, 10) < r.getString("dateFrom").slice(0, 10)) {
    throw new BadRequestError("Bis liegt vor Von.");
  }
  // Überstunden-Auszahlung (Betrag, im Lohn) nur mit Recht «Löhne» — floss sonst ohne Lohnrecht in die Abrechnung
  // Überstunden-Abschlüsse (Auszahlung oder abgerechnete Stunden) nur mit Recht «Löhne» (senken den Saldo bzw. fliessen in den Lohn)
  if (name === "overtimeClosings" && !has("loehne")) throw new ForbiddenError("Überstunden abschliessen braucht das Recht Löhne.");
  // Zeiteinträge höchstens ein Jahr im Voraus (sonst Saldo/Auszahlung per Eintrag im Jahr 2099 aufblähbar)
  if (name === "timeEntries" && r.getString("date") && new Date(r.getString("date").slice(0, 10) + "T00:00:00Z").getTime() > Date.now() + 366 * 86400000) {
    throw new ForbiddenError("Zeiteinträge höchstens ein Jahr im Voraus.");
  }
  // 2. Rechnungs-Zuordnung
  if (name === "timeEntries" && r.getString("invoice") && !has("invoices")) throw new ForbiddenError("Zeiteinträge einer Rechnung zuordnen braucht das Recht Rechnungen.");
  // 3. eigene Anträge / Abschlüsse
  if (own && !full) {
    if ((name === "vacationEntries" || name === "absences") && r.getString("status") !== "pending") throw new ForbiddenError("Eigene Ferien und Absenzen nur als Antrag.");
    // ein neuer Antrag ist nie ein Änderungsantrag: originalData setzt nur der Wechsel aus «approved» (Update-Hook)
    const odNew = r.getString("originalData");
    if (name === "vacationEntries" && odNew && odNew !== "null" && odNew !== "{}") throw new ForbiddenError("Ein neuer Ferienantrag hat keine bisherigen Daten.");
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
    // ohne «loehne» liefert der Server die Lohnfelder fremder Datensätze nicht aus (onRecordEnrich unten); schickt der
    // Client sie leer zurück, gelten sie als unverändert (sonst Ablehnung bzw. gelöschte Löhne beim Speichern des Namens)
    if (!has("loehne") && o.get("appUser") !== uid) {
      for (const f of ["monatslohn", "lohnVerlauf", "lohnIban", "dreizehnterLohn", "ahvSatz", "alvSatz", "bvgSatz", "nbuSatz", "ktgSatz",
        "quellensteuerPflichtig", "quellensteuerSatz", "pkBeitragAN", "pkBeitragAG", "pkAgSatz", "familienzulagen", "ahvRentner", "ahvNr"]) {
        const nv = r.getString(f).trim();
        if ((nv === "" || nv === "0" || nv === "false" || nv === "[]" || nv === "null" || nv === "{}") && JSON.stringify(r.get(f)) !== JSON.stringify(o.get(f))) r.set(f, o.get(f));
      }
    }
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
        "quellensteuerPflichtig", "quellensteuerSatz", "pkBeitragAN", "pkBeitragAG", "pkAgSatz", "familienzulagen", "ahvRentner", "ahvNr"];
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
    try { closed = JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths; } catch { closed = []; }
    closed = Array.isArray(closed) ? closed.filter((m) => typeof m === "string") : [];   // falscher Typ sperrte sonst alles bzw. nichts
    for (const x of [o, r]) {
      const ds = [x.getString("date"), x.getString("dateFrom"), x.getString("dateTo")].map((v) => String(v || "").slice(0, 7)).filter((v) => v).sort();
      for (const m of closed) if (ds.length && m >= ds[0] && m <= ds[ds.length - 1]) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
    }
  }
  if ((name === "absences" || name === "vacationEntries") && r.getString("dateFrom") && r.getString("dateTo") && r.getString("dateTo").slice(0, 10) < r.getString("dateFrom").slice(0, 10)) {
    throw new BadRequestError("Bis liegt vor Von.");
  }
  if (name === "overtimeClosings" && !has("loehne")) {
    // alle Felder (Runde 27: Umhängen auf andere Person, Typ/Jahr änderte sonst Salden ohne Lohnrecht)
    for (const f of e.record.collection().fields) {
      const n = f.name;
      if (n === "updated") continue;
      if (JSON.stringify(r.get(n)) !== JSON.stringify(o.get(n))) throw new ForbiddenError("Überstunden-Abschlüsse ändert, wer das Recht Löhne hat (" + n + ").");
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
    const day = (v) => String(v || "").slice(0, 10);
    let rOd = null, oOd = null;
    try { rOd = JSON.parse(od || "null"); } catch { rOd = null; }
    try { oOd = JSON.parse(o.getString("originalData") || "null"); } catch { oOd = null; }
    // eigene Ferien/Absenzen nicht einer anderen Person zuordnen und fremde nicht sich selbst (sonst galten die
    // Prüfungen für eigene Anträge nicht: über einen Wechsel des Mitarbeiters liess sich ein Antrag selbst
    // genehmigen; Review 25.11.2026)
    if ((name === "vacationEntries" || name === "absences") && JSON.stringify(r.get("employee")) !== JSON.stringify(o.get("employee"))) {
      throw new ForbiddenError("Ferien und Absenzen lassen sich nicht einer anderen Person zuordnen.");
    }
    if (name === "vacationEntries") {
      // originalData entsteht nur beim Wechsel aus «approved» und bleibt danach unverändert (nicht aus «rejected»)
      if (changeRequest && !(o.getString("status") === "approved" || (o.getString("status") === "pending" && JSON.stringify(rOd) === JSON.stringify(oOd)))) {
        throw new ForbiddenError("Ein Änderungsantrag entsteht nur aus genehmigten Ferien.");
      }
      // originalData ist der Stand, der genehmigt war — vom Server geprüft, nicht vom Client frei wählbar (Review
      // 25.11.2026: sonst liessen sich über «verwerfen» selbst gewählte Ferien genehmigen)
      if (o.getString("status") === "approved" && r.getString("status") === "pending"
        && !(rOd && day(rOd.dateFrom) === day(o.getString("dateFrom")) && day(rOd.dateTo) === day(o.getString("dateTo")))) {
        throw new ForbiddenError("Änderungsantrag: die bisherigen Daten müssen den genehmigten Ferien entsprechen.");
      }
      if (o.getString("status") === "pending" && r.getString("status") === "pending" && JSON.stringify(rOd) !== JSON.stringify(oOd)) {
        throw new ForbiddenError("Die bisherigen Daten eines Änderungsantrags lassen sich nicht ändern.");
      }
    }
    // eigenen Änderungsantrag verwerfen: zurück auf «approved» mit genau den bisherigen Daten (originalData)
    let discard = false;
    if (name === "vacationEntries" && o.getString("status") === "pending" && r.getString("status") === "approved" && !changeRequest) {
      let prev = null;
      try { prev = JSON.parse(o.getString("originalData") || "null"); } catch { prev = null; }
      discard = !!prev && String(prev.dateFrom || "").slice(0, 10) === r.getString("dateFrom").slice(0, 10)
        && String(prev.dateTo || "").slice(0, 10) === r.getString("dateTo").slice(0, 10);
    }
    if (!discard && (name === "vacationEntries" || name === "absences") && (r.getString("status") !== "pending" || (o.getString("status") !== "pending" && !changeRequest))) {
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
  // 5. Stammdaten mit Verweisen (Runde 25: auch Offerten, Spesen, Protokolle, Lieferscheine — PocketBase leerte sonst
  // still die Verweise) und Mitarbeitende (Kaskade löschte sonst Lohnabrechnungen und Abschlüsse ohne Protokoll)
  if (name === "persons" || name === "projects" || name === "quotes" || name === "employees") {
    if (name === "employees" && !full) throw new ForbiddenError("Mitarbeitende löscht ein Admin.");
    const refs = name === "persons"
      ? [["invoices", "client"], ["quotes", "client"], ["contracts", "client"], ["deliveryNotes", "client"], ["projects", "client"]]
      : name === "projects"
        ? [["invoices", "project"], ["quotes", "project"], ["contracts", "project"], ["expenses", "project"], ["protocols", "project"], ["deliveryNotes", "project"], ["timeEntries", "project"]]
        : name === "quotes"
          ? [["invoices", "quote"], ["contracts", "quote"]]
          : [["payrollEntries", "employee"], ["overtimeClosings", "employee"], ["vacationEntries", "employee"], ["absences", "employee"], ["timeEntries", "employee"], ["expenses", "employee"]];
    // auch mit Vollzugriff nicht — «Rückgängig» stellt geleerte Verweise nicht wieder her. Nur Stunden: Admin darf.
    const LABEL = { invoices: "Rechnungen", quotes: "Offerten", contracts: "Verträge", timeEntries: "Zeiteinträge", expenses: "Spesen",
      protocols: "Protokolle", deliveryNotes: "Lieferscheine", payrollEntries: "Lohnabrechnungen", overtimeClosings: "Überstunden-Abschlüsse",
      vacationEntries: "Ferien", absences: "Absenzen", projects: "Projekte" };
    for (const [coll, field] of refs) {
      let used = false;
      try { e.app.findFirstRecordByFilter(coll, field + " = {:id}", { id: r.id }); used = true; } catch { used = false; }
      if (used && (coll !== "timeEntries" || name !== "projects" || !full)) throw new ForbiddenError("Wird noch verwendet (" + LABEL[coll] + ") und kann darum nicht gelöscht werden.");
    }
    return e.next();
  }
  let own = false;
  try { own = e.app.findRecordById("employees", r.get("employee")).get("appUser") === uid; } catch { own = false; }
  if (!has("mitarbeiter")) {
    let closed = [];
    try { closed = JSON.parse(e.app.findFirstRecordByFilter("studioSettings", "studio = {:s}", { s: sid }).getString("ui") || "{}").closedMonths; } catch { closed = []; }
    closed = Array.isArray(closed) ? closed.filter((m) => typeof m === "string") : [];   // falscher Typ sperrte sonst alles bzw. nichts
    // alle drei Datumsfelder (date, dateFrom, dateTo) und ihr ganzer Bereich — vorher zählte date nicht, sobald
    // dateFrom gesetzt war, und ein umgekehrter Bereich war leer (Sicherheits-Test Runde 25)
    const ds = [r.getString("date"), r.getString("dateFrom"), r.getString("dateTo")].map((v) => String(v || "").slice(0, 7)).filter((v) => v).sort();
    for (const m of closed) if (ds.length && m >= ds[0] && m <= ds[ds.length - 1]) throw new ForbiddenError("Der Monat " + m + " ist abgeschlossen.");
  }
  if (name === "timeEntries" && r.getString("invoice") && !has("invoices")) throw new ForbiddenError("Verrechnete Zeiteinträge löscht nur, wer das Recht Rechnungen hat.");
  if (name === "overtimeClosings" && !has("loehne")) throw new ForbiddenError("Überstunden-Abschlüsse löscht, wer das Recht Löhne hat.");
  if (own && !full) {
    if ((name === "vacationEntries" || name === "absences") && r.getString("status") !== "pending") throw new ForbiddenError("Genehmigte eigene Einträge ändert ein Admin.");
    if (name === "overtimeClosings") throw new ForbiddenError("Eigene Überstunden schliesst ein Admin ab.");
  }
  e.next();
}, "timeEntries", "absences", "vacationEntries", "overtimeClosings", "persons", "projects", "quotes", "employees");


// ── Lohnfelder nur mit Recht «loehne» (Entscheid 26.11.2026: Projektleiter sehen keine Löhne; einstellbar pro Rolle) ──
// Vorher lieferte der Server Monatslohn, IBAN, AHV-Nr. usw. jedem mit «mitarbeiter» (z.B. Projektleiter). Ausgeblendet
// für fremde Datensätze; die eigenen sieht jede Person. Gilt für REST, expand und Realtime.
onRecordEnrich((e) => {
  const auth = e.requestInfo && e.requestInfo.auth;
  if (!auth || (auth.collection && auth.collection().name === "_superusers")) return e.next();
  const r = e.record;
  if (r.get("appUser") === auth.id) return e.next();
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: r.get("studio"), u: auth.id }).getString("perms"); } catch { perms = ""; }
  if (perms.indexOf("|*|") >= 0 || perms.indexOf("|loehne|") >= 0) return e.next();
  r.hide("monatslohn", "lohnVerlauf", "lohnIban", "dreizehnterLohn", "ahvSatz", "alvSatz", "bvgSatz", "nbuSatz", "ktgSatz",
    "quellensteuerPflichtig", "quellensteuerSatz", "pkBeitragAN", "pkBeitragAG", "pkAgSatz", "familienzulagen", "ahvRentner", "ahvNr");
  e.next();
}, "employees");
onRecordEnrich((e) => {
  const auth = e.requestInfo && e.requestInfo.auth;
  if (!auth || (auth.collection && auth.collection().name === "_superusers")) return e.next();
  const r = e.record;
  let own = false;
  try { own = e.app.findRecordById("employees", r.get("employee")).get("appUser") === auth.id; } catch { own = false; }
  if (own) return e.next();
  let perms = "";
  try { perms = e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: r.get("studio"), u: auth.id }).getString("perms"); } catch { perms = ""; }
  if (perms.indexOf("|*|") >= 0 || perms.indexOf("|loehne|") >= 0) return e.next();
  r.hide("auszahlungBetrag", "stundenlohn");
  e.next();
}, "overtimeClosings");
// Filter/Sortierung über Lohnfelder ohne «loehne» ablehnen (Orakel per Bisektion, auch über Relationen). Büro aus dem
// Filter («studio = "…"»), sonst muss das Recht in allen Mitgliedschaften bestehen.
onRecordsListRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const q = e.requestInfo().query || {};
  const text = String(q.filter || "") + " " + String(q.sort || "");
  if (!/(monatslohn|lohnverlauf|lohniban|ahvnr|pkbeitrag|familienzulagen|quellensteuer|dreizehnterlohn|ahvrentner|(ahv|alv|bvg|nbu|ktg|pkag)satz|auszahlungbetrag|stundenlohn)/i.test(text)) return e.next();
  const uid = e.auth ? e.auth.id : "";
  const m = String(q.filter || "").match(/studio\s*=\s*["']([a-zA-Z0-9_-]+)["']/);
  let mems = [];
  try { mems = m ? [e.app.findFirstRecordByFilter("studioMembers", "studio = {:s} && user = {:u} && active = true", { s: m[1], u: uid })] : e.app.findRecordsByFilter("studioMembers", "user = {:u} && active = true", "", 0, 0, { u: uid }); } catch { mems = []; }
  const ok = mems.length > 0 && mems.every((x) => { const p = x.getString("perms"); return p.indexOf("|*|") >= 0 || p.indexOf("|loehne|") >= 0; });
  if (!ok) throw new BadRequestError("Filter oder Sortierung über Lohnangaben braucht das Recht Löhne.");
  e.next();
});


// ── Ressourcenplan (Migration 1787970000_resource_plan.js): Bereich und Büro-Zugehörigkeit prüfen ──
// Von–bis, Pensum 1–100 (das Feld prüft die Grenzen auch; hier die klare Meldung) und: Mitarbeiter/Projekt gehören
// zum selben Büro (sonst hängte ein Eintrag an einer fremden Person, und die Kaskade griffe dort).
onRecordCreateRequest((e) => {
  const r = e.record;
  const day = (v) => String(v || "").slice(0, 10);
  const p = r.getFloat("pensum");
  if (!(p >= 1 && p <= 100)) throw new BadRequestError("Pensum muss zwischen 1 und 100 liegen.");
  if (day(r.getString("dateTo")) < day(r.getString("dateFrom"))) throw new BadRequestError("Bis liegt vor Von.");
  try { if (e.app.findRecordById("employees", r.get("employee")).get("studio") !== r.get("studio")) throw new Error("x"); } catch { throw new BadRequestError("Mitarbeiter gehört nicht zu diesem Büro."); }
  if (r.get("project")) {
    try { if (e.app.findRecordById("projects", r.get("project")).get("studio") !== r.get("studio")) throw new Error("x"); } catch { throw new BadRequestError("Projekt gehört nicht zu diesem Büro."); }
  }
  e.next();
}, "resourcePlans");
onRecordUpdateRequest((e) => {
  const r = e.record;
  const day = (v) => String(v || "").slice(0, 10);
  const p = r.getFloat("pensum");
  if (!(p >= 1 && p <= 100)) throw new BadRequestError("Pensum muss zwischen 1 und 100 liegen.");
  if (day(r.getString("dateTo")) < day(r.getString("dateFrom"))) throw new BadRequestError("Bis liegt vor Von.");
  try { if (e.app.findRecordById("employees", r.get("employee")).get("studio") !== r.get("studio")) throw new Error("x"); } catch { throw new BadRequestError("Mitarbeiter gehört nicht zu diesem Büro."); }
  if (r.get("project")) {
    try { if (e.app.findRecordById("projects", r.get("project")).get("studio") !== r.get("studio")) throw new Error("x"); } catch { throw new BadRequestError("Projekt gehört nicht zu diesem Büro."); }
  }
  e.next();
}, "resourcePlans");
