// Buchhaltung: Periodenzuordnung und MWST-Basis (Prüfung 28.11.2026) — Summe der MWST-Perioden = Jahr (Zufallsdaten),
// Jahreswechsel vereinbart/vereinnahmt, vereinnahmte Entgelte in CSV nachvollziehbar, Brutto-Total mit 5-Rappen-Rundung.
import { describe, expect, it } from "vitest";
import { accountingRows, accountingSummary, buildBuchhaltungCSV, mwstPerioden } from "./accounting";
import { roundCHF } from "./utils";
import type { AppData } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
/** Einfacher deterministischer Zufall (LCG), damit ein Fehler reproduzierbar bleibt. */
function rnd(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

function zufallsDaten(seed: number, settings: Record<string, unknown>): AppData {
  const r = rnd(seed);
  const datum = (y: number) => `${y}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`;
  const invoices = Array.from({ length: 40 }, (_, k) => {
    const sub = roundCHF((r() - 0.15) * 20000);   // auch Gutschriften (negativ)
    const mwst = r() > 0.1;
    const rate = r() > 0.8 ? 7.7 : 8.1;           // gemischte Sätze
    const tax = mwst ? roundCHF(sub * rate / 100) : 0;
    const status = ["entwurf", "gesendet", "bezahlt", "überfällig", "bezahlt"][Math.floor(r() * 5)];
    const date = datum(2026);
    return { id: "i" + k, number: "N" + k, date, status, sub, globalDisc: 0, tax, total: roundCHF(sub + tax), mwst, mwstRate: rate, items: [],
      invoiceKind: r() > 0.5 ? "akonto" : "", paidDate: status === "bezahlt" ? (r() > 0.7 ? datum(2027) : date) : undefined };
  });
  const expenses = Array.from({ length: 30 }, (_, k) => ({ id: "e" + k, date: datum(2026), amount: roundCHF(r() * 500), inclMwst: r() > 0.3,
    mwstRate: [8.1, 2.6, 3.8, 0][Math.floor(r() * 4)], status: ["offen", "genehmigt", "ausbezahlt", "abgelehnt"][Math.floor(r() * 4)] }));
  const internalExpenses = [
    { id: "x1", date: "2025-11-30", amount: 2000, inclMwst: false, mwstRate: 0, recurring: true, recurringInterval: "monatlich" },
    { id: "x2", date: "2026-02-15", amount: 1081.37, inclMwst: true, mwstRate: 8.1, recurring: true, recurringInterval: "quartalsweise", amountHistory: [{ before: "2026-08", amount: 999.99 }] },
  ];
  return { settings, invoices, expenses, internalExpenses, lohnEntries: [], persons: [], projects: [] } as unknown as AppData;
}

const FELDER = ["revenueNet", "revenueGross", "taxTotal", "akontoTax", "umsatzsteuer", "mwstEntgeltBrutto", "expNet", "expTax", "intNet", "intTax", "vorsteuer", "mwstSchuld", "ergebnis", "ertrag"] as const;
const VARIANTEN: Record<string, unknown>[] = [
  {}, { mwstAbrechnungsart: "vereinnahmt" },
  { mwstMethode: "saldo", mwstSaldoSatz: 6.2 }, { mwstMethode: "saldo", mwstSaldoSatz: 6.2, mwstAbrechnungsart: "vereinnahmt" },
];

describe("Summe der Perioden = Jahr (Zufallsdaten)", () => {
  for (const settings of VARIANTEN) {
    it(JSON.stringify(settings), () => {
      for (let seed = 1; seed < 40; seed++) {
        const d = zufallsDaten(seed, settings);
        const jahr = accountingSummary(d, "2026", "2026-12-31");
        const perioden = mwstPerioden(2026, (settings as { mwstMethode?: "saldo" }).mwstMethode).map(p => accountingSummary(d, p.period, "2026-12-31"));
        const monate = Array.from({ length: 12 }, (_, i) => accountingSummary(d, `2026-${pad(i + 1)}`, "2026-12-31"));
        for (const k of FELDER) {
          // Saldosteuer wird je Periode gerundet: höchstens 1 Rappen je Periode Abweichung
          expect(Math.abs(roundCHF(perioden.reduce((a, p) => a + p[k], 0)) - jahr[k]), `seed ${seed} ${k} Perioden`).toBeLessThanOrEqual(perioden.length * 0.005 + 1e-9);
          expect(Math.abs(roundCHF(monate.reduce((a, p) => a + p[k], 0)) - jahr[k]), `seed ${seed} ${k} Monate`).toBeLessThanOrEqual(0.06);
        }
      }
    });
  }
});

describe("Jahreswechsel und vereinnahmte Entgelte", () => {
  const base = (settings: Record<string, unknown>) => ({
    settings, persons: [{ id: "k", name: "Bauherr AG" }], projects: [], expenses: [], internalExpenses: [], lohnEntries: [],
    invoices: [
      // Akonto im Dezember gestellt, im Januar bezahlt
      { id: "a", number: "2026-012", clientId: "k", date: "2026-12-31", paidDate: "2027-01-04", status: "bezahlt", sub: 10000, tax: 810, total: 10810, mwst: true, mwstRate: 8.1, items: [], invoiceKind: "akonto" },
      // im Q1 gestellt, noch offen
      { id: "b", number: "2027-001", clientId: "k", date: "2027-02-01", status: "gesendet", sub: 20000, tax: 1620, total: 21620, mwst: true, mwstRate: 8.1, items: [], invoiceKind: "akonto" },
    ],
  }) as unknown as AppData;

  it("vereinbart: Rechnungsdatum (Q4 2026), vereinnahmt: Zahlungsdatum (Q1 2027)", () => {
    expect(accountingSummary(base({}), "2026-Q4").umsatzsteuer).toBe(810);
    expect(accountingSummary(base({}), "2027-Q1").umsatzsteuer).toBe(1620);
    const v = base({ mwstAbrechnungsart: "vereinnahmt" });
    expect(accountingSummary(v, "2026-Q4").umsatzsteuer).toBe(0);
    expect(accountingSummary(v, "2027-Q1").umsatzsteuer).toBe(810);
    const s = base({ mwstMethode: "saldo", mwstSaldoSatz: 6.2, mwstAbrechnungsart: "vereinnahmt" });
    expect(accountingSummary(s, "2026-H2").umsatzsteuer).toBe(0);
    expect(accountingSummary(s, "2027-H1").umsatzsteuer).toBe(670.22); // 10'810 × 6.2 %
  });

  it("CSV vereinnahmt: listet die bezahlten Rechnungen der Periode; «davon Akonto» nicht mehr grösser als die Umsatzsteuer", () => {
    const v = base({ mwstAbrechnungsart: "vereinnahmt" });
    expect(accountingRows(v, "2027-Q1").taxInvoices.map(i => i.number)).toEqual(["2026-012"]);
    const csv = buildBuchhaltungCSV(v, "2027-Q1");
    expect(csv).toContain("ZAHLUNGSEINGÄNGE");
    expect(csv).toContain('"2027-01-04";"2026-012";"Bauherr AG";"2026-12-31";"10000.00";"8.1";"810.00";"10810.00";"ja"');
    expect(csv).toContain('"Umsatzsteuer";"";"";"810.00"');
    // vorher: «davon auf Akontorechnungen 1620.00» unter einer Umsatzsteuer von 810.00
    expect(csv).not.toContain("davon auf Akontorechnungen");
    // vereinbart unverändert ohne diesen Abschnitt, mit «davon Akonto»
    const vb = buildBuchhaltungCSV(base({}), "2027-Q1");
    expect(vb).not.toContain("ZAHLUNGSEINGÄNGE");
    expect(vb).toContain('"davon auf Akontorechnungen";"";"";"1620.00"');
  });

  it("CSV vereinnahmt: TOTAL der Zahlungseingänge = Umsatzsteuer (Zufallsdaten, alle Quartale)", () => {
    for (let seed = 1; seed < 20; seed++) {
      const d = zufallsDaten(seed, { mwstAbrechnungsart: "vereinnahmt" });
      for (const p of mwstPerioden(2026, "effektiv")) {
        const csv = buildBuchhaltungCSV(d, p.period).split("\n");
        const start = csv.findIndex(l => l.startsWith('"ZAHLUNGSEINGÄNGE'));
        const total = csv.slice(start).find(l => l.includes('"TOTAL"'))!.split(";").map(c => c.replace(/"/g, ""));
        expect(Number(total[6])).toBe(accountingSummary(d, p.period).umsatzsteuer);
      }
    }
  });
});

describe("Brutto-Umsatz = Summe der Rechnungstotale (Total auf 5 Rappen)", () => {
  it("Netto + MWST weicht um die Rundung ab, revenueGross nicht", () => {
    const d = { settings: {}, invoices: [
      { id: "r", number: "1", date: "2026-05-01", status: "gesendet", sub: 100.02, tax: 8.1, total: 108.1, mwst: true, mwstRate: 8.1, items: [] },   // exakt 108.12 → 108.10
      { id: "s", number: "2", date: "2026-05-02", status: "gesendet", sub: 100.03, tax: 8.1, total: 108.15, mwst: true, mwstRate: 8.1, items: [] },  // exakt 108.13 → 108.15
    ], expenses: [], internalExpenses: [], lohnEntries: [], persons: [], projects: [] } as unknown as AppData;
    const s = accountingSummary(d, "2026");
    expect(s.revenueNet + s.taxTotal).toBe(216.25);
    expect(s.revenueGross).toBe(216.25);
    const d2 = { ...d, invoices: [d.invoices[0]] } as AppData;
    expect(accountingSummary(d2, "2026").revenueGross).toBe(108.1);   // Netto + MWST = 108.12
    expect(buildBuchhaltungCSV(d2, "2026")).toContain('"TOTAL";"100.02";"";"8.10";"108.10"');
  });
});
