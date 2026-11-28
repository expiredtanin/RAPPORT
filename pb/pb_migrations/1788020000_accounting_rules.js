/// <reference path="../pb_data/types.d.ts" />
// Buchhaltungsregeln (28.11.2026, RAPPORT-APP: accounting.ts, newInvoiceForm.ts, invoiceHelpers.ts):
//   invoices.creditKind           Gutschrift: "korrektur" (leer = Standard) korrigiert eine gestellte Rechnung,
//                                 "minderung" = Honorarminderung (vom Honorar abgezogen, nicht wieder belastet)
//   invoices.vorauszahlung        Akonto als reine Vorauszahlung: MWST erst mit der Zahlung (Art. 40 Abs. 1 lit. c MWSTG)
//   expenses.mwstAufteilung       Beleg mit mehreren MWST-Sätzen: [{ betrag, satz }] inkl. MWST, Σ = amount
//   internalExpenses.mwstAufteilung  ebenso
// Rechte wie die übrigen Felder der Collections (pb_hooks/permissions.pb.js), keine eigene Regel nötig.
migrate((app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  if (!invoices.fields.getByName("creditKind")) invoices.fields.add(new Field({ name: "creditKind", type: "text", max: 20 }));
  if (!invoices.fields.getByName("vorauszahlung")) invoices.fields.add(new Field({ name: "vorauszahlung", type: "bool" }));
  app.save(invoices);
  for (const name of ["expenses", "internalExpenses"]) {
    const c = app.findCollectionByNameOrId(name);
    if (!c.fields.getByName("mwstAufteilung")) c.fields.add(new Field({ name: "mwstAufteilung", type: "json" }));
    app.save(c);
  }
}, (app) => {
  const invoices = app.findCollectionByNameOrId("invoices");
  invoices.fields.removeByName("creditKind");
  invoices.fields.removeByName("vorauszahlung");
  app.save(invoices);
  for (const name of ["expenses", "internalExpenses"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("mwstAufteilung");
    app.save(c);
  }
});
