# Marketing-Screenshots

Erzeugt die Screenshots für die **Feature-Seiten** von
[rapport.gabrielevarano.ch](https://rapport.gabrielevarano.ch) mit fiktiven
Demo-Daten und legt sie direkt nach
`../RAPPORT-WEBSITE/static/images/screenshots/`.

Vier Bilder: `projekt-detail.png`, `zeiterfassung.png`, `rechnungen.png`,
`chain-qr-detail.png`. Die Startseite braucht keine — siehe unten.

```bash
npm run dev                              # Vite auf :3000 muss laufen
node scripts/marketing-shots/shoot.mjs
```

Läuft in einem frischen Chromium-Profil; die Demo-Daten kommen per
`addInitScript` in dessen `localStorage`. **Die echten Daten in der App und im
eigenen Browser werden nicht angefasst.**

## Warum das nicht einfach «ein paar Screenshots» sind

`demo-data.mjs` ist so gebaut, dass die Zahlen einer fachlichen Prüfung
standhalten — Website-Besucher aus Architekturbüros sehen sofort, wenn Werte
unplausibel sind:

- **Leitprojekt Limmatfeld** trägt die ganze Kette Offerte → Projekt → Zeit →
  Kontrolle → Akonto → Schluss. Alle Screenshots zeigen dasselbe Projekt.
- **Phasen werden der Reihe nach abgearbeitet**, abgeschlossene liegen bei
  93–114 % ihres Budgets, die laufende bei 50 %, die letzte bei 0 %.
- **Honorar stammt aus der echten SIA-102-Formel der App**
  (`calcSIAHours`, Baukosten 650'000 → 1197.1 h → CHF 185'550.50). Die
  Phasenbudgets leitet die App selbst aus der verknüpften Offerte ab.
- **Rechnungen summieren sich auf**: Hardau 30 % + 40 % + 30 % = 96'000.
- Drei Offerten in drei Modi (SIA 102 / Aufwand / Freie Positionen).

`report()` gibt diese Kontrollrechnung vor jedem Lauf aus — bitte anschauen.

## Fallstricke (alle schon mal reingelaufen)

| Problem | Lösung im Skript |
|---|---|
| Wochenansicht leer | Alle Daten **relativ zum Montag dieser Woche** (`dateAt`). Fixe Daten veralten. |
| `page.goto` läuft in den Timeout | Nicht `waitUntil: "networkidle"` — Vites HMR-WebSocket bleibt offen. `domcontentloaded` + `waitForSelector`. |
| UI-Elemente angeschnitten | Keine festen Pixel-`clip`s. Crops über DOM-Bounding-Boxes (`boxOfTexts`, `rowShot`). |
| Unterer Teil fehlt | Für Elemente ausserhalb des Viewports `locator.screenshot()` — scrollt selbst. |
| Phasen zeigen Anteile statt Budget-% | Projekt braucht `phasesBudget` oder eine verknüpfte Offerte. |
| Belegnummer passt nicht zum Datum | `docNo()` leitet das Jahr aus dem Datum ab. Nummern **nicht** im Skript hartcodieren. |

## Nicht alles ist ein Bild

Die Kette **«Der Weg eines Projekts»** auf der Startseite ist komplett
**nachgebautes HTML**, kein einziger Screenshot: Offertenregister,
Projekt-Kennzahlen, Wochenraster, Phasenbudget, Rechnungs-Kennzahlen und
Rechnungsliste. Das war vorher gemischt — vier PNGs und eine HTML-Karte — und
man sah es: unterschiedliche Schärfe, Light-Mode-Bilder auf dunklem Grund,
angeschnittene Zeilen auf dem Handy.

Das Markup steht in `../RAPPORT-WEBSITE/content/_index.md`, die Stile unter
«APP-OBERFLÄCHEN ALS ECHTES HTML» in `assets/css/custom.css`. **Farben und
Schwellen sind 1:1 aus der App kopiert** — bei Änderungen dort mitziehen:

| Was | Quelle in der App |
|---|---|
| Status-Pillen (`gesendet`, `bezahlt`, …) | `src/constants.js` — `STATUS_COLORS` / `STATUS_BG` |
| KPI-Akzentfarben | `src/views/Projects.jsx`, `src/views/Invoices.jsx` |
| Rechnungsart-Tags (Akonto / Teil / Schluss) | `src/views/Invoices.jsx` — `kindColor` |
| Blockfarbe im Wochenraster | `src/views/Time.jsx` — `PROJ_COLORS[0]` |
| Phasenschwellen (≥100 % rot, ≥80 % orange, sonst grün) | `src/views/Projects.jsx` |

Die **Zahlen** dort stammen aus denselben Demo-Daten wie die Screenshots —
`report()` unten ist also auch für die Startseite die Kontrollrechnung.
Jahreszahlen und Wochentage rechnet Hugo aus `now` (`layouts/_shortcodes/yr.html`
und `wd.html`), damit die Belege nicht still veralten.
