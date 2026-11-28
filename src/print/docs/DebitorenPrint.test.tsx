// Test der Druckvorlage Debitorenliste: Stichtag im Titel, Zahlen = debitoren(), Leerfall.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DebitorenPrint } from "./DebitorenPrint";
import { debitoren } from "../../debitoren";
import { formatCHF, formatDate } from "../../utils";
import type { AppData, Settings } from "../../types";

const settings = { name: "Atelier" } as unknown as Settings;
const data = {
  settings, projects: [], persons: [{ id: "c1", name: "Bauherr AG" }],
  invoices: [
    { id: "1", number: "R1", clientId: "c1", date: "2026-01-10", dueDate: "2026-02-09", status: "gesendet", total: 1234.5, reminders: [{ nr: 1, date: "2026-03-01" }] },
    { id: "2", number: "R2", clientId: "c1", date: "2026-02-10", dueDate: "2026-03-12", status: "bezahlt", paidDate: "2026-04-01", total: 800 },
  ],
} as unknown as AppData;

describe("DebitorenPrint", () => {
  it("Stichtag, Kunde, Betrag und Mahnstufe stehen im Dokument; Total = debitoren()", () => {
    const out = renderToStaticMarkup(<DebitorenPrint data={data} asOf="2026-03-20" settings={settings} />);
    expect(out).toContain("DEBITORENLISTE");
    expect(out).toContain(`per ${formatDate("2026-03-20")}`);
    expect(out).toContain("Bauherr AG");
    expect(out).toContain("Erinnerung");
    expect(out).toContain(formatCHF(debitoren(data, "2026-03-20").total));
    expect(debitoren(data, "2026-03-20").total).toBe(2034.5);   // R2 war per 20.03. noch nicht bezahlt
  });
  it("nach der Zahlung nur noch R1; leer → Hinweis", () => {
    expect(debitoren(data, "2026-04-01").total).toBe(1234.5);
    const none = renderToStaticMarkup(<DebitorenPrint data={data} asOf="2025-12-31" settings={settings} />);
    expect(none).toContain("Keine offenen Posten");
  });
});
