// Demobüro als importierbares Backup (Einstellungen → System → «Backup importieren» bzw. bei der
// Ersteinrichtung «Backup importieren»). Die Demo-Daten sind relativ zum Ausführungsdatum datiert:
// für aktuelle Daten (Zeiterfassung «diese Woche», offene Rechnungen) die Datei neu erzeugen.
//
//   node scripts/marketing-shots/demo-export.mjs [Zieldatei]     (Standard: demo-buero.json hier)
//
// Anmeldung nach dem Import: Benutzer «admin», Passwort «admin» (wird beim ersten Anmelden gehasht).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoData } from "./demo-data.mjs";

const out = process.argv[2] || fileURLToPath(new URL("./demo-buero.json", import.meta.url));
writeFileSync(out, JSON.stringify(demoData, null, 2));
console.log(`Demobüro geschrieben: ${out} (${demoData.employees.length} Personen, ${demoData.projects.length} Projekte, ${demoData.invoices.length} Rechnungen, ${demoData.timeEntries.length} Zeiteinträge)`);
