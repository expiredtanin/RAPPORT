/// <reference path="../pb_data/types.d.ts" />
// protocols: title/time/endTime fehlten seit der Phase-2-Migration komplett.
// Protocols.jsx (RAPPORT-APP) liest/schreibt diese Felder aktiv (Titel in der
// Protokoll-Liste, Sitzungsbeginn/-ende im Formular) — ohne PB-Spalte gingen
// sie bei jedem Cloud-Speichern+Reload stillschweigend verloren. War bereits
// als bekannte Lücke im pocketbase-mappers.js-Kommentar vermerkt, aber nie
// nachgezogen.
migrate((app) => {
  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.add(
    new Field({ name: "title", type: "text", max: 300 }),
    new Field({ name: "time", type: "text", max: 5 }),
    new Field({ name: "endTime", type: "text", max: 5 }),
  );
  app.save(protocols);
}, (app) => {
  const protocols = app.findCollectionByNameOrId("protocols");
  protocols.fields.removeByName("title");
  protocols.fields.removeByName("time");
  protocols.fields.removeByName("endTime");
  app.save(protocols);
});
