// PocketBaseAdapter — Cloud/Self-Host-Variante des Storage-Adapters (ersetzt SupabaseAdapter).
//
// PB-Phase 1: Auth, Studios, Settings/Rollen, Personen, Projekte.
// PB-Phase 2: restliche Entities (Rechnungen, Zeiterfassung, Mitarbeiter, …),
// Invite-Flow, Seed-Defaults, Passwort-Reset-Confirm-Flow.
// Noch offen: Person-Sharing über Studios hinweg (siehe README.md/ARCHITECTURE.md
// "Bekannte Lücken").
//
// Öffentliches Interface ist bewusst 1:1 identisch zu SupabaseAdapter (gleiche Methoden,
// gleiche Rückgabe-Shapes inkl. snake_case bei signIn().studios) — App.jsx/Login.jsx/
// CloudSetup.jsx/Settings.jsx greifen direkt darauf zu und bleiben unverändert.
//
// Multi-Tenant: jede Query läuft über PocketBase-Rules (studio.studioMembers_via_studio…),
// äquivalent zu Postgres-RLS. Vor erfolgreichem Login kann nichts geladen werden.
//
// ── Überblick für Entwickler ──────────────────────────────────────────────
// Ablauf: signIn() → setStudioId() → load() (alles auf einmal) → App hält den
// State → bei jeder Änderung save(data) → _writeSnapshot().
//
// Sync-Modell («Full Replace»): save() bekommt immer den GANZEN Datenstand. Pro
// Collection wird der Serverstand geladen, mit dem Snapshot verglichen und nur
// das Nötige geschrieben (create / update / delete) — siehe _syncTable().
// Unveränderte Collections werden per Referenzvergleich (`_lastData`) ganz
// übersprungen. Konsequenz: Was lokal fehlt, wird auf dem Server GELÖSCHT.
// Zwei Nutzer, die gleichzeitig dieselbe Collection ändern, überschreiben sich
// (letzter Schreiber gewinnt); Realtime (subscribeToChanges) lädt Änderungen
// anderer Nutzer gezielt nach (loadPartial).
//
// Gleichzeitige save()-Aufrufe werden zusammengefasst: es läuft höchstens ein
// Schreibvorgang, der letzte angeforderte Stand gewinnt (siehe save()).
//
// Berechtigungen: serverseitige Hooks (pb/pb_hooks/permissions.pb.js) sperren
// Collections je Rolle. 403/404 gilt hier als «keine Berechtigung» und wird
// beim Laden zu leeren Listen, beim Schreiben zu einem übersprungenen Block.
//
// Neue Entity hinzufügen: Eintrag in ENTITY_MAP (oder CONFIG_MAP), Mapper in
// pocketbase-mappers.ts, Collection im PocketBase-Schema (pb/), Typ in
// types.ts/AppData. Reihenfolge in ENTITY_MAP beachten (Relationen!).

import PocketBase, { LocalAuthStore } from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { AppData, Id } from "../types";
import type { RawData } from "./migrations";
import type { StorageAdapter } from "./adapter";
import { fromDB, toDB } from "./pocketbase-mappers";

type Row = RecordModel;
/** Fehlerform von PocketBase (ClientResponseError), soweit hier benutzt. */
type PbError = { status?: number; message?: string; data?: { message?: string } };
const pbError = (e: unknown): PbError => (e ?? {}) as PbError;
/** Alle Mapper, die eine Zeile 1:1 in eine App-Entität übersetzen (ohne studioSettings). */
type EntityMapper = Exclude<keyof typeof fromDB, "studioSettings">;
type DataKey = keyof AppData;
/** Eine create/update/delete-Operation, die _applyOps ausführt. */
type Op =
  | { type: "create"; body: Record<string, unknown> }
  | { type: "update"; id: string; body: Record<string, unknown> }
  | { type: "delete"; id: string };

// [data-Key, Collection, Mapper-Name, natürlicher Schlüssel (Default "id"), Sort-Feld]
// Deckt alle "Daten"-Entities ab, die 1:1 studio-gebunden sind und komplett per
// Full-Replace (siehe _writeSnapshot) synchronisiert werden.
const ENTITY_MAP: [DataKey, string, EntityMapper, string, string | null][] = [
  ["persons", "persons", "person", "id", null],
  ["projects", "projects", "project", "id", "number"],
  ["quotes", "quotes", "quote", "id", "number"],
  ["contracts", "contracts", "contract", "id", "number"],
  ["invoices", "invoices", "invoice", "id", "number"],
  ["timeEntries", "timeEntries", "timeEntry", "id", "date"],
  // lohnEntries vor expenses: expenses.lohnEntry referenziert einen
  // Lohnlauf-Eintrag (beim Abschliessen einer Lohnabrechnung gesetzt) —
  // in der falschen Reihenfolge synchronisiert, existiert der referenzierte
  // payrollEntries-Datensatz noch nicht und PocketBase lehnt die Relation
  // mit "Failed to find all relation records with the provided ids." ab,
  // was den kompletten _writeSnapshot()-Aufruf abbricht (stiller Datenverlust,
  // da setData() bereits optimistisch lokal geschrieben hatte).
  ["lohnEntries", "payrollEntries", "payrollEntry", "id", null],
  ["expenses", "expenses", "expense", "id", "date"],
  ["internalExpenses", "internalExpenses", "internalExpense", "id", "date"],
  ["employees", "employees", "employee", "id", "name"],
  ["absences", "absences", "absence", "id", null],
  ["ferienEntries", "vacationEntries", "vacationEntry", "id", "dateFrom"],
  ["uberstundenAbschluss", "overtimeClosings", "overtimeClosing", "id", null],
  ["protocols", "protocols", "protocol", "id", "number"],
  ["deliveryNotes", "deliveryNotes", "deliveryNote", "id", "number"],
  ["blogPosts", "blogPosts", "blogPost", "id", "-created"],
  // Schriften/Briefpapier fürs Dokument-Design: eine Zeile pro Datei, damit grosse
  // Data-URLs nicht bei jeder Einstellungsänderung mit studioSettings neu gesendet werden.
  ["docAssets", "docAssets", "docAsset", "id", null],
];

// Stammdaten-Collections: natürlicher (Text-)Schlüssel statt UUID-`id` — analog zu studioRoles.
const CONFIG_MAP: [DataKey, string, EntityMapper, string][] = [
  ["feiertage", "holidays", "holiday", "date"],
  ["absenzTypes", "absenceTypes", "absenceType", "typeId"],
  ["letterTemplates", "letterTemplates", "letterTemplate", "templateId"],
  ["appRoles", "appRoles", "appRole", "roleId"],
  ["dashboardTemplates", "dashboardTemplates", "dashboardTemplate", "templateId"],
];

// Normalisiert "kein Wert" auf einen einzigen Nenner: die App schreibt fehlende
// Werte meist als null/undefined (siehe toDB.*, z.B. "client: p.clientId || null"),
// PocketBase liefert dieselbe leere Relation/Textspalte aus getFullList() aber als
// "" zurück. Ohne diese Normalisierung würde rowUnchanged() für jede Zeile mit
// mindestens einem leeren Feld IMMER "geändert" melden und der Row-Skip unten liefe
// für einen Grossteil der Datensätze ins Leere.
const normalizeEmpty = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
const fieldEqual = (a: unknown, b: unknown) => JSON.stringify(normalizeEmpty(a)) === JSON.stringify(normalizeEmpty(b));
// Vergleicht nur die Felder, die der Payload tatsächlich mitschickt — "existing" (roh
// von PocketBase) hat zusätzliche System-Felder (created, updated, collectionId, …),
// die hier bewusst ignoriert werden.
const rowUnchanged = (row: Record<string, unknown>, existing: Row) => Object.keys(row).every(k => fieldEqual(row[k], existing[k]));

// Collection-Name -> data-Key, für den gezielten Realtime-Refresh (siehe
// subscribeToChanges()/loadPartial()). studioSettings UND studioRoles bilden
// gemeinsam den einen "settings"-Key ab (fromDB.studioSettings kombiniert
// beide) — ändert sich eine der beiden Collections, muss data.settings
// trotzdem komplett neu zusammengesetzt werden.
const collToDataKey = (coll: string): DataKey | null => {
  if (coll === "studioSettings" || coll === "studioRoles") return "settings";
  return ENTITY_MAP.find(([, c]) => c === coll)?.[0] ?? CONFIG_MAP.find(([, c]) => c === coll)?.[0] ?? null;
};

/**
 * Cloud-Adapter. Erfüllt `StorageAdapter` (load/save/…) und bietet zusätzlich
 * Auth-, Studio- und Realtime-Methoden. Eine Instanz gehört zu genau einer
 * Server-URL; das aktive Studio wird nach dem Login mit setStudioId() gesetzt.
 */
export class PocketBaseAdapter implements StorageAdapter {
  url: string;
  client: PocketBase;
  _studioId: Id | null;
  _lastData: AppData | null;
  _batchSupported: boolean | null;
  _unsub?: (() => void) | null;
  _pendingData?: AppData | null;
  _currentWrite?: Promise<void> | null;

  constructor(url: string) {
    if (!url) throw new Error("PocketBaseAdapter: URL ist erforderlich.");
    this.url = url;
    this.client = new PocketBase(url, new LocalAuthStore("rapport_pocketbase_auth"));
    // Auto-Cancel deaktiviert: nichts in diesem Adapter ist Search-as-you-type, wo
    // "letzter Request gewinnt" gewünscht wäre. Ohne das killt PocketBase gleiche
    // Requests, die kurz hintereinander feuern (z.B. React StrictMode Doppel-Mount
    // im Dev-Modus), mit einem Abort-Error statt sie einfach parallel zu beantworten.
    this.client.autoCancellation(false);
    this._studioId = null;
    // Letzter erfolgreich geschriebener data-Snapshot — Grundlage für den
    // Referenzvergleich in _writeSnapshot(), der unveränderte Collections
    // komplett überspringt (siehe dortiger Kommentar).
    this._lastData = null;
    // null = noch nicht getestet, true/false = Ergebnis des ersten Batch-Versuchs
    // gegen DIESEN Server (siehe _applyOps). Eine Server-URL ändert sich nicht
    // innerhalb einer Adapter-Instanz, daher kein Reset bei Studio-Wechsel nötig.
    this._batchSupported = null;
  }

  /** Aktives Studio setzen (nach Login/Studio-Wechsel). Wechsel verwirft den Sync-Snapshot. */
  setStudioId(studioId: Id | null) {
    if (studioId !== this._studioId) this._lastData = null;
    this._studioId = studioId;
  }

  /** Erreichbarkeit des Servers prüfen (Health-Endpoint). */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.health.check();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: pbError(e).message || String(e) };
    }
  }

  /**
   * Login mit E-Mail/Passwort. Gibt null bei falschen Zugangsdaten zurück, sonst
   * User, Profil und die aktiven Studio-Mitgliedschaften (Felder in snake_case,
   * Altlast aus der Supabase-Zeit — Aufrufer erwarten diese Form).
   */
  async signIn(email: string, password: string) {
    let auth;
    try {
      auth = await this.client.collection("users").authWithPassword(email, password);
    } catch {
      return null;
    }
    const userId = auth.record.id;
    const memberships = await this.client.collection("studioMembers").getFullList({
      filter: `user = "${userId}" && active = true`,
      expand: "studio",
    });
    return {
      user: auth.record,
      profile: { username: auth.record.username, display_name: auth.record.displayName },
      studios: memberships.map(m => ({
        studio_id: m.studio,
        app_role_id: m.appRoleId,
        studios: { name: m.expand?.studio?.name, slug: m.expand?.studio?.slug },
      })),
    };
  }

  /** Abmelden: Realtime beenden, Session und Studio-Kontext verwerfen. */
  async signOut() {
    this.unsubscribeFromChanges();
    this.client.authStore.clear();
    this._studioId = null;
    this._lastData = null;
  }

  /** Schickt die Passwort-Reset-Mail. */
  async requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.collection("users").requestPasswordReset(email);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: pbError(e).message || String(e) };
    }
  }

  // Zweite Hälfte des Reset-Flows: Token kommt aus dem Mail-Link (siehe
  // App.jsx "#/reset-password/{TOKEN}"-Hash), löst KEINE Session aus — der
  // User muss sich danach normal einloggen.
  async confirmPasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!token) return { ok: false, error: "Kein Reset-Token gefunden. Bitte den Link erneut aus der E-Mail öffnen." };
    try {
      await this.client.collection("users").confirmPasswordReset(token, newPassword, newPassword);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: pbError(e).data?.message || pbError(e).message || "Passwort konnte nicht gesetzt werden." };
    }
  }

  // Wie bei Supabase (enable_confirmations=false) muss nach signUp sofort eine
  // Session stehen — der Caller (App.jsx cloudInit) ruft direkt danach
  // ensureProfile()/createStudio() auf, ohne zwischendurch signIn() aufzurufen.
  // PocketBase-`create()` allein authentifiziert nicht, daher explizit nachziehen.
  async signUp(email: string, password: string): Promise<{ ok: boolean; user?: RecordModel; error?: string }> {
    try {
      const username = (email.split("@")[0] || "user").replace(/[^a-zA-Z0-9._-]/g, "") + Math.random().toString(36).slice(2, 6);
      const record = await this.client.collection("users").create({
        email, password, passwordConfirm: password,
        username, displayName: username,
      });
      await this.client.collection("users").authWithPassword(email, password);
      return { ok: true, user: record };
    } catch (e) {
      return { ok: false, error: pbError(e).data?.message || pbError(e).message || "signUp failed" };
    }
  }

  // Setzt username/displayName auf dem eigenen User-Record (ersetzt ensure_profile-RPC).
  async ensureProfile(username: string, displayName: string): Promise<void> {
    if (!this.client.authStore.record?.id) throw new Error("ensureProfile: kein eingeloggter User.");
    await this.client.collection("users").update(this.client.authStore.record.id, { username, displayName });
  }

  // Öffentliche Studio-Liste über den public.pb.js-Hook (kein Auth nötig).
  async listStudios(): Promise<{ id: Id; name: string; slug: string }[]> {
    const res = await fetch(`${this.url.replace(/\/+$/, "")}/api/rapport/studios`);
    if (!res.ok) throw new Error("listStudios: " + res.status);
    return res.json();
  }

  // Legt Studio + Admin-Mitgliedschaft über den create-studio-Hook an.
  // sharePersonsFrom: Quell-Studio-IDs, deren Personen (lokal + bereits geteilte)
  // ins neue Studio übernommen werden. Berechtigungsprüfung läuft serverseitig
  // im Hook (Caller muss Member jedes Quell-Studios sein).
  async createStudio(name: string, slug: string, sharePersonsFrom: Id[] = []): Promise<Id> {
    const res = await this.client.send("/api/rapport/create-studio", {
      method: "POST",
      body: { name, slug, sharePersonsFrom },
    });
    return res.id;
  }

  /** Studios, in denen der angemeldete User aktives Mitglied ist. */
  async myStudios(): Promise<{ id: Id; name?: string; slug?: string; appRoleId?: string }[]> {
    const userId = this.client.authStore.record?.id;
    if (!userId) return [];
    try {
      const memberships = await this.client.collection("studioMembers").getFullList({
        filter: `user = "${userId}" && active = true`,
        expand: "studio",
      });
      return memberships.map(m => ({
        id: m.studio,
        name: m.expand?.studio?.name,
        slug: m.expand?.studio?.slug,
        appRoleId: m.appRoleId,
      }));
    } catch (e) {
      console.error("myStudios:", pbError(e).message);
      return [];
    }
  }

  // Mitarbeiter ins aktuelle Studio einladen — Admin-Aktion.
  //   1) User-Record ganz normal anlegen (öffentliche users-Collection, kein Session-Risiko
  //      wie bei Supabase — PocketBase-`create()` ändert den eigenen authStore nicht).
  //   2) invite-member-Hook: prüft serverseitig, dass der Caller Admin im Ziel-Studio ist,
  //      und hängt den neuen User als Mitglied an (idempotent, siehe invite.pb.js).
  async inviteMember(
    email: string,
    tempPassword: string,
    displayName: string,
    appRoleId = "r-mitarbeiter",
  ): Promise<{ ok: boolean; userId?: Id; error?: string }> {
    if (!this._studioId) return { ok: false, error: "Kein aktives Studio." };
    const username = (email.split("@")[0] || "user").replace(/[^a-zA-Z0-9._-]/g, "") + Math.random().toString(36).slice(2, 6);
    let newUser: RecordModel;
    try {
      newUser = await this.client.collection("users").create({
        email, password: tempPassword, passwordConfirm: tempPassword, username, displayName,
      });
    } catch (e) {
      return { ok: false, error: pbError(e).data?.message || pbError(e).message || "signUp failed" };
    }
    try {
      await this.client.send("/api/rapport/invite-member", {
        method: "POST",
        body: { userId: newUser.id, studioId: this._studioId, appRoleId },
      });
    } catch (e) {
      return { ok: false, error: pbError(e).data?.message || pbError(e).message || "invite failed" };
    }
    return { ok: true, userId: newUser.id };
  }

  // onChange(dataKey) statt onChange() — der Aufrufer (App.jsx) kann damit einen
  // gezielten loadPartial([dataKey]) statt eines kompletten load() anstossen.
  // Ändert sich z.B. ein einzelner Zeiterfassungs-Eintrag eines anderen Nutzers,
  // muss nicht mehr über alle ~20 Collections neu geladen werden.
  subscribeToChanges(onChange: (dataKey: DataKey | null) => void) {
    if (this._unsub) return;
    const collections = [
      "studioSettings", "studioRoles",
      ...ENTITY_MAP.map(([, coll]) => coll),
      ...CONFIG_MAP.map(([, coll]) => coll),
    ];
    const subs = collections.map(coll => {
      const dataKey = collToDataKey(coll);
      return this.client.collection(coll).subscribe("*", () => {
        try { onChange(dataKey); } catch (e) { console.error("onChange handler:", e); }
      }, { filter: `studio = "${this._studioId}"` });
    });
    this._unsub = () => subs.forEach(p => p.then(unsub => unsub()).catch(() => {}));
  }

  /** Realtime-Abos beenden. */
  unsubscribeFromChanges() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  /** true, wenn das aktive Studio auf dem Server existiert. */
  async hasExistingData() {
    if (!this._studioId) return false;
    try {
      await this.client.collection("studios").getOne(this._studioId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lädt den kompletten Datenstand des aktiven Studios (~20 Collections parallel)
   * und baut daraus die `AppData`-Form. `users` wird aus den Mitgliedschaften abgeleitet.
   */
  async load(): Promise<RawData> {
    if (!this._studioId) {
      throw new Error("PocketBaseAdapter.load: studio_id nicht gesetzt — setStudioId() nach Login.");
    }
    const sid = this._studioId;
    const c = this.client;
    const filter = `studio = "${sid}"`;
    // Personen: lokale (studio = sid) ODER geteilte (via personStudioLinks an
    // sid verlinkt) — anders als alle anderen Entities, die rein lokal sind.
    const personsFilter = `studio = "${sid}" || personStudioLinks_via_person.studio ?= "${sid}"`;

    // Manche Collections sind serverseitig an eine appRoles-Berechtigung gebunden
    // (pb/pb_hooks/permissions.pb.js) — ein Mitarbeiter ohne z.B. "invoices"
    // bekommt dort ein 403. Ohne .catch() würde das den gesamten Promise.all-Batch und
    // damit den kompletten Login/Boot-Vorgang abbrechen. Fehlende Berechtigung wird
    // deshalb wie "keine Daten sichtbar" behandelt (leeres Array) — die UI blendet die
    // jeweilige View für diese Rolle ohnehin aus (App.jsx hasViewAccess).
    const entityMapNonPersons = ENTITY_MAP.filter(([dataKey]) => dataKey !== "persons");
    const entityLoads = entityMapNonPersons.map(([, coll, mapper, , sort]) =>
      c.collection(coll).getFullList(sort ? { filter, sort } : { filter })
        .then(rows => rows.map(fromDB[mapper]))
        .catch((err: unknown) => { if (pbError(err).status !== 403 && pbError(err).status !== 404) throw err; return []; }));
    const configLoads = CONFIG_MAP.map(([, coll, mapper]) =>
      c.collection(coll).getFullList({ filter })
        .then(rows => rows.map(fromDB[mapper]))
        .catch((err: unknown) => { if (pbError(err).status !== 403 && pbError(err).status !== 404) throw err; return []; }));

    const [settingsList, roles, members, personsRows, ...rest] = await Promise.all([
      c.collection("studioSettings").getFullList({ filter }),
      c.collection("studioRoles").getFullList({ filter, sort: "sort" }),
      c.collection("studioMembers").getFullList({ filter: `${filter} && active = true`, expand: "user" }),
      c.collection("persons").getFullList({ filter: personsFilter }),
      ...entityLoads,
      ...configLoads,
    ]);
    const entityResults = rest.slice(0, entityMapNonPersons.length);
    const configResults = rest.slice(entityMapNonPersons.length);

    const result: Record<string, unknown> = {
      settings: fromDB.studioSettings(settingsList[0], roles),
      persons: personsRows.map(r => fromDB.person(r)),
    };
    entityMapNonPersons.forEach(([dataKey], i) => { result[dataKey] = entityResults[i]; });
    CONFIG_MAP.forEach(([dataKey], i) => { result[dataKey] = configResults[i]; });
    // Verknüpfung Mitarbeiter↔Cloud-User existiert nur umgekehrt über
    // employees.appUserId — hier auflösen, sonst bleibt users[].employeeId
    // leer und Self-Service-Ansichten behandeln jeden Nutzer wie einen Admin.
    result.users = members.map(m => ({
      id: m.user,
      username: m.expand?.user?.username || "",
      displayName: m.expand?.user?.displayName || m.expand?.user?.username || "",
      appRoleId: m.appRoleId,
      role: m.appRoleId === "r-admin" ? "admin" : "user",
      employeeId: ((result.employees || []) as { id: Id; appUserId?: Id | null }[]).find(e => e.appUserId === m.user)?.id || null,
    }));
    return result as RawData;
  }

  // Gezielter Reload für genau die angegebenen data-Keys — Pendant zu load(),
  // aber ohne die übrigen ~18 Collections anzufragen. Genutzt vom
  // Realtime-Refresh in App.jsx: ändert ein anderer Nutzer z.B. einen einzelnen
  // Zeiterfassungs-Eintrag, muss nicht mehr über alles neu geladen werden, nur
  // über "timeEntries". "users" (aus studioMembers + employees.appUserId
  // abgeleitet, siehe load()) wird hier bewusst NICHT aktualisiert — dafür
  // müsste zusätzlich studioMembers abgefragt werden, das aktuell gar nicht
  // subscribed ist (Mitgliedschaftsänderungen sind selten und werden über den
  // ohnehin vorhandenen vollen Reload bei Tab-Fokus/Wiedereinstieg nachgezogen).
  async loadPartial(dataKeys: DataKey[]): Promise<Record<string, unknown>> {
    if (!this._studioId) return {};
    const sid = this._studioId;
    const c = this.client;
    const filter = `studio = "${sid}"`;
    const keys = new Set<DataKey>(dataKeys);
    const result: Record<string, unknown> = {};

    if (keys.has("settings")) {
      const [settingsList, roles] = await Promise.all([
        c.collection("studioSettings").getFullList({ filter }),
        c.collection("studioRoles").getFullList({ filter, sort: "sort" }),
      ]);
      result.settings = fromDB.studioSettings(settingsList[0], roles);
    }

    if (keys.has("persons")) {
      const personsFilter = `studio = "${sid}" || personStudioLinks_via_person.studio ?= "${sid}"`;
      const rows = await c.collection("persons").getFullList({ filter: personsFilter });
      result.persons = rows.map(r => fromDB.person(r));
    }

    const loads = [...ENTITY_MAP.filter(([dk]) => dk !== "persons"), ...CONFIG_MAP]
      .filter(([dataKey]) => keys.has(dataKey))
      .map(([dataKey, coll, mapper, , sort]) =>
        c.collection(coll).getFullList(sort ? { filter, sort } : { filter })
          .then(rows => { result[dataKey] = rows.map(fromDB[mapper]); })
          .catch((err: unknown) => { if (pbError(err).status !== 403 && pbError(err).status !== 404) throw err; result[dataKey] = []; }));
    await Promise.all(loads);

    return result;
  }

  // Full-Replace-Strategie wie SupabaseAdapter: pro save() ein kompletter Sync von
  // Settings/Rollen/Personen/Projekten. Andere data-Keys werden in dieser Phase
  // NICHT persistiert (siehe PB-Phase 2-Kommentar oben) — bewusste Einschränkung.
  /**
   * Speichert den kompletten Datenstand. Ruft während eines laufenden Schreibens
   * jemand erneut save() auf, wird nur der neueste Stand nachgeschrieben (kein Stau).
   * Alle Aufrufer warten auf denselben Schreibvorgang.
   */
  async save(data: AppData): Promise<void> {
    if (!this._studioId) throw new Error("PocketBaseAdapter.save: studio_id nicht gesetzt.");
    this._pendingData = data;
    if (this._currentWrite) return this._currentWrite;
    this._currentWrite = (async () => {
      try {
        while (this._pendingData) {
          const next = this._pendingData;
          this._pendingData = null;
          await this._writeSnapshot(next);
        }
      } finally {
        this._currentWrite = null;
      }
    })();
    return this._currentWrite;
  }

  async _writeSnapshot(data: AppData): Promise<void> {
    const sid = this._studioId as Id; // save() hat vorher geprüft, dass es gesetzt ist
    const c = this.client;
    const prev = this._lastData;
    // update()/save() in App.jsx bauen data immer per Objekt-Spread neu
    // ({...data, [key]: value}) — ein Top-Level-Key, der nicht angefasst wurde,
    // behält also seine Array/Objekt-Referenz. Das erlaubt einen O(1)-Check,
    // ob sich eine Collection seit dem letzten Save überhaupt geändert hat, bevor
    // überhaupt ein getFullList()-Roundtrip dafür losgeschickt wird. Ohne
    // vorherigen Snapshot (erster Save nach Login/Konstruktion) gilt alles als
    // geändert — identisch zum bisherigen Verhalten.
    const changed = (key: DataKey) => !prev || data[key] !== prev[key];

    // Manche Collections sind serverseitig an eine appRoles-Berechtigung gebunden
    // (pb/pb_hooks/permissions.pb.js) — ein Mitarbeiter ohne z.B. "invoices"
    // bekommt dort ein 403. Ohne diesen Guard würde das den gesamten Snapshot-Write
    // abbrechen (sequentielle awaits), inkl. aller danach kommenden Entities, die die
    // Rolle sehr wohl schreiben dürfte (z.B. eigene Zeiterfassung). Fehlende Berechtigung
    // wird deshalb pro Collection übersprungen statt den ganzen save() scheitern zu lassen;
    // andere Fehler (Validierung, Netzwerk, echte Bugs) werden weiterhin durchgereicht.
    // 404 zählt hier bewusst als "keine Berechtigung" mit: PocketBase liefert bei
    // satzbasierten Rule-Ablehnungen (z.B. appRoles.updateRule, r-admin-only seit dem
    // Self-Escalation-Fix) für Update/Delete-Requests 404 statt 403, um Existenz von
    // Datensätzen ausserhalb der eigenen Rule-Sicht nicht zu verraten — hier unbedenklich,
    // da "existing" direkt zuvor in derselben Funktion frisch geladen wurde.
    const skip403 = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        if (pbError(err).status !== 403 && pbError(err).status !== 404) throw err;
        console.warn(`PocketBaseAdapter._writeSnapshot: keine Berechtigung für "${label}", übersprungen.`);
      }
    };

    if (changed("settings")) {
      await skip403("studioSettings", async () => {
        const existingSettings = await c.collection("studioSettings").getFullList({ filter: `studio = "${sid}"` });
        const settingsPayload = toDB.studioSettings(data.settings || {}, sid);
        if (existingSettings[0]) {
          if (!rowUnchanged(settingsPayload, existingSettings[0])) await c.collection("studioSettings").update(existingSettings[0].id, settingsPayload);
        } else {
          await c.collection("studioSettings").create(settingsPayload);
        }
      });
    }

    if (data.settings?.roles && (!prev || data.settings.roles !== prev.settings?.roles)) {
      await skip403("studioRoles", () => this._syncTable("studioRoles", sid, toDB.studioRoles(data.settings.roles, sid), "roleId"));
    }

    // Reihenfolge wichtig: employees/persons vor allem, das sie referenziert
    // (timeEntries/expenses/absences/… → employee-Relation; projects/quotes/… → client-Relation).
    if (changed("persons")) {
      await skip403("persons", () => this._syncPersons(sid, data.persons || []));
    }
    if (changed("employees")) {
      await skip403("employees", () => this._syncTable("employees", sid, (data.employees || []).map(e => toDB.employee(e, sid)), "id"));
    }

    for (const [dataKey, coll, mapper] of ENTITY_MAP) {
      if (coll === "persons" || coll === "employees") continue; // schon oben synchronisiert
      if (!changed(dataKey)) continue;
      await skip403(coll, () => this._syncTable(coll, sid, this._toRows(mapper, data[dataKey], sid), "id"));
    }
    for (const [dataKey, coll, mapper, keyField] of CONFIG_MAP) {
      if (!changed(dataKey)) continue;
      await skip403(coll, () => this._syncTable(coll, sid, this._toRows(mapper, data[dataKey], sid), keyField));
    }

    // Erst nach vollständigem, fehlerfreiem Durchlauf als "synchronisiert"
    // markieren — wirft einer der obigen skip403()-Blöcke einen echten (nicht
    // 403/404-)Fehler, bricht die Funktion vorher ab und der nächste Save
    // vergleicht wieder gegen den alten Snapshot (alle Collections erneut "changed").
    this._lastData = data;
  }

  // UPSERT (per id bzw. natürlichem Schlüssel) + DELETE was nicht mehr im Snapshot ist.
  // Sammelt nur die nötigen Operationen — die tatsächliche Ausführung (Batch
  // oder sequenziell) übernimmt _applyOps().
  /**
   * Wendet den Mapper `toDB[mapper]` auf jede App-Zeile an. Die Mapper haben je
   * Entität einen anderen Parametertyp; hier ist die Zuordnung über ENTITY_MAP/
   * CONFIG_MAP gesichert, deshalb der Cast.
   */
  _toRows(mapper: EntityMapper, list: unknown, sid: Id): Record<string, unknown>[] {
    const fn = toDB[mapper] as (row: unknown, studioId: Id) => Record<string, unknown>;
    return ((list as unknown[] | undefined) || []).map(row => fn(row, sid));
  }

  async _syncTable(table: string, sid: Id, rows: Record<string, unknown>[], keyField: string): Promise<void> {
    const c = this.client.collection(table);
    const existing = await c.getFullList({ filter: `studio = "${sid}"` });
    const existingByKey = new Map(existing.map(r => [String(r[keyField === "id" ? "id" : keyField]), r]));
    const seenIds = new Set<string>();
    const ops: Op[] = [];

    for (const row of rows) {
      const key = String(row[keyField === "id" ? "id" : keyField]);
      const match = existingByKey.get(key);
      if (match) {
        seenIds.add(match.id);
        if (!rowUnchanged(row, match)) ops.push({ type: "update", id: match.id, body: row });
      } else {
        ops.push({ type: "create", body: row });
      }
    }
    for (const r of existing) {
      if (!seenIds.has(r.id)) ops.push({ type: "delete", id: r.id });
    }

    await this._applyOps(table, ops);
  }

  // Führt create/update/delete-Operationen für eine Collection aus — bevorzugt
  // per PocketBase-Batch-API (mehrere Operationen in einem HTTP-Request), mit
  // Fallback auf sequenzielle Einzel-Requests (bisheriges Verhalten). Empirisch
  // verifiziert (siehe ARCHITECTURE.md): ein PocketBase-Batch läuft in EINER
  // DB-Transaktion — scheitert eine einzelne Operation im Chunk, wird der
  // GESAMTE Chunk zurückgerollt (nichts committed). Der Fallback kann einen
  // gescheiterten Chunk deshalb gefahrlos komplett sequenziell nachziehen, ohne
  // Duplikate/Doppel-Deletes zu riskieren. `_batchSupported` merkt sich pro
  // Adapter-Instanz (= pro Server), ob Batches serverseitig aktiviert sind
  // (PocketBase-Setting, standardmäßig AUS) — vermeidet wiederholte, immer
  // gleich scheiternde Batch-Versuche gegen ältere/nicht migrierte Server.
  static BATCH_SIZE = 50; // Server-Default für settings.batch.maxRequests.

  async _applyOps(table: string, ops: Op[]): Promise<void> {
    const c = this.client.collection(table);
    for (let i = 0; i < ops.length; i += PocketBaseAdapter.BATCH_SIZE) {
      const chunk = ops.slice(i, i + PocketBaseAdapter.BATCH_SIZE);
      if (this._batchSupported === false) {
        await this._applyOpsSequential(c, chunk);
        continue;
      }
      try {
        await this._applyOpsBatched(table, chunk);
      } catch (err) {
        if (pbError(err).status === 403 && /batch/i.test(pbError(err).data?.message || pbError(err).message || "")) {
          this._batchSupported = false;
        }
        await this._applyOpsSequential(c, chunk);
      }
    }
  }

  async _applyOpsBatched(table: string, chunk: Op[]): Promise<void> {
    const batch = this.client.createBatch();
    for (const op of chunk) {
      if (op.type === "create") batch.collection(table).create(op.body);
      else if (op.type === "update") batch.collection(table).update(op.id, op.body);
      else batch.collection(table).delete(op.id);
    }
    await batch.send();
  }

  async _applyOpsSequential(c: ReturnType<PocketBase["collection"]>, chunk: Op[]): Promise<void> {
    for (const op of chunk) {
      if (op.type === "create") await c.create(op.body);
      else if (op.type === "update") await c.update(op.id, op.body);
      else await c.delete(op.id);
    }
  }

  // Wie _syncTable, aber Personen-spezifisch wegen Sharing (siehe load()):
  // "existing" muss lokale UND geteilte Personen abdecken, sonst würde eine
  // bereits geteilte Person hier fälschlich als "neu" erkannt und erneut
  // erstellt (Id-Konflikt). Beim UPDATE wird studio nie mitgeschickt (toDB.person
  // liefert das Feld gar nicht) — verhindert, dass eine geteilte Person beim
  // nächsten Save versehentlich re-lokalisiert wird. Gelöscht wird nur, was
  // wirklich lokal zu diesem Studio gehört (studio === sid) — geteilte Personen,
  // die aus dem lokalen data.persons-Snapshot verschwunden sind (z.B. weil ein
  // anderes Studio sie entfernt hat), bleiben unangetastet.
  async _syncPersons(sid: Id, persons: AppData["persons"]): Promise<void> {
    const c = this.client.collection("persons");
    const filter = `studio = "${sid}" || personStudioLinks_via_person.studio ?= "${sid}"`;
    const existing = await c.getFullList({ filter });
    const existingById = new Map(existing.map(r => [r.id, r]));
    const seenIds = new Set<string>();
    const ops: Op[] = [];

    for (const p of persons) {
      const payload = toDB.person(p);
      const match = existingById.get(p.id);
      if (match) {
        seenIds.add(match.id);
        if (!rowUnchanged(payload, match)) ops.push({ type: "update", id: match.id, body: payload });
      } else {
        ops.push({ type: "create", body: { ...payload, studio: sid } });
      }
    }
    for (const r of existing) {
      if (!seenIds.has(r.id) && r.studio === sid) ops.push({ type: "delete", id: r.id });
    }

    await this._applyOps("persons", ops);
  }

  async clear(): Promise<void> {
    // Lokaler Cache existiert nicht (alles live aus PocketBase) — no-op, wie bei Supabase.
  }
}
