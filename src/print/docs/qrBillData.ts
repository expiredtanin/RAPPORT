// Daten des QR-Zahlteils (Swiss QR Code, SIX Implementation Guidelines 2.3) für swissqrbill: Zeichensatz,
// Feldlängen, strukturierte Adressen (Typ S), Referenz je nach Konto. Reine Funktion ohne React, damit sie
// getestet werden kann; die Darstellung macht QRBillPrint in InvoicePrint.tsx.

import type { Data, Debtor } from "swissqrbill/types";
import { isQRIban, isValidIban, paymentReference } from "../../utils";
import type { Invoice, Person, Settings } from "../../types";

/** Ergebnis: Daten für swissqrbill oder der Grund, warum kein Zahlteil gedruckt wird. */
export type QrBillResult = { ok: true; data: Data } | { ok: false; reason: string; error?: boolean };

// Typografische Zeichen, die im Swiss QR Code nicht erlaubt sind, durch die nächste erlaubte Form ersetzen
const REPLACE: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "“": '"', "”": '"', "„": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-", "…": "...", "•": "-",
};

/**
 * Text für ein Feld des QR-Codes: nur der zulässige Zeichensatz (Basic Latin, Latin-1 Supplement, Latin
 * Extended-A, Ș ș Ț ț, €), typografische Zeichen ersetzt, Zeilenumbrüche/Tabs als Leerzeichen, auf `max`
 * Zeichen gekürzt (swissqrbill bricht bei zu langen Feldern sonst den ganzen Zahlteil ab).
 */
export function qrText(value: string | null | undefined, max: number): string {
  const cleaned = Array.from(String(value ?? "").normalize("NFC"))
    .map(ch => REPLACE[ch] ?? (/[\t\r\n\u00a0]/.test(ch) ? " " : ch))
    .join("")
    .replace(/[^\u0020-\u007e\u00a1-\u017f\u0218-\u021b\u20ac]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, max).join("").trim();
}

/** Land als ISO-Code mit zwei Buchstaben; Freitext wie «Schweiz» oder leer → CH. */
const countryCode = (c?: string | null) => {
  const v = (c || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "CH";
};

/**
 * Adresse der zahlungspflichtigen Partei (Typ S: PLZ und Ort sind Pflicht). Ohne strukturierte Felder wird
 * das alte Freitextfeld gelesen («Strasse⏎PLZ Ort»). Unvollständig → undefined: der Zahlteil zeigt dann
 * das leere Feld zum Ausfüllen, statt einen ungültigen QR-Code zu erzeugen.
 */
export function qrDebtor(client: Person | null | undefined): Debtor | undefined {
  if (!client) return undefined;
  let street = client.street || "";
  let zip = client.zip || "";
  let city = client.city || "";
  if ((!zip || !city) && client.address) {
    const lines = client.address.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const zipLine = lines.findIndex(l => /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/.test(l));
    if (zipLine >= 0) {
      const m = lines[zipLine].match(/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/)!;
      zip = zip || m[1];
      city = city || m[2];
      if (!street && zipLine > 0) street = lines[zipLine - 1];
    }
  }
  const name = qrText(client.company || client.name, 70);
  zip = qrText(zip, 16);
  city = qrText(city, 35);
  if (!name || !zip || !city) return undefined;
  return { name, address: qrText(street, 70), zip, city, country: countryCode(client.country) };
}

/**
 * Daten des QR-Zahlteils einer Rechnung. Betrag = gespeichertes `total`; Referenz nach `paymentReference`
 * (QR-IBAN → QRR, sonst SCOR aus der Rechnungsnummer). Kein Zahlteil bei Gutschriften/Betrag 0 und ohne
 * vollständige Absenderadresse.
 */
export function buildQrBillData(inv: Pick<Invoice, "number" | "total">, client: Person | null | undefined, settings: Pick<Settings, "iban" | "name" | "street" | "zip" | "city" | "country">): QrBillResult {
  const account = (settings.iban || "").replace(/\s/g, "").toUpperCase();
  if (!account) return { ok: false, error: true, reason: "Keine IBAN erfasst (Einstellungen → Studio)." };
  if (!isValidIban(account)) return { ok: false, error: true, reason: "Die IBAN in Einstellungen → Studio ist ungültig (Prüfziffer stimmt nicht) — bitte prüfen." };
  // QR-IBAN verlangt eine QR-Referenz aus der Rechnungsnummer; ohne Ziffern wäre sie «000…0» und die Zahlung nicht zuzuordnen
  if (isQRIban(account) && !/\d/.test(inv.number || "")) return { ok: false, reason: "Einzahlungsschein erst mit Rechnungsnummer (die QR-Referenz entsteht daraus)." };
  const amount = inv.total || 0;
  if (amount < 0.01) return { ok: false, reason: "Gutschrift bzw. Betrag 0 — kein Einzahlungsschein." };
  if (amount > 999_999_999.99) return { ok: false, error: true, reason: "Betrag zu gross für eine QR-Rechnung (höchstens 999'999'999.99)." };
  const creditor = {
    name: qrText(settings.name, 70),
    address: qrText(settings.street, 70),
    zip: qrText(settings.zip, 16),
    city: qrText(settings.city, 35),
    country: countryCode(settings.country),
    account,
  };
  if (!creditor.name || !creditor.zip || !creditor.city) {
    return { ok: false, error: true, reason: "Absenderadresse unvollständig: Name, PLZ und Ort in Einstellungen → Studio erfassen." };
  }
  const data: Data = { currency: "CHF", amount: Math.round(amount * 100) / 100, creditor };
  const debtor = qrDebtor(client);
  if (debtor) data.debtor = debtor;
  const ref = paymentReference(inv.number, account);
  if (ref.reference) data.reference = ref.reference;
  if (inv.number) data.message = qrText(`Rechnung ${inv.number}`, 140);
  return { ok: true, data };
}
