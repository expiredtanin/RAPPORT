// Versionshistorie für den «Changelog»-Dialog (InfoModals.tsx). Neuester Eintrag zuerst;
// jeder Eintrag ist eine Liste aus [Titel, Beschreibung]-Paaren (Deutsch, für Endnutzer).
//
// Bei einem Release: Eintrag oben ergänzen UND LATEST_VERSION anheben. Weil LATEST_VERSION
// auch als Wert von `rapport_changelog_seen` im localStorage dient, zeigt die App den Dialog
// nach dem Update einmal automatisch. Die Version in package.json, tauri.conf.json und
// Cargo.toml muss separat synchron gehalten werden (siehe ARCHITECTURE.md §9/§10).

/** Aktuelle App-Version, wie sie in Sidebar, «Über Rapport» und Changelog angezeigt wird. */
export const LATEST_VERSION = "0.8.3";

export const CHANGELOGS: Record<string, { items: string[][] }> = {
  "0.8.3": {
    items: [
      ["Desktop-App-Verhalten", "Kein Text mehr markierbar, kein Rechtsklick-Menü — die App verhält sich jetzt wie eine native Desktop-Applikation. Eingabefelder sind weiterhin voll benutzbar."],
      ["PWA-Support", "Die Web-Version lässt sich auf dem Homebildschirm von iPhone/iPad und Android hinzufügen. Nach dem Hinzufügen öffnet sie sich vollbild ohne Browser-Chrome — mit eigenem App-Icon und Name."],
      ["Testmodus klar gekennzeichnet", "Wer Rapport ohne Server ausprobiert, sieht jetzt explizit, dass es sich um einen Testmodus mit Einschränkungen handelt (5 MB Limit, kein Backup, kein Mehrbenutzer)."],
    ],
  },
  "0.8.2": {
    items: [
      ["Selbstheilung für hängende 0.8.0-Installationen", "Wer von 0.7 auf 0.8 geupdated hat und in den Cloud-Setup-Wizard geschoben wurde, kommt mit 0.8.2 automatisch zurück in seinen Lokal-Modus. Der Auto-Recovery-Code erkennt: Cloud-Modus gesetzt + lokale Daten vorhanden + keine Cloud-Anmeldung → Cloud-Konfiguration wird zurückgenommen, alle Daten bleiben erhalten."],
      ["Auto-Update auch ohne Login", "Bisher prüfte Rapport erst nach dem Login auf Updates — wer in einem fehlerhaften Setup-Bildschirm hing, kam nicht an den Bugfix. Jetzt läuft der Update-Check auch im «Lokal oder Cloud»-Wizard, im Login-Screen und im Cloud-Setup."],
      ["Tauri ohne fest eingebaute Server-IP", "Die Desktop-App enthält keine vorkonfigurierte Cloud-Adresse mehr. Wer Cloud nutzen will, gibt die Server-Adresse beim Login aktiv ein — kein automatisches Vorausfüllen mit irrelevanten IPs."],
    ],
  },
  "0.8.1": {
    items: [
      ["Update-Fix", "Behebt einen Fehler beim Upgrade von 0.7 auf 0.8: Lokal-Installationen wurden ungewollt in den Cloud-Modus geschoben und der Cloud-Setup-Wizard angezeigt, obwohl bereits lokale Daten vorhanden waren. Die App prüft jetzt vor einem automatischen Modus-Wechsel, ob lokale Daten existieren — und in Tauri-Installationen wird der Modus nie implizit gesetzt."],
    ],
  },
  "0.8": {
    items: [
      ["Cloud-Variante", "Rapport kann jetzt nicht nur lokal, sondern auch auf einem eigenen Server (Supabase) laufen. Beim ersten Öffnen wählt man «Lokal» oder «Cloud»; beide Modi haben dieselben Funktionen, Cloud zusätzlich Multi-User und Live-Sync zwischen Geräten."],
      ["Erst-Einrichtung als Wizard", "Cloud-Einrichtung als 3-Schritt-Assistent: Studio-Stammdaten, Admin-Account, optionale Buchhaltungsdaten (IBAN, MwSt, Stundensatz). Adresse und Bankverbindung sind optional und können später ergänzt werden."],
      ["Multi-Studio", "Ein Account kann mehrere Studios verwalten. Beim Anlegen eines neuen Studios lassen sich Personen (Kunden & Partner) aus bestehenden Studios übernehmen — Änderungen sind dann für alle verlinkten Studios sichtbar."],
      ["Live-Sync zwischen Browsern", "Änderungen in einem Browser (z.B. neue Pinnwand-Notiz) erscheinen in allen anderen offenen Rapport-Tabs ohne Reload. Funktioniert über Postgres-Realtime."],
      ["Mitarbeiter einladen", "Admins können Mitarbeiter direkt in den Einstellungen einladen: Email + Anzeigename + App-Rolle + temporäres Passwort. Eingeladene erhalten Zugangsdaten zum sofortigen Login."],
      ["Passwort-Reset", "Im Cloud-Modus gibt es einen «Passwort vergessen?»-Link auf der Anmeldeseite. Mit der hinterlegten Email wird ein Reset-Link per Mail verschickt."],
      ["Web-Version", "Wer keine Desktop-App installieren möchte, kann Rapport im Browser unter der Studio-Adresse nutzen (z.B. app.rapport.kgva.ch). Identische UI, gleiches Backend, kein Tauri nötig."],
      ["Sichere Datenhaltung pro Studio", "Daten verschiedener Studios sind auf Datenbank-Ebene strikt getrennt (Row-Level-Security). Kein Studio sieht je die Daten eines anderen."],
      ["Persönliche Zugangsdaten via Email", "Cloud-Anmeldung mit Email + Passwort (statt Benutzername). Lokal-Modus weiter wie gehabt mit Benutzername + Passwort."],
    ],
  },
  "0.7": {
    items: [
      ["Automatische Updates", "Rapport prüft beim Start, ob eine neue Version unter git.kgva.ch verfügbar ist, und installiert sie auf Knopfdruck — kein manuelles DMG-Download mehr nötig. Updates lassen sich überspringen oder verschieben; Pakete werden vor der Installation per Signaturprüfung verifiziert."],
      ["System-Tray-Icon", "Rapport läuft im Hintergrund weiter, wenn das Fenster geschlossen wird, und ist über ein Menüleisten-Icon erreichbar. Schnellzugriff auf Dashboard, Zeiterfassung, Projekte und Buchhaltung; Cmd+Q beendet die App vollständig."],
      ["Einstellungen: Updates & Support", "Neuer Tab «Updates & Support» mit manueller Update-Suche, Zeitstempel der letzten Prüfung und Link zur Dokumentation auf rapport.kgva.ch."],
    ],
  },
  "0.6": {
    items: [
      ["Sicherheit: Passwort-Hashing", "Passwörter werden jetzt mit PBKDF2 (SHA-256, 100 000 Iterationen) und einem zufälligen Salt gespeichert. Bestehende Klartext-Passwörter werden beim ersten erfolgreichen Login transparent migriert."],
      ["Login: Brute-Force-Schutz", "Nach 5 Fehlversuchen wird der Login für 60 Sekunden gesperrt — mit sichtbarem Countdown. Passwortvergleich erfolgt in konstanter Zeit, Mindestlänge bei der Einrichtung auf 8 Zeichen erhöht."],
      ["Briefe: HTML-Sanitizer", "Brieftexte werden vor dem Druck durch einen Allowlist-Sanitizer geleitet. Script-Tags, javascript:-URLs und on*-Handler werden entfernt — externe Links bekommen automatisch rel=\"noopener noreferrer\"."],
      ["Datenexport ohne Klartext-Passwörter", "Beim Sichern der Daten werden Legacy-Klartext-Passwörter entfernt; nur die nicht umkehrbaren PBKDF2-Hashes bleiben im Backup."],
      ["Belege direkt in der Zeiterfassung", "Spesenbelege (Bild oder PDF) können jetzt direkt aus der Tagesansicht hochgeladen und angezeigt werden. Bilder werden vor dem Speichern auf 1600 px skaliert und JPEG-komprimiert."],
      ["Avatar-Upload schlanker", "Profilbilder werden auf 256 px skaliert und als JPEG gespeichert — localStorage bleibt klein. Nur Bilddateien werden akzeptiert."],
      ["Schnellerer Start", "Module werden per Code-Splitting nur bei Bedarf geladen — die App startet spürbar schneller und braucht weniger Speicher."],
      ["QR-Rechnung offline", "Die swissqrbill-Bibliothek ist jetzt lokal eingebunden — QR-Einzahlungsscheine funktionieren ohne Internet-Verbindung."],
      ["Stabilere IDs", "Neue Datensätze nutzen kryptografisch zufällige IDs (crypto.randomUUID) statt Math.random."],
      ["Über Rapport & UI-Feinschliff", "Neues «Über Rapport»-Modal mit Lizenzinfo, einheitliche Stift-Icons zum Bearbeiten, Pinnwand-Kategorien als Pills."],
    ],
  },
  "0.5": {
    items: [
      ["Anmeldesystem", "Benutzerverwaltung mit Rollen und Passwörtern. Jeder Mitarbeiter erhält einen eigenen Login. Berechtigungen steuern, welche Module sichtbar sind."],
      ["Migration bestehender Daten", "Beim ersten Start mit einer bestehenden Datenbank erscheint ein Migrations-Assistent: Daten sichern, Admin-Konto einrichten — alle bisherigen Inhalte bleiben erhalten."],
      ["Rechnungstypen: Akonto / Teilrechnung / Schluss", "Klare Trennung der Rechnungsarten mit unterschiedlicher steuerlicher Behandlung. Akonto ist erst bei der Schlussrechnung steuerrelevant; Teilrechnungen sind sofort wirksam."],
      ["Neuer Rechnungsdialog", "Zweistufige Auswahl: zuerst Art der Rechnung (Akonto / Teilrechnung / Schlussrechnung), dann Berechnungsmethode (Stunden / % vom Budget / Fixer Betrag / SIA-Phase)."],
      ["Akonto & Teilrechnung nach SIA-Phase", "Für Pauschal-Projekte können einzelne SIA-Phasen direkt verrechnet werden — bereits verrechnete Phasen werden als solche markiert."],
      ["Aufwandsrechnungen erweitert", "Stundenprojekte unterstützen jetzt Akonto (Stunden bis heute, %, Fixbetrag) und Teilrechnung (Stunden auswählen, %, Fixbetrag, SIA-Phase)."],
      ["Buchhaltung: Akonto-MwSt getrennt", "Akonto-Rechnungen werden in der Buchhaltung separat ausgewiesen — die MwSt wird erst bei der Schlussrechnung als steuerrelevant gezählt."],
      ["Mitarbeiter: Intern & Absenzen", "Umbenennung zu «Intern / Absenzen». Neue Jahresübersicht mit Monatsvergleich und Vorjahr, Absenzkategorien-Matrix, sowie Auswertung interner Stunden ohne Projektbezug."],
    ],
  },
  "0.4": {
    items: [
      ["Material Design 3", "Sidebar mit einklappbarem Icon-Modus und Material Symbols Rounded Icons. Buttons als Pill, Inputs und Cards mit mehr Radius, Tags als Chips, Modals mit Backdrop-Blur."],
      ["Interne Projektbeteiligung", "Mitarbeitende können direkt im Projekt zugewiesen werden. In Protokollen erscheinen unter «Intern» nur noch die zugewiesenen Personen."],
      ["Offerten im Budget", "Neben Rechnungen können jetzt auch Offerten in die Einnahmen-Planung des Bürobudgets einbezogen werden."],
      ["Kategorien direkt auf der Seite", "Spesenarten und Ausgaben-Kategorien werden neu direkt auf der jeweiligen Seite verwaltet, nicht mehr in den Einstellungen."],
    ],
  },
  "0.3": {
    items: [
      ["Visuelles Redesign", "Sidebar schwebt als eigenständiges Panel mit Radius und Schatten. Cards haben mehr Tiefe. Header kompakter, Abstände überarbeitet, Menüpunkte in Kapitälchen. Studio-Name in der Sidebar."],
      ["Zoom", "Der UI-Zoom betrifft nur den Hauptinhalt — die Sidebar bleibt immer gleich gross und unverzerrt."],
    ],
  },
  "0.2": {
    items: [
      ["Neue Module", "Lohnabrechnung, Bürobudget, Protokolle, Lieferscheine und Spesen (Mitarbeiter & intern) hinzugefügt."],
      ["Zeiterfassung Wochenansicht", "Visuelles Zeitraster mit Drag & Drop — Einträge verschieben und skalieren, Wechsel zwischen Tag-, Wochen- und Monatsansicht."],
      ["Ferienplanung", "Ferienanträge stellen, genehmigen und zurückziehen. Absenzverwaltung ausgebaut."],
      ["Teilzeit", "Lohn wird proportional zum Pensum berechnet, pro Monat überschreibbar."],
    ],
  },
  "0.1": {
    items: [
      ["Erster Release", "Projekte, Kunden, Mitarbeiterverwaltung, Zeiterfassung."],
      ["Rechnungen & Offerten", "Rechnungen mit QR-Einzahlungsschein, Offerten nach SIA 102, manuell oder frei — konvertierbar zur Rechnung."],
      ["Einstellungen", "Studio-Stammdaten, Stundensätze, Rollen, MwSt und Projektnummern-Format."],
    ],
  },
};
