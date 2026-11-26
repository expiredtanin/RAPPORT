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
- `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD` — Admin-Zugang für die PocketBase-Dashboard-UI (`/_/`) — Passwort mindestens 12 Zeichen; mit dem Platzhalter aus `.env.example` startet der Container nicht
- `RAPPORT_SETUP_TOKEN` (optional) — Einrichtungscode für das erste Konto und Büro. Leer lassen: der Container erzeugt beim ersten Start einen und schreibt ihn einmal ins Log (`docker compose logs pb | grep Einrichtungscode`; später: `docker compose exec pb cat /pb/pb_data/.setup-token`); die App fragt bei der Ersteinrichtung danach. So kann niemand den frisch gestarteten Server vor Ihnen übernehmen
- `API_EXTERNAL_URL` — die öffentliche URL, unter der PocketBase erreichbar sein wird (z.B. `https://api.rapport.studio.ch`) — für den Admin-Zugang und die Desktop-App; die Web-App im Container braucht sie nicht (siehe [Web-App und PocketBase-Adresse](#web-app-und-pocketbase-adresse))
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

### Web-App und PocketBase-Adresse

Regel: Das fertige App-Image (`rapport-app`, aus der Registry) funktioniert ohne Neubau. Die Web-App
spricht PocketBase standardmässig unter **ihrer eigenen Adresse** an: nginx im app-Container leitet
`/api/` an den pb-Container weiter ([nginx.conf](nginx.conf), Realtime ungepuffert, komprimiert), die
Content-Security-Policy erlaubt nur die eigene Adresse. Es ist also egal, ob die App unter
`http://192.168.1.50:8080`, `http://mac-mini.local:18080` oder `https://rapport.studio.ch` läuft — es
gibt nichts einzubrennen. Die Web-App ist fest auf diesen Server eingestellt (keine Wahl «Lokal»).

Das Image wird deshalb **ohne** Build-Argument gebaut (`docker build -f server/container/Dockerfile.app .`
aus der Repo-Wurzel; `POCKETBASE_URL` leer). Nur wer die App auf eine eigene API-Domain zeigen lassen
will, baut selbst: `APP_POCKETBASE_URL=https://api.rapport.studio.ch` in `.env`, dann
`docker compose --profile build build app` — die URL kommt dann in den Build und in die CSP.

Hinweis Rate-Limits: Über die Weiterleitung sieht PocketBase alle Anfragen von der IP des app-Containers
(Login 2 pro 3 s, Batch 3 pro s gelten dann für alle zusammen). Für den Bürobetrieb deshalb
`PB_TRUSTED_PROXY_HEADER=X-Forwarded-For` und `PB_BIND=127.0.0.1:` setzen (siehe unten).

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

In `.env` dann `API_EXTERNAL_URL=https://api.rapport.studio.ch` setzen. Die Web-App unter
`app.rapport.studio.ch` nutzt PocketBase trotzdem über ihre eigene Adresse (`/api/`, siehe oben); soll sie
direkt `api.rapport.studio.ch` ansprechen, `APP_POCKETBASE_URL` setzen und das App-Image selbst bauen.

Hinter einem Proxy sieht PocketBase nur dessen IP; die Rate-Limits (z.B. Login 2 pro 3 s)
gelten dann für alle Nutzer zusammen. Deshalb zusätzlich `PB_TRUSTED_PROXY_HEADER=X-Forwarded-For`
und `PB_BIND=127.0.0.1:` setzen (Port 8090 nur lokal, sonst liesse sich der Header fälschen).

Einfachere Variante mit nur einer Adresse (Standard der Web-App): der app-Container reicht `/api/`
an PocketBase weiter (komprimiert, Realtime ungepuffert). Dafür nur das Frontend veröffentlichen
(z.B. `https://rapport.studio.ch` → Port 8080) und dieselben zwei Variablen wie oben setzen; ein
Neubau des App-Images ist nicht nötig. PocketBase wertet den rechtesten Eintrag im Header aus:
das passt, solange vor PocketBase genau ein Proxy steht (Caddy → 8090 oder Browser → app-Container).
Bei zwei Proxys hintereinander (Caddy → app-Container → PocketBase) sähe es wieder nur Caddy.

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
docker compose stop pb
docker compose run --rm -T --no-deps --entrypoint tar pb -czf - -C / pb/pb_data > backup-$(date +%Y%m%d).tar.gz
docker compose start pb
```

PocketBase dafür kurz stoppen (wenige Sekunden): ein `tar` der laufenden Datenbank kann `data.db` und
`data.db-wal` aus verschiedenen Momenten erwischen — so ein Backup lässt sich unter Umständen nicht oder nur
ohne die letzten Änderungen zurückspielen. (Die Server-App macht es genauso.) Ohne Unterbruch: im Dashboard
`/_/` → **Settings → Backups** (konsistente ZIP-Sicherung, auch zeitgesteuert und auf S3).

Empfohlen: per `cron` täglich + auf externe Disk/S3/Backblaze sichern.
Rücksicherung: Container stoppen, Volume-Inhalt durch das Backup ersetzen (`tar -xzf - -C /` im Einmal-Container wie oben), neu starten.

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
