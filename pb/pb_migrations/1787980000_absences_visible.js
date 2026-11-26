/// <reference path="../pb_data/types.d.ts" />
// Absenzen und Mitarbeitende für alle Mitglieder lesbar (Entscheid 26.11.2026: «Krankheit sollten alle sehen»).
// Bisher lasen Mitglieder ohne Recht «mitarbeiter» nur den eigenen Mitarbeiter-Datensatz und die eigenen Absenzen —
// die Terminplanung zeigte ihnen niemanden sonst. Neu genügt zum LESEN die aktive Mitgliedschaft; was ohne
// «mitarbeiter» nicht sichtbar sein soll (Absenz-Notiz, Adresse, Geburtsdatum, AHV-Nr., Lohn …), blendet
// integrity.pb.js per onRecordEnrich aus und sperrt Filter/Sortierung darüber. Schreiben bleibt unverändert.

migrate((app) => {
  const CUT = " && (studio.studioMembers_via_studio.perms ?~ '|mitarbeiter|'";
  for (const name of ["employees", "absences"]) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["listRule", "viewRule"]) {
      const s = String(c[k] || "");
      const i = s.indexOf(CUT);
      if (i < 0) throw new Error("Regel hat nicht die erwartete Form: " + s);
      c[k] = s.slice(0, i);
    }
    app.save(c);
  }
}, (app) => {
  const own = { employees: "appUser = @request.auth.id", absences: "employee.appUser = @request.auth.id" };
  for (const name of ["employees", "absences"]) {
    const c = app.findCollectionByNameOrId(name);
    for (const k of ["listRule", "viewRule"]) {
      c[k] = String(c[k]) + ` && (studio.studioMembers_via_studio.perms ?~ '|mitarbeiter|' || studio.studioMembers_via_studio.perms ?~ '|*|' || (${own[name]}))`;
    }
    app.save(c);
  }
});
