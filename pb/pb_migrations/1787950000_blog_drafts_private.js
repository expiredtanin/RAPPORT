/// <reference path="../pb_data/types.d.ts" />
// Pinnwand: Entwürfe (status = 'entwurf') sieht nur der Autor oder wer Vollzugriff hat. Vorher lieferte die API
// Entwürfe aller Autoren an jedes Mitglied (die App blendete sie nur aus; Cloud-Test Runde 15, 25.11.2026).
const EXTRA = ` && (status != 'entwurf' || author = @request.auth.id || studio.studioMembers_via_studio.perms ?~ '|*|')`;

migrate((app) => {
  const c = app.findCollectionByNameOrId("blogPosts");
  for (const k of ["listRule", "viewRule"]) {
    const r = c[k];
    if (r === null || r === undefined || String(r).includes(EXTRA)) continue;
    c[k] = `(${r})${EXTRA}`;
  }
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("blogPosts");
  for (const k of ["listRule", "viewRule"]) {
    const r = c[k];
    if (r === null || r === undefined) continue;
    const s = String(r);
    if (s.endsWith(EXTRA) && s.startsWith("(")) c[k] = s.slice(1, s.length - EXTRA.length - 1);
  }
  app.save(c);
});
