/// <reference path="../pb_data/types.d.ts" />
// Belege, Logo, Pinnwand-Bilder und Dokument-Design-Dateien als echte PocketBase-Dateifelder
// statt Base64-Data-URLs in Textfeldern (max. 15 Mio. Zeichen, siehe 1787519900_calc_audit_fixes.js,
// 1787520000_second_audit_fixes.js, 1787710000_internal_expense_receipt.js, 1787760000_doc_assets.js).
//
// Vorher lag jeder Beleg als ~1.3-fach aufgeblähter Text in der Zeile: jede Liste (auch das
// Nachladen nach einer Realtime-Meldung) übertrug alle Belege aller Jahre. Neu liegt nur der
// Dateiname in der Zeile; die App lädt Belege erst beim Anzeigen (storage/pocketbase-files.ts).
//
// Es gibt noch keine produktiven Server: die alten Textfelder werden ohne Datenumzug entfernt.
// Lokale Daten mit Data-URLs (Datenordner, localStorage, JSON-Backup) lädt die App beim
// Speichern als Dateien hoch.
//
//   expenses.receiptData         → receiptFile   (Beleg; PDF/Bilder, 20 MB)
//   internalExpenses.receiptData → receiptFile   (Beleg; PDF/Bilder, 20 MB)
//   studioSettings.logo          → logoFile      (Bild, 10 MB)
//   blogPosts.image              → imageFile     (Bild, 10 MB)
//   docAssets.data               → file          (Schrift oder Briefpapier-Bild, 10 MB)
//
// Alle Felder sind `protected`: Herunterladen nur mit Datei-Token (pb.files.getToken()) eines
// Nutzers, der die viewRule der Collection erfüllt (Mitglied des Studios). Ein Nutzer eines
// anderen Büros bekommt auch mit eigenem Token 404. Belege sind zusätzlich an die Rolle
// gebunden (onFileDownloadRequest in pb_hooks/permissions.pb.js).
// Neue Feldnamen statt gleichnamiger Felder: Typwechsel text → file geht nicht in-place.

migrate((app) => {
  // Konstanten im Callback: Top-Level-Werte sind in der JSVM zur Laufzeit nicht sicher sichtbar.
  const RECEIPT_MIME = [
    "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif", "image/tiff",
  ];
  const IMAGE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  const FONT_MIME = [
    "font/woff2", "font/woff", "font/ttf", "font/otf",
    "application/font-woff", "application/x-font-ttf", "application/vnd.ms-opentype",
  ];
  const MB = 1024 * 1024;

  const fileField = (name, maxSize, mimeTypes) => new Field({
    name, type: "file", maxSelect: 1, maxSize, mimeTypes, protected: true, thumbs: [],
  });

  for (const name of ["expenses", "internalExpenses"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("receiptData");
    c.fields.add(fileField("receiptFile", 20 * MB, RECEIPT_MIME));
    app.save(c);
  }

  const settings = app.findCollectionByNameOrId("studioSettings");
  settings.fields.removeByName("logo");
  settings.fields.add(fileField("logoFile", 10 * MB, IMAGE_MIME));
  app.save(settings);

  const blogPosts = app.findCollectionByNameOrId("blogPosts");
  blogPosts.fields.removeByName("image");
  blogPosts.fields.add(fileField("imageFile", 10 * MB, IMAGE_MIME));
  app.save(blogPosts);

  // Schriften (Liste FONT_MIME) und Briefpapier (als PNG/JPG gerastert oder SVG, print/docAssets.ts)
  const docAssets = app.findCollectionByNameOrId("docAssets");
  docAssets.fields.removeByName("data");
  docAssets.fields.add(fileField("file", 10 * MB, FONT_MIME.concat(["image/png", "image/jpeg", "image/svg+xml"])));
  app.save(docAssets);
}, (app) => {
  const swap = (coll, fileName, textName) => {
    const c = app.findCollectionByNameOrId(coll);
    c.fields.removeByName(fileName);
    c.fields.add(new Field({ name: textName, type: "text", max: 15000000 }));
    app.save(c);
  };
  swap("expenses", "receiptFile", "receiptData");
  swap("internalExpenses", "receiptFile", "receiptData");
  swap("studioSettings", "logoFile", "logo");
  swap("blogPosts", "imageFile", "image");
  swap("docAssets", "file", "data");
});
