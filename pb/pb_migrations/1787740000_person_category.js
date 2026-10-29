/// <reference path="../pb_data/types.d.ts" />
// Kontakt-Kategorie (RAPPORT-APP: Person.category). Ersetzt in der UI die frühere Unterscheidung
// Auftraggeber/Partner (die Flags isAuftraggeber/isPartner bleiben als Altlast bestehen und
// werden weiter geschrieben). Werte: person | unternehmer | oeffentlich | auslober | wbw.
// Bewusst als freies Textfeld statt "select": die App kennt die Liste (CONTACT_CATEGORIES), und
// ein späterer Eintrag in der App soll nicht an einer Schema-Migration hängen. Leer = keine
// Kategorie (Altdaten; die App zeigt ehemalige Partner dann als «Unternehmer»).
// Die Akquise-Collections (leads, activities) und die CRM-Felder an persons (source, referredById,
// tags) sind absichtlich NICHT Teil dieser Migration — Akquise läuft noch im Testbetrieb, nur lokal.

migrate((app) => {
  const persons = app.findCollectionByNameOrId("persons");
  persons.fields.add(
    new Field({ name: "category", type: "text", max: 40 }),
  );
  app.save(persons);
}, (app) => {
  const persons = app.findCollectionByNameOrId("persons");
  persons.fields.removeByName("category");
  app.save(persons);
});
