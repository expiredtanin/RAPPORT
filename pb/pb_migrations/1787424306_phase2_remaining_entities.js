/// <reference path="../pb_data/types.d.ts" />
// PB-Phase 2: restliche Entities aus supabase/migrations/0001_initial.sql.
// Vereinfachungen ggü. dem Postgres-Schema (bewusst, keine Funktionseinbusse):
//   - invoice_reminders  → invoices.reminders (json) statt eigener Tabelle
//   - delivery_note_items → deliveryNotes.items (json) statt eigener Tabelle
//   - project_quote_links → projects.linkedQuotes (json, [{quoteId,role}]) statt Join-Tabelle
// Alle drei waren im Original laut SQL-Kommentar 1:1-Abbilder von Frontend-Arrays
// (inv.reminders[] etc.) — die separate Tabelle brachte keinen echten Vorteil.

migrate((app) => {
  const studios = app.findCollectionByNameOrId("studios");
  const persons = app.findCollectionByNameOrId("persons");
  const projects = app.findCollectionByNameOrId("projects");
  const users = app.findCollectionByNameOrId("users");

  const memberRule =
    "@request.auth.id != '' && " +
    "studio.studioMembers_via_studio.user ?= @request.auth.id && " +
    "studio.studioMembers_via_studio.active = true";
  const rules = { listRule: memberRule, viewRule: memberRule, createRule: memberRule, updateRule: memberRule, deleteRule: memberRule };
  const uuidId = { name: "id", type: "text", primaryKey: true, required: true, system: true, autogeneratePattern: "", pattern: "^[a-zA-Z0-9-]+$", min: 1, max: 64 };
  const audit = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const rel1 = (name, target, required = false, cascadeDelete = false) =>
    ({ name, type: "relation", required, collectionId: target.id, cascadeDelete, maxSelect: 1 });

  // ── linkedQuotes-Feld auf projects nachtragen (Quotes-Collection existiert erst gleich) ──
  // (wird unten, nach Anlage von quotes, ergänzt)

  // ── Stammdaten (Config, kein Audit — analog zu studioRoles) ─────────────
  const absenceTypes = new Collection({
    type: "base", name: "absenceTypes",
    fields: [
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "typeId", type: "text", required: true, max: 60 },
      { name: "label", type: "text", required: true, max: 120 },
      { name: "color", type: "text", max: 20 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_absenceTypes_studio_typeId ON absenceTypes (studio, typeId)"],
    ...rules,
  });
  app.save(absenceTypes);

  const letterTemplates = new Collection({
    type: "base", name: "letterTemplates",
    fields: [
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "templateId", type: "text", required: true, max: 60 },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "body", type: "editor", maxSize: 500000 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_letterTemplates_studio_templateId ON letterTemplates (studio, templateId)"],
    ...rules,
  });
  app.save(letterTemplates);

  const holidays = new Collection({
    type: "base", name: "holidays",
    fields: [
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "date", type: "date", required: true },
      { name: "label", type: "text", required: true, max: 120 },
      { name: "halfDay", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_holidays_studio_date ON holidays (studio, date)"],
    ...rules,
  });
  app.save(holidays);

  const appRoles = new Collection({
    type: "base", name: "appRoles",
    fields: [
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "roleId", type: "text", required: true, max: 60 },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "permissions", type: "json" },
      { name: "dashboardTemplateId", type: "text", max: 60 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_appRoles_studio_roleId ON appRoles (studio, roleId)"],
    ...rules,
  });
  app.save(appRoles);

  const dashboardTemplates = new Collection({
    type: "base", name: "dashboardTemplates",
    fields: [
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "templateId", type: "text", required: true, max: 60 },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "isPublic", type: "bool" },
      { name: "layout", type: "json", required: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_dashboardTemplates_studio_templateId ON dashboardTemplates (studio, templateId)"],
    ...rules,
  });
  app.save(dashboardTemplates);

  // ── employees (HR-Kern, von vielen Folge-Entities referenziert) ─────────
  const employees = new Collection({
    type: "base", name: "employees",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "personalNr", type: "text", max: 60 },
      { name: "pensum", type: "number" },
      { name: "wochenstunden", type: "number" },
      { name: "ferienWochen", type: "number" },
      { name: "pkAgSatz", type: "number" },
      { name: "ferienUebertragVorjahr", type: "json" },
      { name: "appUser", ...rel1("appUser", users, false, false) },
      { name: "active", type: "bool" },
      ...audit,
    ],
    indexes: ["CREATE INDEX idx_employees_studio_active ON employees (studio, active)"],
    ...rules,
  });
  app.save(employees);

  // ── quotes ────────────────────────────────────────────────────────────
  const quotes = new Collection({
    type: "base", name: "quotes",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "number", type: "text", max: 60 },
      { name: "client", ...rel1("client", persons, false, false) },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "projectName", type: "text", max: 300 },
      { name: "date", type: "date" },
      { name: "validUntil", type: "date" },
      { name: "mode", type: "select", maxSelect: 1, values: ["sia", "manual", "free"] },
      { name: "mwst", type: "bool" },
      { name: "notes", type: "text", max: 5000 },
      { name: "status", type: "select", maxSelect: 1, values: ["entwurf", "gesendet", "angenommen", "abgelehnt", "abgelaufen"] },
      { name: "siaConfig", type: "json" },
      { name: "manualPhases", type: "json" },
      { name: "freeItems", type: "json" },
      { name: "quoteRoles", type: "json" },
      ...audit,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_quotes_studio_number ON quotes (studio, number)",
      "CREATE INDEX idx_quotes_project ON quotes (project)",
    ],
    ...rules,
  });
  app.save(quotes);

  // linkedQuotes jetzt auf projects nachtragen (quotes existiert jetzt)
  projects.fields.add(new Field({ name: "linkedQuotes", type: "json" }));
  app.save(projects);

  // ── invoices (inkl. reminders als json statt eigener Tabelle) ──────────
  const invoices = new Collection({
    type: "base", name: "invoices",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "number", type: "text", max: 60 },
      { name: "client", ...rel1("client", persons, false, false) },
      { name: "contactId", type: "text", max: 64 },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "quote", ...rel1("quote", quotes, false, false) },
      { name: "date", type: "date" },
      { name: "dueDate", type: "date" },
      { name: "sentDate", type: "date" },
      { name: "paidDate", type: "date" },
      { name: "items", type: "json" },
      { name: "mwst", type: "bool" },
      { name: "mwstRate", type: "number" },
      { name: "notes", type: "text", max: 5000 },
      { name: "status", type: "select", maxSelect: 1, values: ["entwurf", "gesendet", "bezahlt", "überfällig"] },
      { name: "invoiceKind", type: "select", maxSelect: 1, values: ["akonto", "teilrechnung", "schluss", "voll"] },
      { name: "discountType", type: "select", maxSelect: 1, values: ["none", "percent", "amount"] },
      { name: "discountValue", type: "number" },
      { name: "discountLabel", type: "text", max: 200 },
      { name: "entrySelections", type: "json" },
      { name: "qrReference", type: "text", max: 40 },
      { name: "reminders", type: "json" },
      ...audit,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_invoices_studio_number ON invoices (studio, number)",
      "CREATE INDEX idx_invoices_project ON invoices (project)",
      "CREATE INDEX idx_invoices_client ON invoices (client)",
    ],
    ...rules,
  });
  app.save(invoices);

  // ── time_entries ─────────────────────────────────────────────────────
  const timeEntries = new Collection({
    type: "base", name: "timeEntries",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, false, false) },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "phaseId", type: "text", max: 20 },
      { name: "positionId", type: "text", max: 60 },
      { name: "date", type: "date", required: true },
      { name: "minutes", type: "number", required: true },
      { name: "startTime", type: "text", max: 5 },
      { name: "endTime", type: "text", max: 5 },
      { name: "description", type: "text", max: 2000 },
      ...audit,
    ],
    indexes: [
      "CREATE INDEX idx_timeEntries_studio_date ON timeEntries (studio, date)",
      "CREATE INDEX idx_timeEntries_employee_date ON timeEntries (employee, date)",
      "CREATE INDEX idx_timeEntries_project_date ON timeEntries (project, date)",
    ],
    ...rules,
  });
  app.save(timeEntries);

  // ── expenses (Mitarbeiterspesen; lohnEntry-Relation wird nach payrollEntries nachgetragen) ──
  const expenses = new Collection({
    type: "base", name: "expenses",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, false, false) },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "date", type: "date", required: true },
      { name: "category", type: "text", max: 100 },
      { name: "description", type: "text", max: 2000 },
      { name: "amount", type: "number", required: true },
      { name: "mwstRate", type: "number" },
      { name: "inclMwst", type: "bool" },
      { name: "status", type: "select", maxSelect: 1, values: ["offen", "genehmigt", "auf nächsten Lohn", "ausbezahlt"] },
      { name: "receiptUrl", type: "file", maxSelect: 1 },
      { name: "receiptName", type: "text", max: 300 },
      // lohnEntry-Relation wird unten nachgetragen (payrollEntries existiert erst danach)
      ...audit,
    ],
    indexes: [
      "CREATE INDEX idx_expenses_studio_status ON expenses (studio, status)",
      "CREATE INDEX idx_expenses_employee_date ON expenses (employee, date)",
    ],
    ...rules,
  });
  app.save(expenses);

  // ── internal_expenses (Studio-Ausgaben) ─────────────────────────────
  const internalExpenses = new Collection({
    type: "base", name: "internalExpenses",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "date", type: "date", required: true },
      { name: "category", type: "text", max: 100 },
      { name: "description", type: "text", max: 2000 },
      { name: "amount", type: "number", required: true },
      { name: "mwstRate", type: "number" },
      { name: "inclMwst", type: "bool" },
      { name: "recurring", type: "bool" },
      { name: "recurringInterval", type: "select", maxSelect: 1, values: ["monatlich", "quartalsweise", "jährlich"] },
      { name: "receiptUrl", type: "file", maxSelect: 1 },
      ...audit,
    ],
    indexes: ["CREATE INDEX idx_internalExpenses_studio_date ON internalExpenses (studio, date)"],
    ...rules,
  });
  app.save(internalExpenses);

  // ── absences ─────────────────────────────────────────────────────────
  const absences = new Collection({
    type: "base", name: "absences",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, true, true) },
      { name: "typeId", type: "text", max: 60 },
      { name: "date", type: "date" },
      { name: "dateFrom", type: "date" },
      { name: "dateTo", type: "date" },
      { name: "startTime", type: "text", max: 5 },
      { name: "endTime", type: "text", max: 5 },
      { name: "hours", type: "number" },
      { name: "minutes", type: "number" },
      { name: "note", type: "text", max: 2000 },
      { name: "status", type: "select", maxSelect: 1, values: ["pending", "approved", "rejected"] },
      ...audit,
    ],
    indexes: ["CREATE INDEX idx_absences_employee_date ON absences (employee, date)"],
    ...rules,
  });
  app.save(absences);

  // ── vacation_entries (ferienEntries) ────────────────────────────────
  const vacationEntries = new Collection({
    type: "base", name: "vacationEntries",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, true, true) },
      { name: "dateFrom", type: "date", required: true },
      { name: "dateTo", type: "date", required: true },
      { name: "note", type: "text", max: 2000 },
      { name: "status", type: "select", maxSelect: 1, values: ["pending", "approved", "rejected"] },
      { name: "originalData", type: "json" },
      ...audit,
    ],
    indexes: ["CREATE INDEX idx_vacationEntries_employee_dateFrom ON vacationEntries (employee, dateFrom)"],
    ...rules,
  });
  app.save(vacationEntries);

  // ── payroll_entries (lohnEntries) ───────────────────────────────────
  const payrollEntries = new Collection({
    type: "base", name: "payrollEntries",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, true, true) },
      { name: "year", type: "number", required: true },
      { name: "month", type: "number", required: true },
      { name: "brutto", type: "number" }, { name: "ahv", type: "number" }, { name: "alv", type: "number" },
      { name: "bvg", type: "number" }, { name: "nbu", type: "number" }, { name: "ktg", type: "number" },
      { name: "quellensteuer", type: "number" }, { name: "spesen", type: "number" }, { name: "bonus", type: "number" },
      { name: "netto", type: "number" },
      { name: "status", type: "text", max: 40 },
      { name: "paidAt", type: "date" },
      ...audit,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_payrollEntries_employee_year_month ON payrollEntries (employee, year, month)"],
    ...rules,
  });
  app.save(payrollEntries);

  // lohnEntry-Relation auf expenses nachtragen (payrollEntries existiert jetzt)
  expenses.fields.add(new Field({ name: "lohnEntry", type: "relation", required: false, collectionId: payrollEntries.id, cascadeDelete: false, maxSelect: 1 }));
  app.save(expenses);

  // ── overtime_closings (uberstundenAbschluss) ────────────────────────
  const overtimeClosings = new Collection({
    type: "base", name: "overtimeClosings",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "employee", ...rel1("employee", employees, true, true) },
      { name: "date", type: "date", required: true },
      { name: "saldoHours", type: "number" },
      ...audit,
    ],
    indexes: [],
    ...rules,
  });
  app.save(overtimeClosings);

  // ── protocols ────────────────────────────────────────────────────────
  const protocols = new Collection({
    type: "base", name: "protocols",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "number", type: "text", max: 60 },
      { name: "type", type: "select", maxSelect: 1, values: ["Bausitzung", "Planungssitzung", "Baubesprechung", "Jour fixe", "Interne Sitzung", "Kundensitzung", "Abnahme", "Sonstiges"] },
      { name: "location", type: "text", max: 200 },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "projectManual", type: "text", max: 300 },
      { name: "participants", type: "json" },
      { name: "traktanden", type: "json" },
      { name: "nextDate", type: "date" },
      { name: "verteiler", type: "text", max: 2000 },
      ...audit,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_protocols_studio_number ON protocols (studio, number)",
      "CREATE INDEX idx_protocols_project ON protocols (project)",
    ],
    ...rules,
  });
  app.save(protocols);

  // ── delivery_notes (inkl. items als json statt eigener Tabelle) ────
  const deliveryNotes = new Collection({
    type: "base", name: "deliveryNotes",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "number", type: "text", max: 60 },
      { name: "date", type: "date" },
      { name: "client", ...rel1("client", persons, false, false) },
      { name: "project", ...rel1("project", projects, false, false) },
      { name: "notes", type: "text", max: 2000 },
      { name: "items", type: "json" },
      ...audit,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_deliveryNotes_studio_number ON deliveryNotes (studio, number)"],
    ...rules,
  });
  app.save(deliveryNotes);

  // ── blog_posts (Pinnwand) ───────────────────────────────────────────
  const blogPosts = new Collection({
    type: "base", name: "blogPosts",
    fields: [
      uuidId,
      { name: "studio", ...rel1("studio", studios, true, true) },
      { name: "author", ...rel1("author", users, false, false) },
      { name: "category", type: "text", max: 100 },
      { name: "title", type: "text", max: 300 },
      { name: "body", type: "editor", maxSize: 500000 },
      { name: "pinned", type: "bool" },
      ...audit,
    ],
    indexes: ["CREATE INDEX idx_blogPosts_studio_created ON blogPosts (studio, created)"],
    ...rules,
  });
  app.save(blogPosts);

}, (app) => {
  for (const name of [
    "blogPosts", "deliveryNotes", "protocols", "overtimeClosings", "payrollEntries",
    "vacationEntries", "absences", "internalExpenses", "expenses", "timeEntries",
    "invoices", "quotes", "employees", "dashboardTemplates", "appRoles",
    "holidays", "letterTemplates", "absenceTypes",
  ]) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.removeByName("linkedQuotes");
  app.save(projects);
});
