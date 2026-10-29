# RAPPORT — Architektur-Übersicht

> Studio-Management für Architekturbüros. Tauri 2.x Desktop-App, React 19 Frontend, Rust-Backend (minimal), localStorage-only Persistierung. Solo-Dev: Karim.
> Dieses Dokument ist die **Karte** der Codebase. Es ersetzt nicht das Lesen einzelner Dateien, soll aber verhindern, dass jede Session bei Null anfangen muss.

---

## 1. Mentales Modell in einem Absatz

RAPPORT ist eine **monolithische SPA**: ein React-Root in [App.tsx](src/App.tsx) hält den **gesamten** App-State in einem `useState({...})`, persistiert ihn synchron in `localStorage` unter dem Key `studio_data_v1`, und übergibt ihn als Props an lazy-geladene Views. Es gibt **kein Routing-Framework** (View-Wechsel via String-State), **kein State-Library** (kein Redux/Context/Zustand), **kein TypeScript**, **kein CSS-Framework** (alles inline `style={{}}` oder ein 700-Zeilen `<style>`-Block in App.tsx). Der **Rust-Teil** ist 109 Zeilen und macht nur drei Dinge: System-Tray, Window-Hide-on-Close, Plugin-Registrierung (Updater, Process, Log). Es gibt **keine `#[tauri::command]`** — Frontend ↔ Backend kommuniziert nur über das Event `rapport:navigate` (Tray → Frontend). Alle Daten sind im WebView-`localStorage`, nichts wird in Rust gespeichert.

**Konsequenz:** Wenn etwas mit Daten passiert, ist es JS. Wenn etwas mit dem Fenster/Tray/Update passiert, ist es Rust. Es gibt keine dritte Stelle.

---

## 2. Verzeichnis-Karte

```
APP/
├── src/                          React-Frontend (Migration nach TypeScript läuft, siehe TYPESCRIPT-MIGRATION.md)
│   ├── main.tsx                  Entry: createRoot().render(<App />)
│   ├── App.tsx                   Root: Login/Cloud-Setup, View-Routing, Layout  [~420 Z.]
│   ├── crm.ts                    CRM-Auswertungen (reine Funktionen): Umsatz pro Kunde/Empfehler/Herkunft, Trefferquote, Pipeline, Wiedervorlagen
│   ├── auth.ts                   getUserPermissions / getVisibleNavItems / getUserInitials (reine Funktionen)
│   ├── hooks/                    useStudioData (data, Laden, save/update, Realtime, Auto-überfällig, saveError), useNavigation (view + Verlauf), useAppearance (Dark Mode, Zoom, Sidebar), useConfirm (Bestätigungsdialog), useCalendarNav (Kalender-Dropdown)
│   ├── changelog.ts              CHANGELOGS + LATEST_VERSION (Anzeige-Version, `rapport_changelog_seen`)
│   ├── styles/global.css         Globale Klassen (.btn, .card, .pill, .modal, Tabellen, Sidebar) und Theme-Variablen
│   ├── constants.ts              STORAGE_KEY, NAV_ITEMS, defaultData, SIA-Phasen, Statusfarben  [252 Z.]
│   ├── types.ts                  TypeScript-Typen des Datenmodells (AppData, Person, Invoice, …)
│   ├── utils.ts                  Business-Logik: Kalkulation, Format, QR-Bill, Hash, CSV, Lohn  [678 Z.]
│   ├── storage/adapter.ts        Storage-Adapter (Promise-API): LocalStorageAdapter + PocketBaseAdapter, Modus-Auswahl
│   ├── storage/pocketbase-adapter.ts  Cloud-Implementation: load/save/realtime/signIn/signUp/reset (PB-Phase 1: Studios/Settings/Personen/Projekte — Rest folgt)
│   ├── storage/pocketbase-mappers.ts  fromDB / toDB für die PB-Phase-1-Entities (camelCase-Felder, kaum Mapping nötig)
│   ├── storage/migrations.ts     `applyMigrations(parsed, defaultData)` — Schema-Migrations als reine Funktion
│   ├── views/                    23 Top-Level-Screens, lazy-geladen; views/settings/ — Reiter der Einstellungen
│   ├── components/               UI.tsx (StatusBadge, Modal, FormField, SortTh, …; nur Komponenten, Hooks liegen in hooks/), Sidebar.tsx, InfoModals.tsx (Changelog/Über), MahnModal.tsx (Rechnungen/Buchhaltung), ReceiptViewer.tsx (Belege), UpdateNotifier, UpdatesSupport
│   ├── print/                    PrintComponents.tsx (Einstieg PrintView + DocPreview), docs/ — Vorlagen je Fachbereich (InvoicePrint mit QR, QuotePrint, ProtocolPrint, …), docDesign/docAssets/paginate
│   ├── utils/updater.ts          Wrapper um @tauri-apps/plugin-updater + plugin-process
│   ├── index.css                 CSS-Reset
│
├── pb/                           PocketBase-Backend: pb_migrations/ (Schema), pb_hooks/ (Rechte, Einladung, Studios).
│   (früher eigenes Repo RAPPORT-PB; `pb_data/` und das `pocketbase`-Binary sind per
│   pb/.gitignore ausgeschlossen)
│
├── server/                       Self-Hosting (früher eigene Repos RAPPORT-SERVER / RAPPORT-SERVER-APP)
│   ├── container/                Docker Compose: PocketBase + Frontend. Build-Kontext ist die Repo-Wurzel
│   │                             (Dockerfile.pb kopiert pb/, Dockerfile.app baut die App) — Schema und
│   │                             Server können so nicht auseinanderlaufen. Eigene README.
│   └── app/                      RAPPORT Server: Tauri-Mac-App über dem Compose-Stack (eigene
│                                 ARCHITECTURE.md, eigene Version/Updater, JSX statt TS)
│
├── deploy/                       Static-Hosting der Web-App via nginx-Container
│   ├── docker-compose.yml        nginx:alpine, mountet ../dist
│   └── nginx.conf                SPA-Routing (try_files $uri /index.html)
│
├── .env.production.example       Template für VITE_POCKETBASE_URL
├── DEPLOY.md                     Deploy-Anleitung (LAN-only + extern via NPM)
│
├── src-tauri/                    Rust-Backend (Tauri 2.12; Crates und @tauri-apps/*-Pakete auf gleicher Minor-Version halten, sonst warnt `tauri dev`)
│   ├── src/main.rs               6 Zeilen — delegiert zu app_lib::run()
│   ├── src/lib.rs                ~185 Zeilen — Tray, App-Menü, Beenden mit Speichern, Window-Events, Plugins
│   ├── Cargo.toml                tauri, plugin-updater, plugin-process, plugin-log, serde
│   ├── tauri.conf.json           Updater-URL, Public-Key, CSP, Bundle-Targets
│   ├── capabilities/default.json core:default, core:webview:allow-print, updater:default, process:allow-restart
│   ├── icons/                    .icns, .ico, mehrere PNGs (icon.png = Quelle)
│   ├── gen/                      AUTO-GENERIERT — nie editieren
│   ├── target/                   Cargo-Build-Output (~2 GB) — nie editieren
│   └── build.rs                  Ruft tauri_build::build()
│
├── scripts/release.sh            Build + Sign + latest.json
├── latest.json                   Updater-Manifest (im Repo, weil über main.HTTP abgerufen)
├── package.json                  version, scripts (dev, build, lint), Deps
├── eslint.config.js              Flat-Config, sehr minimal
├── vite.config.js                Nur @vitejs/plugin-react
├── index.html                    Vite-Entry
├── public/                       favicon.svg, icons.svg
├── README.md                     Setup-Doku (Release-Sektion veraltet, siehe §6)
└── .claude/                      Lokale Claude-Code-Einstellungen (gitignored)
```

---

## 3. Datenfluss — Wie Updates wirklich passieren

```
User-Interaktion in View
     │
     ▼  onChange / onClick
View ruft eine der zwei Props auf:
     │
     ├── update(key, value)      → save(prev => ({ ...prev, [key]: value }))  // Top-Level-Field
     │   update(key, prev => …)    // Variante: Funktion des bisherigen Werts
     └── saveAll(newData)         → save(newData)  // Atomar; auch saveAll(prev => next)
                                     │
                                     ▼
                              dataRef.current = newData; setData(newData)
                              storage.save(newData)   ← Storage-Adapter (Fehler → saveError-Banner)
                                     │
                                     ▼
                              React re-rendert die Hierarchie
```

**Immer auf dem neuesten Stand aufbauen:** `useStudioData` hält neben dem React-State einen `dataRef` mit dem zuletzt gesetzten Stand; `update()`/`save(prev => …)` rechnen darauf. Zwei `update()`-Aufrufe direkt hintereinander (oder einer nach einem `await`, während eine Änderung von aussen hereinkam) überschreiben sich dadurch nicht mehr. In asynchronen Handlern die Funktionsform verwenden (`update("expenses", prev => prev.map(…))`), weil ein vorab aus `data` berechneter Wert veraltet sein kann. `update`/`save` sind stabile Referenzen. Schlägt `storage.save()` fehl (z.B. localStorage voll), zeigt App.tsx `saveError` als Banner über der View, bis wieder ein Speichern gelingt.

**Storage-Adapter** ([src/storage/adapter.ts](src/storage/adapter.ts)) ist die einzige Stelle, die `studio_data_v1` schreibt. Zwei Implementationen mit identischem Promise-Interface:
- `LocalStorageAdapter` — Browser-localStorage; `save()` entprellt (250 ms, wie der Datenordner), `flush()` bei `blur`/`pagehide`/`visibilitychange`. Beenden über Tray oder Cmd+Q wartet, bis `flushStorage()` geschrieben hat (`rapport:quit-requested` → `rapport:quit-ready`, siehe §8); vor dem Neustart nach einem Update schreibt `installAppUpdate` selbst. Nicht abgedeckt: «Beenden» im Dock, Abmelden/Ausschalten (macOS beendet dort direkt) — eine Änderung aus den letzten 250 ms kann verloren gehen (gilt auch für den Datenordner).
- `PocketBaseAdapter` ([pocketbase-adapter.ts](src/storage/pocketbase-adapter.ts)) — Cloud via PocketBase (ein Binary statt Postgres+GoTrue+PostgREST+Kong); pro `data.*`-Array eine eigene Collection (Mapper in [pocketbase-mappers.ts](src/storage/pocketbase-mappers.ts)). Schema/Rules/Hooks liegen im Ordner **`pb/`** dieses Repos. Ersetzt den bisherigen `SupabaseAdapter` (entfernt).

Auswahl-Logik beim Modul-Load: `localStorage.rapport_backend` entscheidet (`"local"` | `"cloud"` | `"file"`). Bei Production-Build mit gesetztem `VITE_POCKETBASE_URL` wird automatisch Cloud (für Web-Deploy). Schnittstelle: `hasExistingData()`, `load()`, `save(data)`, `clear()`. PocketBaseAdapter zusätzlich: `signIn/signUp/signOut`, `setStudioId`, `myStudios/listStudios`, `createStudio`, `requestPasswordReset`/`confirmPasswordReset`, `subscribeToChanges`. App.tsx zeigt Boot-Spinner ([ViewFallback](src/App.tsx)) bis Initial-Load durch ist.

Alle `data.*`-Entities sind portiert (Studios/Settings/Personen/Projekte aus PB-Phase 1, plus Quotes/Invoices/TimeEntries/Expenses/Employees/Absences/Payroll/Protocols/DeliveryNotes/BlogPosts/Stammdaten aus PB-Phase 2). `load()`/`save()` sind generisch über `ENTITY_MAP`/`CONFIG_MAP` in [pocketbase-adapter.ts](src/storage/pocketbase-adapter.ts) implementiert — neue Entity = neuer Eintrag in einer der beiden Maps + Mapper-Funktion, kein Copy-Paste von Query-Code nötig.

Drei bewusste Vereinfachungen ggü. dem alten Postgres-Schema (siehe Kommentar in [1787424306_phase2_remaining_entities.js](pb/pb_migrations/1787424306_phase2_remaining_entities.js)): `invoice_reminders`, `delivery_note_items` und `project_quote_links` sind als JSON-Felder auf dem Parent-Record statt als eigene Join-Collections abgebildet — das Original war laut SQL-Kommentar ohnehin nur ein 1:1-Abbild von Frontend-Arrays.

Invite-Flow (`inviteMember`) und Seed-Defaults für neu angelegte Studios (Rate-Profile,
Dashboard-Templates, App-Rollen, Absenz-Typen, Brieftemplates) sind portiert — siehe
`invite.pb.js`/`studios.pb.js` in `pb/pb_hooks`.

Passwort-Reset-Confirm-Flow: App.tsx erkennt `#/reset-password/{TOKEN}` im URL-Hash (der PB-Mailtemplate verlinkt dorthin, siehe [pb/pb_migrations](pb/pb_migrations)) und zeigt `ResetPassword.tsx`; `confirmPasswordReset()` im Adapter schließt den Flow ab. Voraussetzung pro Deployment: `APP_URL` in SERVER-CONTAINERs `.env` gesetzt (setzt `meta.appURL` in PocketBase) und SMTP im PocketBase-Dashboard (`/_/` → Settings → Mail settings) konfiguriert — ohne SMTP läuft der Request durch, es kommt aber keine Mail an.

Person-Sharing über Studios hinweg (`personStudioLinks`-Collection, Ersatz für Postgres' `person_studio_links`): eine geteilte Person hat `persons.studio == ""` und ist stattdessen über je eine `personStudioLinks`-Zeile pro berechtigtem Studio sichtbar (Zugriffsregel siehe `pb_migrations/*_person_sharing.js`). Globalisiert wird ausschließlich server-seitig im `create-studio`-Hook (`sharePersonsFrom`-Parameter, UI in `Settings.tsx` → System → "Weiteres Studio anlegen"). `PocketBaseAdapter._syncPersons()` ersetzt dafür den generischen `_syncTable()`-Pfad: `load()` nutzt einen breiteren Filter (lokal ODER verlinkt), `save()` sendet das `studio`-Feld nie bei einem Update einer bereits existierenden Person (nur bei Neuanlage) — verhindert versehentliches Re-Lokalisieren einer geteilten Person beim nächsten Speichern.

**Server-seitige Rollen-/Berechtigungsdurchsetzung** (`pb/pb_hooks/permissions.pb.js`): das App-Rollenmodell (`data.appRoles[].permissions`, siehe [constants.ts](src/constants.ts)) wurde bis dahin NUR im Frontend geprüft (`App.tsx` `userPermissions`/`hasViewAccess`) — die PocketBase-Collection-Rules kannten nur Studio-Mitgliedschaft, nicht die Rolle. Ein Mitarbeiter ohne z.B. `"invoices"`-Berechtigung konnte Rechnungen also per direktem API-Call trotzdem lesen/schreiben. Fünf Record-Request-Hooks (`onRecordsListRequest`/`View`/`Create`/`Update`/`Delete`) prüfen jetzt zusätzlich zur bestehenden `memberRule`, ob die `appRoles`-Rolle des Callers (`permissions === null` = Vollzugriff, sonst Array-Contains) die jeweilige Collection erlaubt — fail-closed bei nicht auflösbarer Rolle/Mitgliedschaft, Superuser-Requests (`e.hasSuperuserAuth()`) bypassen wie bei normalen Rules. Sensible Collections (invoices, quotes, contracts, expenses, internalExpenses, payrollEntries, employees, absences, vacationEntries, overtimeClosings) sind komplett gesperrt (Lesen + Schreiben); quer referenzierte Stammdaten (persons, projects, timeEntries, protocols, deliveryNotes, letterTemplates, studioSettings, studioRoles, dashboardTemplates, absenceTypes, holidays) bleiben für alle aktiven Mitglieder lesbar (viele Views brauchen sie unabhängig von der eigenen Rolle), nur das Schreiben ist gebunden. Wichtige JSVM-Falle dabei: Top-Level-`const`/`function` sind im jeweiligen Hook-Callback zur Request-Laufzeit nicht sicher sichtbar (`ReferenceError: not defined`, gleiches Verhalten wie bei den `routerAdd`-Hooks in `studios.pb.js`/`invite.pb.js`) — die Gate-Map + Rollen-Lookup-Logik ist deshalb in jedem der fünf Callbacks vollständig dupliziert. Ausserdem: `record.get("jsonField")` liefert für ein DB-`null` in der JSVM ein leeres JS-Array statt `null` — die Admin-Vollzugriffs-Prüfung läuft deshalb als `findFirstRecordByFilter`-Filter (`permissions = null || permissions ~ '"<id>"'`) statt über einen JS-seitigen Wertevergleich. Die Record-Request-Hooks decken nur REST ab — PocketBase broadcastet Realtime-Änderungen (vollständiger Record-Inhalt) weiterhin allein über die klassische Collection-ViewRule; ein zusätzlicher `onRealtimeSubscribeRequest`-Hook filtert deshalb Subscription-Topics zu gesperrten Collections aus der angeforderten Liste heraus (Topic-Format `<collectionName>/*?options=<urlencoded JSON>`), statt den ganzen Subscribe-Request abzulehnen (der Client abonniert immer alle Collections auf einmal, siehe `subscribeToChanges()` im Adapter).

**Adapter-seitige Fehlertoleranz für RBAC-Antworten** (`src/storage/pocketbase-adapter.ts`): `load()` (ein `Promise.all` über alle Entities) und `_writeSnapshot()` (eine sequentielle Kette von `_syncTable`-Aufrufen pro `save()`) liefen ursprünglich beide komplett ins Leere, sobald der obige RBAC-Hook auch nur eine einzige Collection mit 403 ablehnte — für jede Nicht-Admin-Rolle (r-projektleiter, r-mitarbeiter) brach das Login und jedes Speichern vollständig ab, selbst für Aktionen innerhalb der eigenen Berechtigung. Beide Stellen fangen 403 (Hook-Ablehnung) und 404 (satzbasierte Rule-Ablehnung, z.B. `appRoles.updateRule` seit dem r-admin-only-Fix) jetzt pro Collection ab und behandeln sie als "keine Daten sichtbar" bzw. "Schreiben übersprungen" statt den gesamten Vorgang abzubrechen; andere Fehler (Validierung, Netzwerk, echte Bugs) werden weiterhin durchgereicht.

**Full-Diff-Sync-Optimierung** (`src/storage/pocketbase-adapter.ts`): `_writeSnapshot()` synct grundsätzlich weiterhin per Full-Replace (kompletter `getFullList()`-Diff pro Collection, siehe `_syncTable`/`_syncPersons`) statt gezielter Updates — bewusste Vereinfachung aus der localStorage-first-Herkunft, für Einzelbüro-Datenmengen unproblematisch. Vier Sparmaßnahmen ohne Architekturwechsel:
1. `_writeSnapshot` überspringt eine ganze Collection komplett (kein `getFullList()`, kein Diff), wenn sich der zugehörige `data[key]`-Wert seit dem letzten Save nicht per Referenz geändert hat (`update()`/`save()` in App.tsx bauen `data` immer per Objekt-Spread neu, unveränderte Top-Level-Keys behalten also ihre Referenz) — Tracking über `this._lastData`, zurückgesetzt bei Studio-Wechsel/Logout.
2. `_syncTable`/`_syncPersons`/das Settings-Update feuern innerhalb einer synchronisierten Collection keinen `update()`-Call mehr für Zeilen, die inhaltlich identisch mit dem PocketBase-Bestand sind (`rowUnchanged()`, mit `normalizeEmpty()` gegen das PocketBase-eigene `""`/`0`-statt-`null`-Verhalten bei leeren Feldern).
3. Die verbleibenden create/update/delete-Operationen laufen über PocketBase's Batch-API (`_applyOps`/`client.createBatch()`, Chunks à 50), statt sequenziell ein HTTP-Request pro Zeile abzusetzen. Batches sind serverseitig standardmäßig deaktiviert (`settings.batch.enabled`) und laufen transaktional — schlägt eine Operation im Chunk fehl, wird der GESAMTE Chunk zurückgerollt (empirisch gegen eine Testinstanz verifiziert: 0 Records committed bei einer ungültigen Zeile im Batch). `_applyOps` fällt deshalb bei jedem Chunk-Fehler gefahrlos auf sequenzielle Einzel-Requests für genau diesen Chunk zurück (nichts kann doppelt geschrieben werden) und merkt sich dauerhaft (`_batchSupported`), wenn ein Server Batches gar nicht erst zulässt — alte/nicht migrierte PocketBase-Instanzen funktionieren also weiterhin, nur ohne den Geschwindigkeitsgewinn. Serverseitige Aktivierung: Migration `pb/pb_migrations/1787720000_enable_batch_requests.js`.
4. Der Realtime-Refresh (App.tsx, `subscribeToChanges`) lud bei JEDER externen Änderung — egal in welcher der ~20 Collections — bisher immer den kompletten `load()` neu nach. `PocketBaseAdapter.subscribeToChanges()` reicht jetzt den betroffenen data-Key durch (`collToDataKey()`-Zuordnung Collection→data-Key), und `PocketBaseAdapter.loadPartial(dataKeys)` lädt gezielt nur die tatsächlich betroffenen Collections nach. App.tsx sammelt die data-Keys mehrerer Realtime-Events im 500ms-Debounce-Fenster und ruft `loadPartial()` nur mit denen auf; Tab-Fokus/Wiedereinstieg (wo während der Hintergrundzeit beliebig viel unbeobachtet passiert sein kann) erzwingt weiterhin den vollen `load()` — mischen sich beide Trigger-Arten im selben Debounce-Fenster, gewinnt sicherheitshalber der volle Reload. `users` (aus `studioMembers` + `employees.appUserId` abgeleitet) wird von `loadPartial()` bewusst nicht aktualisiert, da `studioMembers` gar nicht subscribed ist (Mitgliedschaftsänderungen sind selten, werden über den vollen Reload bei Tab-Fokus nachgezogen).

Alle vier sind rein additiv (Fallback bei fehlendem Vorzustand/fehlender Server-Unterstützung = wie bisher alles synchronisieren bzw. komplett neu laden) und ändern weder Konfliktverhalten noch Fehlerpfade.

**Server-Härtung, Rate-Limiting** (`pb/pb_migrations/1787730000_enable_rate_limits.js`): `settings.rateLimits` war bereits mit sinnvollen Regeln vorkonfiguriert (`*:auth` 2/3s gegen Login-Brute-Force, `*:create` 20/5s, `/api/batch` 3/1s, generelles `/api/` 300/10s), der Master-Schalter (`enabled`) stand aber auf AUS. Empirisch verifiziert: nach Aktivierung liefert ein dritter schneller Login-Versuch innerhalb von 3s korrekt HTTP 429, normale Einzel-Logins bleiben unbeeinflusst. `trustedProxy` bewusst nicht mitgesetzt — hängt davon ab, ob die jeweilige Instanz hinter einem Reverse-Proxy läuft (unbekannt für die aktuelle Produktions-Topologie); falls ja, muss das zusätzlich konfiguriert werden, sonst greifen die IP-basierten Regeln nur auf die Proxy-IP.

**Bekannte Lücken** (bewusst, folgen in weiteren Schritten):
- Keine bekannten größeren Lücken mehr.

**Datenordner** ([file-adapter.ts](src/storage/file-adapter.ts), dritter Adapter, nur Desktop): Daten als Dateien in einem frei gewählten Ordner (Ordnerwahl: `data-folder.ts`, Einstellungen → System → Datenspeicher, oder beim Erststart). Gedacht für zwei Personen über iCloud/NAS (eine pflegt alles, eine trägt Stunden ein). Aufteilung nach Schreiber: `studio.json` (alles ausser Zeiteinträgen), `time/<mitarbeiter>_<YYYY-MM>.json` (Zeiteinträge), `backups/backup-<Tag>-<Gerät>.json` (ein Stand pro Tag, letzte 14). Speichern entprellt (250 ms), atomar (temp + rename); hat jemand eine Datei inzwischen geändert, wird per Drei-Wege-Merge ([merge.ts](src/storage/merge.ts): pro Schlüssel bzw. pro Eintrag mit `id`, Konflikt → eigene Änderung gewinnt, Löschen verliert gegen Änderung) verrechnet statt überschrieben. Dateiüberwachung (`fs:watch`) meldet fremde Änderungen über `onExternalChange` → `useStudioData` setzt den neuen Stand. Konfliktkopien der Sync-Dienste («studio 2.json», «conflicted copy») werden ignoriert und in den Einstellungen gemeldet; nicht geladene iCloud-Dateien (`.x.json.icloud`) und beschädigte Dateien führen zu einem Fehlerbildschirm statt zu leeren Daten (sonst würde das nächste Speichern echte Dateien überschreiben). Dateischicht `FsApi` ist austauschbar (Tauri im Betrieb, Node-`fs` im Test). Rust: `tauri-plugin-fs` (+`watch`), `tauri-plugin-dialog`, `tauri-plugin-persisted-scope` — der Dialog erweitert den fs-Scope zur Laufzeit auf den gewählten Ordner, persisted-scope behält ihn über Neustarts; Capabilities `dialog:allow-open` und `fs:allow-*` ohne statischen Pfad. **Nicht enthalten:** Verschlüsselung, Rechte (wer den Ordner lesen darf, sieht alles; Rollen gelten nur in der App), Assets (`docAssets`, Belege) bleiben in `studio.json`. Wechsel zurück zum lokalen Speicher gibt es nicht (der alte localStorage-Bestand bleibt unverändert stehen).

**Per-Device-UI-State** (Dark Mode, Zoom, Sidebar-Collapse, Changelog-Seen, `rapport_backend`/`rapport_cloud_url`) bleibt außerhalb des Adapters in direktem `localStorage` — kommt nicht in die Cloud.

**Schema-Migrations** ([src/storage/migrations.ts](src/storage/migrations.ts)) sind als reine Funktion `applyMigrations(parsed, defaultData)` extrahiert, damit derselbe Code auf Local- und Cloud-geladenen Daten läuft. Beim Initial-Load in App.tsx wird das Ergebnis vom Adapter durch diese Funktion gepiped, bevor es in `useState` landet.

**Wichtig:**
- `save()` schreibt **synchron** bei jedem Update — kein Debouncing. Bei großen `data`-Objekten kann das spürbar werden.
- Es gibt **kein Backup, kein Conflict-Resolution**. Wenn der User zwei App-Fenster hat (passiert kaum, weil Single-Window), überschreibt das letzte gewinnt.
- Kein Schema-Validator beim Laden — wenn `localStorage` korrupt ist, crasht es im Render.

**`data` Top-Level-Struktur** (definiert in [constants.ts](src/constants.ts)):
```
{
  settings,           // Studio-Daten: Name, IBAN, MWST, Stundensätze, Rollen, …
  persons[],          // Kontakte (UI: «Kontakte»); Kategorie `category`, keine Auftraggeber/Partner-Filter mehr
  projects[],         // Projekte mit SIA-Phasen / Budget / Billing-Type
  timeEntries[],      // Stundeneinträge
  invoices[], quotes[],
  expenses[], internalExpenses[],
  employees[], absences[], ferienEntries[], lohnEntries[],
  protocols[], deliveryNotes[], letterTemplates[],
  dashboardTemplates[], appRoles[], users[]
}
```

**Kontakte:** `Person.category` (`person | unternehmer | oeffentlich | auslober | wbw`, Labels in `CONTACT_CATEGORIES`) wird beim Erstellen gewählt. Die Altflags `isAuftraggeber`/`isPartner` bleiben im Datenmodell (Cloud-Zuordnung, alte Daten), **filtern aber nichts mehr**: jeder Kontakt ist in Offerten, Rechnungen, Projekten und Verträgen wählbar. Altdaten ohne `category`: ehemalige Partner gelten als «Unternehmer» (`contactCategory()` in utils.ts), alle anderen sind ohne Kategorie. Die Kategorie ist in der Cloud-Zuordnung (Feld `category`, PB-Migration `pb/pb_migrations/1787740000_person_category.js` — muss auf dem Server eingespielt sein, sonst scheitert das Speichern von Kontakten). Herkunft, Empfehler und Tags (Akquise, Testbetrieb) sind weiter nur lokal.

**CRM / Akquise** (`leads[]`, `activities[]`, plus `Person.source/referredById/tags`, `settings.leadSources`):
- `Lead` = ein Akquise-Vorgang mit Stufe (`anfrage` → `besichtigung` → `offerte` → `verhandlung` → `gewonnen` | `verloren`), Herkunft, Empfehler (`referrerId`), geschätztem Honorar (netto), optional verknüpfter Offerte/Projekt. `Activity` = Kontaktverlauf einer Person (mit optionaler Wiedervorlage); Meetings werden daraus gezählt, nicht gespeichert.
- Auswertung nur in [crm.ts](src/crm.ts), nichts Aggregiertes wird gespeichert. «Umsatz» = netto (`Invoice.sub`), alle Rechnungen ausser Entwurf. Empfehler/Herkunft einer Rechnung: Lead (über Projekt oder Offerte) vor `Person.referredById`/`Person.source`.
- Zahlungsmoral braucht `Invoice.paidDate`; die UI setzt es seit dem CRM-Update beim Wechsel auf «bezahlt» (ältere Rechnungen haben keins).
- **Nur lokal:** `leads`/`activities` sind noch nicht in `ENTITY_MAP` des PocketBase-Adapters. Im Cloud-Modus werden sie nicht synchronisiert. Für den Sync: ENTITY_MAP + Mapper (`pocketbase-mappers.ts`), Collections und Gate-Listen in `pb/` (Migration + `pb/pb_hooks/permissions.pb.js`).

---

## 4. Navigation & State-Verwaltung

**Navigation** ist eine String-State-Machine in [App.tsx](src/App.tsx):
- `const [view, setView] = useState("dashboard")`
- Jede View ist ein String-Identifier (`"dashboard"`, `"projects"`, `"time"`, …)
- `navigate(newView)` schiebt auf einen Ref-basierten History-Stack (Browser-ähnliches Vor/Zurück)
- Drill-down via `selectedProjectId` etc. (zweiter State neben `view`)

**Modals:** Inkonsistent — manche Views nutzen `modal: { type, id }`, andere haben mehrere separate `useState` (siehe [Invoices.tsx](src/views/Invoices.tsx): `setModal`, `setNewInvModal`, `setAkontoModal`). Es gibt keinen zentralen Modal-Manager.

**Sessions/Auth:**
- `sessionStorage.rapport_user` — angemeldeter User (gestrippt von Credentials)
- Login per PBKDF2-SHA-256 (100k Iter, 16-Byte Salt) — siehe `hashPassword`, `verifyPassword` in [utils.ts](src/utils.ts)
- Lockout: 5 Fehlversuche → 60s Sperre ([Login.tsx](src/views/Login.tsx))
- Auto-Upgrade: legacy plaintext-Passwörter werden beim ersten erfolgreichen Login zu PBKDF2 migriert ([App.tsx](src/App.tsx))

**Weitere `localStorage`-Keys (alle `rapport_*`-prefixed):**
| Key | Zweck |
|---|---|
| `studio_data_v1` | **Die Hauptdaten** (alles außer Settings unten) |
| `rapport_backend` | `"local"` \| `"cloud"` \| `"file"` (Datenordner, nur Desktop) |
| `rapport_data_dir` | Pfad des Datenordners (Modus `file`), pro Gerät |
| `rapport_folder_hint` | `"off"` = Umzugshinweis «Daten in einem Ordner speichern?» dauerhaft ausgeblendet (`components/DataFolderHint.tsx`) |
| `rapport_device_id` | Zufällige Gerätekennung für Backup-Dateinamen im Datenordner |
| `rapport_dark` | Dark Mode (`"1"`/`"0"`) |
| `rapport_sidebar_collapsed` | Sidebar collapsed (`"1"`/`"0"`) |
| `rapport_zoom` | UI-Zoom-Faktor |
| `rapport_changelog_seen` | Zuletzt gesehene Changelog-Version |
| `rapport_v0_5_migrated` | Marker für abgeschlossene Migration |
| `rapport_update_skipped_version` | Vom User übersprungene Update-Version |
| `rapport_update_last_check` | ISO-Timestamp letzter Update-Check |
| `sessionStorage.rapport_user` | Aktive Session |

---

## 5. Views — Inventar

Alle Views liegen in [src/views/](src/views/), werden in [App.tsx](src/App.tsx) per `React.lazy()` geladen und über Props `{ data, update, saveAll, modal, setModal, currentUser, … }` versorgt.

| View | Zeilen | Zweck | Komplexität |
|---|---:|---|---|
| [Projects.tsx](src/views/Projects.tsx) | 355 | Projektliste (Gruppierung, Filter, Sortierung) | Mittel |
| [ProjectDetail.tsx](src/views/ProjectDetail.tsx) | 1246 | Detail: Budget/Zeit, SIA-Phasen, Quoten-Zuordnung, Nachträge | **Sehr hoch** |
| [ProjectEditForm.tsx](src/views/ProjectEditForm.tsx) | 224 | Gemeinsames Bearbeitungsformular (Liste + Detail) | Mittel |
| [Time.tsx](src/views/Time.tsx) | 1538 | Wochen-Grid mit Drag&Drop, Tag/Woche/Monat, Absenzen | **Sehr hoch** |
| [Invoices.tsx](src/views/Invoices.tsx) | 1467 | Rechnungen, Akonto, QR-Bill, Mahnungen, Planer | **Sehr hoch** |
| [Employees.tsx](src/views/Employees.tsx) | 1298 | Multi-Tab: Stammdaten, Absenzen, Ferien, Lohnabschluss | **Sehr hoch** |
| [Quotes.tsx](src/views/Quotes.tsx) | 980 | Offerten: SIA / manuell / frei, Übernahme als Projekt | Hoch |
| [Protocols.tsx](src/views/Protocols.tsx) | ~880 | Sitzungsprotokolle (Beschluss/Info/Aufgabe); der Mahn-Dialog liegt in components/MahnModal.tsx | Hoch |
| [Expenses.tsx](src/views/Expenses.tsx) | ~500 | Mitarbeiter-Spesen, Beleg-Upload + Belegerkennung | Hoch |
| [InternalExpenses.tsx](src/views/InternalExpenses.tsx) | ~400 | Interne Ausgaben (gleich aufgebaut wie Spesen) | Mittel |
| [Settings.tsx](src/views/Settings.tsx) | ~110 | Reiter-Leiste, Entwurf `s` der Studio-Einstellungen, «Speichern». Die Reiter liegen in [views/settings/](src/views/settings/): `StudioTab`, `DocumentsTab`, `TeamTab` (Rollen, Einladen), `CalendarTab` (Feiertage, Absenztypen), `SystemTab` (Speicher, Backup, Studios), `PersonalSettings`; Erscheinungsbild in components/DocDesignSettings | Hoch |
| [StudioBudget.tsx](src/views/StudioBudget.tsx) | 847 | Revenue-Sparklines, Aggregation Rechnungen/Quoten | Hoch |
| [Dashboard.tsx](src/views/Dashboard.tsx) | 762 | Drag&Drop Widget-Layout, Template-System | Hoch |
| [Persons.tsx](src/views/Persons.tsx) | ~720 | **Kontakte** (Nav-Label; View-/Permission-Id bleibt `personen`): eine Liste, Kategorie statt Auftraggeber/Partner, Kontaktverlauf, Herkunft/Empfehler | Mittel |
| [Crm.tsx](src/views/Crm.tsx), [CrmPipeline.tsx](src/views/CrmPipeline.tsx), [CrmAuswertung.tsx](src/views/CrmAuswertung.tsx) | ~220 / ~270 | Akquise: Pipeline-Board (Leads nach Stufen), Auswertung nach Kunde/Empfehler/Herkunft. Nav-Id und Recht `crm` | Mittel |
| [Setup.tsx](src/views/Setup.tsx) | 423 | 7-Step-Wizard für Neuinstallation | Mittel |
| [Pinboard.tsx](src/views/Pinboard.tsx) | 417 | Blog-artige Notizen, kategorisiert | Mittel |
| [Accounting.tsx](src/views/Accounting.tsx) | 374 | CSV-Export, Jahreszahlen, MwSt-Berechnung | Mittel |
| [Payroll.tsx](src/views/Payroll.tsx) | 344 | Monats-Lohnzettel, BVG-Sätze, Abzüge | Mittel |
| [DeliveryNotes.tsx](src/views/DeliveryNotes.tsx) | 294 | Lieferscheine | Niedrig |
| [Login.tsx](src/views/Login.tsx) | 197 | Login + Brute-Force-Lockout | Niedrig |
| [Documents.tsx](src/views/Documents.tsx) | 194 | Router zu Protokolle/Lieferscheine/Briefe | Niedrig |
| [MigrationScreen.tsx](src/views/MigrationScreen.tsx) | 141 | v0.5-Migration-Wizard (wenn alte Daten erkannt) | Niedrig |
| [Letters.tsx](src/views/Letters.tsx) | 114 | Brieftemplates mit Placeholdern (`{{client}}`, …) | Niedrig |
| [DataImport.tsx](src/views/DataImport.tsx) | — | CSV/Excel-Importassistent (Personen, Projekte, Mitarbeiter, Zeiterfassung, Ferien, Absenzen, Spesen, interne Ausgaben, Verträge, Rechnungen, Feiertage) mit generalisiertem FK-Mechanismus (`FK_TARGETS`, "→ neu anlegen" für Personen/Mitarbeiter, kein Stub für Projekte), dynamischen Enums (`getAbsenzTypes`, `settings.expenseCategories`/`internalExpenseCategories`), abgeleitetem Dauer-Feld bei Zeiterfassung (Stunden/Minuten/Von-Bis → `minutes`), Spalten-/Wert-Mapping, Dubletten-Check. Nicht in `NAV_ITEMS`, nur über Einstellungen → System erreichbar (`view === "dataImport"`, an die `"settings"`-Berechtigung gekoppelt). Nutzt `exceljs` (.xlsx) + eigenen CSV-Parser — bewusst nicht SheetJS/`xlsx` (unfixierte CVEs beim Parsen von Fremddateien). `phaseId`/`positionId` bei Zeiterfassung bleiben immer leer (projekt-intern skoped, nicht generisch auflösbar). Vorsicht bei künftigen Enum-Feldern: `resolveEnumValue()` prüft `Object.hasOwn(field, "valueOf")` statt `field.valueOf` — Objekte erben sonst `Object.prototype.valueOf`, was einen echten Bug verursacht hat (Enum-Wert wurde durch das ganze Feld-Config-Objekt ersetzt). Rechnungen: eine CSV-Zeile = eine Rechnung mit **einer** Sammelposition (`items[0]`), keine Einzelpositionen; `sub`/`tax`/`total` werden wie beim manuellen Speichern in `Invoices.tsx` vorab berechnet und persistiert (sonst "CHF 0.00" nach Reload), `qrReference` bleibt leer (wird beim Drucken frisch generiert, nirgends aus dem gespeicherten Feld gelesen). Personen-Import kann optional einen strukturierten Ansprechpartner (`contacts[0]`) aus separaten Spalten zusammenbauen statt ihn als Freitext in die Notiz zu kippen. Feiertage: `date` ist bei jährlich wiederkehrenden Einträgen nur ein Platzhalter-Jahr (`getFeiertageForYear()` ersetzt beim Lesen nur `MM-DD`), Dedup entsprechend auf `MM-DD` statt vollem Datum | Hoch |

---

## 6. utils.ts — Business-Logik-Bibliothek

[utils.ts](src/utils.ts) ist isoliert und gut testbar. Die wichtigsten Gruppen:

**Kalkulation:**
- `calcSIAHours(baukosten, schwierigkeit, phasen)` — SIA-102-Formel `p = Z1 + Z2/∛B`
- `calcManualHours(phases, roles)` — Stundenansatz × Stunden pro Rolle
- `deriveQuoteBudget(linkedQuotes, allQuotes, roles)` — Aggregiert Offerten zu Projekt-Budget
- `calcLohn(emp, monat, spesen, bonus)` — AHV/ALV/BVG/NBU/KTG/Quellensteuer

**Crypto / Auth:**
- `hashPassword(password, saltHex)` — PBKDF2-SHA-256, 100k Iter, via Web Crypto
- `verifyPassword(password, user)` — Constant-Time
- `withHashedPassword(user, password)` — Upgrade legacy → hashed
- `stripCredentials(user)` — Entfernt `password`, `passwordHash`, `passwordSalt`

**Sicherheit:**
- `sanitizeHtml(html)` — Allowlist (`<p>`, `<br>`, `<b>`, `<a>`, …), blockiert `<script>`, `javascript:`, `on*`-Handler

**Formatierung (de-CH):**
- `formatCHF(amount)` → `"CHF 1'234.50"`
- `formatDate(iso)` → `"14. Mai 2025"`
- `roundCHF(amount)` → 5-Rappen-Rundung
- `formatHours(minutes)` → `"2h 30m"`

**Schweizer QR-Rechnung:**
- `isQRIban(iban)` — IID-Range 30000–31999
- `formatIban(iban)` → 4er-Blöcke
- `generateQRReference(invoiceNumber)` → 27-stellige Referenz mit Mod10-Prüfziffer
- `mod10(input)` — Schweizer Modulo-10-Algorithmus

**Templates / Nummerngenerierung:**
- `applyProjectNumberFormat`, `applyProtoNumberFormat` — Template-Syntax wie `{YYYY}/{NN}`
- `parseSeqFromNumber`, `nextProtoSeq`
- `buildReminderLetter(inv, nr, …)` — Mahnungstexte (1./2./3. Mahnung)
- `buildPdfName(format, content, settings)` — Sanitierter Dateiname

**Sonstiges:**
- `exportBuchhaltungCSV(data, year)` — Voller Jahresexport
- `migrateDashboardLayout(val)` — Alte Widget-IDs → Row-basiertes Layout
- `getFeiertageForYear`, `getWorkdaysInMonth`, `getSollStunden`

---

## 7. Print-Modul

[src/print/PrintComponents.tsx](src/print/PrintComponents.tsx) (~310 Zeilen) exportiert `<PrintView>`, das via `setPrintContent(...)` aus App.tsx getriggert wird, und `<DocPreview>` für Einstellungen → Erscheinungsbild. Die Vorlagen selbst liegen je Fachbereich in [src/print/docs/](src/print/docs/) (`InvoicePrint.tsx` mit QR-Zahlteil, `QuotePrint`, `ContractPrint`, `DeliveryNotePrint`, `ProtocolPrint`, `LetterPrint`, `ProjectPrints`, `PayrollPrint`, `AccountingPrint`, `EmployeePrints`, `StudioBudgetPrint`); gemeinsame Typen und `HEADING` in `docs/shared.ts`.

**Content-Typen:** `invoice`, `invoice+qr`, `qrbill`, `quote`, `letter`, `lieferschein`, `protokoll`, `lohn`, `studioBudget`, `buchhaltung`, `projectDetail`, `projectsOverview`, `mitarbeiterOverview`, `timeReport`.

**Druck-Trigger:** `getCurrentWebviewWindow().print()` (Tauri WebView) oder Fallback `window.print()` (Browser).

**Schweizer QR-Rechnung:** Lib `swissqrbill` (lokal installiert), erzeugt SVG für 100% akkuraten Druck. Format: 105mm × 210mm, separate `@page`-Regel.

**Styles:** Inline + `@page`, `print-color-adjust: exact`. Margins konfigurierbar über `settings.pageMargin{Top,Bottom,Left,Right}`.

**Dokument-Design (Einstellungen → Erscheinungsbild, [DocDesignSettings.tsx](src/components/DocDesignSettings.tsx)):** `settings.docDesign` (Schriften, Farben, Folgeseiten-Ränder, eigenes CSS) und `data.docAssets` (hochgeladene Schriften + Briefpapier als Data-URL). Die Druckvorlagen nutzen keine festen Schriften/Farben mehr, sondern CSS-Variablen `--doc-font-heading|body|plain`, `--doc-ink`, `--doc-accent` (erzeugt in [print/docDesign.ts](src/print/docDesign.ts)); Titel tragen `...HEADING` + Klasse `doc-heading`, der Absenderblock im Kopf `doc-sender` (bei Briefpapier ausgeblendet), das Blatt `data-doc="<type>"`. Neue Dokumente: Variablen statt fester Farben/Schriften verwenden. Briefpapier: PDF wird beim Upload mit pdf.js gerastert (`print/docAssets.ts`), Ebenen hinter dem Inhalt (`LetterheadLayers`). **Seitenumbruch:** [print/paginate.ts](src/print/paginate.ts) setzt Abstandselemente, damit Folgeseiten oben/unten Rand haben (die Druckansicht läuft mit `@page{margin:0}`; WKWebView wiederholt weder `position:fixed` noch `box-decoration-break` noch Tabellenköpfe). Gemessen mit WKWebView/NSPrintOperation: das Blatt muss im Druck exakt `width:210mm` haben, sonst skaliert WebKit (744 px Druckbreite). Der QR-Zahlteil ist vom Design ausgenommen (Arial per Norm).
**Cloud:** `docAssets`-Collection (Migration `1787760000_doc_assets.js`, Schreibrecht `settings`), `docDesign` im `ui`-JSON von `studioSettings`. **Lokal:** localStorage fasst in WKWebView nur ~5,2 Mio. Zeichen (gemessen) — `checkLocalBudget()` verweigert Uploads darüber.

---

## 8. Rust-Backend ([src-tauri/src/lib.rs](src-tauri/src/lib.rs))

**Alles in ~185 Zeilen.** Keine `#[tauri::command]` — Rust und Frontend sprechen nur über Events. Kein HTTP, keine DB (Dateizugriff nur über die fs/dialog-Plugins für den Datenordner).

**Was er macht:**
1. **System-Tray** mit 5 Nav-Items (`nav:dashboard`, `nav:time`, `nav:projects`, `nav:buchhaltung`, `nav:settings`) + `show` + `quit` ([lib.rs:84-110](src-tauri/src/lib.rs#L84-L110))
2. **Tray-Click** → Fenster anzeigen + fokussieren ([lib.rs:154-163](src-tauri/src/lib.rs#L154-L163))
3. **Tray-Nav-Click** → `emit("rapport:navigate", "<view>")` ans Frontend ([lib.rs:147-151](src-tauri/src/lib.rs#L147-L151))
4. **Window-Close (X)** → Hide statt Quit, solange kein Beenden läuft (`QuitState.requested`, [lib.rs:67-74](src-tauri/src/lib.rs#L67-L74))
4a. **Beenden mit Speichern** (Tray «Beenden» und Cmd+Q; das Standard-Quit im macOS-App-Menü ist durch einen eigenen Eintrag mit id `quit` ersetzt, [lib.rs:112-134](src-tauri/src/lib.rs#L112-L134)): `ExitRequested` wird abgefangen, Rust sendet `rapport:quit-requested`, [storage/adapter.ts](src/storage/adapter.ts) ruft `flushStorage()` und antwortet `rapport:quit-ready`, erst dann `app.exit(0)`. Nach 3 s (`QUIT_TIMEOUT`) wird auch ohne Antwort beendet. Neustart nach Update (`RESTART_EXIT_CODE`) läuft durch.
5. **Plugins registrieren:** `updater`, `process` (für Relaunch nach Update), `log` (nur Debug)

**Frontend lauscht** in [App.tsx:260](src/App.tsx#L260) (`rapport:navigate` → `navigate(view)`) und in [storage/adapter.ts](src/storage/adapter.ts) (`rapport:quit-requested` → `flushStorage()` → `emit("rapport:quit-ready")`).

**Capabilities** ([src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)) — bewusst minimal:
- `core:default`
- `core:webview:allow-print` (für `window.print()`)
- `updater:default`
- `process:allow-restart` (für Relaunch nach Update)
- `dialog:allow-open` + `fs:allow-read-text-file|write-text-file|read-dir|mkdir|rename|remove|exists|stat|watch|unwatch` — nur für den Datenordner (Scope zur Laufzeit per Ordnerdialog, siehe §3)
- **Nichts** für `shell:*`, `http:*`, `clipboard:*`

**Tauri-Plugins (Cargo.toml):**
- `tauri-plugin-updater` v2
- `tauri-plugin-process` v2
- `tauri-plugin-fs` v2 (Feature `watch`), `tauri-plugin-dialog` v2, `tauri-plugin-persisted-scope` v2 (Datenordner)
- `tauri-plugin-log` v2
- `serde` 1.0, `serde_json` 1.0

**Bekannte Fragilitäten:**
- `app.default_window_icon().unwrap()` — panicked, wenn Icon fehlt ([lib.rs:140](src-tauri/src/lib.rs#L140))
- Hardcoded `"main"`-Label für Window, Hardcoded `"nav:"`-Prefix — wenn Frontend Konventionen ändert, bricht Tray
- Keine Tests in Rust

---

## 9. Updater-Pipeline End-to-End

```
release.sh (lokal, manuell aufgerufen)
  ├─ liest VERSION aus tauri.conf.json + package.json (Mismatch → Exit)
  ├─ ⚠️ Cargo.toml wird NICHT geprüft
  ├─ Lädt Private Key aus ~/.tauri/rapport_updater.key (kein Passwort)
  ├─ npx tauri build   (mit TAURI_SIGNING_PRIVATE_KEY env)
  ├─ findet .app.tar.gz + .sig in src-tauri/target/release/bundle/macos/
  └─ schreibt latest.json (Repo-Root) mit version, signature, url, pub_date
     └─ url zeigt auf Gitea Release Asset (manuell hochzuladen)

User (manuell):
  ├─ Gitea-Webinterface: Release mit Tag <VERSION> (ohne v-Prefix) erstellen
  ├─ .app.tar.gz (+ optional .dmg) hochladen
  └─ git add latest.json && git commit && git push origin main

App-Start (in jeder installierten Version):
  ├─ UpdateNotifier.tsx: setTimeout 1.5s → checkForAppUpdate({ silent: true })
  ├─ Tauri-Plugin GET https://git.kgva.ch/karim/RAPPORT/raw/branch/main/latest.json
  ├─ Verifiziert Signature gegen pubkey aus tauri.conf.json (Minisign)
  ├─ Vergleicht latest.json.version mit getVersion()
  └─ Wenn neuer → Modal mit "Installieren / Später / Diese Version überspringen"

Installation:
  ├─ update.downloadAndInstall(onProgress)  // lädt von url in latest.json
  └─ relaunch() (via plugin-process)
```

**Updater-Komponenten im Frontend:**
- [src/utils/updater.ts](src/utils/updater.ts) (49 Z.) — Wrapper, kapselt Skip-Logik in `localStorage`
- [src/components/UpdateNotifier.tsx](src/components/UpdateNotifier.tsx) (163 Z.) — Auto-Check beim Start, Modal mit Progress-Bar
- [src/components/UpdatesSupport.tsx](src/components/UpdatesSupport.tsx) (197 Z.) — Settings-Tab "Updates & Support", manueller Check, ignoriert Skip
- Custom DOM-Event: `window.dispatchEvent(new CustomEvent("rapport:check-update"))` — UpdatesSupport triggert manuell

**Aktueller `latest.json`:** nur `darwin-aarch64` (Apple Silicon). **Kein Intel-Build, kein Windows-Build, kein Linux-Build.** Wer auf x86_64-Mac oder anderem OS installiert, bekommt keine Updates.

**Signatur-Setup (Minisign):**
- Private Key: `~/.tauri/rapport_updater.key` (User-Home, **niemals** im Repo, gitignored via `*.key`)
- Public Key: base64 in `tauri.conf.json` → `plugins.updater.pubkey`
- Kein Passwort (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`)

---

## 10. Build & Release-Workflow

**Versions-Bump betrifft drei Dateien — alle drei müssen synchron sein:**
1. [package.json](package.json) → `"version"`
2. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) → `"version"`
3. [src-tauri/Cargo.toml](src-tauri/Cargo.toml) → `[package] version`

**Zusätzlich für jeden Release:**
4. [src/changelog.ts](src/changelog.ts) → Changelog-Entry oben in `CHANGELOGS`
5. [src/changelog.ts](src/changelog.ts) → `LATEST_VERSION` anheben (steuert Sidebar-Anzeige, Login-Fusszeile und den `rapport_changelog_seen`-Vergleich)

> ⚠️ `release.sh` prüft nur 1+2. **Cargo.toml-Mismatch bleibt unbemerkt.**

**Dev-Workflow:**
```bash
npm run dev          # Vite-Server auf http://localhost:5173 (= devUrl in tauri.conf.json)
npx tauri dev        # Native Window + HMR
npm run lint         # ESLint (manuell — kein Pre-Commit-Hook)
```

**Release-Workflow:**
```bash
# 1. Versionen in package.json, tauri.conf.json, Cargo.toml + Changelog-Entry hochziehen
# 2. Commit
# 3. Release-Script:
./scripts/release.sh
# 4. In Gitea-UI: Release <VERSION> erstellen (Tag OHNE v-Prefix — latest.json-URL nutzt /<VERSION>/), .app.tar.gz hochladen
# 5. git add latest.json && git commit -m "Release X.Y.Z" && git push origin main
# 6. git tag -a <VERSION> -m "..." && git push origin <VERSION>
```

> Die [README.md](README.md)-Release-Sektion erwähnt `scripts/release.sh` nicht und ist veraltet.

---

## 11. Konventionen

**Sprache:**
- **UI-Strings: Deutsch** ("Zeiterfassung", "Buchhaltung", "Beenden")
- **Code-Identifier: Englisch** (`isQuitting`, `setView`, `currentUser`)
- **Wenig Inline-Kommentare** — wenn vorhanden, meist Deutsch

**Naming:**
- Komponenten/Views: PascalCase, eine Datei = ein Default-Export (ggf. mit Named-Exports für Sub-Views)
- Utils: camelCase
- Dateien: PascalCase für Components/Views, lowercase für constants/utils

**Styling:**
- Inline-Styles dominieren (über 200 in [Invoices.tsx](src/views/Invoices.tsx) allein)
- Globale Klassen: `.btn`, `.card`, `.pill`, `.filter-bar`, `.modal` — definiert in [src/styles/global.css](src/styles/global.css)
- CSS-Variablen für Theming: `--bg`, `--text`, `--border`, … (Dark Mode via `data-theme`-Attribut)
- **Bedeutungsfarben** statt Hex: `--positive`/`--positive-bg` (grün), `--warning` (orange), `--negative` (rot), `--info` (blau), `--pending` (gelb), je mit `-bg`; Graustufen über `--text2…5`, Rahmen `--border*`. Dark-Mode-Werte = `STATUS_COLORS_DARK`. Fest bleiben: Markenfarbe `#b07848`, Druckvorlagen (immer hell, `--doc-*`), Screens vor dem Login (ausserhalb von `data-theme`) und gespeicherte Farbwerte (z.B. Absenztyp-Farbe, `<input type="color">`).
- **Keine Komponenten in Komponenten definieren** (`const Foo = () => …` im Funktionskörper): React baut sie bei jedem Render neu auf, Eingabefelder verlieren den Fokus. ESLint (`react-hooks/static-components`) meldet das.
- **Datum «heute»:** `localISODate()` aus utils.ts, nie `new Date().toISOString().slice(0, 10)` (UTC → zwischen 0 und 2 Uhr der Vortag). Datumsschleifen rechnen in UTC (`T00:00:00Z` + `setUTCDate`).
- **Datei-Uploads:** `receiptToDataUrl`/`imageFileToJpeg`/`readAsDataUrl` aus utils.ts; im lokalen Modus vorher `checkLocalBudget` (`isLocalBackend`).
- **Kein** Tailwind, **kein** CSS-Module, **kein** styled-components

**ESLint** ([eslint.config.js](eslint.config.js)): Flat-Config mit `js.configs.recommended`, `reactHooks.configs.flat.recommended`, `reactRefresh.configs.vite`; ignoriert `pb/` (PocketBase-JSVM), `public/` (Tesseract-Builds), `src-tauri/`. `npm run lint` ist sauber (0 Meldungen) und soll es bleiben; bewusste Ausnahmen stehen als `eslint-disable-next-line … -- Begründung` im Code (einmalige Übergaben zwischen Views über `modal`/`window.__…`). Kein Prettier, kein Husky, kein lint-staged.

**Imports:** Stdlib oben (React), dann Constants/Utils, dann lokale Components. Keine Pfad-Aliase (`~/`, `@/` werden **nicht** verwendet — relative Pfade `../foo`).

---

## 12. Wo es weh tut — Realistische Schwachstellen

1. **Grosse Views** über 1200 Zeilen ([ProjectDetail](src/views/ProjectDetail.tsx), [Time](src/views/Time.tsx), [Invoices](src/views/Invoices.tsx), [Employees](src/views/Employees.tsx)) — Refactoring riskant ohne Tests. Innere Komponenten sind extrahiert (Lint-Regel); Projects, Expenses, PrintComponents und Settings sind aufgeteilt, die übrigen noch nicht.
2. **App.tsx ist ~420 Zeilen** und hält noch Login/Cloud-Setup (nutzt `save`/`setData`), View-Routing, Print-Routing und die Layout-Hülle. Der Daten-State liegt in `hooks/useStudioData.ts`; ausgelagert sind ausserdem Sidebar, Changelog/Über, globales CSS, Navigation, Erscheinungsbild und Rechte-Ableitung. Jede Änderung an App.tsx ist hochriskant — sie betrifft alles.
3. **Inline-Styles ohne Konvention** — Spacing ist über das Projekt verstreut; Farben laufen über Theme- und Bedeutungsvariablen (siehe §11), Reste von Hex-Werten stehen noch in Template-Strings.
4. **Modal-State chaotisch** — manche Views haben `{type,id}`, andere mehrere `useState`. Kein zentraler Manager.
5. **Keine Tests.** Nichts. Kein Vitest, kein Cypress, kein Rust-Test. Kalkulationen in `utils.ts` wären leicht testbar.
6. **TypeScript seit der Migration (siehe TYPESCRIPT-MIGRATION.md).** Die Typen des Datenmodells stehen in [src/types.ts](src/types.ts); ältere Datensätze sind aber oft unvollständig, deshalb sind viele Felder optional. Ein Schema-Refactor braucht trotzdem eine Migration in `storage/migrations.ts`.
7. **Kein Error-Boundary** — wenn eine lazy-geladene View crasht, weißer Screen.
8. **`localStorage` ohne Schema-Validierung** — korrupte Daten crashen im Render.
9. **Keine CI**, keine Pre-Commit-Hooks. `npm run lint` und `npm run typecheck` muss man sich selbst merken (beide sind sauber).
10. **Updater nur für Apple Silicon** — wenn User x86_64-Mac/Windows/Linux hat, kein Update.
11. **README-Release-Sektion veraltet** — erwähnt `scripts/release.sh` nicht.
12. **`release.sh` prüft Cargo.toml-Version nicht** — Inkonsistenz bleibt unbemerkt.
13. **`.unwrap()` im Tray-Icon-Load** in [lib.rs:140](src-tauri/src/lib.rs#L140) — Startup-Panic möglich, wenn Icon fehlt.

---

## 13. Wenn-du-anfasst-Hinweise

| Bereich | Risiko | Notiz |
|---|---|---|
| `App.tsx` State/Auth/Migration | **Sehr hoch** | Touch nur mit klarem Auftrag, betrifft alles |
| `constants.ts` `defaultData` Shape | **Hoch** | Schema-Änderung erfordert Migration (siehe Beispiele in App.tsx:56-122) |
| `utils.ts` Kalkulationen | **Hoch** | Ohne Tests — Änderung an `calcSIAHours`, `calcLohn`, `generateQRReference`, `mod10` → manuell durchrechnen |
| `print/PrintComponents.tsx`, `print/docs/` | **Hoch** | SwissQR-Bill ist Pixel-genau — Layout-Bugs sichtbar erst im Druck |
| Views (Invoices/Projects/Time) | **Hoch** | Lange Files mit Edge-Cases (Mahnung, Akonto, Drag&Drop) |
| `views/settings/TeamTab.tsx` Permissions | **Hoch** | Tangiert Rollen/Berechtigungen, Dashboard-Templates |
| `Login.tsx` Hash-Logik | **Hoch** | PBKDF2 + Migration, sicherheitsrelevant |
| `storage/adapter.ts` | **Hoch** | Einzige Schreibstelle für `studio_data_v1`. API ist async (Promise) — Direkt-Zugriffe auf `localStorage[STORAGE_KEY]` in Views sind verboten |
| `storage/migrations.ts` | **Hoch** | Schema-Migrations. Jede Änderung am `defaultData`-Shape erfordert hier eine Migration-Step + Test mit alten Snapshots |
| `storage/pocketbase-adapter.ts` | **Hoch** | Cloud-Read/Write, Auth, Realtime. Bei neuer Collection: load() + save() + Mapper anpassen. Schema/Rules/Hooks liegen in `pb/` (im selben Repo: Schema-Änderung und App-Änderung gehören in einen Commit) |
| `storage/pocketbase-mappers.ts` | **Hoch** | fromDB ↔ toDB pro Entity — deutlich schlanker als bei Supabase, da PocketBase-Felder direkt camelCase heissen |
| `pb/pb_migrations/` | **Hoch** | Cloud-Schema (Collections + Rules + Hooks). Neue Migration-Datei pro Schema-Änderung, kein Bearbeiten bestehender |
| `views/CloudSetup.tsx` | **Mittel** | Erst-Einrichtung der Cloud (3 Schritte). Ruft `cloudInit` in App.tsx |
| `views/BackendChoice.tsx` | **Niedrig** | Modus-Wahl Lokal/Cloud bei frischer Installation |
| `views/ResetPassword.tsx` | **Niedrig** | Passwort-Reset nach Mail-Link-Klick. Läuft über App.tsx-Hash-Erkennung + `PocketBaseAdapter.confirmPasswordReset()` |
| `deploy/` + `DEPLOY.md` | **Niedrig** | Nginx-Container + Anleitung. Reine Doku/Hosting-Files |
| `lib.rs` Tray/Window | **Mittel** | Wenn Nav-IDs geändert werden, müssen Frontend + Rust synchron bleiben |
| `tauri.conf.json` Updater | **Sehr hoch** | Public Key ändern bricht alle bestehenden Installationen |
| `release.sh` | **Sehr hoch** | Falsche Änderung → defekte Updates beim User |
| Neue Util / neue View | Niedrig | Isoliert, safe — kopiere bestehende, entferne was du nicht brauchst |

---

## 14. Offene Fragen / Nicht-Validiertes

- Bild-Uploads (Belege, Logo, Pinnwand, Avatar, Dokument-Design) liegen als Data-URL in `data`; Fotos werden verkleinert (Belege 1600 px, Pinnwand 1200 px, Avatar 256 px). Im lokalen Modus (~4,8 Mio. Zeichen Budget, `LOCAL_STORAGE_BUDGET`) prüfen Belege, Logo und Dokument-Design vorher `checkLocalBudget`; ein trotzdem volles localStorage zeigt das `saveError`-Banner. Binärdateien ausserhalb des Daten-Blobs (eigene Dateien im Datenordner, PocketBase-File-Felder) wären der nächste Schritt — offene Architekturentscheidung.
- PDF-Export: aktuell nur `window.print()` → User-PDF-Dialog. Kein direkter File-Save.
- Multi-User-Workflow: `users[]` in `data`, aber nur ein Browser-localStorage → keine echte Mehrfachnutzung.
