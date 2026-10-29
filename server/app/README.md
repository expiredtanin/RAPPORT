# RAPPORT Server-App

> **Tauri-Admin-UI für den Rapport-Stack.**
> Eine native Mac/Linux/Windows-App, die den kompletten Rapport-Server (PocketBase + Frontend) als Docker-Compose-Stack startet, überwacht und administriert — lokal mit Native-UI und im LAN über HTTPS-WebUI.

## Status

**Pre-Alpha, aber funktional.** Service-Lifecycle, Live-Logs, TLS-WebUI, Tray-Modus, Backup/Restore (tar.gz-Snapshots von PocketBase-Daten) laufen — End-to-End gegen echte Docker-Container getestet. Auto-Updater ist aktiv (siehe `latest.json`).

## Was die App ist

- **Admin-UI auf dem Server-Mac**: Status-Dashboard für beide Services (PocketBase + Frontend), Live-Log-Tail, Start/Stop pro Service oder bulk, Settings-Editor für `config.env`.
- **HTTPS-WebUI im LAN**: dieselbe UI vom Browser eines anderen Geräts aus. Self-signed Cert, Basic-Auth mit Brute-Force-Lockout. Wichtig für **headless Mac-Mini-Deployments** ohne Bildschirm.
- **Tray-Wrapper**: Fenster schliessen reduziert in den System-Tray; Services laufen weiter. Quit nur über Tray-Menü.
- **Compose-Wrapper**, kein eigener Container-Runtime: die App ruft `docker compose` gegen den Stack in [`server/container/`](../container/) auf. Die Compose-Datei und das `.env` sind die Source-of-Truth — Änderungen dort werden automatisch übernommen.

## Was die App nicht ist

- ~~"Doppelklick statt Docker"~~ — diese ursprüngliche Idee ist verworfen. Native Service-Binaries gibt's für die meisten Supabase-Komponenten nicht (Realtime/Erlang, Storage/Node, etc.). Pragmatik schlägt Vision: wir setzen einen lokalen Docker-Daemon (OrbStack, Colima oder Docker Desktop) voraus und liefern dafür die polierte UI obendrauf.

## Voraussetzungen

| Komponente | Hinweis |
|---|---|
| **Docker-CLI + Daemon** | OrbStack oder [Colima](https://github.com/abiosoft/colima) (beide Mac-nativ, Colima ist Apache 2.0 / open source). `brew install docker colima && colima start` reicht. |
| **Rapport-Repo** geklont | Default-Suchpfad: `~/RAPPORT/server/container/` (ältere Installationen: `~/RAPPORT/SERVER-CONTAINER/`). Override via `COMPOSE_DIR=...` in `config.env`. |
| **Node ≥ 22, Rust ≥ 1.77** | nur fürs Bauen aus Source, nicht für den Endnutzer. |

## Lokal starten

```bash
npm install
npm run tauri:dev
```

Beim ersten Klick auf "Alle starten" pullt Compose die Images (~700 MB). Danach geht's instant.

## Bundle

```bash
npm run tauri:build
```

Output unter `src-tauri/target/release/bundle/`. Code-Signing ist noch nicht konfiguriert.

## WebUI-Zugriff (für headless)

- URL lokal: `https://127.0.0.1:9090`
- URL im LAN: `https://<hostname>.local:9090`
- User: `admin`, Passwort steht in `config.env` (`ADMIN_UI_PASSWORD`, auto-generiert beim Erst-Start)
- Browser warnt vor dem self-signed Cert → einmal akzeptieren

LAN-Freigabe ist standardmässig **aus** — in der App unter Settings → Admin-WebUI explizit aktivieren.

## Konfiguration

Alles in `<DATA>/config.env` (auf macOS: `~/Library/Application Support/com.rapport.server-app/config.env`, chmod 600). Wichtige Keys:

| Key | Bedeutung |
|---|---|
| `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` | PocketBase-Superuser-Login (auto-generiert) |
| `ADMIN_UI_BIND` | `127.0.0.1` (default) oder `0.0.0.0` für LAN |
| `ADMIN_UI_PORT` | Default `9090` |
| `ADMIN_UI_TLS` | `true` (default) oder `false` |
| `ADMIN_UI_PASSWORD` | Random; via Settings-UI anzeigbar/änderbar |
| `COMPOSE_DIR` | Pfad zu `server/container/` (nur nötig, wenn nicht unter `~/RAPPORT/server/container/`) |

## Bezug zum Rest des Repos

| Ordner | Rolle |
|---|---|
| [`/`](../../) | Rapport selbst — Desktop-/Web-Client (Tauri, React/TypeScript) |
| [`pb/`](../../pb/) | PocketBase-Schema und -Hooks |
| [`server/container/`](../container/) | Der Compose-Stack — Source-of-Truth für Service-Config |
| **`server/app/`** *(dieser Ordner)* | Polished UI über dem Compose-Stack — lokal + LAN-WebUI |

## Lizenz

GNU AGPL-3.0-or-later — identisch zur restlichen Rapport-Familie.
