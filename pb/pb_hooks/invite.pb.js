/// <reference path="../pb_data/types.d.ts" />
// Ersetzt die Supabase-RPC `attach_user_to_studio`: hängt einen bereits angelegten
// User (Schritt 1: PocketBaseAdapter.inviteMember() erstellt den User-Record ganz normal
// über die öffentliche users-Collection, kein Hook nötig dafür) als Mitglied an ein
// Studio. Nur Admins des Ziel-Studios dürfen das — Prüfung server-seitig, weil
// studioMembers.createRule bewusst leer ist (kein Direkt-Write vom Client).
// Idempotent (upsert), damit der Flow re-runnable ist — wie beim Original.

routerAdd("POST", "/api/rapport/invite-member", (e) => {
  const data = new DynamicModel({ userId: "", studioId: "", appRoleId: "r-mitarbeiter" });
  e.bindBody(data);

  if (!data.userId || !data.studioId) {
    throw new BadRequestError("userId und studioId sind erforderlich.");
  }

  const membersCollection = e.app.findCollectionByNameOrId("studioMembers");

  // findFirstRecordByFilter wirft (statt null zurückzugeben), wenn nichts gefunden wird.
  let callerIsAdmin = false;
  try {
    e.app.findFirstRecordByFilter(
      "studioMembers",
      "studio = {:sid} && user = {:uid} && appRoleId = 'r-admin' && active = true",
      { sid: data.studioId, uid: e.auth.id },
    );
    callerIsAdmin = true;
  } catch {
    callerIsAdmin = false;
  }
  if (!callerIsAdmin) {
    throw new ForbiddenError("Nur Admins des Studios können Mitglieder einladen.");
  }

  e.app.runInTransaction((txApp) => {
    let member;
    try {
      member = txApp.findFirstRecordByFilter(
        "studioMembers", "studio = {:sid} && user = {:uid}",
        { sid: data.studioId, uid: data.userId },
      );
    } catch {
      member = null;
    }
    if (!member) member = new Record(membersCollection);
    member.set("studio", data.studioId);
    member.set("user", data.userId);
    member.set("appRoleId", data.appRoleId);
    member.set("active", true);
    txApp.save(member);
  });

  return e.json(200, { ok: true });
}, $apis.requireAuth());
