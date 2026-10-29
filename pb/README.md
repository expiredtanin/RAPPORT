# PocketBase-Backend

PocketBase-Backend für den Cloud-/Self-Host-Modus von Rapport: Schema-Migrationen
(`pb_migrations/`) und Hooks (`pb_hooks/`). Ein Binary statt des früheren
Supabase-Stacks mit sieben Docker-Services.

**Status: funktional vollständig, inkl. Multi-Studio-Features.**
Auth, Studios (mit Seed-Defaults), Settings, Invite-Flow, Personen-Sharing über
Studios hinweg, Passwort-Reset-Confirm-Flow und alle `data.*`-Entities der App
sind abgebildet (Personen, Projekte, Offerten, Rechnungen, Zeiterfassung, Spesen,
Mitarbeiter, Absenzen, Löhne, Protokolle, Lieferscheine, Pinnwand, Stammdaten,
Dokument-Design).

Im Repo:

| Ordner | Rolle |
|---|---|
| [`/`](../) | Desktop-/Web-Client |
| **`pb/`** *(dieser Ordner)* | **PocketBase-Schema und -Hooks** |
| [`server/container/`](../server/container/) | Docker-Compose-Stack: PocketBase (mit diesem Ordner) + Frontend |
| [`server/app/`](../server/app/) | Mac-Admin-App für den Server |

Ändert sich ein synchronisiertes Feld, gehören Mapper (`src/storage/pocketbase-mappers.ts`),
`src/types.ts` und eine **neue** Migration hier in denselben Commit; bestehende
Migrationen werden nie bearbeitet.

## Setup

Binary ist nicht committed (`.gitignore`). Laden:

```bash
curl -sL -o pocketbase.zip \
  https://github.com/pocketbase/pocketbase/releases/download/v0.39.11/pocketbase_0.39.11_darwin_arm64.zip
unzip pocketbase.zip && rm pocketbase.zip && chmod +x pocketbase
```

(Für Linux-Server: `_linux_amd64.zip` statt `_darwin_arm64.zip` von derselben Release-Seite.)

## Entwicklung

```bash
./pocketbase serve
```

Startet auf `http://127.0.0.1:8090`. Admin-UI unter `/_/` — beim ersten Start nach
Superuser-Account fragen (`./pocketbase superuser create <email> <password>`).

Migrationen in `pb_migrations/` werden beim Start automatisch angewendet. Neue
Schema-Änderungen: entweder per Admin-UI machen und "Sync Collection" → Migration
exportieren lassen, oder Migration direkt in `pb_migrations/` schreiben.

Custom-Endpoints (Studio-Anlage, öffentliche Studio-Liste) liegen in `pb_hooks/`
(JS, PocketBase-eigene JSVM — kein Go-Toolchain nötig).

## Struktur

```
pb_hooks/          # Custom-API-Routen (JS)
pb_migrations/      # Schema-Migrationen (JS, PocketBase-Format)
pb_data/             # Runtime: SQLite + File-Storage (gitignored)
```
