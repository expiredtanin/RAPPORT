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

  // Rolle muss es geben (sonst Mitglied ohne Rechte); den letzten Admin nicht herabstufen (wie set-member-role)
  if (data.appRoleId !== "r-admin") {
    try {
      e.app.findFirstRecordByFilter("appRoles", "studio = {:sid} && roleId = {:rid}", { sid: data.studioId, rid: data.appRoleId || "" });
    } catch {
      throw new BadRequestError("Diese Rolle gibt es im Studio nicht.");
    }
    let wasAdmin = false;
    try { e.app.findFirstRecordByFilter("studioMembers", "studio = {:sid} && user = {:uid} && appRoleId = 'r-admin' && active = true", { sid: data.studioId, uid: data.userId }); wasAdmin = true; } catch { wasAdmin = false; }
    if (wasAdmin) {
      const admins = e.app.findRecordsByFilter("studioMembers", "studio = {:sid} && appRoleId = 'r-admin' && active = true", "", 0, 0, { sid: data.studioId });
      if (admins.length <= 1) throw new BadRequestError("Mindestens ein Administrator muss bestehen bleiben.");
    }
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

// Rolle eines bestehenden Mitglieds ändern (E2E 25.11.2026: der Rollenwechsel im Mitarbeiter-Dialog ging in der Cloud
// still verloren, weil studioMembers für Clients schreibgeschützt ist). Nur Admins des Studios; der letzte aktive
// Admin kann nicht herabgestuft werden. memberperms.pb.js rechnet perms beim Speichern neu.
routerAdd("POST", "/api/rapport/set-member-role", (e) => {
  const data = new DynamicModel({ userId: "", studioId: "", appRoleId: "" });
  e.bindBody(data);
  if (!data.userId || !data.studioId || !data.appRoleId) throw new BadRequestError("userId, studioId und appRoleId sind erforderlich.");
  try {
    e.app.findFirstRecordByFilter("studioMembers", "studio = {:sid} && user = {:uid} && appRoleId = 'r-admin' && active = true", { sid: data.studioId, uid: e.auth.id });
  } catch {
    throw new ForbiddenError("Nur Admins des Studios können Rollen ändern.");
  }
  if (data.appRoleId !== "r-admin") {
    try {
      e.app.findFirstRecordByFilter("appRoles", "studio = {:sid} && roleId = {:rid}", { sid: data.studioId, rid: data.appRoleId });
    } catch {
      throw new BadRequestError("Diese Rolle gibt es im Studio nicht.");
    }
  }
  let member;
  try {
    member = e.app.findFirstRecordByFilter("studioMembers", "studio = {:sid} && user = {:uid}", { sid: data.studioId, uid: data.userId });
  } catch {
    throw new NotFoundError("Mitglied nicht gefunden.");
  }
  if (member.get("appRoleId") === "r-admin" && data.appRoleId !== "r-admin") {
    const admins = e.app.findRecordsByFilter("studioMembers", "studio = {:sid} && appRoleId = 'r-admin' && active = true", "", 0, 0, { sid: data.studioId });
    if (admins.length <= 1) throw new BadRequestError("Mindestens ein Administrator muss bestehen bleiben.");
  }
  member.set("appRoleId", data.appRoleId);
  e.app.save(member);
  return e.json(200, { ok: true });
}, $apis.requireAuth());
