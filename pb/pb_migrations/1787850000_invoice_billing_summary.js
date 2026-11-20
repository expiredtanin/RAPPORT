/// <reference path="../pb_data/types.d.ts" />
// Abrechnungsblock auf Akonto-/Teilrechnungen (RAPPORT-APP: invoiceHelpers.ts invoiceBillingSummary):
//   invoices.billingSummary { fee, quoteNumber?, prior, priorNumbers[], thisNet, rest } (JSON),
//   beim Speichern bzw. beim Versand festgehalten, damit ein Nachdruck dieselben Zahlen zeigt.
// Rechte wie die übrigen Felder der Collection (pb_hooks/permissions.pb.js).

migrate((app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  invoices.fields.add(new Field({ name: "billingSummary", type: "json" }));
  app.save(invoices);
}, (app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  invoices.fields.removeByName("billingSummary");
  app.save(invoices);
});
