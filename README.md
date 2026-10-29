# Rapport

Studio-Management für Architekturbüros. **Tauri 2** + **React 19** + **Vite**. Läuft als Desktop-App (macOS/Windows/Linux) **oder** als Web-App im Browser.

Daten liegen wahlweise:
- **Lokal** im Browser-`localStorage` — Solo-Setup, kein Server nötig
- **Cloud** auf einer eigenen PocketBase-Instanz (z.B. Mac Mini im Büro) — Multi-User mit Realtime-Sync, Multi-Studio (Schema/Rules/Hooks im Ordner [`pb/`](pb/); Stand PB-Phase 1, siehe [ARCHITECTURE.md](ARCHITECTURE.md))

Auf dem Desktop zusätzlich **in einem Datenordner** (z.B. iCloud Drive oder NAS) — ohne Grössengrenze, mit Tagesbackup, für zwei Personen nutzbar.

Der Modus wird beim ersten Öffnen gewählt und kann später umgeschaltet werden.

## Inhalt dieses Repos

| Ordner | Was |
|---|---|
| [`/`](.) (`src/`, `src-tauri/`) | Die App selbst — Desktop (Tauri) und Web |
| [`pb/`](pb/) | PocketBase-Backend: Schema-Migrationen und Hooks für den Cloud-Modus |
| [`server/container/`](server/container/) | Self-Hosting-Stack: Docker Compose mit PocketBase + Web-Frontend |
| [`server/app/`](server/app/) | RAPPORT Server — Mac-App, die den Stack verwaltet (Start/Stop, Backups, Updates, Admin-WebUI im LAN) |
| [`deploy/`](deploy/) | Nur das Web-Frontend per nginx ausliefern (ohne eigenen Server-Stack) |

## Voraussetzungen

| Tool | Version |
|---|---|
| Node.js | ≥ 22 (Vite 8 braucht ≥ 20.19 / 22.12) |
| npm | ≥ 10 |
| Rust toolchain | ≥ 1.77.2 (`rustup`) |
| Plattform-Build-Tools | siehe [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/) |

Plattform-spezifisch zusätzlich:
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Microsoft C++ Build Tools, WebView2
- **Linux**: `webkit2gtk-4.1`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `build-essential`

## Setup

```bash
git clone https://github.com/expiredtanin/RAPPORT.git rapport
cd rapport
npm install
```

## Entwicklung

**Web-Modus** (HMR im Browser, schnellster Iteration-Loop für UI-Arbeit):

```bash
npm run dev          # http://localhost:5173
```

**Native Window** (Tauri-Fenster mit echter Desktop-Integration):

```bash
npx tauri dev
```

Lint:

```bash
npm run lint
```

## Produktion-Build

**Nur Frontend** (statische Files für Web-Deployment):

```bash
npm run build        # → dist/
```

**Desktop-Bundle** (vollständiges Installer-Paket):

```bash
npx tauri build
```

Output landet in `src-tauri/target/release/bundle/`:

| Plattform | Verzeichnis |
|---|---|
| macOS | `dmg/` und `macos/` (`.app`) |
| Windows | `msi/` (WiX) und `nsis/` |
| Linux | `deb/`, `appimage/`, `rpm/` |

Bundle-Name und -Version stammen aus [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) (`productName`, `version`).

## Versionierung

Beim Anheben der Version müssen drei Stellen synchron bleiben:

- [`package.json`](package.json) — `version`
- [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) — `version`
- [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) — `version`

Zusätzlich im UI-Changelog: [`src/changelog.ts`](src/changelog.ts) — `CHANGELOGS` ergänzen und `LATEST_VERSION` anheben (steuert Sidebar, Login-Fusszeile und `rapport_changelog_seen`).

## Projektstruktur

```
.
├── src/                    Frontend (React)
│   ├── App.tsx             Root-Komponente, Routing, Auth-State, Cloud-Resume
│   ├── main.tsx            React-Mount
│   ├── constants.ts        Default-Daten, SIA-Phasen, Statusfarben
│   ├── utils.ts            Hashing, Sanitizer, Formatter, Berechnungen
│   ├── storage/            Storage-Adapter (Local + PocketBase) + Migrations
│   ├── components/UI.tsx   Wiederverwendbare UI-Bausteine
│   ├── views/              Module (Dashboard, Time, Invoices, Setup, CloudSetup, …)
│   └── print/              Druckansicht + Vorlagen (print/docs/: Rechnung mit QR, Offerte, Protokoll, …)
├── src-tauri/              Tauri-Wrapper (Rust)
│   ├── src/                main.rs + lib.rs
│   ├── capabilities/       Permission-Definitionen
│   ├── icons/              App-Icons aller Plattformen
│   └── tauri.conf.json     Window, Bundle, CSP
├── pb/                     PocketBase: pb_migrations/ (Schema), pb_hooks/ (Rechte, Einladung, Studios)
├── server/
│   ├── container/          Docker-Compose-Stack (PocketBase + Frontend), baut aus diesem Repo
│   └── app/                RAPPORT Server (Tauri-Mac-App zur Verwaltung des Stacks)
├── deploy/                 Static-Hosting der Web-App
│   ├── docker-compose.yml  nginx-Container, liefert dist/ aus
│   └── nginx.conf          SPA-Routing
├── public/                 Statische Assets (Favicon, PWA-Icons, pdf.js-Worker, Tesseract-OCR)
├── index.html              Vite-Entry
├── DEPLOY.md               Deploy-Anleitung (LAN + extern via NPM)
└── vite.config.js
```

## Daten & Persistenz

Rapport hat drei Storage-Backends (localStorage, Datenordner, PocketBase) mit einheitlicher Schnittstelle in [`src/storage/adapter.ts`](src/storage/adapter.ts):

### Lokal-Modus (Standard, kein Server)

- Alles liegt unter dem Key `studio_data_v1` in `localStorage`.
- Beim ersten Start: **BackendChoice** (`Lokal / Cloud`) → bei Lokal-Wahl klassischer **Setup-Assistent** ([`src/views/Setup.tsx`](src/views/Setup.tsx)).
- Backup/Restore: **Einstellungen → Daten exportieren / importieren** als JSON.

### Cloud-Modus (eigener Server)

- PocketBase-Schema mit 25 Collections, multi-tenant via `studio`-Relation + Access-Rules (siehe [pb/](pb/)).
- **Realtime-Sync**: Änderungen im Browser A erscheinen ohne Reload in Browser B.
- **Multi-Studio**: ein Account kann mehrere Studios verwalten.
- **Mitarbeiter-Einladung** als Admin-Aktion in den Settings — keine Self-Registrierung.
- **Passwort-Reset**: voller Flow (Anfordern + Mail-Link + neues Passwort setzen). Setzt konfiguriertes SMTP im PocketBase-Dashboard sowie `APP_URL` im Server-`.env` voraus (siehe [server/container/README.md](server/container/README.md)).
- Cloud-Setup mit PocketBase auf einem Mac Mini / Docker-Host: siehe [server/container/](server/container/) (empfohlen, Komplettstack; auf dem Mac bequem über [server/app/](server/app/)) oder **[DEPLOY.md](DEPLOY.md)** (nur Frontend).

Erst-Einrichtung einer leeren Cloud-Instanz: 3-Schritt-Wizard ([`src/views/CloudSetup.tsx`](src/views/CloudSetup.tsx)) erscheint automatisch, wenn der Browser auf eine Instanz ohne Studios trifft.

## Sicherheit

- **Lokal-Modus** Passwörter: PBKDF2-SHA-256 mit 100 000 Iterationen und zufälligem Salt; Verifikation in konstanter Zeit. Legacy-Klartext-Passwörter werden beim ersten erfolgreichen Login transparent zu Hashes migriert.
- **Cloud-Modus** Auth: PocketBase-Auth (bcrypt-Passwörter, JWT-Sessions), separat von der Lokal-User-Tabelle.
- **Access-Rules**: jede Cloud-Collection prüft Studio-Mitgliedschaft über die `studio.studioMembers_via_studio`-Relation — Server-Ebene garantiert Tenant-Trennung.
- **Login-Schutz**: 5 Fehlversuche → 60 s Sperre pro Tab (`sessionStorage`).
- **HTML-Sanitizer**: Brieftexte werden vor Print/Render durch eine Allowlist gefiltert (`sanitizeHtml` in [`src/utils.ts`](src/utils.ts)) — kein `javascript:`, kein `on*`-Handler.
- **Datenexport**: Legacy-Klartext-Passwörter werden beim Export gestrippt; nur Hashes verlassen die App.
- **CSP**: definiert in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) — `default-src 'self'` plus Google-Fonts-Allowlist.
- **Tauri-Capabilities**: minimal (`core:default`, `core:webview:allow-print`, Updater/Relaunch, fs/dialog nur für den gewählten Datenordner) — siehe [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json).

## Release-Workflow

```bash
# 1. Versionen anheben (package.json, tauri.conf.json, Cargo.toml)
# 2. Changelog in src/changelog.ts ergänzen (LATEST_VERSION anheben)
# 3. Commit + Tag
git tag -a 0.7.0 -m "Rapport 0.7"   # ohne v-Prefix — latest.json verlinkt /releases/download/<VERSION>/
git push origin main 0.7.0

# 4. Bundle bauen
npx tauri build

# 5. Bundle als Release-Asset auf Gitea anhängen
#    (nicht ins Repo committen)
```

## Lizenz

Copyright (C) 2026 Karim Gabriele Varano

[GNU AGPL-3.0-or-later](LICENSE) — gilt für das ganze Repo (App, `pb/`, `server/`). Mitgelieferte Drittbibliotheken (z.B. Tesseract-Daten und pdf.js unter `public/`) stehen unter ihren eigenen Lizenzen.
