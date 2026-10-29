// Tests für die Geld- und Rechenfunktionen in utils.ts (QR-Rechnung, Lohn, SIA-Honorar, Nummern).
// Laufen mit `npm test` (Vitest, Node-Umgebung).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calcLohn, calcSIAHours, calcManualHours, deriveQuoteBudget, formatReference, generateQRReference, getWorkdaysInMonth,
  hashPassword, isQRIban, mod10, parseSeqFromNumber, applyProjectNumberFormat, roundCHF, verifyPassword, formatIban,
} from "./utils";
import type { Employee, Quote } from "./types";

describe("QR-Rechnung", () => {
  it("mod10 rekursiv liefert die Prüfziffer des SIX-Beispiels", () => {
    expect(mod10("21000000000313947143000901")).toBe("7");
  });

  it("generateQRReference füllt auf 26 Ziffern auf und hängt die Prüfziffer an", () => {
    const ref = generateQRReference("2026-042");
    expect(ref).toHaveLength(27);
    expect(ref.slice(0, 26)).toBe("2026042".padStart(26, "0"));
    expect(ref.slice(26)).toBe(mod10(ref.slice(0, 26)));
  });

  it("formatReference gruppiert von rechts in 5er-Blöcken", () => {
    expect(formatReference("210000000003139471430009017")).toBe("21 00000 00003 13947 14300 09017");
  });

  it("isQRIban erkennt QR-IBANs an der Instituts-Nummer 30000–31999", () => {
    expect(isQRIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQRIban("CH93 0076 2011 6238 5295 7")).toBe(false);
    expect(isQRIban("DE89 3704 0044 0532 0130 00")).toBe(false);
    expect(isQRIban("")).toBe(false);
  });

  it("formatIban gruppiert in 4er-Blöcke", () => {
    expect(formatIban("ch9300762011623852957")).toBe("CH93 0076 2011 6238 5295 7");
  });
});

describe("roundCHF", () => {
  it("rundet auf Rappen, nicht auf 5 Rappen", () => {
    expect(roundCHF(10.234)).toBe(10.23);
    expect(roundCHF(10.236)).toBe(10.24);
    expect(roundCHF(null)).toBe(0);
  });
});

describe("calcLohn", () => {
  const emp = { id: "e1", name: "Test", role: "", pensum: 80, wochenstunden: 42, ferienWochen: 5, monatslohn: 6000, dreizehnterLohn: true } as Employee;

  it("rechnet Pensum, 13. Lohn, Standardabzüge und Spesen", () => {
    const r = calcLohn(emp, "2026-10", [{ amount: 100.5 }]);
    expect(r.brutto).toBe(4800);
    expect(r.dreizehnter).toBe(400);
    expect(r.bruttoTotal).toBe(5200);
    expect(r.ahv).toBe(275.6);
    expect(r.alv).toBe(57.2);
    expect(r.bvg).toBe(416);
    expect(r.nbu).toBe(78);
    expect(r.ktg).toBe(26);
    expect(r.qst).toBe(0);
    expect(r.totalAbzuege).toBeCloseTo(852.8, 10);
    expect(r.netto).toBe(4347.2);
    expect(r.auszahlung).toBe(4447.7);
  });

  it("Bonus ist AHV-pflichtig, Quellensteuer nur wenn pflichtig", () => {
    const r = calcLohn({ ...emp, pensum: 100, dreizehnterLohn: false, quellensteuerPflichtig: true, quellensteuerSatz: 5 }, undefined, [], 1000);
    expect(r.bruttoTotal).toBe(7000);
    expect(r.ahv).toBe(371);
    expect(r.qst).toBe(350);
  });
});

describe("SIA-Honorar", () => {
  it("ohne Baukosten ist alles 0", () => {
    expect(calcSIAHours(0, 1, []).total).toBe(0);
  });

  it("Stunden = B × p/100 × n × Anteil, deaktivierte Teilleistungen zählen nicht", () => {
    const phases = [{ id: "31", label: "Vorprojekt", items: [{ id: "a", label: "A", pct: 10 }, { id: "b", label: "B", pct: 5, enabled: false }] }];
    const r = calcSIAHours(1_000_000, 1, phases as never);
    const p = 0.062 + 10.58 / 100;
    expect(r.p).toBe(Math.round(p * 1000) / 1000);
    expect(r.phases[0].items[0].hours).toBe(Math.round(1_000_000 * (p / 100) * 0.1 * 10) / 10);
    expect(r.phases[0].items[1].hours).toBe(0);
  });

  it("manuelle Schätzung: Stunden × Satz nur aktivierter Phasen", () => {
    const roles = [{ id: "PL", label: "PL", rate: 140 }, { id: "TS", label: "TS", rate: 120 }];
    const r = calcManualHours([
      { id: "p1", label: "P1", enabled: true, hoursByRole: { PL: 10, TS: 5 } },
      { id: "p2", label: "P2", enabled: false, hoursByRole: { PL: 100 } },
    ] as never, roles);
    expect(r.totalHours).toBe(15);
    expect(r.totalAmount).toBe(10 * 140 + 5 * 120);
  });

  it("deriveQuoteBudget zählt Referenz-Offerten nicht mit", () => {
    const quotes = [
      { id: "q1", mode: "free", freeItems: [{ qty: 2, price: 500 }] },
      { id: "q2", mode: "free", freeItems: [{ qty: 1, price: 9999 }] },
    ] as unknown as Quote[];
    const r = deriveQuoteBudget([{ quoteId: "q1", role: "Hauptofferte" }, { quoteId: "q2", role: "Referenz" }], quotes);
    expect(r.budgetAmount).toBe(1000);
    expect(r.hasFreeQuotes).toBe(true);
    expect(r.hasHourQuotes).toBe(false);
  });
});

describe("Nummernformate", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("Projektnummer hin und zurück im aktuellen Jahr", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    const num = applyProjectNumberFormat("YYYY/NNN", 7);
    expect(num).toBe("2026/007");
    expect(parseSeqFromNumber(num, "YYYY/NNN")).toBe(7);
    expect(parseSeqFromNumber("2025/007", "YYYY/NNN")).toBeNull();
  });
});

describe("getWorkdaysInMonth", () => {
  it("März 2026: 22 Werktage, auch über die Zeitumstellung", () => {
    const days = getWorkdaysInMonth(2026, 2, [{ id: "f", date: "2026-03-02", name: "Test" } as never]);
    expect(days).toHaveLength(22);
    expect(days[0].date).toBe("2026-03-02");
    expect(days[0].feiertag).not.toBeNull();
    expect(days.at(-1)!.date).toBe("2026-03-31");
  });
});

describe("Passwörter", () => {
  it("Hash prüft richtig und falsch", async () => {
    const { hash, salt } = await hashPassword("geheim");
    expect(await verifyPassword("geheim", { passwordHash: hash, passwordSalt: salt })).toBe(true);
    expect(await verifyPassword("falsch", { passwordHash: hash, passwordSalt: salt })).toBe(false);
  });
});
