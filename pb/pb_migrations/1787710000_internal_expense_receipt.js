/// <reference path="../pb_data/types.d.ts" />
// Lokale Belegerkennung für "Ausgaben" (InternalExpenses.jsx): analog zu
// expenses.receiptData/receiptName — Base64-Data-URL als Text, kein echter
// PocketBase-File-Upload (gleiches Muster, siehe 1787519900_calc_audit_fixes.js
// für die Begründung). internalExpenses hatte vorher ein receiptUrl-file-Feld,
// das dort bewusst entfernt wurde, weil die UI es nie las/schrieb — jetzt kommt
// mit dem Scan-Feature ein echter Anwendungsfall dazu.

migrate((app) => {
  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.add(
    new Field({ name: "receiptData", type: "text", max: 15000000 }),
    new Field({ name: "receiptName", type: "text", max: 300 }),
  );
  app.save(internalExpenses);
}, (app) => {
  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.removeByName("receiptData");
  internalExpenses.fields.removeByName("receiptName");
  app.save(internalExpenses);
});
