// Länder für Kontakte (Persons.tsx) und den QR-Zahlteil (print/docs/qrBillData.ts).
//
// Regel (26.11.2026): Das Land des Zahlungspflichtigen im QR-Code kommt aus dem Feld «Land» des Kontakts — ISO-Code
// mit zwei Buchstaben, Standard CH —, nicht aus einer Freitext-Adresse. Im Kontaktformular wird es aus der Liste
// gewählt. Ältere Kontakte mit ausgeschriebenem Land («Deutschland», «Österreich») werden beim Lesen auf den Code
// abgebildet; Unbekanntes gilt als CH.

/** Gängige Länder für die Auswahl im Kontaktformular (Code nach ISO 3166-1, Name deutsch), Schweiz zuerst. */
export const COUNTRIES: readonly { code: string; label: string }[] = [
  { code: "CH", label: "Schweiz" },
  { code: "LI", label: "Liechtenstein" },
  { code: "DE", label: "Deutschland" },
  { code: "AT", label: "Österreich" },
  { code: "FR", label: "Frankreich" },
  { code: "IT", label: "Italien" },
  { code: "BE", label: "Belgien" },
  { code: "DK", label: "Dänemark" },
  { code: "ES", label: "Spanien" },
  { code: "FI", label: "Finnland" },
  { code: "GB", label: "Grossbritannien" },
  { code: "IE", label: "Irland" },
  { code: "LU", label: "Luxemburg" },
  { code: "MC", label: "Monaco" },
  { code: "NL", label: "Niederlande" },
  { code: "NO", label: "Norwegen" },
  { code: "PL", label: "Polen" },
  { code: "PT", label: "Portugal" },
  { code: "SE", label: "Schweden" },
  { code: "CZ", label: "Tschechien" },
  { code: "US", label: "USA" },
];

/** Weitere Schreibweisen (ausgeschrieben, englisch/französisch/italienisch, Autokennzeichen) → Code. */
const ALIASES: Record<string, string> = {
  SCHWEIZ: "CH", SUISSE: "CH", SVIZZERA: "CH", SWITZERLAND: "CH", CHE: "CH",
  LIECHTENSTEIN: "LI", FL: "LI",
  DEUTSCHLAND: "DE", GERMANY: "DE", ALLEMAGNE: "DE", GERMANIA: "DE", D: "DE",
  "ÖSTERREICH": "AT", OESTERREICH: "AT", AUSTRIA: "AT", AUTRICHE: "AT", A: "AT",
  FRANKREICH: "FR", FRANCE: "FR", FRANCIA: "FR", F: "FR",
  ITALIEN: "IT", ITALY: "IT", ITALIE: "IT", ITALIA: "IT", I: "IT",
  NIEDERLANDE: "NL", HOLLAND: "NL", NETHERLANDS: "NL",
  GROSSBRITANNIEN: "GB", "GROẞBRITANNIEN": "GB", ENGLAND: "GB", UK: "GB", "VEREINIGTES KÖNIGREICH": "GB",
  SPANIEN: "ES", SPAIN: "ES", ESPAGNE: "ES",
  USA: "US", "VEREINIGTE STAATEN": "US",
};

/**
 * Land als ISO-Code mit zwei Buchstaben: ein Code bleibt (gross geschrieben), bekannte Ländernamen werden abgebildet,
 * leer oder Unbekanntes → `fallback` (Standard CH).
 */
export function countryCode(value: string | null | undefined, fallback = "CH"): string {
  const v = String(value ?? "").trim().toUpperCase();
  const alias = ALIASES[v] ?? COUNTRIES.find(c => c.label.toUpperCase() === v)?.code;   // auch «FL», «UK»
  if (alias) return alias;
  return /^[A-Z]{2}$/.test(v) ? v : fallback;
}
