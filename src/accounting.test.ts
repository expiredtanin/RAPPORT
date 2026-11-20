// Tests für Lohnabrechnung (calcLohn mit Eintritt/Höchstlohn), Spesen-Auszahlung und die
// Buchhaltungssummen (Jahresergebnis, MWST-Abrechnung, CSV) mit realistischen Schweizer Zahlen.

import { describe, expect, it } from "vitest";
import { ahvStatus, bvgAltersgutschriftSatz, bvgKoordinierterLohn, calcLohn, contractAmounts, hoechstlohnKumuliert, monatsAnteilNachEintritt } from "./utils";
import { periodLabel, mwstDueDate, mwstPerioden, expandInternalExpenses, spesenWartend,
  accountingSummary, buildBuchhaltungCSV, expenseNet, expenseTax, inPeriod, lohnAGBeitraege,
  lohnPersonalaufwand, lohnVorperioden, spesenFuerLohn,
} from "./accounting";
import type { AppData, Employee, Expense, InternalExpense, Invoice, LohnEntry } from "./types";

const emp = (over: Partial<Employee> = {}): Employee =>
  ({ id: "e1", name: "Anna Muster", role: "Architektin", pensum: 100, wochenstunden: 42, ferienWochen: 5, monatslohn: 7500, ...over }) as Employee;

describe("calcLohn — Schweizer Lohnabrechnung", () => {
  it("7'500 bei 100 %: Standardabzüge und AG-Kosten", () => {
    const r = calcLohn(emp(), "2026-03");
    expect(r.bruttoTotal).toBe(7500);
    expect(r.ahv).toBe(397.5);
    expect(r.alv).toBe(82.5);
    expect(r.bvg).toBe(600);
    expect(r.nbu).toBe(112.5);
    expect(r.ktg).toBe(37.5);
    expect(r.totalAbzuege).toBe(1230);
    expect(r.netto).toBe(6270);
    // AG: AHV + ALV paritätisch, PK 8 %
    expect(lohnAGBeitraege(r)).toEqual({ ahvAG: 397.5, alvAG: 82.5, bvgAG: 600, weitere: 0, total: 1080 });
    // Personalaufwand = Brutto + AG (früher Auszahlung + PK-AG = 6'870: AN-Abzüge fehlten)
    expect(lohnPersonalaufwand(r)).toBe(8580);
  });

  it("80 % Pensum mit 13. Monatslohn", () => {
    const r = calcLohn(emp({ pensum: 80, dreizehnterLohn: true }), "2026-03");
    expect(r.brutto).toBe(6000);
    expect(r.dreizehnter).toBe(500);
    expect(r.bruttoTotal).toBe(6500);
    expect(r.ahv).toBe(344.5);
    expect(r.totalAbzuege).toBe(1066);
    expect(r.netto).toBe(5434);
  });

  it("Eintritt am 15. Juni: Lohn anteilig nach Kalendertagen (16/30)", () => {
    expect(monatsAnteilNachEintritt("2026-06-15", "2026-06")).toBeCloseTo(16 / 30, 12);
    const r = calcLohn(emp({ eintrittsdatum: "2026-06-15", dreizehnterLohn: true }), "2026-06");
    expect(r.brutto).toBe(4000); // vorher voller Monat 7'500
    expect(r.dreizehnter).toBe(333.33);
    expect(r.bruttoTotal).toBe(4333.33);
    expect(r.ahv).toBe(229.67);
    // Folgemonat voll, Monat vor Eintritt leer
    expect(calcLohn(emp({ eintrittsdatum: "2026-06-15" }), "2026-07").brutto).toBe(7500);
    expect(calcLohn(emp({ eintrittsdatum: "2026-06-15" }), "2026-05").brutto).toBe(0);
  });

  it("Eintritt am 15. Mai (31 Tage) → 17/31", () => {
    expect(calcLohn(emp({ eintrittsdatum: "2026-05-15" }), "2026-05").brutto).toBe(4112.9);
  });

  it("ALV/NBU nur bis Höchstlohn 148'200 (12'350 pro Monat)", () => {
    const r = calcLohn(emp({ monatslohn: 13000 }), "2026-01");
    expect(r.alvBasis).toBe(12350);
    expect(r.alv).toBe(135.85); // vorher 143.00
    expect(r.nbu).toBe(185.25); // vorher 195.00
    expect(r.ahv).toBe(689); // AHV ohne Plafond
  });

  it("Höchstlohn kumuliert: Dezember-Bonus nach 11 × 12'000", () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({
      employeeId: "e1", monat: `2026-${String(i + 1).padStart(2, "0")}`, bruttoTotal: 12000, alvBasis: 12000,
    })) as LohnEntry[];
    const vor = lohnVorperioden(entries, "e1", "2026-12");
    expect(vor).toEqual({ bruttoBisher: 132000, alvBasisBisher: 132000 });
    const r = calcLohn(emp({ monatslohn: 12000 }), "2026-12", [], 20000, vor);
    expect(r.bruttoTotal).toBe(32000);
    expect(r.alvBasis).toBe(16200); // 148'200 − 132'000
    expect(r.alv).toBe(178.2); // vorher 352.00
  });

  it("Höchstlohn bei Eintritt Mitte Jahr anteilig", () => {
    expect(hoechstlohnKumuliert("2026-07-01", "2026-07")).toBe(12350);
    expect(hoechstlohnKumuliert("2026-07-01", "2026-12")).toBe(74100);
    expect(hoechstlohnKumuliert("2025-03-01", "2026-02")).toBe(24700);
    expect(calcLohn(emp({ monatslohn: 15000, eintrittsdatum: "2026-07-01" }), "2026-07").alvBasis).toBe(12350);
  });

  it("Austritt am 10. Juni: letzter Monat anteilig (10/30), danach nichts", () => {
    const e = emp({ austrittsdatum: "2026-06-10" });
    expect(calcLohn(e, "2026-06").brutto).toBe(2500);
    expect(calcLohn(e, "2026-07").brutto).toBe(0);
    expect(monatsAnteilNachEintritt("2026-06-05", "2026-06", "2026-06-10")).toBeCloseTo(6 / 30, 12);
  });

  it("AHV-Rentner:in: Freibetrag 1'400, keine ALV, keine BVG-Pflicht", () => {
    const r = calcLohn(emp({ geburtsdatum: "1960-05-20", monatslohn: 5000 }), "2026-03");
    expect(r.ahvBasis).toBe(3600);
    expect(r.ahv).toBe(190.8);
    expect(r.alv).toBe(0);
    expect(r.bvg).toBe(0);
    expect(r.nbu).toBe(75); // NBU bleibt
    // mit 65 im Juni 2026: Rentner ab Juli
    expect(ahvStatus("1961-06-15", "2026-06")).toBe("aktiv");
    expect(ahvStatus("1961-06-15", "2026-07")).toBe("rentner");
    expect(ahvStatus("2009-02-01", "2026-03")).toBe("jung");
    expect(ahvStatus("1970-01-01", "2026-03", true)).toBe("rentner");
  });

  it("BVG: unter der Eintrittsschwelle keine PK, Beträge laut PK-Ausweis haben Vorrang", () => {
    const klein = calcLohn(emp({ monatslohn: 1800 }), "2026-03"); // 21'600 < 22'680
    expect(klein.bvg).toBe(0);
    expect(klein.bvgAG).toBe(0);
    expect(klein.hinweise?.some(h => h.includes("Eintrittsschwelle"))).toBe(true);
    const pk = calcLohn(emp({ pkBeitragAN: 412.4, pkBeitragAG: 498.6 }), "2026-03");
    expect(pk.bvg).toBe(412.4);
    expect(pk.bvgAG).toBe(498.6);
    expect(bvgKoordinierterLohn(90000)).toBe(63540);
    expect(bvgAltersgutschriftSatz(40)).toBe(10);
  });

  it("Hinweis bei PK unter dem BVG-Minimum (Alter 50: 15 % vom koordinierten Lohn)", () => {
    const r = calcLohn(emp({ geburtsdatum: "1976-01-01", bvgSatz: 2, pkAGSatz: 2 }), "2026-03");
    expect(r.hinweise?.some(h => h.includes("BVG-Minimum"))).toBe(true);
  });

  it("Familienzulagen in der Auszahlung, nicht im Personalaufwand; weitere AG-Kosten", () => {
    const r = calcLohn(emp({ familienzulagen: 215 }), "2026-03", [], 0, undefined, { fak: 1.0, vk: 3.0, bu: 0.1, ktgAG: null });
    expect(r.familienzulagen).toBe(215);
    expect(r.auszahlung).toBe(6270 + 215);
    expect(r.agFak).toBe(75);
    expect(r.agVk).toBe(23.85); // 3 % von 2 × 397.50
    expect(r.agBu).toBe(7.5);
    expect(r.agKtg).toBe(37.5); // paritätisch = AN-Satz 0.5 %
    expect(lohnPersonalaufwand(r)).toBe(8580 + 75 + 23.85 + 7.5 + 37.5);
  });

  it("Abrechnungen vor 26.11 ohne alvBasis zählen voll", () => {
    const vor = lohnVorperioden([{ employeeId: "e1", monat: "2026-01", bruttoTotal: 7500 } as LohnEntry, { employeeId: "e1", monat: "2025-12", bruttoTotal: 7500 } as LohnEntry, { employeeId: "e2", monat: "2026-01", bruttoTotal: 9000 } as LohnEntry], "e1", "2026-02");
    expect(vor).toEqual({ bruttoBisher: 7500, alvBasisBisher: 7500 });
  });
});

describe("spesenFuerLohn", () => {
  const sp = (id: string, date: string, status: string, over: Partial<Expense> = {}): Expense =>
    ({ id, date, status, employeeId: "e1", category: "Reise", description: "", amount: 50, mwstRate: 8.1, inclMwst: true, ...over }) as Expense;
  const list = [
    sp("a", "2026-03-10", "offen"), // nicht genehmigt → nicht in den Lohn
    sp("b", "2026-03-11", "ausbezahlt"), // schon bar ausbezahlt → nicht nochmals
    sp("c", "2026-02-20", "auf nächsten Lohn"), // nachgereicht → mit dem März-Lohn
    sp("d", "2026-02-21", "genehmigt"), // genehmigt, noch nicht ausbezahlt → mit dem März-Lohn
    sp("e", "2026-03-12", "offen", { lohnEntryId: "L0" }),
    sp("f", "2026-03-12", "offen", { employeeId: "e2" }),
    sp("g", "2026-04-01", "auf nächsten Lohn"), // späterer Monat → nicht
  ];
  it("nur genehmigte bis und mit Monat, ohne bereits ausbezahlte", () => {
    expect(spesenFuerLohn(list, "e1", "2026-03").map(e => e.id)).toEqual(["c", "d"]);
    expect(spesenWartend(list, "e1", "2026-03").map(e => e.id)).toEqual(["a"]);
  });
});

describe("Spesen netto/Vorsteuer", () => {
  it("108.10 inkl. 8.1 % → 100.00 + 8.10; ohne inkl. MWST keine Vorsteuer", () => {
    const e = { amount: 108.1, inclMwst: true, mwstRate: 8.1 };
    expect(expenseNet(e)).toBeCloseTo(100, 10);
    expect(expenseTax(e)).toBeCloseTo(8.1, 10);
    expect(expenseTax({ amount: 50, inclMwst: false, mwstRate: 8.1 })).toBe(0);
  });
});

describe("inPeriod", () => {
  it("Jahr, Monat, Quartal, alle", () => {
    expect(inPeriod("2026-03-31", "2026-Q1")).toBe(true);
    expect(inPeriod("2026-04-01", "2026-Q1")).toBe(false);
    expect(inPeriod("2025-02-01", "2026-Q1")).toBe(false);
    expect(inPeriod("2026-11-05", "2026-Q4")).toBe(true);
    expect(inPeriod("2026-11-05", "2026")).toBe(true);
    expect(inPeriod("2026-11-05", "2026-11")).toBe(true);
    expect(inPeriod(undefined, "")).toBe(true);
    expect(inPeriod(undefined, "2026")).toBe(false);
  });
});

describe("accountingSummary — Jahresergebnis und MWST-Abrechnung", () => {
  const inv = (over: Partial<Invoice>): Invoice => ({ id: "i", number: "", clientId: "", date: "", status: "gesendet", sub: 0, globalDisc: 0, tax: 0, total: 0, mwst: true, items: [], ...over }) as unknown as Invoice;
  const lohn = calcLohn(emp(), "2026-03", [{ amount: 108.1 }]);
  const data = {
    settings: { mwstRate: 8.1 },
    persons: [], projects: [],
    invoices: [
      inv({ id: "r1", number: "2026-01-001", date: "2026-01-20", status: "gesendet", sub: 10000, tax: 810, total: 10810 }),
      inv({ id: "r2", number: "2026-02-002", date: "2026-02-10", status: "bezahlt", sub: 5000, tax: 405, total: 5405, invoiceKind: "akonto" }),
      inv({ id: "r3", number: "2026-04-003", date: "2026-04-05", status: "bezahlt", sub: 2000, tax: 162, total: 2162 }),
      inv({ id: "r4", number: "2026-03-004", date: "2026-03-01", status: "entwurf", sub: 3000, tax: 243, total: 3243 }),
    ],
    expenses: [
      { id: "s1", date: "2026-03-12", category: "Reise", description: "Zug", amount: 108.1, mwstRate: 8.1, inclMwst: true, status: "ausbezahlt", employeeId: "e1", lohnEntryId: "L1" },
      { id: "s2", date: "2026-01-05", category: "Material", description: "Plot", amount: 54.05, mwstRate: 8.1, inclMwst: true, status: "offen", employeeId: "e1" },
    ] as Expense[],
    internalExpenses: [
      { id: "x1", date: "2026-01-31", category: "Miete", description: "Büro", amount: 2500, mwstRate: 0, inclMwst: false, recurring: true, recurringInterval: "monatlich" },
      { id: "x2", date: "2026-02-15", category: "Software", description: "CAD", amount: 1081, mwstRate: 8.1, inclMwst: true },
    ] as InternalExpense[],
    lohnEntries: [{ ...lohn, id: "L1", employeeId: "e1", monat: "2026-03", empSnapshot: { name: "Anna Muster" } }] as LohnEntry[],
  } as unknown as AppData;

  const END = "2026-12-31";
  it("Quartal 1: Einnahmen, MWST inkl. Akonto (Art. 40 MWSTG), Vorsteuer inkl. Lohn-Spesen, Miete monatlich", () => {
    const s = accountingSummary(data, "2026-Q1", END);
    expect(s.revenueNet).toBe(15000);
    expect(s.draftNet).toBe(3000);
    expect(s.taxTotal).toBe(1215);
    expect(s.akontoTax).toBe(405);
    expect(s.umsatzsteuer).toBe(1215); // Akonto-MWST wird mit der Akontorechnung abgerechnet
    expect(s.expNet).toBe(150);
    expect(s.expTax).toBe(12.15); // vorher 4.05: Vorsteuer der über Lohn bezahlten Spese fehlte
    expect(s.intNet).toBe(8500); // Miete Jan, Feb, Mär (je 2'500) + CAD 1'000
    expect(s.intTax).toBe(81);
    expect(s.vorsteuer).toBe(93.15);
    expect(s.mwstSchuld).toBe(1121.85);
    expect(s.lohnBrutto).toBe(7500);
    expect(s.lohnAG).toBe(1080);
    expect(s.personalaufwand).toBe(8580); // vorher 6'978.10 (Auszahlung inkl. Spesen + PK-AG)
    expect(s.ausgabenTotal).toBe(17230);
    expect(s.ergebnis).toBe(-2230);
    expect(s.openTotal).toBe(10810);
    expect(s.paidTotal).toBe(5405);
  });

  it("Jahr 2026", () => {
    const s = accountingSummary(data, "2026", END);
    expect(s.revenueNet).toBe(17000);
    expect(s.umsatzsteuer).toBe(1377);
    expect(s.mwstSchuld).toBe(1283.85);
    expect(s.intNet).toBe(31000); // 12 × Miete + CAD
    expect(s.paidTotal).toBe(7567);
  });

  it("Wiederkehrende Ausgaben nur bis heute bzw. bis «Ende»", () => {
    expect(accountingSummary(data, "2026", "2026-02-28").intNet).toBe(6000); // Jan + Feb Miete + CAD
    const mitEnde = { ...data, internalExpenses: [{ ...data.internalExpenses[0], recurringUntil: "2026-03-01" }] } as unknown as AppData;
    expect(accountingSummary(mitEnde, "2026", END).intNet).toBe(7500);
    const ex = expandInternalExpenses(data.internalExpenses, "2026-04-30").filter(e => e.occurrenceOf === "x1").map(e => e.date);
    expect(ex).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]); // Monatsende bleibt Monatsende
  });

  it("Saldosteuersatz: Bruttoentgelt × Satz, keine Vorsteuer, halbjährlich", () => {
    const saldo = { ...data, settings: { mwstRate: 8.1, mwstMethode: "saldo", mwstSaldoSatz: 6.2 } } as unknown as AppData;
    const s = accountingSummary(saldo, "2026-H1", END);
    expect(s.mwstEntgeltBrutto).toBe(18377); // 10'810 + 5'405 + 2'162
    expect(s.umsatzsteuer).toBe(1139.37);
    expect(s.vorsteuer).toBe(0);
    expect(s.mwstSchuld).toBe(1139.37);
    expect(mwstPerioden(2026, "saldo").map(p => [p.period, p.due])).toEqual([["2026-H1", "2026-08-29"], ["2026-H2", "2027-03-01"]]);
  });

  it("Vereinnahmte Entgelte: nur bezahlte Rechnungen nach Zahlungsdatum", () => {
    const d2 = { ...data, settings: { mwstAbrechnungsart: "vereinnahmt" },
      invoices: data.invoices.map(i => i.id === "r2" ? { ...i, paidDate: "2026-04-02" } : i) } as unknown as AppData;
    expect(accountingSummary(d2, "2026-Q1", END).umsatzsteuer).toBe(0); // r2 erst im April bezahlt
    expect(accountingSummary(d2, "2026-Q2", END).umsatzsteuer).toBe(567); // r2 405 + r3 162
  });

  it("CSV-Zusammenfassung = Ansicht", () => {
    const csv = buildBuchhaltungCSV(data, "2026-Q1");
    expect(csv).toContain('"MWST-Schuld";"";"";"1121.85"');
    expect(csv).toContain('"Personalaufwand (Bruttolohn + AG-Beiträge)";"8580.00"');
    // Spesen-Tabelle: TOTAL über alle Zeilen, Lohn-Spese mit Monat markiert
    expect(csv).toContain('"TOTAL";"150.00";"";"12.15";"162.15"');
    expect(csv).toContain('"2026-03"');
    // Entwurf nicht in der Einnahmen-Tabelle
    expect(csv).not.toContain("2026-03-004");
  });
});

describe("Periode und MWST-Frist", () => {
  it("benennt Perioden", () => {
    expect(periodLabel("")).toBe("Alle Jahre");
    expect(periodLabel("2026")).toBe("2026");
    expect(periodLabel("2026-Q3")).toBe("3. Quartal 2026");
    expect(periodLabel("2026-11")).toBe("November 2026");
  });
  it("Frist 60 Tage nach Quartalsende", () => {
    expect(mwstDueDate(2026, 1)).toBe("2026-05-30");
    expect(mwstDueDate(2026, 3)).toBe("2026-11-29");
    expect(mwstDueDate(2026, 4)).toBe("2027-03-01");
  });
});

describe("Vertragssumme exkl. MWST (SIA 1001/1)", () => {
  const q = { id: "q1", sub: 10000, total: 10810, mwst: true, mwstRate: 8.1 };
  it("netto aus der Offerte, MWST separat", () => {
    expect(contractAmounts({ amount: 10000, quoteId: "q1" }, [q], 8.1)).toEqual({ net: 10000, rate: 8.1, tax: 810, gross: 10810 });
  });
  it("alte Verträge mit Bruttobetrag der Offerte werden als netto gelesen", () => {
    expect(contractAmounts({ amount: 10810, quoteId: "q1" }, [q], 8.1).net).toBe(10000);
  });
  it("Offerte ohne MWST", () => {
    expect(contractAmounts({ amount: 5000, quoteId: "q2" }, [{ id: "q2", sub: 5000, total: 5000, mwst: false, mwstRate: 8.1 }], 8.1)).toEqual({ net: 5000, rate: 0, tax: 0, gross: 5000 });
  });
});
