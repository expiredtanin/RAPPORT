// Tests für die Debitorenliste (offene Posten per Stichtag): Stichtag-Logik, Fälligkeitsklassen,
// Kundensummen, CSV und Übereinstimmung mit der Kennzahl «Offen» der Buchhaltung.

import { describe, expect, it } from "vitest";
import { accountingSummary } from "./accounting";
import { agingBucket, buildDebitorenCSV, daysOverdue, debitoren, isOpenAt, mahnstufeAt, mahnLabel } from "./debitoren";
import type { AppData, Invoice, Person, Project } from "./types";

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: "i1", number: "R-2026-001", clientId: "c1", date: "2026-03-01", dueDate: "2026-03-31", items: [], mwst: true, mwstRate: 8.1,
  status: "gesendet", sub: 1000, tax: 81, total: 1081, ...over,
}) as Invoice;

const data = (invoices: Invoice[], persons: Partial<Person>[] = [{ id: "c1", name: "Bauherr AG" }, { id: "c2", name: "Alpha GmbH" }], projects: Partial<Project>[] = [{ id: "p1", name: "Haus Berg" }]): AppData =>
  ({ invoices, persons, projects, settings: {} }) as unknown as AppData;

describe("isOpenAt — Stichtag-Logik", () => {
  it("gesendete Rechnung ist ab Rechnungsdatum offen, davor nicht", () => {
    const i = inv();
    expect(isOpenAt(i, "2026-02-28")).toBe(false);
    expect(isOpenAt(i, "2026-03-01")).toBe(true);
    expect(isOpenAt(i, "2026-12-31")).toBe(true);
  });

  it("bezahlt: offen bis und mit Zahlungstag davor, nach Zahlung nicht mehr (paidDate ≤ Stichtag = bezahlt)", () => {
    const i = inv({ status: "bezahlt", paidDate: "2026-04-15" });
    expect(isOpenAt(i, "2026-04-14")).toBe(true);
    expect(isOpenAt(i, "2026-04-15")).toBe(false);
    expect(isOpenAt(i, "2026-12-31")).toBe(false);
  });

  it("bezahlt ohne Zahlungsdatum: gilt wie in der Buchhaltung mit dem Rechnungsdatum als bezahlt", () => {
    const i = inv({ status: "bezahlt", paidDate: undefined });
    expect(isOpenAt(i, "2026-03-01")).toBe(false);
  });

  it("Entwurf ist nie offen", () => {
    expect(isOpenAt(inv({ status: "entwurf" }), "2026-12-31")).toBe(false);
  });

  it("überfällig ist offen; Rechnung ohne Datum ist nie offen", () => {
    expect(isOpenAt(inv({ status: "überfällig" }), "2026-06-01")).toBe(true);
    expect(isOpenAt(inv({ date: "" }), "2026-06-01")).toBe(false);
  });

  it("Rechnung nach dem Stichtag fehlt in der Liste, Gutschrift erscheint als Minusposten", () => {
    const d = data([
      inv({ id: "a", number: "A", date: "2026-12-15", dueDate: "2027-01-14" }),
      inv({ id: "b", number: "B", date: "2026-05-01", dueDate: "2026-05-31", total: 1000 }),
      inv({ id: "g", number: "G", date: "2026-06-01", dueDate: "2026-06-30", total: -250 }),
    ]);
    const r = debitoren(d, "2026-12-01");
    expect(r.rows.map(x => x.number).sort()).toEqual(["B", "G"]);
    expect(r.total).toBe(750);
    expect(r.rows.find(x => x.number === "G")!.amount).toBe(-250);
  });

  it("Rechnung mit Total 0 erscheint nicht", () => {
    expect(debitoren(data([inv({ total: 0 })]), "2026-12-31").rows).toEqual([]);
  });
});

describe("Fälligkeitsklassen", () => {
  it("Tage überfällig: 0 am Fälligkeitstag, 1 am Tag danach, 0 ohne Fälligkeit", () => {
    expect(daysOverdue("2026-03-31", "2026-03-31")).toBe(0);
    expect(daysOverdue("2026-03-31", "2026-04-01")).toBe(1);
    expect(daysOverdue(undefined, "2026-04-01")).toBe(0);
    expect(daysOverdue("2026-03-31", "2026-03-01")).toBe(0);
    // Sommerzeit-Wechsel darf die Tage nicht verschieben
    expect(daysOverdue("2026-03-20", "2026-04-05")).toBe(16);
  });

  it("Grenzen: 0 nicht fällig, 1 und 30 → 1–30, 31 → 31–60, 60/61, 90/91", () => {
    expect(agingBucket(0)).toBe("notDue");
    expect(agingBucket(1)).toBe("d1_30");
    expect(agingBucket(30)).toBe("d1_30");
    expect(agingBucket(31)).toBe("d31_60");
    expect(agingBucket(60)).toBe("d31_60");
    expect(agingBucket(61)).toBe("d61_90");
    expect(agingBucket(90)).toBe("d61_90");
    expect(agingBucket(91)).toBe("d90plus");
  });

  it("genau 30 und 31 Tage nach Fälligkeit landen in verschiedenen Klassen (mit Beträgen und Anzahl)", () => {
    const d = data([
      inv({ id: "a", number: "A", dueDate: "2026-05-01", total: 100 }),   // per 31.05. = 30 Tage
      inv({ id: "b", number: "B", dueDate: "2026-04-30", total: 200 }),   // 31 Tage
      inv({ id: "c", number: "C", dueDate: "2026-06-30", total: 400 }),   // nicht fällig
    ]);
    const r = debitoren(d, "2026-05-31");
    expect(r.buckets.notDue).toMatchObject({ amount: 400, count: 1 });
    expect(r.buckets.d1_30).toMatchObject({ amount: 100, count: 1 });
    expect(r.buckets.d31_60).toMatchObject({ amount: 200, count: 1 });
    expect(r.buckets.d61_90.count + r.buckets.d90plus.count).toBe(0);
    expect(r.overdueTotal).toBe(300);
    expect(r.overdueCount).toBe(2);
    // Klassen ergeben immer das Gesamttotal
    const sum = Object.values(r.buckets).reduce((s, b) => s + b.amount, 0);
    expect(sum).toBe(r.total);
  });

  it("Gutschrift gilt nie als überfällig (nicht fällig), Rechnung ohne Fälligkeit ebenso", () => {
    const d = data([
      inv({ id: "g", number: "G", dueDate: "2026-01-10", total: -100 }),
      inv({ id: "n", number: "N", dueDate: undefined, total: 50 }),
    ]);
    const r = debitoren(d, "2026-12-31");
    expect(r.buckets.notDue).toMatchObject({ amount: -50, count: 2 });
    expect(r.overdueCount).toBe(0);
  });
});

describe("Mahnstufe", () => {
  it("zählt nur Mahnungen bis zum Stichtag", () => {
    const i = inv({ reminders: [{ nr: 1, date: "2026-04-10" }, { nr: 2, date: "2026-05-10", sentDate: "2026-05-12" }] });
    expect(mahnstufeAt(i, "2026-04-09")).toBe(0);
    expect(mahnstufeAt(i, "2026-04-10")).toBe(1);
    expect(mahnstufeAt(i, "2026-05-11")).toBe(1);   // versandt erst am 12.
    expect(mahnstufeAt(i, "2026-05-12")).toBe(2);
    expect([0, 1, 2, 3].map(mahnLabel)).toEqual(["", "Erinnerung", "2. Mahnung", "3. Mahnung"]);
  });
});

describe("Gruppierung und Sortierung", () => {
  const d = data([
    inv({ id: "1", number: "B2", clientId: "c1", dueDate: "2026-06-30", total: 300.1 }),
    inv({ id: "2", number: "B1", clientId: "c1", dueDate: "2026-05-31", total: 200.2 }),
    inv({ id: "3", number: "A1", clientId: "c2", dueDate: "2026-06-15", total: 99.99, projectId: "p1" }),
    inv({ id: "4", number: "X1", clientId: "gone", dueDate: "2026-06-15", total: 10 }),
  ]);

  it("nach Kundenname, innerhalb nach Fälligkeit; Zwischensummen und Total auf Rappen", () => {
    const r = debitoren(d, "2026-07-31");
    expect(r.groups.map(g => g.clientName)).toEqual(["Alpha GmbH", "Bauherr AG", "Ohne Kunde"]);
    const bauherr = r.groups[1];
    expect(bauherr.rows.map(x => x.number)).toEqual(["B1", "B2"]);
    expect(bauherr.total).toBe(500.3);
    expect(bauherr.count).toBe(2);
    expect(r.groups[0].rows[0].projectName).toBe("Haus Berg");
    expect(r.total).toBe(610.29);
    expect(r.groups.reduce((s, g) => s + g.total, 0)).toBeCloseTo(r.total, 10);
    expect(r.count).toBe(4);
  });

  it("Filter nur überfällige", () => {
    const r = debitoren(d, "2026-06-20", { onlyOverdue: true });
    expect(r.rows.map(x => x.number).sort()).toEqual(["A1", "B1", "X1"]);
    expect(r.rows.every(x => x.daysOverdue > 0)).toBe(true);
  });
});

describe("CSV", () => {
  const d = data([
    inv({ id: "1", number: "R1", clientId: "e", dueDate: "2026-04-30", total: 1000, reminders: [{ nr: 1, date: "2026-05-05" }] }),
    inv({ id: "2", number: "R2", clientId: "e", dueDate: "2026-12-30", total: -50.5 }),
  ], [{ id: "e", name: "=HYPERLINK(\"x\")" }]);

  it("Trennzeichen «;», Formel-Anfänge maskiert, Beträge mit 2 Stellen, Summenzeilen", () => {
    const csv = buildDebitorenCSV(d, "2026-06-30");
    const lines = csv.split("\n");
    expect(lines[0]).toBe('"DEBITORENLISTE";"Stichtag";"2026-06-30"');
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).not.toMatch(/(^|;)"=/m);
    const row = lines.find(l => l.includes('"R1"'))!;
    expect(row.split(";")).toEqual(expect.arrayContaining(['"1000.00"', '"61"', '"Erinnerung"']));
    expect(csv).toContain('"-50.50"');
    expect(lines.some(l => l.includes("Zwischensumme") && l.includes('"949.50"'))).toBe(true);
    expect(lines.some(l => l.includes("TOTAL") && l.includes('"949.50"'))).toBe(true);
    // Fälligkeitsstruktur am Ende
    expect(csv).toContain("über 90 Tage");
  });

  it("jede Datenzeile hat gleich viele Spalten wie der Kopf", () => {
    const lines = buildDebitorenCSV(d, "2026-06-30").split("\n");
    const head = lines.findIndex(l => l.startsWith('"Kunde"'));
    expect(head).toBeGreaterThan(0);
    const cols = lines[head].split(";").length;
    expect(lines[head + 1].split(";").length).toBe(cols);
  });
});

describe("Übereinstimmung mit der Buchhaltung (Kennzahl «Offen»)", () => {
  it("Summe der offenen Posten per heute = openTotal + overdueTotal der Buchhaltung (alle Jahre)", () => {
    const today = "2026-11-28";
    const d = data([
      inv({ id: "1", number: "1", total: 1081, status: "gesendet" }),
      inv({ id: "2", number: "2", total: 500.55, status: "überfällig", dueDate: "2026-02-01" }),
      inv({ id: "3", number: "3", total: 777, status: "bezahlt", paidDate: "2026-04-01" }),
      inv({ id: "4", number: "4", total: 300, status: "entwurf" }),
      inv({ id: "5", number: "5", total: -120.25, status: "gesendet" }),
      inv({ id: "6", number: "6", total: 90, status: "bezahlt", paidDate: undefined }),
    ]);
    const acc = accountingSummary(d, "", today);
    expect(debitoren(d, today).total).toBe(Math.round((acc.openTotal + acc.overdueTotal) * 100) / 100);
  });
});

describe("Navigation und Rechte", () => {
  it("«Debitoren» sieht, wer das Recht «invoices» hat (und niemand ohne)", async () => {
    const { getVisibleNavItems } = await import("./auth");
    const ids = (perms: string[] | null) => getVisibleNavItems(perms).flatMap(i => i.children?.map(c => c.id) ?? [i.id]);
    expect(ids(["invoices"])).toContain("debitoren");
    expect(ids(null)).toContain("debitoren");
    expect(ids(["expenses", "time"])).not.toContain("debitoren");
  });
});
