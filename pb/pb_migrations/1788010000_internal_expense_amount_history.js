/// <reference path="../pb_data/types.d.ts" />
// Wiederkehrende interne Ausgaben: Betragsänderung «gültig ab» (RAPPORT-APP: accounting.ts changeRecurringAmount).
//   internalExpenses.amountHistory  [{ before: "YYYY-MM", amount }] (JSON): bis (ausschliesslich) Monat `before`
//                                   galt `amount`; ab dem letzten `before` gilt internalExpenses.amount.
//                                   Leer = der Betrag war immer gleich.
// Die Büro-Einstellung rechnungRunden5 (Rechnungs-/Offerttotal auf 5 Rappen) liegt im freien JSON studioSettings.ui
// (keine Spalte). Rechte wie die übrigen Felder der Collection (pb_hooks/permissions.pb.js), keine eigene Regel nötig.
migrate((app) => {
  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  if (!internalExpenses.fields.getByName("amountHistory")) {
    internalExpenses.fields.add(new Field({ name: "amountHistory", type: "json" }));
  }
  app.save(internalExpenses);
}, (app) => {
  const internalExpenses = app.findCollectionByNameOrId("internalExpenses");
  internalExpenses.fields.removeByName("amountHistory");
  app.save(internalExpenses);
});
