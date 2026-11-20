// Test der Druckvorlage Offerte: Stundenansatz-Format und Summen aus den gespeicherten Werten.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotePrint } from "./QuotePrint";
import { SIA_PHASE_WEIGHTS } from "../../constants";
import type { Quote, Settings } from "../../types";

const settings = { name: "Atelier", mwstRate: 8.1, roles: [] } as unknown as Settings;
const phases = SIA_PHASE_WEIGHTS.map(ph => ({ id: ph.id, label: ph.label, items: ph.items.map(it => ({ ...it, enabled: true, r: 1 })) }));
const quote = (stundenansatz: number) => ({
  id: "q", number: "O2026-001", clientId: "", date: "2026-11-19", mode: "sia", status: "entwurf", mwst: true, mwstRate: 8.1,
  sia: { baukosten: 1_000_000, schwierigkeit: 1, stundenansatz, phases }, sub: 100_000, tax: 8_100, total: 108_100,
} as Quote);

describe("QuotePrint", () => {
  it("Stundenansatz: «142.50/h» statt «142.5.–/h», ganze Franken als «140.–/h»", () => {
    expect(renderToStaticMarkup(<QuotePrint quote={quote(142.5)} client={undefined} settings={settings} />)).toContain("CHF 142.50/h");
    expect(renderToStaticMarkup(<QuotePrint quote={quote(140)} client={undefined} settings={settings} />)).toContain("CHF 140.–/h");
  });
});
