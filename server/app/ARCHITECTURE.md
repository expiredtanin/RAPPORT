# RAPPORT Server-App — Architektur

> Wie die App den Compose-Stack in [server/container/](../container/) verwaltet, lokal anzeigt und im LAN per HTTPS erreichbar macht.

---

## 1 · Mentales Modell in einem Absatz

Die Server-App ist eine **Tauri-2-App**, deren Rust-Backend keine Container selbst startet, sondern **`docker compose`** gegen den existierenden Compose-Stack aufruft. Die Compose-Datei und ihr `.env` in `server/container/` sind die einzige Konfigurations-Wahrheit für die Services — die App ist eine dünne Steuerschicht obendrauf. Das Tauri-Backend exponiert die Steuerung auf zwei Wegen: über **Tauri-IPC** an die eingebettete React-WebView (Admin-UI auf dem Server-Mac selbst) und über einen **eingebauten HTTPS-Server (axum + rustls, self-signed)** an Browser im LAN (für headless Mac-Mini-Deployments). Beide Endpoints sprechen die identische API, beide rendern dieselbe React-App.

**Konsequenz:** Schliessen des Tauri-Fensters reduziert nur in den System-Tray — Container und HTTPS-Server laufen weiter. Echtes Beenden nur über das Tray-Menü.

---

## 2 · Verzeichnis-Karte

```
server/app/
├── src/                          React-Admin-UI (JSX, kein TS), Gestaltung wie die Haupt-App
│   ├── main.jsx                  Entry; Schriften lokal (Inter, Archivo Black, Material Symbols Rounded)
│   ├── App.jsx                   Rahmen: Seitenleiste, Navigation, Polling von Diensten/Auslastung, Sammelaktionen
│   ├── api.js                    invoke() in Tauri, fetch() im Browser — gleicher Shape (Config im Browser ohne Geheimnisse)
│   ├── styles.css                Variablen wie ../../src/styles/global.css, hell/dunkel nach System
│   └── components/
│       ├── ui.jsx                PageHead, Note, Icon, ConfirmProvider/useConfirm (statt window.confirm —
│       │                         in WKWebView stumm), Formatierung
│       ├── Overview.jsx          Übersicht: Zustand, Kennzahlen, Dienste mit Auslastung, Zugänge, Aktivität (events.rs)
│       ├── BackupPanel.jsx       Backups & Updates: Liste, Wiederherstellen, Speicherplatz, Container-Updates
│       ├── LogViewer.jsx         Logs je Dienst mit Filter, Anhalten, Kopieren
│       ├── FirstAidPanel.jsx     Erste Hilfe: Diagnose → Neu erstellen → Daten-Reset (Tippwort)
│       ├── SetupWizard.jsx       Docker/Colima-Erstinstallation (siehe setup.rs)
│       ├── AppUpdateBanner.jsx   App-Update mit Backup, Fortschritt und Neustart (relaunch)
│       └── SettingsPanel.jsx     Einstellungen gruppiert + Rohzugriff auf config.env
│
├── src-tauri/                    Rust-Backend
│   ├── src/
│   │   ├── main.rs               6 Zeilen
│   │   ├── lib.rs                Tauri-Setup, Tray, Tick-Loop, HTTP-Server-Spawn
│   │   ├── supervisor.rs         Wrapper um `docker compose` (up/down/stop/ps/logs)
│   │   ├── services.rs           ServiceDef-Liste, init_compose_dir() Auto-Detect
│   │   ├── setup.rs              Setup-Wizard: Docker-CLI/Colima/Lima Detection + Install
│   │   ├── http_server.rs        axum + rustls + Basic-Auth + Rate-Limit
│   │   ├── config.rs             config.env Lesen/Schreiben + Default-Generation
│   │   ├── paths.rs              ~/Library/.../com.rapport.server-app/...
│   │   ├── backup.rs             tar.gz-Snapshots von /pb/pb_data (pb kurz gestoppt),
│   │   │                          Restore-Flow, Auto-Backup-Scheduler + Rotation
│   │   ├── disk.rs                Disk-Usage-Sammler (pb_data, Backups, Docker-Volumes, Host)
│   │   ├── container_update.rs   Image-Update-Check + Apply (mit Pre-Backup)
│   │   ├── firstaid.rs           Erste-Hilfe: Recreate/Reset-Data/Redeploy
│   │   ├── stats.rs               CPU/RAM/Netz pro Container (docker stats)
│   │   ├── events.rs              Ringbuffer-Event-Log fürs Status-Dashboard
│   │   ├── pb_embed.rs           PocketBase-Admin als Child-Webview im Hauptfenster
│   │   └── commands.rs           #[tauri::command]-Wrapper für die UI
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── README.md
└── ARCHITECTURE.md  (diese Datei)
```

---

## 3 · Service-Inventar

Image-Tags und Konfiguration kommen aus [`server/container/docker-compose.yml`](../container/docker-compose.yml) — siehe dort. Aktueller Stand (August 2026, seit dem Wechsel von Supabase-Selfhost auf PocketBase — 2 statt 7 Services):

| Compose-Service | Image | Host-Port | Erreichbar |
|---|---|---|---|
| `pb` (PocketBase) | `rapport-pb:main` (baut aus [pb/](../../pb/)) | 18090 | LAN (`0.0.0.0:18090`) |
| `app` (Frontend) | `rapport-app:main` (lokal gebaut) | 18080 | LAN (`0.0.0.0:18080`) |

Die Host-Ports liest die App aus `PB_PORT`/`APP_PORT` der `.env` im Compose-Ordner (`services::compose_port`); ohne Eintrag gelten die Compose-Defaults 8090/8080. Der Setup-Wizard schreibt 18090/18080.

PocketBase deckt Auth + Datenbank + Realtime + File-Storage in einem Prozess ab — kein separates API-Gateway (Kong) mehr nötig, das Frontend spricht `pb` direkt an.

---

## 4 · Supervisor

Der Rust-Supervisor (`supervisor.rs`) ist im Wesentlichen ein Wrapper um die `docker compose`-CLI:

| Funktion | Compose-Aufruf |
|---|---|
| `start(id)` | `docker compose up -d <id>` |
| `stop(id)` | `docker compose stop <id>` |
| `start_all()` | `docker compose up -d` (Compose erzwingt `depends_on`) |
| `stop_all()` | `docker compose down` |
| `restart(id)` / `restart_all()` | `docker compose restart [<id>]`, danach `up -d --no-recreate` (legt fehlende Container an) |
| `logs(id)` | Hintergrund-Spawn von `docker compose logs -f --tail 1000 <id>`, stdout → Ring-Buffer (1000 Zeilen, wird beim Respawn neu befüllt) |
| `query_compose_status()` + `apply_health()` | alle 2s: `docker compose ps -a --format json` (ohne Supervisor-Lock, 20 s Timeout) parsen — Compose liefert je nach Version ein JSON-Array oder NDJSON, beides wird gelesen — und auf die UI-State-Machine mappen |

Der Tick pflegt auch die Log-Pumps: beendete `logs -f`-Prozesse werden abgeräumt, für laufende Container ohne Pump (z. B. per Terminal gestartet) wird einer gestartet (höchstens alle 30 s). Beim App-Exit werden alle Pumps beendet.

**Docker nicht erreichbar** (Colima gestoppt, Daemon hängt): alle Services → `Stopped` mit `last_error = "Docker nicht erreichbar: …"`, ein Event + eine Notification (nicht pro Service, keine Auto-Recovery-Versuche). Kommt Docker zurück: Event „Docker wieder erreichbar“.

**Crash-Benachrichtigung:** Wechselt ein Service in `Error`, gibt es Event + System-Notification. Auto-Recovery (`AUTO_RECOVERY_*`) startet ihn nach `AUTO_RECOVERY_BASE_DELAY_SECONDS` neu (exponentielles Backoff), nach `AUTO_RECOVERY_MAX_ATTEMPTS` gibt sie mit Notification auf.

Pro Service wird die State-Machine `Stopped → Starting → Running` (mit `Error`-Zweig) aus Compose-Output abgeleitet. **Healthchecks definiert Compose** in der yml; unsere App liest nur den Status, probt nicht selber.

### State-Mapping

```
compose.state               → ServiceState
─────────────────────────────────────────
nicht in ps                 → Stopped (während eines laufenden compose-
                              Aufrufs + 30 s Nachlauf bleibt Starting)
running + health=healthy    → Running
running + health=starting   → Starting
running + (kein health)     → Running
restarting / dead           → Error
exited / stopped / removing → Stopped
created / paused            → Starting
```

---

## 5 · Compose-Dir-Auflösung

`services::init_compose_dir()` sucht beim App-Start in dieser Reihenfolge:

1. `COMPOSE_DIR=...` aus `config.env`
2. Env-Var `RAPPORT_COMPOSE_DIR`
3. `~/RAPPORT/server/container/`, danach `~/RAPPORT/SERVER-CONTAINER/` (alter Einzel-Klon)
4. `~/.rapport/compose/` (Setup-Wizard)
5. `<exe-parent>/../SERVER-CONTAINER/` (bundled Layout)
6. `<crate>/../../container/` (Dev-Layout im Repo), danach `<crate>/../../SERVER-CONTAINER/`

Der erste Pfad mit einer `docker-compose.yml` wird genommen. Hat keiner eine, loggt die App einen Fehler und alle compose-Aufrufe scheitern hart (mit klarer Fehlermeldung).

---

## 6 · HTTP-Server (LAN-WebUI)

`http_server.rs` startet **axum 0.7** mit `axum-server`-rustls-Adapter. Im Detail:

- **Routen** (alle unter `/api`, Basic-Auth; schreibende zusätzlich Header `X-Rapport-Csrf`):
  `GET services`, `GET services/:id` (Status oder `null`), `POST services/start-all|stop-all|restart-all|:id/start|:id/stop|:id/restart`, `GET services/:id/logs`, `GET activity`,
  `GET backups`, `POST backups/now`, `POST backups/:filename/restore`, `POST container-updates/check|apply`, `GET events|stats|disk`, `POST firstaid/recreate|reset-data|diagnose`, `GET setup/status`, `POST setup/install`,
  `GET config` (wie `get_config`, aber Werte geheimer Schlüssel — Name enthält `PASSWORD`/`SECRET`/`TOKEN`/`KEY` — als `"<redacted>"`), `POST config` mit JSON `{"key","value"}` (wie `set_config_value`; geheime Schlüssel und `COMPOSE_DIR` → 403, ungültiger Schlüssel/Wert → 400).
- **Frontend**: aus den in die App eingebetteten Assets (Tauri `asset_resolver`, SPA-Fallback auf `index.html`); unbekannte `/api/*` → 404, Pfade mit `..`/kodierten Trennern → 400.
- **TLS**: self-signed Cert via [`rcgen`](https://crates.io/crates/rcgen), SANs für `localhost`, `127.0.0.1`, `<hostname>`, `<hostname>.local`. Cert + Key landen in `~/Library/.../admin-ui-cert.pem`; der Key wird direkt mit 0600 angelegt. Browser warnt einmal pro Gerät.
- **Auth**: HTTP-Basic, User `admin`, Passwort aus `ADMIN_UI_PASSWORD` (User + Passwort zeitkonstant verglichen). Pro IP wird ein Fehler-Counter geführt — nach 5 Fehlversuchen in 60 s ist die IP für 5 Min geblockt; die Tabelle wird bei >4096 Einträgen von abgelaufenen bereinigt.
- **Bind**: Default `127.0.0.1:9090` (IPv4/IPv6). LAN-Freigabe ist Opt-In via Settings-Toggle (mit Confirm-Dialog). `ADMIN_UI_TLS=false` startet nur mit Loopback-Bind (sonst Basic-Auth im Klartext im LAN) — Fehler landet im Event-Log.
- **Änderungen** an `ADMIN_UI_*` greifen erst nach App-Neustart.

---

## 7 · Daten- und Konfigurationspfade

| OS | App-Data-Dir |
|---|---|
| **macOS** | `~/Library/Application Support/com.rapport.server-app/` |
| **Linux** | `~/.local/share/rapport-server-app/` |
| **Windows** | `%APPDATA%/rapport/server-app/` |

```
<app-data>/
├── config.env                  Settings (chmod 600)
├── admin-ui-cert.pem           TLS-Cert für WebUI
├── admin-ui-key.pem            TLS-Private-Key (chmod 600)
├── pb_data/                     (nicht genutzt — Compose mountet sein eigenes Volume)
├── logs/                       (App-eigene Logs, separat von Compose-Logs)
└── backups/                    tar.gz-Snapshots von /pb/pb_data (siehe backup.rs),
                                dazu diagnose-*.txt aus der Ersten Hilfe
```

### Backups (`backup.rs`)

- **Konsistent:** PocketBase hält SQLite im WAL-Modus offen; ein `tar` im laufenden Container ist nicht konsistent. Darum: `compose stop pb` → `compose run --rm --no-deps -T --entrypoint tar pb -czf - -C / pb/pb_data` (gestreamt in `<name>.partial`, gzip geprüft, dann umbenannt) → `compose start pb`. Ausfall von pb: wenige Sekunden.
- **Dateinamen:** `rapport-YYYYmmdd-HHMMSS[-label][-n].tar.gz`, Labels `vor-restore`, `vor-update`, `vor-reset` für Sicherheits-Backups. Restore akzeptiert nur Namen nach genau diesem Muster (kein Pfad-Traversal).
- **Automatisch:** Scheduler prüft alle 10 Min. `BACKUP_ENABLED` (Default `true`), `BACKUP_INTERVAL_HOURS` (24), `BACKUP_HOUR` (Stunde 0–23 Ortszeit, Default 3; `-1` = keine feste Stunde; bei Intervallen < 24 h ignoriert). War der Rechner zur Stunde aus, läuft es nach, sobald es 24 h überfällig ist. Fehlschlag → Event + Notification.
- **Rotation:** `BACKUP_RETENTION_COUNT` (Default 14 für neue Installationen; bestehende `config.env` behalten ihren Wert) — neueste N bleiben, auch nach „Backup jetzt“ und Container-Update. Das neueste wird nie gelöscht.
- **Restore:** Safety-Backup → `compose stop pb app` → Einmal-Container puffert das Archiv, prüft es (`tar -tz`, nur `pb/pb_data/…`, kein `..`) und löscht erst dann die alten Daten → `compose up -d` (auch nach Fehlern).
- **Reihenfolge:** Backup, Restore, Container-Update und Daten-Reset laufen über einen gemeinsamen Lock nie gleichzeitig.
- **Container-Update:** `compose pull`, dann je Container die laufende Image-ID mit der lokal getaggten vergleichen (früher: `compose images` vorher/nachher — fand nie etwas, weil das die Container-Image-ID ist). Bei Updates: Pre-Backup (`vor-update`), `compose up -d`, Rotation.

Container-Volumes verwaltet Compose über Docker selbst (`pb-data`-Named-Volume). Wenn die App stoppt, bleiben die Daten erhalten.

---

## 8 · Tray-Modus

Verhalten:

| Aktion | Effekt |
|---|---|
| Fenster X klicken | Fenster wird versteckt, App läuft im Tray weiter |
| Tray-Click (Links) | Fenster wieder zeigen |
| Tray-Rechtsklick → "Show Dashboard" | gleiches Verhalten |
| Tray-Rechtsklick → "Quit RAPPORT Server" | App wirklich beenden (Container laufen weiter — das ist Compose-Sache) |

Effekt: ein **headless Mac Mini** kann die App im Boot-Login starten, sie verschwindet ins Tray, die Container laufen, und vom Laptop aus erreicht man die WebUI per `https://hostname.local:9090`.

---

## 9 · Sicherheit (Stand Hardening Pass 1)

- 🔒 WebUI Default `127.0.0.1`; LAN ist bewusste Opt-In-Aktion
- 🔒 WebUI über HTTPS (rustls + self-signed)
- 🔒 Basic-Auth (zeitkonstant) mit IP-basiertem Rate-Limit, CSRF-Header auf allen schreibenden Routen
- 🔒 `config.env` + TLS-Key von Anfang an 0600 (kein Fenster mit Default-umask); Werte mit Zeilenumbrüchen werden abgelehnt (keine Schlüssel-Injection)
- 🔒 Geheimnisse gehen nicht über HTTP raus (`GET /api/config` geschwärzt), Diagnose-Bundle schwärzt alle `*PASSWORD*`/`*SECRET*`/`*TOKEN*`/`*KEY*`
- 🔒 Capabilities: kein `process:allow-exit`, kein `notification:default` (Notifications kommen aus Rust); PocketBase-Embed (Remote-URL) hat keinen IPC-Zugriff
- 🔒 Container-Crash und Docker-Ausfall → System-Notification
- ℹ️ Updater: Endpoint + Pubkey in `tauri.conf.json` gesetzt (`plugins.updater`); der private Schlüssel liegt nur beim Maintainer (`release.sh`). Neue Schlüssel nie in der App generieren.

---

## 10 · Bekannte Lücken / nächste Schritte

- [ ] Audit-Log (wer hat wann was gestartet/gestoppt)
- [ ] Backup ohne pb-Stopp (PocketBase-Backup-API mit Superuser-Token oder `sqlite3 .backup` im Image)
- [ ] Backups ausserhalb des Rechners (z. B. zweites Ziel)
- [ ] Compose-Dir + `.env` ins Bundle inkludieren statt Pfad-Sucherei
- [ ] Linux/Windows getestet (aktuell nur Mac aarch64 verifiziert)

---

## 11 · Bezug zur ursprünglichen "kein Docker"-Vision

Die erste Version dieses Dokuments behauptete `Postgres + GoTrue + ... als plattform-native Subprozesse spawnen, kein Container nötig`. Diese Vision ist **bewusst verworfen**:

- Realtime (Erlang/BEAM) und Storage (Node-Bundle) haben keine offiziellen Mac-aarch64-Binaries
- GoTrue ships zwar offiziell `darwin-arm64`, aber das Asset enthält fälschlicherweise ein Linux-ELF
- Wir müssten eine eigene Build-Pipeline pro Service pro Plattform unterhalten → exponentieller Wartungsaufwand

Pragmatik: **Docker-CLI** (Apache 2.0, ~30 MB) ist universell und open-source, **Colima** liefert den Daemon Mac-nativ ohne Docker Desktop, und unsere App polished das Erlebnis darüber so weit, dass Endnutzer die Container-Schicht nicht mehr sehen.
