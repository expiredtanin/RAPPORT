/// <reference path="../pb_data/types.d.ts" />
// Server-seitige Durchsetzung des App-Rollen-Berechtigungsmodells (appRoles.permissions,
// siehe RAPPORT-APP/src/constants.js defaultData.appRoles). Bisher wurde permissions NUR im
// React-Frontend geprüft (App.jsx userPermissions/hasViewAccess) — die Collection-Rules
// kennen nur Studio-Mitgliedschaft (memberRule), nicht die Rolle des Callers. Ein technisch
// versierter Mitarbeiter ohne z.B. "invoices"-Berechtigung konnte also Rechnungen trotzdem
// per direktem API-Call lesen/schreiben, weil die UI-Sperre die einzige Hürde war.
//
// Diese Hooks laufen ZUSÄTZLICH zu den bestehenden memberRule-Checks (die Studio-Zugehörigkeit
// bleibt erste Verteidigungslinie). Sensible/eigenständige Collections (Rechnungen, Offerten,
// Verträge, Spesen, Löhne, Mitarbeiterdaten) sind komplett gesperrt (Lesen + Schreiben).
// Quer referenzierte Stammdaten (Personen, Projekte, Zeiteinträge, Protokolle, Lieferscheine,
// Briefvorlagen, geteilte Studio-Konfiguration) bleiben lesbar für alle aktiven Mitglieder,
// da viele Views (Dropdowns, PDF-Köpfe etc.) unabhängig von der eigenen Rolle darauf
// zugreifen müssen — nur das Schreiben ist an die jeweilige Berechtigung gebunden.
//
// permissions === null in appRoles => Vollzugriff (Administrator-Rolle). Die Prüfung ob eine
// Rolle Vollzugriff hat oder eine bestimmte Berechtigung im Array trägt, läuft bewusst als
// EIN findFirstRecordByFilter mit "(permissions = null || permissions ~ '"<id>"')" statt über
// role.get("permissions") in JS zu dekodieren: die PocketBase-JSVM (goja) exportiert ein
// Go-seitig nil-JSON-Array beim Auslesen als leeres JS-Array ([]), nicht als JS null — ein
// direkter `perms === null`-Vergleich in JS liefert für Admin-Rollen (permissions: null in der
// DB) daher fälschlich false. Die Filter-Query umgeht das, weil PocketBase "= null" auf
// SQL-Ebene korrekt gegen die Spalte prüft.
//
// Fail-closed: jede nicht auflösbare Rolle/Mitgliedschaft/Studio-Zuordnung => keine Rechte.
//
// WICHTIG: jede Hook-Callback-Funktion läuft bei Ausführung isoliert vom Datei-Top-Level
// (gleiches JSVM-Verhalten wie in studios.pb.js/invite.pb.js dokumentiert — jeder Verweis auf
// Top-Level-const/-function aus dem Callback heraus scheitert mit "ReferenceError: not
// defined", auch aus einer IIFE oder über einen top-level function-Helper). Deshalb ist die
// komplette Prüf-Logik (Gate-Map + Rollen-Lookup) in JEDEM der fünf Callbacks vollständig
// dupliziert, statt sie über eine gemeinsame Funktion zu teilen — exakt das Muster, das
// invite.pb.js/studios.pb.js bereits für ihre verschachtelten Helper erzwingt.
// Die Collection-Namen-Arrays für die tags-Argumente sind unkritisch (werden synchron beim
// Registrieren ausgewertet, nicht erst beim späteren Request-Callback).

const FULL_GATE_NAMES = [
  "invoices", "quotes", "contracts", "expenses", "internalExpenses",
  "payrollEntries", "employees", "absences", "vacationEntries", "overtimeClosings",
];
const WRITE_GATE_NAMES = [
  "persons", "projects", "timeEntries", "protocols", "deliveryNotes", "letterTemplates",
  "studioSettings", "studioRoles", "dashboardTemplates", "absenceTypes", "holidays",
  "docAssets",
];
const ALL_GATE_NAMES = FULL_GATE_NAMES.concat(WRITE_GATE_NAMES);

onRecordsListRequest((e) => {
  const GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
  };
  const permId = GATE[e.collection.name];
  if (permId && !e.hasSuperuserAuth()) {
    const raw = (e.requestInfo().query && e.requestInfo().query.filter) || "";
    const m = raw.match(/studio\s*=\s*["']([a-zA-Z0-9_-]+)["']/);
    const studioId = m ? m[1] : null;
    const authId = e.auth ? e.auth.id : "";

    let allowed = false;
    if (authId && studioId) {
      try {
        const member = e.app.findFirstRecordByFilter(
          "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
          { sid: studioId, uid: authId },
        );
        const roleId = member.get("appRoleId");
        if (roleId) {
          try {
            e.app.findFirstRecordByFilter(
              "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
              { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
            );
            allowed = true;
          } catch {
            allowed = false;
          }
        }
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw new ForbiddenError("Keine Berechtigung (" + permId + ") für diese Aktion.");
  }
  e.next();
}, ...FULL_GATE_NAMES);

onRecordViewRequest((e) => {
  const GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
  };
  const permId = GATE[e.collection.name];
  if (permId && !e.hasSuperuserAuth()) {
    const studioId = e.record.get("studio");
    const authId = e.auth ? e.auth.id : "";

    let allowed = false;
    if (authId && studioId) {
      try {
        const member = e.app.findFirstRecordByFilter(
          "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
          { sid: studioId, uid: authId },
        );
        const roleId = member.get("appRoleId");
        if (roleId) {
          try {
            e.app.findFirstRecordByFilter(
              "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
              { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
            );
            allowed = true;
          } catch {
            allowed = false;
          }
        }
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw new ForbiddenError("Keine Berechtigung (" + permId + ") für diese Aktion.");
  }
  e.next();
}, ...FULL_GATE_NAMES);

onRecordCreateRequest((e) => {
  const GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
    persons: "personen", projects: "projects", timeEntries: "time", protocols: "protokolle",
    deliveryNotes: "lieferscheine", letterTemplates: "letters", studioSettings: "settings",
    studioRoles: "settings", dashboardTemplates: "settings", absenceTypes: "settings", holidays: "settings",
    docAssets: "settings",
  };
  const permId = GATE[e.collection.name];
  if (permId && !e.hasSuperuserAuth()) {
    // e.record ist zu diesem Zeitpunkt evtl. noch nicht aus dem Request-Body befüllt —
    // Studio-Zuordnung deshalb robust direkt aus dem Body lesen statt aus e.record.
    const body = e.requestInfo().body || {};
    const studioId = body.studio || e.record.get("studio");
    const authId = e.auth ? e.auth.id : "";

    let allowed = false;
    if (authId && studioId) {
      try {
        const member = e.app.findFirstRecordByFilter(
          "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
          { sid: studioId, uid: authId },
        );
        const roleId = member.get("appRoleId");
        if (roleId) {
          try {
            e.app.findFirstRecordByFilter(
              "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
              { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
            );
            allowed = true;
          } catch {
            allowed = false;
          }
        }
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw new ForbiddenError("Keine Berechtigung (" + permId + ") für diese Aktion.");
  }
  e.next();
}, ...ALL_GATE_NAMES);

onRecordUpdateRequest((e) => {
  const GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
    persons: "personen", projects: "projects", timeEntries: "time", protocols: "protokolle",
    deliveryNotes: "lieferscheine", letterTemplates: "letters", studioSettings: "settings",
    studioRoles: "settings", dashboardTemplates: "settings", absenceTypes: "settings", holidays: "settings",
    docAssets: "settings",
  };
  const permId = GATE[e.collection.name];
  if (permId && !e.hasSuperuserAuth()) {
    const studioId = e.record.get("studio");
    const authId = e.auth ? e.auth.id : "";

    let allowed = false;
    if (authId && studioId) {
      try {
        const member = e.app.findFirstRecordByFilter(
          "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
          { sid: studioId, uid: authId },
        );
        const roleId = member.get("appRoleId");
        if (roleId) {
          try {
            e.app.findFirstRecordByFilter(
              "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
              { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
            );
            allowed = true;
          } catch {
            allowed = false;
          }
        }
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw new ForbiddenError("Keine Berechtigung (" + permId + ") für diese Aktion.");
  }
  e.next();
}, ...ALL_GATE_NAMES);

onRecordDeleteRequest((e) => {
  const GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
    persons: "personen", projects: "projects", timeEntries: "time", protocols: "protokolle",
    deliveryNotes: "lieferscheine", letterTemplates: "letters", studioSettings: "settings",
    studioRoles: "settings", dashboardTemplates: "settings", absenceTypes: "settings", holidays: "settings",
    docAssets: "settings",
  };
  const permId = GATE[e.collection.name];
  if (permId && !e.hasSuperuserAuth()) {
    const studioId = e.record.get("studio");
    const authId = e.auth ? e.auth.id : "";

    let allowed = false;
    if (authId && studioId) {
      try {
        const member = e.app.findFirstRecordByFilter(
          "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
          { sid: studioId, uid: authId },
        );
        const roleId = member.get("appRoleId");
        if (roleId) {
          try {
            e.app.findFirstRecordByFilter(
              "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
              { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
            );
            allowed = true;
          } catch {
            allowed = false;
          }
        }
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw new ForbiddenError("Keine Berechtigung (" + permId + ") für diese Aktion.");
  }
  e.next();
}, ...ALL_GATE_NAMES);

// Realtime-Subscriptions laufen NICHT über die obigen Record-Request-Hooks — PocketBase
// broadcastet bei einer Record-Änderung den vollen Record-Inhalt an jeden Subscriber, gefiltert
// nur über die klassische Collection-ViewRule (hier: reine Studio-Mitgliedschaft). Ohne diesen
// Hook könnte ein Mitarbeiter ohne z.B. "invoices"-Berechtigung per direktem Subscribe-Aufruf
// (am React-Client vorbei) trotzdem den vollen Inhalt jeder Rechnungs-Änderung live mitlesen —
// das würde die obige REST-Sperre komplett aushebeln. Der Hook entfernt Subscription-Topics zu
// FULL_GATE-Collections aus der angeforderten Liste, wenn die Rolle die Berechtigung nicht hat,
// statt den gesamten Subscribe-Request abzulehnen (sonst würden auch erlaubte Topics blockiert —
// der Client abonniert immer alle Collections auf einmal, siehe subscribeToChanges() im Adapter).
// Topic-Format (empirisch verifiziert): "<collectionName>/*?options=<urlencoded JSON mit
// query.filter>" — Collection-Name ist alles vor dem ersten "/".
onRealtimeSubscribeRequest((e) => {
  const FULL_GATE = {
    invoices: "invoices", quotes: "quotes", contracts: "contracts", expenses: "expenses",
    internalExpenses: "internal-expenses", payrollEntries: "loehne", employees: "mitarbeiter",
    absences: "mitarbeiter", vacationEntries: "mitarbeiter", overtimeClosings: "mitarbeiter",
  };
  const authId = e.auth ? e.auth.id : "";
  const isSuperuser = e.hasSuperuserAuth();

  e.subscriptions = (e.subscriptions || []).filter((topic) => {
    const collName = topic.split("/")[0].split("?")[0];
    const permId = FULL_GATE[collName];
    if (!permId || isSuperuser) return true;

    let decoded = topic;
    try { decoded = decodeURIComponent(topic); } catch { /* topic bleibt roh */ }
    const m = decoded.match(/studio\s*=\s*\\?"([a-zA-Z0-9_-]+)\\?"/);
    const studioId = m ? m[1] : null;
    if (!authId || !studioId) return false;

    try {
      const member = e.app.findFirstRecordByFilter(
        "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
        { sid: studioId, uid: authId },
      );
      const roleId = member.get("appRoleId");
      if (!roleId) return false;
      e.app.findFirstRecordByFilter(
        "appRoles", "studio = {:sid} && roleId = {:rid} && (permissions = null || permissions ~ {:pq})",
        { sid: studioId, rid: roleId, pq: "\"" + permId + "\"" },
      );
      return true;
    } catch {
      return false;
    }
  });
  e.next();
});
