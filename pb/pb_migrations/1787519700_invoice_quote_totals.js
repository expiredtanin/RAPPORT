/// <reference path="../pb_data/types.d.ts" />
// invoices/quotes fehlten die berechneten Summenfelder komplett im Schema.
// Rechnungs-/Offerten-Totale werden in Invoices.jsx/Quotes.jsx EINMAL beim
// Speichern berechnet (calcTotal()) und dann direkt aus dem gespeicherten
// Objekt angezeigt (inv.total, q.total, …) — nicht bei jedem Render neu
// berechnet (wäre bei SIA-Kalkulationen über viele Zeilen zu teuer). Ohne
// diese Spalten gingen sub/tax/total/etc. bei jedem Cloud-Save verloren,
// jede Rechnung/Offerte zeigte danach CHF 0.00.

migrate((app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  invoices.fields.add(
    new Field({ name: "sub", type: "number" }),
    new Field({ name: "tax", type: "number" }),
    new Field({ name: "total", type: "number" }),
    new Field({ name: "subAfterDisc", type: "number" }),
    new Field({ name: "globalDisc", type: "number" }),
  );
  app.save(invoices);

  const quotes = app.findCollectionByNameOrId("quotes");
  quotes.fields.add(
    new Field({ name: "sub", type: "number" }),
    new Field({ name: "totalHours", type: "number" }),
    new Field({ name: "tax", type: "number" }),
    new Field({ name: "total", type: "number" }),
  );
  app.save(quotes);

  // budgetAmount/phasesBudget: von deriveQuoteBudget() beim Verknüpfen einer
  // Offerte einmal berechnet und aufs Projekt geschrieben (siehe Projects.jsx/
  // Quotes.jsx) — Invoices.jsx braucht sie für Akonto-/Teilrechnungen
  // (Restbudget-Berechnung). Gleiches Muster wie invoices/quotes oben.
  const projects = app.findCollectionByNameOrId("projects");
  projects.fields.add(
    new Field({ name: "budgetAmount", type: "number" }),
    new Field({ name: "phasesBudget", type: "json" }),
  );
  app.save(projects);
}, (app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  for (const f of ["sub", "tax", "total", "subAfterDisc", "globalDisc"]) invoices.fields.removeByName(f);
  app.save(invoices);

  const quotes = app.findCollectionByNameOrId("quotes");
  for (const f of ["sub", "totalHours", "tax", "total"]) quotes.fields.removeByName(f);
  app.save(quotes);

  const projects = app.findCollectionByNameOrId("projects");
  for (const f of ["budgetAmount", "phasesBudget"]) projects.fields.removeByName(f);
  app.save(projects);
});
