/// <reference path="../pb_data/types.d.ts" />
// Ersetzt die Supabase-RPC `list_studios`: öffentliche (unauthentifizierte) Liste aller
// Studios dieser Instanz, für den Studio-Dropdown im Login-Screen VOR dem Einloggen.
// Läuft mit App-Rechten (kein User-Auth nötig), analog zu SECURITY DEFINER in Postgres.

routerAdd("GET", "/api/rapport/studios", (e) => {
  const records = e.app.findRecordsByFilter("studios", "", "name", 500, 0);
  const out = records.map((r) => ({
    id: r.id,
    name: r.get("name"),
    slug: r.get("slug"),
  }));
  return e.json(200, out);
});
