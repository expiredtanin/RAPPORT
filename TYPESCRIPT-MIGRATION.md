# TypeScript-Migration & Dokumentation

Ziel: RAPPORT soll auch **ohne AI-Unterstützung** weiterentwickelt werden können — von Karim in einem Jahr oder von einer anderen Person. Die Migration ist der Moment, den Code zu erklären: Wer eine Datei anfasst, um Typen zu ergänzen, muss sie ohnehin verstehen und kann das Verständnis gleich festhalten.

**Status: Umstellung abgeschlossen (alle Dateien unter `src/` sind TypeScript).** `npm run typecheck` und `npm run build` laufen sauber. Offen sind die Punkte unter «Nachlauf» ganz unten.

---

## Leitregeln

1. **Eine Datei pro Schritt, ein Commit pro Datei** (`refactor(ts): utils.js → utils.ts`). Reine Umbenennung + Typen, **keine Verhaltensänderung**. So lässt sich jeder Schritt einzeln prüfen und zurückdrehen.
2. **Nach jedem Schritt:** `npm run typecheck`, `npm run lint`, `npm run build`, dann die betroffene View in `npx tauri dev` einmal durchklicken. Es gibt keine Tests; das ist die Verifikation.
3. **Kein `any` als Ausweg.** Ist ein Typ unklar: `unknown` und eingrenzen, oder ein `// TODO(types): …` mit Grund. `// @ts-expect-error` nur mit Erklärung.
4. **Typen zuerst locker, dann enger.** Unions für Status-Felder (`"entwurf" | "gesendet" | …`) erst einführen, wenn klar ist, welche Werte wirklich in alten Daten vorkommen.
5. **Datenmodell ändern = `types.ts` + `defaultData` + Migration in `storage/migrations.js` zusammen ändern.** Das gehört später in die Doku (siehe unten).

## Dokumentationsstandard (gilt für jede angefasste Datei)

Das wird beim Umwandeln gleich mitgemacht, nicht nachträglich:

- **Dateikopf (3–8 Zeilen):** Wofür ist die Datei da, was sie *nicht* tut, wer sie benutzt, wo der Einstieg ist.
- **JSDoc/TSDoc auf jeder exportierten Funktion:** Eine Zeile Zweck, dazu Besonderheiten. Beispiele: Rundungsregeln (5-Rappen), MWST-Logik, Einheiten (Minuten vs. Stunden), Zeitzonen, Format von Nummern.
- **Das «Warum» in Kommentaren,** nicht das «Was». Besonders bei Schweizer Fachlogik (QR-Rechnung, AHV/ALV/BVG, SIA-Phasen, Feiertage), Workarounds und historischen Eigenheiten.
- **Felder in `types.ts`** bekommen Kommentare, wenn Einheit, Format oder Herkunft nicht offensichtlich sind (`/** Minuten, nicht Stunden */`).
- **Keine Kommentare, die nur den Code wiederholen.**
- **Offene Fragen** als `// FIXME(karim): …` oder `// TODO(types): …`, damit sie mit grep auffindbar sind.

## Phasen

### Phase 0 — Vorbereitung
- Offene Änderungen (12 Dateien, `scripts/marketing-shots/`) committen oder wegräumen, bevor die Migration beginnt.
- `eslint.config.js` um TS erweitern (`typescript-eslint`), damit `npm run lint` auch `.ts`/`.tsx` prüft.
- `src/vite-env.d.ts` ergänzen (Vite-Client-Typen).

### Phase 1 — Fundament (klein, hoher Nutzen)
| Datei | Zeilen | Besonderheit |
|---|---|---|
| `constants.js` → `.ts` | 265 | `defaultData: AppData`, Konstanten mit `as const`. Prüft, ob `types.ts` zu den Defaults passt. |
| `storage/migrations.js` → `.ts` | 86 | Eingabe ist `unknown` bzw. alte Formen. Jede Migration kommentieren: von welcher Version, warum. |
| `utils/updater.js`, `ocr.js` | 48 / 154 | Kleine, isolierte Module. |

### Phase 2 — Logik
| Datei | Zeilen | Besonderheit |
|---|---|---|
| `utils.js` → `.ts` | 715 | Kernstück. Jede Funktion bekommt TSDoc. Dabei entsteht der Inhalt für ARCHITECTURE §6. |
| `storage/adapter.js` | 146 | Gemeinsames Interface `StorageAdapter` definieren (Local, PocketBase). |
| `storage/pocketbase-mappers.js` | 651 | Typen für PocketBase-Records; Mapping `Record ↔ AppData` explizit dokumentieren. |
| `storage/pocketbase-adapter.js` | 602 | Sync-Verhalten, Fehlerfälle, Konfliktregeln in Kommentaren festhalten. |

### Phase 3 — Gemeinsame UI
- `components/UI.jsx` (555) → `.tsx`: Props-Typen für `Modal`, Buttons, Pills usw. Props-Interface gleichzeitig als Doku nutzen.
- `components/UpdatesSupport.jsx`, `UpdateNotifier.jsx`.
- Gemeinsamen `ViewProps`-Typ in `types.ts` definieren (`data`, `update`, `saveAll`, `modal`, `setModal`, `currentUser`, …). Alle Views benutzen ihn.

### Phase 4 — Views (nach Grösse, kleine zuerst)
Reihenfolge: `ResetPassword`, `Letters`, `BackendChoice`, `Documents`, `MigrationScreen`, `CloudSetup`, `Contracts`, `DeliveryNotes`, `Payroll`, `Accounting`, `Login`, `Setup`, `Pinboard`, `Quotes`, `Dashboard`, `StudioBudget`, `DataImport`, `Expenses`, `Protocols`, `Persons`, `Settings`, `Employees`, `Invoices`, `Time`, `Projects`.

Pro View: Dateikopf, `Props`-Interface, lokale Typen, offene Stolperfallen als Kommentar. Grosse Views (>1000 Zeilen) können in mehreren Commits umgestellt werden; dort lohnt sich auch ein Aufteilen in Unterkomponenten, aber **erst nach** der Typisierung, nicht gleichzeitig.

### Phase 5 — Zum Schluss
- `print/PrintComponents.jsx` (1821): grösster Brocken, hängt an Invoice/Quote/Protocol-Typen.
- `App.jsx` (1093): hält den ganzen State; mit allen Typen im Rücken zuletzt.
- `main.jsx`, `index.html` prüfen.
- `checkJs`/`allowJs` ausschalten, sobald keine `.js`-Dateien mehr übrig sind.

## Doku, die parallel entsteht

Für Entwickler ohne AI sind diese Dokumente wichtiger als jede Typannotation:

| Dokument | Inhalt | Wann |
|---|---|---|
| `ARCHITECTURE.md` | Anpassen: TS-Struktur, §6 `utils` mit echter API, §11 Konventionen, §12 Schwachstellen | Laufend, am Ende jeder Phase |
| `CONTRIBUTING.md` (neu) | Setup in 5 Minuten, Befehle, Commit-Stil, wie man eine View/ein Feld hinzufügt, Verifikations-Checkliste | Phase 1 |
| `docs/DATENMODELL.md` (neu) | Alle Entitäten, Beziehungen (`clientId`, `projectId`…), Nummernformate, Migrationsregeln | Phase 2 |
| `docs/FACHLOGIK.md` (neu) | Schweizer Besonderheiten: QR-Rechnung, MWST, Lohnabzüge, SIA-Phasen, Feiertage, Rundungen | Phase 2–4, jeweils beim Anfassen |
| `docs/RELEASE.md` | Release-Ablauf als Checkliste (steht schon in ARCHITECTURE §9/§10; hier ausformuliert) | Phase 5 |
| `CLAUDE.md` | «Kein TypeScript»-Regel streichen, `typecheck` ergänzen, Dokumentationsstandard verlinken | Sofort mit Phase 1 |

## Risiken

- **Alte Daten passen nicht zu den Typen.** `localStorage` und PocketBase enthalten Datensätze aus älteren Versionen. Typen deshalb eher locker halten und Migrationen zur Stelle der Wahrheit machen.
- **Grosse Views** produzieren viele Fehler auf einmal. Deshalb Unterteilen in kleine Commits und vorher die View durchklicken.
- **Kein Test-Netz.** Typen fangen Tippfehler und Form-Fehler, aber keine Logikfehler. Bei `utils.ts` (Rechnungsbeträge, Lohn) lohnt sich später eine kleine Testsuite. Das ist eine separate Entscheidung.
- **Release-Pipeline:** Nach Phase 2 und am Ende einmal `npx tauri build` probehalber ausführen (ohne Release).

## Definition of Done

- Keine `.js`/`.jsx` mehr in `src/`.
- `npm run typecheck`, `npm run lint`, `npm run build` laufen sauber.
- Jede Datei hat einen Dateikopf, jede exportierte Funktion einen Doc-Kommentar.
- ARCHITECTURE, CONTRIBUTING, DATENMODELL und FACHLOGIK sind aktuell.

---

## Nachlauf (nach der Umstellung)

Beim Umstellen bewusst *nicht* erledigt, weil es Verhalten oder Struktur ändern würde:

- **ESLint-Altlasten:** ca. 195 Meldungen (vor der Migration waren es 221). Hauptsächlich `react-hooks/static-components` (Komponenten, die innerhalb von Komponenten definiert werden, z.B. `SortTh`, `TB`, `LohnRow`) und ungenutzte Variablen. Aufräumen = Komponenten nach aussen ziehen; das ändert Struktur, daher eigener Schritt.
- **Lose Typen:** Status-Felder sind `string`, viele Felder optional (alte Datensätze). Verschärfen, sobald die Migrationen vollständig dokumentiert sind.
- **Casts mit Begründung:** `as` kommt an Stellen vor, wo Formulare Teilobjekte halten (`Partial<…>`) oder Daten aus dem untypisierten PocketBase kommen. Die Alternative wäre ein Umbau der Formulare.
- **Markierte Auffälligkeiten (FIXME im Code):** `BackendChoice` liest noch `VITE_SUPABASE_URL`; `Setup` legt Mitarbeiter mit `aktiv` statt `active` an; `FormField` ignoriert die übergebene `style`-Prop; `calcSIAHours` liefert `NaN` ohne Schwierigkeitsgrad.
- **Noch zu schreiben:** `docs/DATENMODELL.md` und `docs/FACHLOGIK.md` (Plan oben). Die Fachlogik ist inzwischen in den Doc-Kommentaren von `utils.ts` und den Dateiköpfen der Views dokumentiert; die Dokumente können daraus zusammengestellt werden.
- **Keine Tests:** weiterhin offen; `utils.ts` (Beträge, Lohn, SIA) wäre der sinnvolle Anfang.
