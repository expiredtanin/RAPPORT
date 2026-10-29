# Rapport Server (Docker Compose)

Self-Hosting-Stack für [Rapport](../../README.md) — die
Studio-Management-Software für Architekturbüros.

Zwei Container statt der bisherigen sieben (Postgres/GoTrue/PostgREST/Realtime/
Storage/Kong wurden durch **PocketBase** ersetzt — ein Binary deckt Auth,
Datenbank, Realtime und File-Storage ab):

- **PocketBase** (Schema/Rules/Hooks aus [`pb/`](../../pb/) in diesem Repo)
- **Rapport-Frontend** (nginx mit dem React-Build)

Komplett Open-Source, per Docker Compose. End-to-End getestet (lokal, Docker Compose,
alternative Ports) — Signup, Studio-Anlage mit Seed-Defaults, Reload-Persistenz
funktionieren im echten Container-Stack.

---

## Voraussetzungen

| OS | Container-Runtime |
|---|---|
| **Linux** (Ubuntu 22.04+, Debian 12+, …) | Docker Engine + Compose v2 |
| **macOS** (Mac Mini etc.) | [Colima](https://github.com/abiosoft/colima) + Docker CLI — **vollständig Open-Source** |

> Auf macOS funktioniert auch OrbStack oder Docker Desktop, beide sind aber proprietär. Colima ist die OSS-Alternative und für Selfhost ausreichend.

Plus: ein erreichbarer DNS-Name (für TLS) — z.B. `rapport.studio.ch`. Optional: Nginx Proxy Manager oder Caddy als Reverse-Proxy für SSL.

---

## Setup

### 1. Repo klonen

```bash
git clone https://github.com/expiredtanin/RAPPORT.git rapport
cd rapport/server/container
```

Selbst gebaut wird immer der Stand dieses Repos (`docker compose build`, Build-Kontext ist die
Repo-Wurzel) — App, Schema und Server passen damit automatisch zusammen.

### 2. `.env` erstellen

```bash
cp .env.example .env
```

In `.env` mindestens ersetzen:
- `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD` — Admin-Zugang für die PocketBase-Dashboard-UI (`/_/`)
- `API_EXTERNAL_URL` — die öffentliche URL, unter der PocketBase erreichbar sein wird (z.B. `https://api.rapport.studio.ch`) — wird zur Build-Zeit ins Frontend eingebrannt
- `APP_URL` — die öffentliche URL des Frontends (z.B. `https://rapport.studio.ch`) — wird beim Start automatisch als PocketBase-Einstellung `meta.appURL` gesetzt, damit Passwort-Reset-Mails auf die richtige Seite verlinken (siehe [Passwort-Reset](#passwort-reset--smtp))

### 3. Stack starten

```bash
docker compose up -d
```

Erststart dauert wenige Sekunden — PocketBase legt beim ersten Boot automatisch
Schema + Superuser an, kein manueller Migrations-Schritt nötig (anders als beim
alten Postgres-Stack).

### 4. Health-Check

```bash
docker compose ps
```

Beide Container sollten `healthy` zeigen.

Frontend ist erreichbar auf `http://localhost:8080`, PocketBase-Admin-UI auf
`http://localhost:8090/_/` — direkt im Browser öffnen oder über deinen
Reverse-Proxy auf eine Domain mappen.

---

## Reverse-Proxy + HTTPS

Empfohlen: **Nginx Proxy Manager** (OSS, Web-UI, Let's-Encrypt automatisch) oder **Caddy** (config-as-code, vollautomatisch).

Beispiel Caddy:

```caddy
app.rapport.studio.ch {
  reverse_proxy localhost:8080
}

api.rapport.studio.ch {
  reverse_proxy localhost:8090
}
```

In `.env` dann `API_EXTERNAL_URL=https://api.rapport.studio.ch` setzen (bestimmt,
welche URL beim Frontend-Build als `VITE_POCKETBASE_URL` eingebrannt wird).

---

## Passwort-Reset / SMTP

PocketBase verschickt Mails über SMTP — ohne Konfiguration läuft der
Reset-Request zwar durch (kein Fehler in der App), es kommt aber keine Mail
an. Einmalig einrichten unter `/_/` → **Settings → Mail settings**: SMTP-Host,
Port, User/Passwort deines Mail-Providers eintragen und "Enable" aktivieren.

Der Link in der Reset-Mail zeigt auf `APP_URL` (siehe oben) + `/#/reset-password/{TOKEN}`
— das Frontend fängt diese Route ab und zeigt das Passwort-Formular. Ohne
gesetztes `APP_URL` bleibt der Platzhalter leer; kann jederzeit nachträglich
unter `/_/` → Settings → **Application URL** gesetzt werden, auch ohne
Neustart des Containers.

---

## Updates

```bash
git pull
docker compose pull   # neueste Container-Versionen (RAPPORT_APP_TAG / RAPPORT_PB_TAG in .env anpassen für Pins)
docker compose up -d  # neu starten
```

Daten bleiben erhalten (Volume `pb-data` wird nicht angetastet).

---

## Backup

PocketBase-Daten sind eine einzelne SQLite-Datei + File-Storage-Ordner — deutlich
einfacher als der alte `pg_dumpall`-Weg:

```bash
docker compose exec -T pb tar -czf - /pb/pb_data > backup-$(date +%Y%m%d).tar.gz
```

Empfohlen: per `cron` täglich + auf externe Disk/S3/Backblaze sichern.
Rücksicherung: Container stoppen, Volume-Inhalt durch das Backup ersetzen, neu starten.

---

## Architektur-Hintergrund

Der Wechsel von Supabase-Selfhost auf PocketBase (Mai/August 2026) ist dokumentiert
in [ARCHITECTURE.md](../../ARCHITECTURE.md) und in [pb/](../../pb/).
Kurzfassung: das ursprüngliche Schema war für Multi-Tenant-SaaS (viele Studios auf
einer Instanz, für eine inzwischen eingestellte Hosting-Plattform) ausgelegt.
Das tatsächliche Zielmodell ist "1 Server pro 1–3 Büros" — dafür ist PocketBase
(ein Binary, minimaler Ops-Aufwand) die passendere Wahl.

## Lizenz

GNU AGPL-3.0-or-later — identisch zur Rapport-App.
