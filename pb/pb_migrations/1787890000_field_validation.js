/// <reference path="../pb_data/types.d.ts" />
// Wertprüfung auf dem Server (Audit 24.11.2026): Zeiteinträge nahmen negative Minuten, 1.5 Mia. Minuten, das Jahr
// 2099 und Uhrzeiten wie «99:99» an — der Überstundensaldo (Auszahlungsbasis) war damit beliebig.
//  - timeEntries.minutes 0…1440 (ein Tag); date 2000-01-01…2100-12-31; startTime/endTime «HH:MM» (24:00 erlaubt)
//  - absences: date/dateFrom/dateTo im selben Bereich, hours 0…24, minutes 0…1440, Uhrzeiten «HH:MM»
//  - vacationEntries: dateFrom/dateTo im Bereich
//  - overtimeClosings: hoursSettled, stundenlohn, auszahlungBetrag, zuschlagPercent ≥ 0
// Rechnungsnummern: der Unique-Index galt auch für leere Nummern — ein zweiter Entwurf ohne Nummer liess sich nicht
// speichern. Neu eindeutig nur, wenn gesetzt; Nummern ohne Leerzeichen am Rand («2026-001 » war ein Duplikat).

migrate((app) => {
  const TIME = "^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$";
  // DateField.min/max sind DateTime-Werte (ein String wird still ignoriert)
  const setDate = (c, n) => { const f = c.fields.getByName(n); if (f) { f.min = new DateTime("2000-01-01 00:00:00.000Z"); f.max = new DateTime("2100-12-31 23:59:59.999Z"); } };
  const setNum = (c, n, min, max) => { const f = c.fields.getByName(n); if (f) { f.min = min; if (max !== undefined) f.max = max; } };
  const setPat = (c, n, pat) => { const f = c.fields.getByName(n); if (f) f.pattern = pat; };

  const te = app.findCollectionByNameOrId("timeEntries");
  setNum(te, "minutes", 0, 1440); setDate(te, "date"); setPat(te, "startTime", TIME); setPat(te, "endTime", TIME);
  app.save(te);

  const ab = app.findCollectionByNameOrId("absences");
  setDate(ab, "date"); setDate(ab, "dateFrom"); setDate(ab, "dateTo");
  setNum(ab, "hours", 0, 24); setNum(ab, "minutes", 0, 1440); setPat(ab, "startTime", TIME); setPat(ab, "endTime", TIME);
  app.save(ab);

  const va = app.findCollectionByNameOrId("vacationEntries");
  setDate(va, "dateFrom"); setDate(va, "dateTo");
  app.save(va);

  const oc = app.findCollectionByNameOrId("overtimeClosings");
  for (const n of ["hoursSettled", "stundenlohn", "auszahlungBetrag", "zuschlagPercent"]) setNum(oc, n, 0);
  app.save(oc);

  const inv = app.findCollectionByNameOrId("invoices");
  inv.indexes = (inv.indexes || []).map((i) => (/idx_invoices_studio_number/.test(i)
    ? "CREATE UNIQUE INDEX idx_invoices_studio_number ON invoices (studio, number) WHERE number != ''" : i));
  setPat(inv, "number", "^\\S(.*\\S)?$");
  app.save(inv);
}, (app) => {
  const clear = (c, names, keys) => { for (const n of names) { const f = c.fields.getByName(n); if (!f) continue; for (const k of keys) f[k] = k === "pattern" ? "" : (f.type() === "date" ? new DateTime("") : null); } };
  const te = app.findCollectionByNameOrId("timeEntries");
  clear(te, ["minutes", "date"], ["min", "max"]); clear(te, ["startTime", "endTime"], ["pattern"]); app.save(te);
  const ab = app.findCollectionByNameOrId("absences");
  clear(ab, ["date", "dateFrom", "dateTo", "hours", "minutes"], ["min", "max"]); clear(ab, ["startTime", "endTime"], ["pattern"]); app.save(ab);
  const va = app.findCollectionByNameOrId("vacationEntries");
  clear(va, ["dateFrom", "dateTo"], ["min", "max"]); app.save(va);
  const oc = app.findCollectionByNameOrId("overtimeClosings");
  clear(oc, ["hoursSettled", "stundenlohn", "auszahlungBetrag", "zuschlagPercent"], ["min"]); app.save(oc);
  // Index bleibt «nur gesetzte Nummern eindeutig»: mehrere Entwürfe ohne Nummer würden den alten Index verletzen
  const inv = app.findCollectionByNameOrId("invoices");
  clear(inv, ["number"], ["pattern"]); app.save(inv);
});
