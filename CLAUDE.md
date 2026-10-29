# Anweisungen für Claude

Dieses Dokument wird in **jede** Claude-Session automatisch geladen. Es ist die kürzeste Form: Was du wissen musst und was du tun/lassen sollst. Details stehen in [ARCHITECTURE.md](ARCHITECTURE.md) — **lies sie, bevor du nicht-triviale Änderungen machst.**

---

## Was das Projekt ist

**RAPPORT** — Tauri 2.x Desktop-App für Architekturbüros. React 19 mit TypeScript (Migration abgeschlossen, siehe [TYPESCRIPT-MIGRATION.md](TYPESCRIPT-MIGRATION.md)), minimaler Rust-Backend (System-Tray + Updater, keine Tauri-Commands). Solo-Dev: Karim. Daten leben standardmässig in `localStorage` unter Key `studio_data_v1`; optional in einem Datenordner (Desktop, z.B. iCloud) oder in PocketBase — alles über den Storage-Adapter. macOS Apple Silicon ist die primäre Plattform.

Architektur in einem Satz: **App.tsx hält (über `hooks/useStudioData`) den gesamten State, übergibt ihn an lazy-geladene Views als Props, persistiert über den Storage-Adapter (localStorage, Datenordner oder PocketBase). Rust macht nur Tray + Update (plus fs/dialog-Plugins für den Datenordner).**

→ Vollständige Karte: [ARCHITECTURE.md](ARCHITECTURE.md)

Im selben Repo liegen auch der Server: [server/container/](server/container/) (Docker Compose mit PocketBase + Frontend, baut aus `pb/` und der App) und [server/app/](server/app/) (eigene Tauri-Mac-App zur Verwaltung des Stacks, eigene [ARCHITECTURE.md](server/app/ARCHITECTURE.md), eigene Version und eigener Updater). Die Regeln hier gelten für die App; für `server/app/` gilt sinngemäss dasselbe (keine Releases auf eigene Faust).

---

## Befehle

```bash
npm run dev          # Vite-Server auf http://localhost:5173
npx tauri dev        # Native App-Window mit HMR (für UI-Verifikation)
npm run lint         # ESLint (js/jsx und ts/tsx)
npm run typecheck    # tsc --noEmit
npm test             # Vitest (*.test.ts neben dem Code)
npm run build        # Frontend-Build (dist/)
npx tauri build      # Vollständiges App-Bundle
./scripts/release.sh # Release-Build mit Signatur — NUR auf explizite Anweisung
```

Tests gibt es mit Vitest (`npm test`, Dateien `*.test.ts` neben dem Code) für Rechenlogik und Speicher; keine CI, kein Pre-Commit-Hook. `typecheck`, `lint`, `test` und `build` sind das Minimum, für UI zusätzlich Augenschein.

---

## Sprache

- **Antworte auf Deutsch.** Karim arbeitet auf Deutsch.
- **UI-Strings im Code: Deutsch** ("Zeiterfassung", "Buchhaltung", "Beenden").
- **Code-Identifier: Englisch** (`setView`, `currentUser`, `isQuitting`).

---

## Vor jeder Änderung — die drei Reflexe

1. **Wenn es um Daten/State geht** → schau in [hooks/useStudioData.ts](src/hooks/useStudioData.ts) (State, Laden, `save()`, `update()`, Realtime) und [App.tsx](src/App.tsx) (Login). Kein Zustand existiert ausserhalb davon.
2. **Wenn es um Logik geht** (Kalkulation, Format, Hash, QR-Bill) → schau in [utils.ts](src/utils.ts). Dort sind isolierte Funktionen — wahrscheinlich gibt es schon eine.
3. **Wenn es um das Datenmodell geht** → schau in [constants.ts](src/constants.ts) (`defaultData` ist die Shape-Referenz).

---

## Tu — Konventionen die hier gelten

- **Inline-Styles** (`style={{}}`) sind etabliert. Keine Tailwind-Vorschläge, keine CSS-Module einführen, ohne dass Karim das initiiert.
- **Globale Klassen** (`.btn`, `.card`, `.pill`, `.modal`, `.filter-bar`) sind in [styles/global.css](src/styles/global.css) definiert — nutze sie statt eigene zu erfinden.
- **CSS-Variablen** für Theming (`--bg`, `--text`, `--border`, …). Dark Mode ist `data-theme="dark"` am Root. Niemals harte Farben einbauen, ohne CSS-Variable zu prüfen.
- **Lazy-Loaded Views** — neue Top-Level-Screens in [App.tsx](src/App.tsx) mit `React.lazy()` einbinden, nicht direkt importieren.
- **Props-Pattern:** Views bekommen `{ data, update, saveAll, modal, setModal, currentUser, … }`. Kein Context, kein Redux. Wenn du State teilst, mach es über `data` oder hebe ihn in App.tsx.
- **`update(key, value)`** für Top-Level-Field-Updates, **`saveAll(newData)`** für atomare Multi-Field-Updates.
- **Relative Imports** (`../utils`; bei migrierten Modulen ohne Endung), keine Pfad-Aliase.
- **Deutsch in UI-Strings**, auch in neuen Features.

---

## Lass — Stolperfallen

- **TypeScript:** Alles unter `src/` ist `.ts`/`.tsx`. Kein `any` (Ausnahmen mit Begründung im Code, z.B. `ImportRecord` in DataImport, `PrintContent`). Jede Datei hat einen Dateikopf, exportierte Funktionen Doc-Kommentare (Standard in [TYPESCRIPT-MIGRATION.md](TYPESCRIPT-MIGRATION.md)). Datenmodell-Typen liegen in [types.ts](src/types.ts); vor Commits `npm run typecheck`.
- **Tests:** Wer Rechenlogik (`utils.ts`, Rechnungssummen, Lohn) oder den Speicher ändert, ergänzt den passenden `*.test.ts`. Kein weiteres Test-Framework (Cypress, Jest) ohne Karim.
- **Keine Context-/Redux-/Zustand-Provider hinzufügen** — das Single-Root-State-Pattern ist bewusst.
- **Keine Tauri-Commands (`#[tauri::command]`) erfinden**, ohne mit Karim zu klären. Die Architektur ist absichtlich Frontend-zentriert.
- **Cloud-Schema liegt in [pb/](pb/)** (PocketBase-Migrationen und Hooks). Ändert sich ein Feld, das synchronisiert wird, gehören Mapper (`pocketbase-mappers.ts`), `types.ts` und eine **neue** Migration unter `pb/pb_migrations/` in denselben Commit. Bestehende Migrationen nie bearbeiten. Niemals `pb/pb_data/` oder das `pocketbase`-Binary einchecken.
- **Keine neuen `localStorage`-Keys** erfinden, ohne `rapport_`-Prefix und Eintragung in [ARCHITECTURE.md §4](ARCHITECTURE.md).
- **Niemals Tests/Lint mit `--no-verify` umgehen** — wenn ein Pre-Commit-Hook fehlt, fehlt er aus Absicht; wenn einer da ist, ist das Karims Entscheidung.
- **Genau ein Speicher pro Installation** (`rapport_backend`: local, file, cloud), immer nur über [storage/adapter.ts](src/storage/adapter.ts) — keine parallele Persistierung daneben (IndexedDB, Tauri AppData). Der Datenordner (`file-adapter.ts`, «Rapport-Ordner») ist der dritte Adapter und der Standard für Einzelplatz in der Desktop-App, kein Nebenweg; Anhänge liegen dort als Dateien unter `Dateien/` (`file-assets.ts`). Details in [ARCHITECTURE.md §3](ARCHITECTURE.md).

---

## Releases — heißes Eisen

**Mach niemals einen Release auf eigene Faust.** Auch nicht "halb" (kein Versions-Bump, kein `release.sh`, kein Tag, kein `latest.json`-Edit), es sei denn Karim sagt es explizit.

Wenn ein Release gewünscht ist, denke an:
- Version in **drei** Dateien synchron: [package.json](package.json), [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/Cargo.toml](src-tauri/Cargo.toml). `release.sh` prüft Cargo.toml **nicht** — du musst manuell.
- Changelog-Entry in [changelog.ts](src/changelog.ts) (`CHANGELOGS`) und `LATEST_VERSION` dort anheben (steuert auch Sidebar, Login-Fusszeile und `rapport_changelog_seen`).
- `release.sh` braucht `~/.tauri/rapport_updater.key` — wenn fehlt, abbrechen, nicht generieren.
- Asset-Upload auf Gitea und `latest.json`-Commit sind **manuelle** Schritte.

Details: [ARCHITECTURE.md §9 + §10](ARCHITECTURE.md).

---

## UI-Verifikation

Wenn du Frontend-Änderungen machst, die optisch wirken, **starte `npx tauri dev`** und schau, ob es funktioniert. ESLint und Type-Checking gibt es hier nicht — also ist Augenschein die Verifikation. Wenn du es nicht selbst öffnen kannst, sag das explizit, anstatt "fertig" zu melden.

---

## Wenn du etwas Neues findest

Wenn du beim Arbeiten merkst, dass [ARCHITECTURE.md](ARCHITECTURE.md) falsch oder veraltet ist (z.B. neue Views, neue Konventionen, Refactor): **update sie im selben Commit**. Sie ist die Karte — wenn sie verrottet, war die Mühe umsonst.

Wenn du eine wiederkehrende Anweisung von Karim bekommst, die hier fehlt: schlag vor, sie in CLAUDE.md zu ergänzen.
