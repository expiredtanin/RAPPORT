/// <reference path="../pb_data/types.d.ts" />
// Ersetzt die Supabase-RPCs `create_studio_with_admin` + `seed_studio_defaults`:
// legt Studio + Admin-Mitgliedschaft + Default-Stammdaten atomar an. Optional
// werden über sharePersonsFrom (Liste von Quell-Studio-IDs) Personen aus
// anderen Studios des Callers geteilt — siehe pb_migrations/*_person_sharing.js
// für die Zugriffsregel-Seite und supabase/migrations/0007_share_persons_on_
// studio_create.sql (git-history) fürs Postgres-Original, 1:1 portiert.
//
// Quelle der Seed-Werte: RAPPORT-APP/src/constants.js (defaultData.settings/.roles/
// .dashboardTemplates/.appRoles/.letterTemplates, DEFAULT_ABSENZ_TYPES). Bei Änderungen
// dort dieses File nachziehen — genau wie das alte Supabase-Pendant im Kommentar mahnte.

routerAdd("POST", "/api/rapport/create-studio", (e) => {
  const data = new DynamicModel({ name: "", slug: "", sharePersonsFrom: [] });
  e.bindBody(data);

  if (!data.name || !data.slug) {
    throw new BadRequestError("name und slug sind erforderlich.");
  }

  const sourceStudioIds = (data.sharePersonsFrom || []).filter(Boolean);

  // Caller muss aktives Mitglied JEDES Quell-Studios sein — sonst könnte man
  // sich fremde Personen "erschleichen", indem man eine beliebige Studio-ID mitschickt.
  for (const sourceId of sourceStudioIds) {
    let isMember = false;
    try {
      e.app.findFirstRecordByFilter(
        "studioMembers", "studio = {:sid} && user = {:uid} && active = true",
        { sid: sourceId, uid: e.auth.id },
      );
      isMember = true;
    } catch {
      isMember = false;
    }
    if (!isMember) {
      throw new ForbiddenError("Nicht Mitglied aller Quell-Studios für Personen-Sharing.");
    }
  }

  const studiosCollection = e.app.findCollectionByNameOrId("studios");
  const membersCollection = e.app.findCollectionByNameOrId("studioMembers");
  const personStudioLinksCollection = e.app.findCollectionByNameOrId("personStudioLinks");

  // Verschachtelt statt Top-Level-Funktion — siehe seedStudioDefaults-Kommentar unten
  // (gleicher JSVM-Scoping-Grund).
  function sharePersonsFromStudio(txApp, sourceId, targetStudioId) {
    const mkLink = (personId, studioId, primary) => {
      try {
        txApp.findFirstRecordByFilter(
          "personStudioLinks", "person = {:pid} && studio = {:sid}",
          { pid: personId, sid: studioId },
        );
        return; // Link existiert schon — nichts zu tun (idempotent).
      } catch { /* nicht gefunden, weiter unten anlegen */ }
      const link = new Record(personStudioLinksCollection);
      link.set("person", personId);
      link.set("studio", studioId);
      link.set("primaryStudio", !!primary);
      txApp.save(link);
    };

    // Schritt 1: lokale Personen des Quell-Studios globalisieren (studio -> "")
    // und einen Link zurück ans Quell-Studio anlegen (primaryStudio, sie sind
    // dort ursprünglich entstanden).
    const localPersons = txApp.findRecordsByFilter("persons", "studio = {:sid}", "", 0, 0, { sid: sourceId });
    for (const p of localPersons) {
      mkLink(p.id, sourceId, true);
      p.set("studio", "");
      txApp.save(p);
    }

    // Schritt 2: ALLE im Quell-Studio sichtbaren Personen (frisch globalisierte
    // von oben + schon vorher geteilte) auch dem neuen Studio zuordnen.
    const sourceLinks = txApp.findRecordsByFilter("personStudioLinks", "studio = {:sid}", "", 0, 0, { sid: sourceId });
    for (const l of sourceLinks) {
      mkLink(l.get("person"), targetStudioId, false);
    }
  }

  // Verschachtelt statt Top-Level-Funktion: PocketBase-JSVM hält Top-Level-`function`-
  // Deklarationen aus pb_hooks-Dateien zur Request-Laufzeit nicht zuverlässig im Scope
  // des später aufgerufenen routerAdd-Callbacks (ReferenceError "not defined").
  function seedStudioDefaults(txApp, studioId) {
    const mk = (collectionName, fields) => {
      const record = new Record(txApp.findCollectionByNameOrId(collectionName));
      record.set("studio", studioId);
      for (const k in fields) record.set(k, fields[k]);
      txApp.save(record);
    };

    mk("studioSettings", {
      name: "Mein Studio", country: "CH",
      email: "mail@studio.ch", phone: "+41 79 000 00 00",
      iban: "CH00 0000 0000 0000 0000 0", ibanType: "qr", mwstRate: 8.1,
      defaultHourlyRate: 120, defaultWochenstunden: 35, defaultFerienWochen: 5,
      formats: {
        projectNumberFormat: "YYYY/NN", invoiceNumberFormat: "YYYY-NNN",
        quoteNumberFormat: "YYYY-NNN", protocolNumberFormat: "YYYY-TT-NN",
        deliveryNoteNumberFormat: "YYYY-NNN",
      },
      pageMargins: { pageMarginTop: 20, pageMarginBottom: 20, pageMarginLeft: 20, pageMarginRight: 20 },
      ui: { autoPrint: false, logoSize: 60, qrNewPage: true, pdfNameFormat: "{studio}_{typ}_{nummer}" },
      protokollTypeAbbr: {
        "Bausitzung": "BS", "Planungssitzung": "PS", "Baubesprechung": "BB", "Jour fixe": "JF",
        "Interne Sitzung": "IS", "Kundensitzung": "KS", "Abnahme": "AB", "Sonstiges": "SO",
      },
    });

    const roles = [
      { roleId: "PL", label: "Projektleiter/in", rate: 140, sort: 1 },
      { roleId: "TS", label: "Technischer Support", rate: 120, sort: 2 },
      { roleId: "BL", label: "Bauleiter/in", rate: 135, sort: 3 },
      { roleId: "AS", label: "Administrativer Support", rate: 120, sort: 4 },
    ];
    roles.forEach(r => mk("studioRoles", r));

    const dashboardTemplates = [
      { templateId: "tpl-admin", name: "Administrator", isPublic: true, layout: [
        { id: "dw-a1", cols: 4, minH: 0, widgets: ["kpi-projekte", "kpi-stunden", "kpi-ausstehend", "kpi-umsatz"] },
        { id: "dw-a2", cols: 1, minH: 0, widgets: ["warnungen"] },
        { id: "dw-a3", cols: 2, minH: 0, widgets: ["aktive-projekte", "unverrechnete-stunden"] },
        { id: "dw-a4", cols: 2, minH: 0, widgets: ["umsatz-sparkline", "offene-offerten"] },
        { id: "dw-a5", cols: 1, minH: 0, widgets: ["letzte-zeiteintraege"] },
      ] },
      { templateId: "tpl-projektleiter", name: "Projektleiter", isPublic: true, layout: [
        { id: "dw-p1", cols: 2, minH: 0, widgets: ["kpi-projekte", "kpi-stunden"] },
        { id: "dw-p2", cols: 1, minH: 0, widgets: ["warnungen"] },
        { id: "dw-p3", cols: 3, minH: 0, widgets: ["meine-projekte", "team-auslastung", "offene-offerten"] },
        { id: "dw-p4", cols: 1, minH: 0, widgets: ["letzte-zeiteintraege"] },
      ] },
      { templateId: "tpl-mitarbeiter", name: "Mitarbeiter", isPublic: true, layout: [
        { id: "dw-m1", cols: 3, minH: 0, widgets: ["kpi-stunden", "ueberstunden", "meine-ferien"] },
        { id: "dw-m2", cols: 2, minH: 0, widgets: ["meine-projekte", "stunden-woche"] },
        { id: "dw-m3", cols: 1, minH: 0, widgets: ["meine-zeiteintraege"] },
      ] },
    ];
    dashboardTemplates.forEach(t => mk("dashboardTemplates", t));

    const appRoles = [
      { roleId: "r-admin", name: "Administrator", permissions: null, dashboardTemplateId: "tpl-admin" },
      { roleId: "r-projektleiter", name: "Projektleiter", dashboardTemplateId: "tpl-projektleiter",
        permissions: ["dashboard", "projects", "time", "quotes", "personen", "mitarbeiter", "settings"] },
      { roleId: "r-mitarbeiter", name: "Mitarbeiter", dashboardTemplateId: "tpl-mitarbeiter",
        permissions: ["dashboard", "projects", "time", "personen", "settings"] },
    ];
    appRoles.forEach(r => mk("appRoles", r));

    const absenceTypes = [
      { typeId: "krankheit", label: "Krankheit", color: "#8a1a1a" },
      { typeId: "unfall", label: "Unfall", color: "#b5621e" },
      { typeId: "intern", label: "Intern", color: "#1a4e8a" },
      { typeId: "informatik", label: "Informatik", color: "#555" },
      { typeId: "rechnungswesen", label: "Rechnungswesen", color: "#7a6a00" },
      { typeId: "weiterbildung", label: "Weiterbildung", color: "#2d6a4f" },
      { typeId: "militaer", label: "Militär / Zivildienst", color: "#3d3d38" },
    ];
    absenceTypes.forEach(t => mk("absenceTypes", t));

    const letterTemplates = [
      { templateId: "offer", name: "Offerte",
        body: "Sehr geehrte/r {{client}}\n\nGerne unterbreiten wir Ihnen die Offerte für das Projekt «{{project}}».\n\n[Leistungsumfang]\n\nHonorar: CHF [Betrag]\n\nWir freuen uns auf die Zusammenarbeit.\n\nFreundliche Grüsse" },
      { templateId: "reminder", name: "Zahlungserinnerung",
        body: "Sehr geehrte/r {{client}}\n\nBei einer Überprüfung unserer Buchhaltung stellen wir fest, dass die Rechnung [Nr.] vom [Datum] über CHF [Betrag] noch nicht beglichen ist.\n\nWir bitten Sie höflich, den offenen Betrag innert 10 Tagen zu überweisen.\n\nFreundliche Grüsse" },
    ];
    letterTemplates.forEach(t => mk("letterTemplates", t));
  }

  let studioId;
  e.app.runInTransaction((txApp) => {
    const studio = new Record(studiosCollection);
    studio.set("name", data.name);
    studio.set("slug", data.slug);
    txApp.save(studio);

    const member = new Record(membersCollection);
    member.set("studio", studio.id);
    member.set("user", e.auth.id);
    member.set("appRoleId", "r-admin");
    member.set("active", true);
    txApp.save(member);

    studioId = studio.id;
    seedStudioDefaults(txApp, studioId);

    for (const sourceId of sourceStudioIds) {
      sharePersonsFromStudio(txApp, sourceId, studioId);
    }
  });

  return e.json(200, { id: studioId });
}, $apis.requireAuth());
