// Tests: Lohn-Optionen (Vorsystem-Summen, 13. Monatslohn nach Betrieb, Nachzahlung, 5-Rappen-Rundung).

import { describe, expect, it } from "vitest";
import { calcLohn, lohnOptionen, runden5Rappen } from "./utils";
import { lohnNachzahlungOffen, lohnVorperioden } from "./accounting";
import type { Employee, LohnEntry, LohnVorsystem } from "./types";

const emp = (over: Partial<Employee> = {}): Employee =>
  ({ id: "e1", name: "Anna Muster", role: "Architektin", pensum: 100, wochenstunden: 42, ferienWochen: 5, monatslohn: 7500, ...over }) as Employee;
const mm = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

/** Ein ganzes Jahr abrechnen wie der Lohnlauf (frühere Abrechnungen = Vorperioden). */
function jahr(e: Employee, year: number, optionen = {}, vorsystem?: LohnVorsystem[]): LohnEntry[] {
  const done: LohnEntry[] = [];
  for (let m = 1; m <= 12; m++) {
    const monat = mm(year, m);
    const r = calcLohn(e, monat, [], 0, lohnVorperioden(done, e.id, monat, vorsystem), undefined, 0, optionen);
    if (r.brutto === 0 && r.bruttoTotal === 0) continue;
    done.push({ ...r, id: monat, employeeId: e.id, monat });
  }
  return done;
}

describe("Vorsystem-Summen (Umstieg mitten im Jahr)", () => {
  const vs = (over: Partial<LohnVorsystem> = {}): LohnVorsystem[] => [{ jahr: 2026, bisMonat: "2026-05", brutto: 100000, alvBasis: 61750, ...over }];

  it("Vorperioden: Vorsystem zählt für Monate nach bisMonat, nicht davor und nicht in anderen Jahren", () => {
    expect(lohnVorperioden([], "e1", "2026-06", vs())).toMatchObject({ bruttoBisher: 100000, alvBasisBisher: 61750 });
    expect(lohnVorperioden([], "e1", "2026-05", vs()).bruttoBisher).toBe(0);
    expect(lohnVorperioden([], "e1", "2027-06", vs()).bruttoBisher).toBe(0);
  });

  it("Juni, 20'000/Monat, Jan–Mai 100'000 mit ALV-Basis 61'750 im Vorsystem: ALV-Basis Juni 12'350 (Höchstlohn bis Juni 74'100)", () => {
    const e = emp({ monatslohn: 20000 });
    const ohne = calcLohn(e, "2026-06");
    expect(ohne.alvBasis).toBe(20000);
    const mit = calcLohn(e, "2026-06", [], 0, lohnVorperioden([], "e1", "2026-06", vs()));
    expect(mit.alvBasis).toBe(12350);
    expect(mit.alv).toBe(135.85);
    expect(mit.nbu).toBe(185.25);
    expect(mit.hinweise?.some(h => h.includes("Vorsystem"))).toBe(true);
  });

  it("hat das Vorsystem schon mehr als den anteiligen Höchstlohn abgezogen (100'000), ist der Juni ALV-frei; das Jahr endet genau bei 148'200", () => {
    const e = emp({ monatslohn: 20000 });
    const v = vs({ alvBasis: 100000 });
    const done: LohnEntry[] = [];
    let alvBasis = 0;
    for (let m = 6; m <= 12; m++) {
      const monat = mm(2026, m);
      const r = calcLohn(e, monat, [], 0, lohnVorperioden(done, "e1", monat, v));
      if (m === 6) expect(r.alvBasis).toBe(0);
      done.push({ ...r, id: monat, employeeId: "e1", monat });
      alvBasis += r.alvBasis!;
    }
    expect(100000 + alvBasis).toBe(148200);
  });

  it("ohne ALV-Basis: AHV-Lohn, höchstens der anteilige Höchstlohn bis bisMonat", () => {
    const p = lohnVorperioden([], "e1", "2026-06", vs({ alvBasis: undefined }));
    expect(p.alvBasisBisher).toBe(61750);
  });

  it("Vorsystem ersetzt die Monate bis bisMonat: eigene Abrechnungen davor zählen nicht doppelt", () => {
    const frueher = [{ id: "a", employeeId: "e1", monat: "2026-03", bruttoTotal: 5000, alvBasis: 5000, brutto: 5000, dreizehnter: 0 }];
    expect(lohnVorperioden(frueher, "e1", "2026-06", vs()).bruttoBisher).toBe(100000);
  });

  it("13. Monatslohn monatlich: Dezember gleicht mit den Vorsystem-Summen aus", () => {
    // Vorsystem Jan–Mai: 5 × 7500 Monatslohn, 5 × 625 = 3'125 13. bezahlt
    const v: LohnVorsystem[] = [{ jahr: 2026, bisMonat: "2026-05", brutto: 40625, dreizehnter: 3125, monatslohnSumme: 37500 }];
    const e = emp({ dreizehnterLohn: true });
    const done: LohnEntry[] = [];
    for (let m = 6; m <= 12; m++) {
      const monat = mm(2026, m);
      const r = calcLohn(e, monat, [], 0, lohnVorperioden(done, "e1", monat, v));
      done.push({ ...r, id: monat, employeeId: "e1", monat });
    }
    expect(sum([3125, ...done.map(d => d.dreizehnter)])).toBe(7500);
  });

  it("13. im Auszahlungsmodus: bezahlte 13.-Anteile im Vorsystem werden angerechnet", () => {
    const v: LohnVorsystem[] = [{ jahr: 2026, bisMonat: "2026-05", brutto: 37500, dreizehnter: 0, monatslohnSumme: 37500 }];
    const e = emp({ dreizehnterLohn: true });
    const done: LohnEntry[] = [];
    for (let m = 6; m <= 12; m++) {
      const monat = mm(2026, m);
      const r = calcLohn(e, monat, [], 0, lohnVorperioden(done, "e1", monat, v), undefined, 0, { dreizehnterModus: "dezember" });
      done.push({ ...r, id: monat, employeeId: "e1", monat });
    }
    expect(done.find(d => d.monat === "2026-12")!.dreizehnter).toBe(7500);
  });
});

describe("13. Monatslohn: Auszahlung nach Betrieb", () => {
  const e = emp({ dreizehnterLohn: true });

  it("Standard monatlich 1/12 (unverändert)", () => {
    const r = calcLohn(e, "2026-03");
    expect(r.dreizehnter).toBe(625);
    expect(r.dreizehnterArt).toBe("monatlich");
  });

  it("mit dem Novemberlohn: Januar bis Oktober ohne, November 7'500, Dezember 0", () => {
    const y = jahr(e, 2026, { dreizehnterModus: "november" });
    expect(y.filter(d => d.monat < "2026-11").every(d => d.dreizehnter === 0)).toBe(true);
    const nov = y.find(d => d.monat === "2026-11")!;
    expect(nov.dreizehnter).toBe(7500);
    expect(nov.dreizehnterArt).toBe("einmal");
    expect(nov.bruttoTotal).toBe(15000);
    expect(y.find(d => d.monat === "2026-12")!.dreizehnter).toBe(0);
    expect(sum(y.map(d => d.dreizehnter))).toBe(7500);
  });

  it("mit dem Dezemberlohn", () => {
    const y = jahr(e, 2026, { dreizehnterModus: "dezember" });
    expect(y.find(d => d.monat === "2026-11")!.dreizehnter).toBe(0);
    expect(y.find(d => d.monat === "2026-12")!.dreizehnter).toBe(7500);
  });

  it("pro Person übersteuerbar", () => {
    const y = jahr(emp({ dreizehnterLohn: true, dreizehnterModus: "dezember" }), 2026, { dreizehnterModus: "november" });
    expect(y.find(d => d.monat === "2026-12")!.dreizehnter).toBe(7500);
  });

  it("Einstellung «monatlich» überschreibt der Person nichts, wenn sie nichts gesetzt hat", () => {
    expect(lohnOptionen({ dreizehnterModus: "november" }).dreizehnterModus).toBe("november");
    expect(lohnOptionen(undefined).dreizehnterModus).toBeUndefined();
  });

  it("Sozialversicherungen im Auszahlungsmonat: AHV auf dem ganzen Betrag, ALV bis zum Höchstlohn", () => {
    const hoch = emp({ monatslohn: 12000, dreizehnterLohn: true });
    const y = jahr(hoch, 2026, { dreizehnterModus: "november" });
    const nov = y.find(d => d.monat === "2026-11")!;
    expect(nov.bruttoTotal).toBe(24000);
    expect(nov.ahv).toBe(1272);
    // Höchstlohn bis November 11 × 12'350 = 135'850; bisher 10 × 12'000 = 120'000 → nur 15'850 ALV-pflichtig
    expect(nov.alvBasis).toBe(15850);
    // über das Jahr genau der Höchstlohn
    expect(sum(y.map(d => d.alvBasis!))).toBe(148200);
  });

  it("Austritt: der 13. wird im Austrittsmonat anteilig ausbezahlt (Novemberlohn-Betrieb, Austritt 31.8.)", () => {
    const aus = emp({ dreizehnterLohn: true, austrittsdatum: "2026-08-31" });
    const y = jahr(aus, 2026, { dreizehnterModus: "november" });
    const aug = y.find(d => d.monat === "2026-08")!;
    expect(y.at(-1)!.monat).toBe("2026-08");
    expect(aug.dreizehnter).toBe(5000); // 8 × 7'500 / 12
    expect(aug.dreizehnterArt).toBe("austritt");
    expect(sum(y.map(d => d.dreizehnter))).toBe(5000);
  });

  it("Austritt im Auszahlungsmonat selbst und danach: keine doppelte Auszahlung", () => {
    const aus = emp({ dreizehnterLohn: true, austrittsdatum: "2026-11-30" });
    const y = jahr(aus, 2026, { dreizehnterModus: "november" });
    expect(sum(y.map(d => d.dreizehnter))).toBe(6875); // 11 × 7'500 / 12
  });

  it("Eintritt im Jahr: 13. nach den tatsächlichen Monatslöhnen (Eintritt 1.7., Dezemberlohn)", () => {
    const neu = emp({ dreizehnterLohn: true, eintrittsdatum: "2026-07-01" });
    const y = jahr(neu, 2026, { dreizehnterModus: "dezember" });
    expect(y.find(d => d.monat === "2026-12")!.dreizehnter).toBe(3750);
  });

  it("Novemberlohn-Betrieb, Eintritt im Dezember: 13. im Dezember", () => {
    const neu = emp({ dreizehnterLohn: true, eintrittsdatum: "2026-12-01" });
    const y = jahr(neu, 2026, { dreizehnterModus: "november" });
    expect(y).toHaveLength(1);
    expect(y[0].dreizehnter).toBe(625);
  });
});

describe("Nachzahlung bei rückwirkender Lohnänderung", () => {
  const alt = emp({ dreizehnterLohn: false });
  const entries = (e: Employee, bis: number) => jahr(e, 2026).filter(d => d.monat <= mm(2026, bis));

  it("keine Differenz, wenn sich nichts geändert hat", () => {
    expect(lohnNachzahlungOffen(alt, entries(alt, 3), "2026-04", "monatlich")).toBeNull();
  });

  it("Lohn ab 1.1. um 500 erhöht: im April 3 × 500 = 1'500 Nachzahlung für 01.2026–03.2026", () => {
    const neu = emp({ lohnVerlauf: [{ ab: "2026-01-01", monatslohn: 8000 }] });
    const nz = lohnNachzahlungOffen(neu, entries(alt, 3), "2026-04", "monatlich")!;
    expect(nz.monate.map(m => m.betrag)).toEqual([500, 500, 500]);
    expect(nz.betrag).toBe(1500);
    expect(nz.beschrieb).toBe("Nachzahlung Lohn 01.2026–03.2026");
  });

  it("mit 13. Monatslohn monatlich: 1/12 der Differenz kommt dazu", () => {
    const a = emp({ dreizehnterLohn: true });
    const neu = emp({ dreizehnterLohn: true, lohnVerlauf: [{ ab: "2026-02-01", monatslohn: 8000 }] });
    const nz = lohnNachzahlungOffen(neu, entries(a, 3), "2026-04", "monatlich")!;
    expect(nz.monate).toEqual([
      { monat: "2026-02", betrag: 500, dreizehnter: 41.67 },
      { monat: "2026-03", betrag: 500, dreizehnter: 41.67 },
    ]);
    expect(nz.betrag).toBe(1083.34);
    expect(nz.beschrieb).toBe("Nachzahlung Lohn 02.2026–03.2026");
  });

  it("13. im Auszahlungsmodus, gleiches Jahr: Differenz erhöht erst den 13. (Basis), nicht die Zeile", () => {
    const a = emp({ dreizehnterLohn: true });
    const neu = emp({ dreizehnterLohn: true, lohnVerlauf: [{ ab: "2026-02-01", monatslohn: 8000 }] });
    const nz = lohnNachzahlungOffen(neu, entries(a, 3), "2026-04", "november")!;
    expect(nz.betrag).toBe(1000);
    expect(nz.basis).toBe(1000);
  });

  it("übernommene Nachzahlung ist erledigt (nächster Lauf zeigt nichts mehr), Änderungen danach wieder", () => {
    const neu = emp({ lohnVerlauf: [{ ab: "2026-01-01", monatslohn: 8000 }] });
    const nz = lohnNachzahlungOffen(neu, entries(alt, 3), "2026-04", "monatlich")!;
    const april = { ...calcLohn(neu, "2026-04", [], 0, undefined, undefined, 0, { nachzahlung: nz.betrag }), id: "x4", employeeId: "e1", monat: "2026-04",
      nachzahlungMonate: nz.monate, nachzahlungBeschrieb: nz.beschrieb } as LohnEntry;
    const alle = [...entries(alt, 3), april];
    expect(lohnNachzahlungOffen(neu, alle, "2026-05", "monatlich")).toBeNull();
    // nochmals erhöht → nur die neue Differenz: 3 × 100 (Jan–Mär, 500 schon bezahlt) + 100 (April, mit 8'000 abgerechnet)
    const neuer = emp({ lohnVerlauf: [{ ab: "2026-01-01", monatslohn: 8100 }] });
    expect(lohnNachzahlungOffen(neuer, alle, "2026-05", "monatlich")!.betrag).toBe(400);
  });

  it("Rückforderung bei sinkendem Lohn ist negativ", () => {
    const neu = emp({ lohnVerlauf: [{ ab: "2026-01-01", monatslohn: 7400 }] });
    const nz = lohnNachzahlungOffen(neu, entries(alt, 2), "2026-03", "monatlich")!;
    expect(nz.betrag).toBe(-200);
  });

  it("abgeschlossene Abrechnungen mit übersteuertem Lohn oder Pensum werden nicht verglichen", () => {
    const e = entries(alt, 2).map((x, i) => (i === 0 ? { ...x, bruttoWasOverridden: true } : { ...x, pensumWasOverridden: true }));
    const neu = emp({ monatslohn: 9000 });
    expect(lohnNachzahlungOffen(neu, e, "2026-03", "monatlich")).toBeNull();
  });

  it("nur frühere Monate, nur dieselbe Person", () => {
    const neu = emp({ monatslohn: 9000 });
    expect(lohnNachzahlungOffen(neu, entries(alt, 3), "2026-02", "monatlich")!.monate.map(m => m.monat)).toEqual(["2026-01"]);
    expect(lohnNachzahlungOffen({ ...neu, id: "e2" }, entries(alt, 3), "2026-04", "monatlich")).toBeNull();
  });

  it("calcLohn: Nachzahlung ist sozialversicherungspflichtig und Teil des Bruttolohns Total", () => {
    const r = calcLohn(alt, "2026-04", [], 0, undefined, undefined, 0, { nachzahlung: 1500 });
    expect(r.nachzahlung).toBe(1500);
    expect(r.bruttoTotal).toBe(9000);
    expect(r.ahv).toBe(477);
    expect(r.ktg).toBe(45);
    expect(r.bvg).toBe(720);
    // negativ (Rückforderung)
    const neg = calcLohn(alt, "2026-04", [], 0, undefined, undefined, 0, { nachzahlung: -200 });
    expect(neg.bruttoTotal).toBe(7300);
    expect(neg.ahv).toBe(386.9);
  });
});

describe("Auszahlung auf 5 Rappen runden", () => {
  it("runden5Rappen: kaufmännisch", () => {
    expect(runden5Rappen(100.02)).toBe(100);
    expect(runden5Rappen(100.03)).toBe(100.05);
    expect(runden5Rappen(100.07)).toBe(100.05);
    expect(runden5Rappen(100.08)).toBe(100.1);
    expect(runden5Rappen(100.025 + 0.0000001)).toBe(100.05);
    expect(runden5Rappen(0)).toBe(0);
    expect(runden5Rappen(-100.03)).toBe(-100.05);
  });

  it("Standard aus: Auszahlung auf den Rappen", () => {
    const r = calcLohn(emp({ monatslohn: 3005 }), "2026-03");
    expect(r.rundung).toBeUndefined();
    expect(r.auszahlung).toBe(r.netto);
  });

  it("an: nur die Auszahlung wird gerundet, Abzüge bleiben rappengenau, Differenz sichtbar", () => {
    const e = emp({ monatslohn: 3005 });
    const roh = calcLohn(e, "2026-03");
    const r = calcLohn(e, "2026-03", [], 0, undefined, undefined, 0, { runden5: true });
    expect(r.ahv).toBe(roh.ahv);
    expect(r.totalAbzuege).toBe(roh.totalAbzuege);
    expect(r.netto).toBe(roh.netto);
    expect(Math.round(r.auszahlung * 100) % 5).toBe(0);
    expect(Math.round((r.auszahlung - roh.auszahlung) * 100) / 100).toBe(r.rundung ?? 0);
    // Beispiel: 2'600.97 → 2'601.00 (+0.03)
    const x = calcLohn(emp({ monatslohn: 3005 }), "2026-03", [{ amount: 12.34 }], 0, undefined, undefined, 0, { runden5: true });
    expect(Math.abs(x.rundung ?? 0)).toBeLessThanOrEqual(0.02);
    expect(Math.round(x.auszahlung * 100) % 5).toBe(0);
  });

  it("Rundung schliesst Familienzulagen und Spesen ein", () => {
    const r = calcLohn(emp({ familienzulagen: 215 }), "2026-03", [{ amount: 33.33 }], 0, undefined, undefined, 0, { runden5: true });
    // 6'270 + 215 + 33.33 = 6'518.33 → 6'518.35
    expect(r.auszahlung).toBe(6518.35);
    expect(r.rundung).toBe(0.02);
  });
});
