/// <reference path="../pb_data/types.d.ts" />
// Fixes aus dem Kalkulations-/Persistenz-Audit (siehe RAPPORT-APP-Historie):
// mehrere Collections verloren beim Cloud-Roundtrip Felder, die die echte
// App-Logik tatsächlich braucht (Lohn-Stammdaten, verrechnete Stunden,
// wiederkehrende Feiertage, Protokoll-Datum, gelöschte Absenz-Typen). Zwei
// Collections (payrollEntries, overtimeClosings) waren von Grund auf am
// falschen Datenmodell vorbei entworfen — statt jedes Feld einzeln
// nachzuziehen, werden sie auf das tatsächliche Objekt aus Payroll.jsx bzw.
// Employees.jsx umgebaut.

migrate((app) => {
  // ── employees: fehlende Lohn-/Personalien-Felder ──────────────────────
  const employees = app.findCollectionByNameOrId("employees");
  employees.fields.add(
    new Field({ name: "role", type: "text", max: 120 }),
    new Field({ name: "adresse", type: "text", max: 200 }),
    new Field({ name: "ort", type: "text", max: 100 }),
    new Field({ name: "ahvNr", type: "text", max: 40 }),
    new Field({ name: "geburtsdatum", type: "date" }),
    new Field({ name: "email", type: "email" }),
    new Field({ name: "eintrittsdatum", type: "date" }),
    new Field({ name: "monatslohn", type: "number" }),
    new Field({ name: "lohnIban", type: "text", max: 60 }),
    new Field({ name: "dreizehnterLohn", type: "bool" }),
    new Field({ name: "ahvSatz", type: "number" }),
    new Field({ name: "alvSatz", type: "number" }),
    new Field({ name: "bvgSatz", type: "number" }),
    new Field({ name: "nbuSatz", type: "number" }),
    new Field({ name: "ktgSatz", type: "number" }),
    new Field({ name: "quellensteuerPflichtig", type: "bool" }),
    new Field({ name: "quellensteuerSatz", type: "number" }),
  );
  app.save(employees);

  // ── timeEntries: Verrechnet-Verknüpfung fehlte komplett ────────────────
  const timeEntries = app.findCollectionByNameOrId("timeEntries");
  const invoices = app.findCollectionByNameOrId("invoices");
  timeEntries.fields.add(
    new Field({ name: "invoice", type: "relation", required: false, collectionId: invoices.id, cascadeDelete: false, maxSelect: 1 }),
  );
  app.save(timeEntries);

  // ── holidays: stundenDelta/repeatsYearly fehlten (halfDay wird von
  //    keiner UI-Stelle gelesen/geschrieben, bleibt aber unangetastet stehen) ──
  const holidays = app.findCollectionByNameOrId("holidays");
  holidays.fields.add(
    new Field({ name: "stundenDelta", type: "number" }),
    new Field({ name: "repeatsYearly", type: "bool" }),
  );
  app.save(holidays);

  // ── protocols: date fehlte (nicht nur title/time/endTime, siehe ARCHITECTURE.md) ──
  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.add(new Field({ name: "date", type: "date" }));
  app.save(protocols);

  // ── quotes: mwstRate fehlte — Offerte speicherte nie, mit welchem Satz sie
  //    kalkuliert wurde, PDF-Nachdruck zeigte immer den AKTUELLEN Studio-Satz ──
  const quotes = app.findCollectionByNameOrId("quotes");
  quotes.fields.add(new Field({ name: "mwstRate", type: "number" }));
  app.save(quotes);

  // ── absenceTypes: deleted-Tombstone fehlte (getAbsenzTypes() in utils.js
  //    braucht ihn, um versteckte Default-Typen von echten zu unterscheiden) ──
  const absenceTypes = app.findCollectionByNameOrId("absenceTypes");
  absenceTypes.fields.add(new Field({ name: "deleted", type: "bool" }));
  app.save(absenceTypes);

  // ── deliveryNotes: manuelle Empfänger-/Projekt-Angaben fehlten (nicht nur
  //    clientManual/deliveryAddress aus dem Audit — projectManual fehlte
  //    ebenfalls, DeliveryNotes.jsx nutzt es genauso) ─────────────────────
  const deliveryNotes = app.findCollectionByNameOrId("deliveryNotes");
  deliveryNotes.fields.add(
    new Field({ name: "clientManual", type: "text", max: 300 }),
    new Field({ name: "projectManual", type: "text", max: 300 }),
    new Field({ name: "deliveryAddress", type: "text", max: 500 }),
  );
  app.save(deliveryNotes);

  // ── expenses: receiptUrl war als "file"-Feld angelegt, die App speichert
  //    aber einen Base64-Data-URL-String direkt im Objekt (e.receiptData,
  //    kein echter Upload). Feldtyp lässt sich nicht in-place ändern (file →
  //    text) — altes Feld entfernen, neues text-Feld anlegen. ─────────────
  // max:0 fällt bei PocketBase-Textfeldern NICHT auf "unbegrenzt" zurück,
  // sondern auf den Default von 5000 Zeichen — für einen Base64-Data-URL
  // (Foto/PDF) viel zu knapp. Explizit grosszügig setzen (~15 MB Base64).
  const expenses = app.findCollectionByNameOrId("expenses");
  expenses.fields.removeByName("receiptUrl");
  expenses.fields.add(new Field({ name: "receiptData", type: "text", max: 15000000 }));
  app.save(expenses);

  // ── internalExpenses.receiptUrl: entspricht keinem Feld, das die UI
  //    jemals liest oder schreibt (anders als bei expenses) — entfernen ──
  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.removeByName("receiptUrl");
  app.save(internalExpenses);

  // ── payrollEntries: komplett am falschen Datenmodell vorbei entworfen.
  //    Payroll.jsx schreibt {monat, employeeId, empSnapshot, saetzeSnapshot,
  //    bruttoWasOverridden, bonusBeschrieb, spesenIds, ...calcLohn()-Output}
  //    — kein year/month/status/paidAt. Umbau auf employee+monat (für die
  //    findEntry()-Suche) + ein freies data-JSON-Feld für den Rest. ────────
  const payrollEntries = app.findCollectionByNameOrId("payrollEntries");
  for (const f of ["year", "month", "brutto", "ahv", "alv", "bvg", "nbu", "ktg", "quellensteuer", "spesen", "bonus", "netto", "status", "paidAt"]) {
    payrollEntries.fields.removeByName(f);
  }
  payrollEntries.fields.add(
    new Field({ name: "monat", type: "text", required: true, max: 7 }),
    new Field({ name: "data", type: "json" }),
  );
  payrollEntries.indexes = ["CREATE UNIQUE INDEX idx_payrollEntries_employee_monat ON payrollEntries (employee, monat)"];
  app.save(payrollEntries);

  // ── overtimeClosings: echtes Objekt aus Employees.jsx ist ein
  //    Auszahlungs-Eintrag (type/hoursSettled/zuschlagPercent/stundenlohn/
  //    auszahlungBetrag/year), nicht ein Saldo-Snapshot (saldoHours). ─────
  const overtimeClosings = app.findCollectionByNameOrId("overtimeClosings");
  overtimeClosings.fields.removeByName("saldoHours");
  overtimeClosings.fields.add(
    new Field({ name: "year", type: "number" }),
    new Field({ name: "type", type: "text", max: 40 }),
    new Field({ name: "hoursSettled", type: "number" }),
    new Field({ name: "zuschlagPercent", type: "number" }),
    new Field({ name: "stundenlohn", type: "number" }),
    new Field({ name: "auszahlungBetrag", type: "number" }),
  );
  app.save(overtimeClosings);
}, (app) => {
  const employees = app.findCollectionByNameOrId("employees");
  for (const f of ["role", "adresse", "ort", "ahvNr", "geburtsdatum", "email", "eintrittsdatum", "monatslohn", "lohnIban", "dreizehnterLohn", "ahvSatz", "alvSatz", "bvgSatz", "nbuSatz", "ktgSatz", "quellensteuerPflichtig", "quellensteuerSatz"]) {
    employees.fields.removeByName(f);
  }
  app.save(employees);

  const timeEntries = app.findCollectionByNameOrId("timeEntries");
  timeEntries.fields.removeByName("invoice");
  app.save(timeEntries);

  const holidays = app.findCollectionByNameOrId("holidays");
  holidays.fields.removeByName("stundenDelta");
  holidays.fields.removeByName("repeatsYearly");
  app.save(holidays);

  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.removeByName("date");
  app.save(protocols);

  const quotes = app.findCollectionByNameOrId("quotes");
  quotes.fields.removeByName("mwstRate");
  app.save(quotes);

  const absenceTypes = app.findCollectionByNameOrId("absenceTypes");
  absenceTypes.fields.removeByName("deleted");
  app.save(absenceTypes);

  const deliveryNotes = app.findCollectionByNameOrId("deliveryNotes");
  deliveryNotes.fields.removeByName("clientManual");
  deliveryNotes.fields.removeByName("projectManual");
  deliveryNotes.fields.removeByName("deliveryAddress");
  app.save(deliveryNotes);

  const expenses = app.findCollectionByNameOrId("expenses");
  expenses.fields.removeByName("receiptData");
  expenses.fields.add(new Field({ name: "receiptUrl", type: "file", maxSelect: 1 }));
  app.save(expenses);

  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.add(new Field({ name: "receiptUrl", type: "file", maxSelect: 1 }));
  app.save(internalExpenses);

  const payrollEntries = app.findCollectionByNameOrId("payrollEntries");
  payrollEntries.fields.removeByName("monat");
  payrollEntries.fields.removeByName("data");
  payrollEntries.fields.add(
    new Field({ name: "year", type: "number", required: true }),
    new Field({ name: "month", type: "number", required: true }),
    new Field({ name: "brutto", type: "number" }), new Field({ name: "ahv", type: "number" }), new Field({ name: "alv", type: "number" }),
    new Field({ name: "bvg", type: "number" }), new Field({ name: "nbu", type: "number" }), new Field({ name: "ktg", type: "number" }),
    new Field({ name: "quellensteuer", type: "number" }), new Field({ name: "spesen", type: "number" }), new Field({ name: "bonus", type: "number" }),
    new Field({ name: "netto", type: "number" }),
    new Field({ name: "status", type: "text", max: 40 }),
    new Field({ name: "paidAt", type: "date" }),
  );
  payrollEntries.indexes = ["CREATE UNIQUE INDEX idx_payrollEntries_employee_year_month ON payrollEntries (employee, year, month)"];
  app.save(payrollEntries);

  const overtimeClosings = app.findCollectionByNameOrId("overtimeClosings");
  for (const f of ["year", "type", "hoursSettled", "zuschlagPercent", "stundenlohn", "auszahlungBetrag"]) {
    overtimeClosings.fields.removeByName(f);
  }
  overtimeClosings.fields.add(new Field({ name: "saldoHours", type: "number" }));
  app.save(overtimeClosings);
});
