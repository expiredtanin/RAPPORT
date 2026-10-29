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
├── src/                          React-Admin-UI (JSX, kein TS)
│   ├── main.jsx                  Entry
│   ├── App.jsx                   Root: Tabs (Status / Logs / Backup / Settings)
│   ├── api.js                    invoke() in Tauri, fetch() im Browser — gleicher Shape
│   └── components/
│       ├── ServiceCard.jsx       eine Karte pro Service mit State-Dot
│       ├── LogViewer.jsx         live tail über docker compose logs
│       ├── BackupPanel.jsx       Backup/Restore + Disk-Usage + Container-Updates
│       ├── FirstAidPanel.jsx     Erste-Hilfe-Aktionen (Recreate/Reset)
│       ├── EventFeed.jsx         Ringbuffer-Event-Log-Anzeige (siehe events.rs)
│       ├── SetupWizard.jsx       Docker/Colima-Erstinstallation (siehe setup.rs)
│       ├── AppUpdateBanner.jsx   Hinweis-Banner bei verfügbarem App-Update
│       └── SettingsPanel.jsx     Admin-WebUI-Sektion + Roh-Editor für config.env
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
│   │   ├── health.rs             (alt: HTTP-Probes — nicht mehr aktiv genutzt,
│   │   │                          wir lesen Container-State aus `docker compose ps`)
│   │   ├── backup.rs             tar.gz-Snapshots von /pb/pb_data, Restore-Flow
│   │   ├── disk.rs                Disk-Usage-Sammler (pb_data, Backups, Docker-Volumes, Host)
│   │   ├── container_update.rs   Image-Update-Check + Apply (mit Pre-Backup)
│   │   ├── firstaid.rs           Erste-Hilfe: Recreate/Reset-Data/Redeploy
│   │   ├── stats.rs               CPU/RAM/Netz pro Container (docker stats)
│   │   ├── events.rs              Ringbuffer-Event-Log fürs Status-Dashboard
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
| `logs(id)` | Hintergrund-Spawn von `docker compose logs -f <id>`, stdout → Ring-Buffer (1000 Zeilen) |
| `tick_health()` | alle 2s: `docker compose ps -a --format json` parsen, Container-State + Health-Status auf die UI-State-Machine mappen |

Pro Service wird die State-Machine `Stopped → Starting → Running` (mit `Error`-Zweig) aus Compose-Output abgeleitet. **Healthchecks definiert Compose** in der yml; unsere App liest nur den Status, probt nicht selber.

### State-Mapping

```
compose.state               → ServiceState
─────────────────────────────────────────
nicht in ps                 → Stopped
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

- **Routen**: `GET /api/services`, `POST /api/services/start-all|stop-all|:id/start|:id/stop`, `GET /api/services/:id/logs`, `GET /api/activity`. Plus statisches `dist/` als Fallback (gleiche React-App wie in der Tauri-WebView).
- **TLS**: self-signed Cert via [`rcgen`](https://crates.io/crates/rcgen), SANs für `localhost`, `127.0.0.1`, `<hostname>`, `<hostname>.local`. Cert + Key landen in `~/Library/.../admin-ui-cert.pem` (chmod 600 fürs Key). Browser warnt einmal pro Gerät.
- **Auth**: HTTP-Basic, User `admin`, Passwort aus `ADMIN_UI_PASSWORD`. Pro IP wird ein Fehler-Counter geführt — nach 5 Fehlversuchen in 60 s ist die IP für 5 Min geblockt.
- **Bind**: Default `127.0.0.1:9090`. LAN-Freigabe ist Opt-In via Settings-Toggle (mit Confirm-Dialog).

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
└── backups/                    tar.gz-Snapshots von /pb/pb_data (siehe backup.rs)
```

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
- 🔒 Basic-Auth mit IP-basiertem Rate-Limit
- 🔒 `config.env` + TLS-Key chmod 600
- ⚠️ Updater-Plugin: `active: false`, Pubkey-Placeholder noch drin
- ⚠️ Container-Crash-Notification: nur via UI-Status, kein Alert-Push

---

## 10 · Bekannte Lücken / nächste Schritte

- [ ] Audit-Log (wer hat wann was gestartet/gestoppt)
- [ ] Updater-Pubkey generieren oder Plugin ganz raus
- [ ] Capabilities tighten (`process:allow-exit` einschränken)
- [ ] Compose-Dir + `.env` ins Bundle inkludieren statt Pfad-Sucherei
- [ ] Linux/Windows getestet (aktuell nur Mac aarch64 verifiziert)

---

## 11 · Bezug zur ursprünglichen "kein Docker"-Vision

Die erste Version dieses Dokuments behauptete `Postgres + GoTrue + ... als plattform-native Subprozesse spawnen, kein Container nötig`. Diese Vision ist **bewusst verworfen**:

- Realtime (Erlang/BEAM) und Storage (Node-Bundle) haben keine offiziellen Mac-aarch64-Binaries
- GoTrue ships zwar offiziell `darwin-arm64`, aber das Asset enthält fälschlicherweise ein Linux-ELF
- Wir müssten eine eigene Build-Pipeline pro Service pro Plattform unterhalten → exponentieller Wartungsaufwand

Pragmatik: **Docker-CLI** (Apache 2.0, ~30 MB) ist universell und open-source, **Colima** liefert den Daemon Mac-nativ ohne Docker Desktop, und unsere App polished das Erlebnis darüber so weit, dass Endnutzer die Container-Schicht nicht mehr sehen.
