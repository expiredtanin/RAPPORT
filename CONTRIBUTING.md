# Mitarbeiten an RAPPORT

Dieses Dokument richtet sich an Entwickler, die RAPPORT ohne Vorwissen übernehmen. Die Architektur steht in [ARCHITECTURE.md](ARCHITECTURE.md), die laufende Umstellung auf TypeScript in [TYPESCRIPT-MIGRATION.md](TYPESCRIPT-MIGRATION.md).

## Setup (ca. 5 Minuten)

Voraussetzungen: Node ≥ 20. Für die native App zusätzlich Rust ≥ 1.77.2 und die Tauri-Voraussetzungen für dein Betriebssystem.

```bash
npm install
npm run dev        # Browser-Version auf http://localhost:5173
npx tauri dev      # native App mit Hot-Reload
```

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run typecheck` | TypeScript-Prüfung (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm test` | Vitest (`*.test.ts` neben dem Code) |
| `npm run build` | Frontend-Build nach `dist/` |
| `npx tauri build` | Vollständiges App-Bundle |

Tests laufen mit `npm test` (Vitest); die GitHub-Action `.github/workflows/check.yml` prüft jeden Push mit `typecheck`, `lint`, `test` und `build`. Vor jedem Commit trotzdem lokal mindestens `typecheck`, `lint`, `test`, `build` ausführen und die geänderte Ansicht im Browser oder in `tauri dev` durchklicken.

## Wo liegt was?

- **State und Persistenz:** alles in `src/App.tsx`. Views bekommen den State als Props (`data`, `update`, `saveAll`, …). Es gibt keinen Context und kein Redux.
- **Datenmodell:** Typen in `src/types.ts`, Startwerte in `src/constants.ts` (`defaultData`), Migrationen in `src/storage/migrations.ts`.
- **Logik:** `src/utils.ts` (Berechnungen, Formate, QR-Rechnung).
- **Speicher:** `src/storage/` (localStorage und PocketBase).
- **Views:** `src/views/`, werden in `App.tsx` per `React.lazy()` geladen.
- **Druck/PDF:** `src/print/`.

## Konventionen

- UI-Texte auf Deutsch, Code-Bezeichner auf Englisch.
- Inline-Styles und die globalen Klassen aus `App.tsx` (`.btn`, `.card`, `.pill`, `.modal`). Farben nur über CSS-Variablen (`--bg`, `--text`, …), damit der Dark Mode funktioniert.
- Relative Imports ohne Pfad-Aliase. Für bereits migrierte Module ohne Dateiendung importieren (`"../constants"`).
- Neue `localStorage`-Keys brauchen das Präfix `rapport_` und einen Eintrag in ARCHITECTURE §4.

## Kommentare und Typen

- Jede Datei hat einen Dateikopf: Zweck, was sie nicht tut, Einstiegspunkte.
- Exportierte Funktionen haben einen Doc-Kommentar mit Zweck und Besonderheiten (Einheiten, Rundung, Formate).
- Kommentare erklären das **Warum**, besonders bei Schweizer Fachlogik.
- Kein `any`. Bei Unklarheit `unknown` verwenden und eingrenzen, oder `// TODO(types): …` mit Grund.

## Typische Aufgaben

**Neues Feld im Datenmodell**
1. Feld in `src/types.ts` ergänzen (optional, wenn alte Datensätze es nicht haben).
2. Startwert in `defaultData` (`src/constants.ts`) ergänzen.
3. Wenn bestehende Daten betroffen sind: Migration in `src/storage/migrations.ts`.
4. Bei PocketBase: Mapper in `src/storage/pocketbase-mappers.ts` und Schema im PocketBase-Admin anpassen.

**Neue Ansicht**
1. Datei in `src/views/` anlegen, Props-Muster wie bei den bestehenden Views.
2. In `App.tsx` per `React.lazy()` einbinden.
3. Eintrag in `NAV_ITEMS` (`src/constants.ts`); die `id` ist zugleich die Berechtigungs-Id.
4. ARCHITECTURE §5 ergänzen.

## Releases

Nicht nebenbei. Der Ablauf (Versionen in drei Dateien, Signatur, Changelog, Upload, `latest.json`) steht in ARCHITECTURE §9 und §10.
