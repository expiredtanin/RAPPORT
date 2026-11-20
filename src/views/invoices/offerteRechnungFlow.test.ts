// Audit-Tests des Ablaufs «Offerte → Projekt → Rechnungen» mit realistischen Zahlen.
// Prüft die reinen Rechenfunktionen (utils.ts, invoiceHelpers.ts, newInvoiceForm.ts) so, wie die
// Ansichten sie aufrufen. Die Summen beim Speichern einer Offerte (Quotes.tsx save) sind hier
// nachgebildet; Verknüpfen eines Nachtrags läuft über `quoteBudgetFields` wie in Quotes.tsx/ProjectDetail.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcManualHours, calcSIAHours, deriveQuoteBudget, generateQRReference, invoiceNet, mod10, projectFee, quoteBudgetFields, roundCHF, yearRevenue } from "../../utils";
import { SIA_PHASE_WEIGHTS } from "../../constants";
import { akontoPlanRows, applyEntryHours, billedNetForProject, buildAkontoInvoices, calcTotal, defaultInvoiceMode, entrySelectionsForEdit, generateSequentialNumbers, invoicesForQuote, isInvoiceNumberTaken, nextInvoiceNumber, selectedEntrySelections } from "./invoiceHelpers";
import type { AkontoPlan, InvoiceForm, NewInvoiceState } from "./invoiceHelpers";
import { buildNewInvoiceForm } from "./newInvoiceForm";
import type { AppData, Invoice, Project, Quote, TimeEntry } from "../../types";

const MWST = 8.1;
const roles = [
  { id: "PL", label: "Projektleitung", rate: 180 },
  { id: "AR", label: "Architekt:in", rate: 120 },
];
const settings = { mwstRate: MWST, invoiceNumberFormat: "YYYY-NNN", defaultHourlyRate: 140, roles };

const siaPhases = () => SIA_PHASE_WEIGHTS.map(ph => ({ id: ph.id, label: ph.label, items: ph.items.map(it => ({ ...it, enabled: true, r: 1 })) }));

/** Summen wie Quotes.tsx save() (Zeilen 189–220). */
function quoteTotals(q: Omit<Quote, "sub" | "tax" | "total">): Pick<Quote, "sub" | "tax" | "total" | "totalHours"> {
  const qRoles = q.quoteRoles || roles;
  const sia = q.mode === "sia" ? calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []) : null;
  const man = q.mode === "manual" ? calcManualHours(q.manualPhases || [], qRoles) : null;
  const free = q.mode === "free" ? (q.freeItems || []).reduce((s, it) => s + it.qty * it.price, 0) : 0;
  const sub = roundCHF(q.mode === "sia" ? (sia?.total || 0) * (q.sia?.stundenansatz || 0) : q.mode === "manual" ? (man?.totalAmount || 0) : free);
  const tax = q.mwst ? roundCHF(sub * ((q.mwstRate ?? MWST) / 100)) : 0;
  return { sub, tax, total: roundCHF(sub + tax), totalHours: q.mode === "sia" ? sia?.total : man?.totalHours };
}

const mkQuote = (q: Omit<Quote, "sub" | "tax" | "total">): Quote => ({ ...q, ...quoteTotals(q) } as Quote);

const hoSia = mkQuote({
  id: "q-ho", number: "O2026-001", clientId: "c1", projectId: "p1", projectName: "MFH Seestrasse", date: "2026-01-10",
  mode: "sia", status: "angenommen", mwst: true, mwstRate: MWST,
  sia: { baukosten: 4_200_000, schwierigkeit: 1, stundenansatz: 140, phases: siaPhases() },
});
const ntFree = mkQuote({
  id: "q-nt", number: "O2026-007", clientId: "c1", projectId: "p1", projectName: "Nachtrag Attika", date: "2026-05-02",
  mode: "free", status: "angenommen", mwst: true, mwstRate: MWST,
  freeItems: [{ id: "f1", desc: "Mehraufwand Attika", qty: 1, price: 50_000 }],
});
const manualQuote = mkQuote({
  id: "q-man", number: "O2026-003", clientId: "c2", projectId: "p2", projectName: "Umbau Praxis", date: "2026-02-01",
  mode: "manual", status: "angenommen", mwst: true, mwstRate: MWST, quoteRoles: roles,
  manualPhases: [
    { id: "31", label: "31 Vorprojekt", enabled: true, hoursByRole: { PL: 100, AR: 0 } },
    { id: "52", label: "52 Ausführung", enabled: true, hoursByRole: { PL: 0, AR: 300 } },
  ],
});

/** Projekt wie Quotes.tsx createProjectFromQuote() für eine SIA-Offerte (Zeilen 120–185). */
function projectFromSia(q: Quote): Project {
  const calc = calcSIAHours(q.sia?.baukosten, q.sia?.schwierigkeit, q.sia?.phases || []);
  return {
    id: "p1", number: "2026/01", name: "MFH Seestrasse", clientId: "c1", billingType: "pauschal",
    hourlyRate: q.sia!.stundenansatz, budget: q.sub, budgetAmount: q.sub, status: "aktiv",
    budgetHours: Math.round(calc.total * 10) / 10,
    enabledPhases: calc.phases.filter(ph => ph.hours > 0).map(ph => ph.id),
    phasesBudget: calc.phases.filter(ph => ph.hours > 0).map(ph => ({ id: ph.id, hours: Math.round(ph.hours * 10) / 10 })),
    linkedQuotes: [{ quoteId: q.id, role: "Hauptofferte" }],
  } as Project;
}

/** Offerte als Nachtrag verknüpfen wie Quotes.tsx doCreate() (attach). */
function attachNachtrag(p: Project, q: Quote, quotes: Quote[]): Project {
  const newLinked = [...(p.linkedQuotes || []), { quoteId: q.id, role: "Nachtrag" }];
  const d = quoteBudgetFields(p, newLinked, quotes, roles);
  return { ...p, linkedQuotes: newLinked, budgetHours: d.budgetHours, budgetAmount: d.budgetAmount, phasesBudget: d.phasesBudget, budget: d.budget,
    enabledPhases: [...new Set([...(p.enabledPhases || []), ...d.enabledPhases])] };
}

const mkData = (projects: Project[], quotes: Quote[], timeEntries: TimeEntry[] = []) =>
  ({ settings, projects, quotes, timeEntries, invoices: [] } as unknown as AppData);

/** Gespeicherte Rechnung aus einem Formular (wie Invoices.tsx save()). */
function saveInvoice(form: Partial<Invoice>, id: string, status = "gesendet"): Invoice {
  const t = calcTotal(form.items, form.mwst, form.mwstRate ?? MWST, form.discountType, form.discountValue);
  return { ...form, id, status, ...t } as Invoice;
}

const ni = (over: Partial<NewInvoiceState>): NewInvoiceState => ({ tab: "projekt", projectId: "p1", quoteId: "", mode: "akonto-amount", pct: 30, amt: 0, phaseId: "", ...over });
const noEntries = () => [] as TimeEntry[];

describe("Offerte: Summen", () => {
  it("SIA 102, Baukosten 4.2 Mio, n = 1.0, CHF 140/h: 5358.3 h, Netto 750'162, MWST 60'763.12, Total 810'925.12", () => {
    const calc = calcSIAHours(4_200_000, 1, siaPhases());
    expect(calc.p).toBe(0.128);
    expect(calc.total).toBeCloseTo(5358.3, 6);
    expect(hoSia.sub).toBe(750_162);
    expect(hoSia.tax).toBe(60_763.12);
    expect(hoSia.total).toBe(810_925.12);
    // Phasenhonorare (wie im PDF) ergeben zusammen das Netto
    const phaseSum = calc.phases.reduce((s, ph) => s + ph.hours * 140, 0);
    expect(phaseSum).toBeCloseTo(hoSia.sub, 4);
  });

  it("SIA-Teilleistungen summieren auf 100 %", () => {
    const pct = SIA_PHASE_WEIGHTS.flatMap(ph => ph.items).reduce((s, it) => s + it.pct, 0);
    expect(pct).toBeCloseTo(100, 6);
  });

  it("Aufwand: 100 h PL à 180 + 300 h AR à 120 = 54'000 netto, 58'374 brutto", () => {
    expect(manualQuote.sub).toBe(54_000);
    expect(manualQuote.total).toBe(58_374);
    expect(manualQuote.totalHours).toBe(400);
  });

  // Netto und MWST auf Rappen gerundet, Total = Summe (früher: 35.63 + 2.89 gedruckt, Total 38.51).
  it("Netto + MWST = Total auf den Rappen (0.25 h à 142.50 → 35.63 + 2.89 = 38.52)", () => {
    const t = calcTotal([{ id: "1", desc: "x", qty: 0.25, price: 142.5, discount: 0 }], true, MWST, "none", 0);
    expect([t.subAfterDisc, t.tax, t.total]).toEqual([35.63, 2.89, 38.52]);
    for (let q = 1; q <= 200; q++) for (const rate of [120, 142.5, 155]) for (const d of [0, 7.5]) {
      const r = calcTotal([{ id: "1", desc: "x", qty: q / 4, price: rate, discount: d }], true, MWST, "percent", 3);
      expect(roundCHF(r.subAfterDisc + r.tax)).toBe(r.total);
      expect(roundCHF(r.subAfterDisc)).toBe(r.subAfterDisc);
      expect(roundCHF(r.tax)).toBe(r.tax);
    }
  });
});

describe("Offerte → Projekt: Budget", () => {
  it("Projekt aus SIA-Offerte: Budget = Netto der Offerte, Stunden × Satz = Budget, Phasen vollständig", () => {
    const p = projectFromSia(hoSia);
    const d = deriveQuoteBudget(p.linkedQuotes, [hoSia], roles);
    expect(d.budgetAmount).toBe(750_162);
    expect(projectFee(p)).toBe(750_162);
    expect(d.budgetHours).toBe(p.budgetHours);
    expect(d.phasesBudget).toEqual(p.phasesBudget);
    expect((p.budgetHours || 0) * (p.hourlyRate || 0)).toBeCloseTo(p.budget || 0, 4);
  });

  it("Nachtrag (freie Positionen 50'000) erhöht budgetAmount auf 800'162 und lässt die Stunden gleich", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    expect(p.budgetAmount).toBe(800_162);
    expect(p.budgetHours).toBe(5358.3);
  });

  // Eine Quelle für das Pauschalhonorar (projectFee): Hauptofferte + Nachträge.
  it("Schlussrechnung eines Pauschalprojekts mit Nachtrag weist HO + Nachtrag aus (800'162, nicht 750'162)", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    expect(p.budget).toBe(800_162);
    const res = buildNewInvoiceForm(ni({ mode: "schluss" }), mkData([p], [hoSia, ntFree]), [], "2026-010", noEntries);
    expect(res?.form?.items[0].price).toBe(800_162);
  });

  it("Altdaten: Nachtrag verknüpft, aber `budget` noch auf HO-Wert → projectFee liest budgetAmount", () => {
    const stale = { ...attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]), budget: 750_162 };
    expect(projectFee(stale)).toBe(800_162);
    // ohne Offerten gilt der von Hand gesetzte Pauschalpreis; fehlt er, budgetAmount
    expect(projectFee({ budget: 96_000, budgetAmount: 0, linkedQuotes: [] })).toBe(96_000);
    expect(projectFee({ budget: 0, budgetAmount: 12_000 })).toBe(12_000);
  });

  it("Entkoppeln des Nachtrags führt das Pauschalhonorar auf die Hauptofferte zurück", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    const linked = (p.linkedQuotes || []).filter(lq => lq.quoteId !== "q-nt");
    const f = quoteBudgetFields(p, linked, [hoSia, ntFree], roles);
    expect([f.budget, f.budgetAmount]).toEqual([750_162, 750_162]);
    // letzte Offerte entfernt: von Hand gesetzter Pauschalpreis bleibt stehen
    expect(quoteBudgetFields({ ...p, budget: 1234 }, [], [hoSia], roles).budget).toBe(1234);
  });

  it("Akonto 30 % vom Budget eines Projekts mit Nachtrag = 240'048.60 (nicht 225'048.60)", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    const res = buildNewInvoiceForm(ni({ mode: "akonto-percent", pct: 30 }), mkData([p], [hoSia, ntFree]), [], "2026-010", noEntries);
    expect(res?.form?.items[0].price).toBe(240_048.6);
  });

  // Aufwand-Offerte → Projekt mit Mischsatz (54'000 / 400 h = 135). Die Teilrechnung «Nach SIA-Phase»
  // nimmt den offerierten Phasenbetrag (Stunden × Satz der Rolle), nicht Stunden × Mischsatz.
  it("Teilrechnung Phase 31 einer Aufwand-Offerte = offerierte 18'000 (nicht 100 h × 135 = 13'500)", () => {
    const d = deriveQuoteBudget([{ quoteId: "q-man", role: "Hauptofferte" }], [manualQuote], roles);
    const p = { id: "p2", number: "2026/02", name: "Umbau Praxis", clientId: "c2", billingType: "stundensatz", status: "aktiv",
      hourlyRate: 135, budget: 0, budgetAmount: d.budgetAmount, budgetHours: d.budgetHours, phasesBudget: d.phasesBudget,
      enabledPhases: d.enabledPhases, linkedQuotes: [{ quoteId: "q-man", role: "Hauptofferte" }] } as Project;
    const res = buildNewInvoiceForm(ni({ projectId: "p2", mode: "phase", phaseId: "31" }), mkData([p], [manualQuote]), [], "2026-011", noEntries);
    expect(res?.form?.items[0].price).toBe(18_000);
    const res52 = buildNewInvoiceForm(ni({ projectId: "p2", mode: "akonto-phase", phaseId: "52" }), mkData([p], [manualQuote]), [], "2026-012", noEntries);
    expect(res52?.form?.items[0].price).toBe(36_000);
    // ohne verknüpfte Offerte: Phasenstunden × Stundensatz
    const noQuote = { ...p, linkedQuotes: [] };
    expect(buildNewInvoiceForm(ni({ projectId: "p2", mode: "phase", phaseId: "31" }), mkData([noQuote], [manualQuote]), [], "x", noEntries)?.form?.items[0].price).toBe(13_500);
  });
});

describe("Rechnungen aus dem Projekt (Pauschal)", () => {
  it("3 Akonti à 200'000 + Schlussrechnung: Netto-Summe = Budget, Brutto-Summe = Offertsumme", () => {
    const p = projectFromSia(hoSia);
    const data = mkData([p], [hoSia]);
    const invoices: Invoice[] = [];
    for (let i = 0; i < 3; i++) {
      const res = buildNewInvoiceForm(ni({ mode: "akonto-amount", amt: 200_000 }), data, invoices, `2026-00${i + 1}`, noEntries);
      invoices.push(saveInvoice(res!.form!, `a${i}`));
    }
    expect(invoices.map(i => i.total)).toEqual([216_200, 216_200, 216_200]);
    // ein Entwurf (z.B. aus dem Akonto-Planer) wird NICHT abgezogen
    invoices.push(saveInvoice(buildNewInvoiceForm(ni({ mode: "akonto-amount", amt: 99 }), data, invoices, "2026-004", noEntries)!.form!, "draft", "entwurf"));
    const schlussForm = buildNewInvoiceForm(ni({ mode: "schluss" }), data, invoices, "2026-005", noEntries)!.form!;
    expect(schlussForm.items.map(it => it.price)).toEqual([hoSia.sub, -600_000]);
    const schluss = saveInvoice(schlussForm, "s");
    expect(schluss.sub).toBe(150_162);
    expect(schluss.total).toBe(162_325.12);
    const billed = [...invoices.filter(i => i.status !== "entwurf"), schluss];
    expect(billed.reduce((s, i) => s + i.sub, 0)).toBe(hoSia.sub);
    expect(roundCHF(billed.reduce((s, i) => s + i.total, 0))).toBe(hoSia.total);
  });

  it("Schlussrechnung zieht Akonti netto nach Gesamtrabatt ab (subAfterDisc)", () => {
    const p = projectFromSia(hoSia);
    const data = mkData([p], [hoSia]);
    const akForm = buildNewInvoiceForm(ni({ mode: "akonto-amount", amt: 100_000 }), data, [], "2026-001", noEntries)!.form!;
    const ak = saveInvoice({ ...akForm, discountType: "percent", discountValue: 10 }, "a1");
    expect(ak.subAfterDisc).toBe(90_000);
    expect(ak.total).toBe(97_290);
    const sf = buildNewInvoiceForm(ni({ mode: "schluss" }), data, [ak], "2026-002", noEntries)!.form!;
    expect(sf.items[1].price).toBe(-90_000);
  });
});

describe("Rechnungen aus der Offerte", () => {
  // Offerte-Reiter: abgezogen werden nur Rechnungen dieser Offerte (bei der Hauptofferte zusätzlich die
  // Projekt-Rechnungen ohne Offertbezug), nicht die eines Nachtrags (invoicesForQuote).
  it("Schlussrechnung zur Hauptofferte zieht die Nachtrags-Rechnung nicht ab (550'162, nicht 500'162)", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    const data = mkData([p], [hoSia, ntFree]);
    const akHo = saveInvoice(buildNewInvoiceForm(ni({ tab: "offerte", quoteId: "q-ho", mode: "akonto-amount", amt: 200_000 }), data, [], "2026-001", noEntries)!.form!, "a1");
    const ntInv = saveInvoice(buildNewInvoiceForm(ni({ tab: "offerte", quoteId: "q-nt", mode: "teilrechnung-percent", pct: 100 }), data, [akHo], "2026-002", noEntries)!.form!, "n1");
    expect(ntInv.sub).toBe(50_000);
    const sf = buildNewInvoiceForm(ni({ tab: "offerte", quoteId: "q-ho", mode: "schluss" }), data, [akHo, ntInv], "2026-003", noEntries)!.form!;
    const net = sf.items.reduce((s, it) => s + it.qty * it.price, 0);
    expect(net).toBeCloseTo(550_162, 4);
  });

  // Gegenrichtung: Schlussrechnung zum Nachtrag darf das Akonto der Hauptofferte nicht abziehen.
  it("Schlussrechnung zum Nachtrag nach HO-Akonto 200'000 = 50'000 (nicht −150'000)", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    const data = mkData([p], [hoSia, ntFree]);
    const akHo = saveInvoice(buildNewInvoiceForm(ni({ tab: "offerte", quoteId: "q-ho", mode: "akonto-amount", amt: 200_000 }), data, [], "2026-001", noEntries)!.form!, "a1");
    const sf = buildNewInvoiceForm(ni({ tab: "offerte", quoteId: "q-nt", mode: "schluss" }), data, [akHo], "2026-002", noEntries)!.form!;
    const net = sf.items.reduce((s, it) => s + it.qty * it.price, 0);
    expect(net).toBe(50_000);
  });
});

describe("Rechnungen aus dem Projekt (Stundensatz)", () => {
  const p2 = { id: "p2", number: "2026/02", name: "Umbau Praxis", clientId: "c2", billingType: "stundensatz", status: "aktiv",
    hourlyRate: 135, budget: 0, budgetAmount: 54_000 } as Project;
  const entries: TimeEntry[] = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, date: "2026-03-0" + (i % 9 + 1), employeeId: "m1", projectId: "p2", minutes: 600 }));

  it("Teilrechnung nach Stunden: 100 h × 135 = 13'500, alle offenen Einträge ausgewählt", () => {
    const res = buildNewInvoiceForm(ni({ projectId: "p2", mode: "teilrechnung" }), mkData([p2], []), [], "2026-020", () => entries)!.form!;
    expect(res.items[0].qty).toBe(100);
    expect(res.items[0].price).toBe(135);
    expect(Object.keys(res.entrySelections || {})).toHaveLength(10);
  });

  // Schlussrechnung eines Stundensatz-Projekts zieht Akonti ohne Zeiteinträge (Fixbetrag / %) ab, nach
  // Stunden gestellte (Zeiteinträge markiert) aber nicht — deren Stunden sind schon nicht mehr offen.
  it("Schlussrechnung nach Akonto 5'000 (Fixbetrag) weist nur noch 8'500 netto aus", () => {
    const data = mkData([p2], []);
    const ak = saveInvoice({ ...buildNewInvoiceForm(ni({ projectId: "p2", mode: "akonto-amount", amt: 5_000 }), data, [], "2026-021", () => entries)!.form! }, "ak");
    const sf = buildNewInvoiceForm(ni({ projectId: "p2", mode: "schluss" }), data, [ak], "2026-022", () => entries)!.form!;
    const net = sf.items.reduce((s, it) => s + it.qty * it.price, 0);
    expect(net).toBe(8_500);
  });
});

describe("Nummern und Akonto-Plan", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T10:00:00")); });
  afterEach(() => { vi.useRealTimers(); });

  const inv = (number: string) => ({ number } as Invoice);

  it("laufende Nummer pro Jahr: 2025-017 zählt nicht, 2026-004 → 2026-005", () => {
    expect(nextInvoiceNumber([inv("2025-017")], "YYYY-NNN")).toBe("2026-001");
    expect(nextInvoiceNumber([inv("2025-017"), inv("2026-004"), inv("2026-002")], "YYYY-NNN")).toBe("2026-005");
    expect(generateSequentialNumbers([inv("2026-004")], "YYYY-NNN", ["2026-12-01", "2027-01-01", "2027-02-01"])).toEqual(["2026-005", "2027-001", "2027-002"]);
  });

  it("Format mit Monat (YYYY-MM-NNN) bei Einzelrechnungen", () => {
    expect(nextInvoiceNumber([inv("2026-10-007")], "YYYY-MM-NNN")).toBe("2026-11-008");
  });

  it("Akonto-Planer mit Format YYYY-MM-NNN: Monat aus dem Ratendatum (2026-11-008, 2026-12-009)", () => {
    expect(generateSequentialNumbers([inv("2026-10-007")], "YYYY-MM-NNN", ["2026-11-30", "2026-12-31"])).toEqual(["2026-11-008", "2026-12-009"]);
  });

  it("Jahr der Rechnungsnummer aus dem Rechnungsdatum; Duplikate werden erkannt", () => {
    expect(nextInvoiceNumber([inv("2026-004")], "YYYY-NNN", "2027-01-05")).toBe("2027-001");
    const all = [{ id: "a", number: "2026-003" }, { id: "b", number: "2026-004" }] as Invoice[];
    expect(isInvoiceNumberTaken(all, " 2026-003 ", "b")).toBe(true);
    expect(isInvoiceNumberTaken(all, "2026-003", "a")).toBe(false);
    expect(isInvoiceNumberTaken(all, "2026-005", null)).toBe(false);
  });

  it("Akonto-Plan 4 × alle 4 Monate über 750'162: Raten à 187'540.50, Daten mit Monatsende-Klemmung", () => {
    const ap: AkontoPlan = { projectId: "p1", clientId: "c1", totalAmt: 750_162, mode: "interval", intervalMonths: 4, count: 4, startDate: "2026-01-31", manualRows: [] };
    const rows = akontoPlanRows(ap);
    expect(rows.map(r => r.date)).toEqual(["2026-01-31", "2026-05-31", "2026-09-30", "2027-01-31"]);
    expect(rows.every(r => r.amt === 187_540.5)).toBe(true);
    const invs = buildAkontoInvoices(rows, ap, mkData([projectFromSia(hoSia)], [hoSia]), []);
    expect(invs.map(i => i.number)).toEqual(["2026-001", "2026-002", "2026-003", "2027-001"]);
    expect(invs.every(i => i.status === "entwurf" && i.invoiceKind === "akonto" && i.total === 202_731.28)).toBe(true);
  });

  // Mehr als 24 Raten: auf 24 begrenzt, der Betrag wird durch die tatsächliche Anzahl geteilt.
  it("Akonto-Plan mit 30 Raten verteilt das ganze Honorar (24 Raten à 12'500)", () => {
    const ap: AkontoPlan = { projectId: "p1", clientId: "c1", totalAmt: 300_000, mode: "interval", intervalMonths: 1, count: 30, startDate: "2026-01-01", manualRows: [] };
    const rows = akontoPlanRows(ap);
    expect(rows).toHaveLength(24);
    expect(rows.reduce((s, r) => s + r.amt, 0)).toBeCloseTo(300_000, 2);
  });

  it("Restbetrag für den Akonto-Planer: Budget minus gestellte Rechnungen (ohne Entwürfe)", () => {
    const invs = [
      { id: "1", projectId: "p1", status: "bezahlt", sub: 200_000, globalDisc: 0 },
      { id: "2", projectId: "p1", status: "gesendet", sub: 100_000, globalDisc: 10_000 },
      { id: "3", projectId: "p1", status: "entwurf", sub: 50_000, globalDisc: 0 },
      { id: "4", projectId: "p9", status: "bezahlt", sub: 1, globalDisc: 0 },
    ] as Invoice[];
    expect(billedNetForProject(invs, "p1")).toBe(290_000);
  });
});

describe("Rabatt und MWST", () => {
  it("Gesamtrabatt 10 % und Zeilenrabatt: Netto nach Rabatt, MWST darauf, Total auf Rappen", () => {
    const t = calcTotal([
      { id: "1", desc: "Honorar", qty: 1, price: 10_000, discount: 0 },
      { id: "2", desc: "Modell", qty: 2, price: 500, discount: 20 },
    ], true, MWST, "percent", 10);
    expect(t.sub).toBe(10_800);
    expect(t.globalDisc).toBe(1_080);
    expect(t.subAfterDisc).toBe(9_720);
    expect(t.tax).toBe(787.32);
    expect(t.total).toBe(10_507.32);
  });

  it("QR-Referenz aus Rechnungsnummer 2026-005: 27 Stellen, gültige Prüfziffer", () => {
    const ref = generateQRReference("2026-005");
    expect(ref).toBe("00000000000000000002026005" + mod10("00000000000000000002026005"));
  });
});

describe("Rechnungsformular: Stunden-Zeile und Startmodus (Nr. 1/2)", () => {
  const p2 = { id: "p2", name: "Umbau Praxis", billingType: "stundensatz", hourlyRate: 165 } as Project;
  const p1 = { id: "p1", name: "MFH", billingType: "pauschal", hourlyRate: 155 } as Project;

  it("Startmodus nach Abrechnungsart: Pauschal → Akonto %, Stundensatz → Teilrechnung nach Stunden", () => {
    expect(defaultInvoiceMode(p1)).toBe("akonto-percent");
    expect(defaultInvoiceMode(p2)).toBe("teilrechnung");
    expect(defaultInvoiceMode({ billingType: "", type: "stundensatz" } as Project)).toBe("teilrechnung");
    expect(defaultInvoiceMode(undefined)).toBe("akonto-percent");
  });

  it("Akonto 5'000 als Fixbetrag eines Stundensatz-Projekts bleibt 5'000 (keine Stunden-Zeile)", () => {
    const form = buildNewInvoiceForm(ni({ projectId: "p2", mode: "akonto-amount", amt: 5_000 }), mkData([p2], []), [], "x", noEntries)!.form!;
    expect(form.hoursFromEntries).toBeFalsy();
    expect(applyEntryHours(form, p2).items[0]).toMatchObject({ qty: 1, price: 5_000 });
  });

  it("Rechnung nach Stunden: Zeile 1 folgt der Auswahl (8 h + 2 h gekürzt auf 1.5 h = 9.5 h × 165)", () => {
    const form: InvoiceForm = { hoursFromEntries: true, entrySelections: { a: { selected: true, billedMinutes: 480 }, b: { selected: true, billedMinutes: 90 }, c: { selected: false, billedMinutes: 60 } },
      items: [{ id: "1", desc: "Leistungen", qty: 10, price: 165, discount: 5 }, { id: "2", desc: "Spesen", qty: 1, price: 80 }] };
    const out = applyEntryHours(form, p2);
    expect(out.items[0]).toMatchObject({ qty: 9.5, price: 165, discount: 5, desc: "Leistungen" });
    expect(out.items[1]).toEqual(form.items[1]);
  });

  it("Verrechnete Minuten werden gespeichert und beim Bearbeiten wieder geladen", () => {
    const saved = selectedEntrySelections({ a: { selected: true, billedMinutes: 480 }, b: { selected: false, billedMinutes: 30 } });
    expect(saved).toEqual({ a: { selected: true, billedMinutes: 480 } });
    const entries = [
      { id: "a", minutes: 600, invoiceId: "inv1" }, { id: "b", minutes: 120, invoiceId: "inv1" }, { id: "c", minutes: 60, invoiceId: null },
    ] as TimeEntry[];
    // a gekürzt gespeichert, b aus einer älteren Rechnung ohne gespeicherte Auswahl → volle Minuten
    expect(entrySelectionsForEdit({ id: "inv1", entrySelections: saved }, entries)).toEqual({
      a: { selected: true, billedMinutes: 480 }, b: { selected: true, billedMinutes: 120 },
    });
  });
});

describe("Kennzahlen netto nach Rabatt (Nr. 8/18)", () => {
  const invs = [
    { id: "1", status: "bezahlt", date: "2026-03-01", paidDate: "2027-01-10", sub: 10_000, globalDisc: 1_000, subAfterDisc: 9_000 },
    { id: "2", status: "gesendet", date: "2026-06-01", sub: 5_000, globalDisc: 0, subAfterDisc: 5_000 },
    { id: "3", status: "entwurf", date: "2026-07-01", sub: 7_000, globalDisc: 0 },
    { id: "4", status: "bezahlt", date: "2025-12-20", paidDate: "2026-01-05", sub: 3_000, globalDisc: 0 },
    // aus der Cloud geladen: subAfterDisc fehlt als 0
    { id: "5", status: "bezahlt", date: "2026-02-01", sub: 2_000, globalDisc: 0, subAfterDisc: 0 },
  ] as Invoice[];

  it("invoiceNet = Netto nach Gesamtrabatt, auch wenn subAfterDisc fehlt", () => {
    expect(invs.map(invoiceNet)).toEqual([9_000, 5_000, 7_000, 3_000, 2_000]);
  });

  it("Umsatz 2026 = gestellte Rechnungen nach Rechnungsdatum, ohne Entwürfe", () => {
    expect(yearRevenue(invs, "2026")).toBe(16_000);
    expect(yearRevenue(invs, "2025")).toBe(3_000);
  });

  it("invoicesForQuote: Hauptofferte mit Projekt-Rechnungen ohne Offertbezug, Nachtrag nur eigene", () => {
    const p = attachNachtrag(projectFromSia(hoSia), ntFree, [hoSia, ntFree]);
    const list = [
      { id: "a", projectId: "p1" }, { id: "b", projectId: "p1", quoteId: "q-ho" }, { id: "c", projectId: "p1", quoteId: "q-nt" }, { id: "d", projectId: "p9" },
    ] as Invoice[];
    expect(invoicesForQuote(hoSia, list, [p]).map(i => i.id)).toEqual(["a", "b"]);
    expect(invoicesForQuote(ntFree, list, [p]).map(i => i.id)).toEqual(["c"]);
  });
});
