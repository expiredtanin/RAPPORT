// Gruppieren mit Schlüsseln aus den Daten: Namen wie «constructor» oder «__proto__» dürfen die Liste nicht abstürzen
// lassen (vorher stiess `{}`[key] auf Object.prototype — `.push` ist dort keine Funktion).
import { describe, expect, it } from "vitest";
import type { Invoice } from "../../types";
import { groupInvoices } from "./invoiceList";

describe("groupInvoices", () => {
  it("verträgt Schlüssel wie «constructor» und «__proto__»", () => {
    const inv = (id: string, status: string, clientId: string) => ({ id, status, clientId, date: "2026-11-01" }) as unknown as Invoice;
    const list = [inv("a", "constructor", "__proto__"), inv("b", "__proto__", "constructor"), inv("c", "toString", "x")];
    const byStatus = groupInvoices(list, "status", []);
    expect(byStatus.flatMap(g => g.items).map(i => i.id).sort()).toEqual(["a", "b", "c"]);
    const byClient = groupInvoices(list, "client", []);
    expect(byClient.flatMap(g => g.items).map(i => i.id).sort()).toEqual(["a", "b", "c"]);
  });
});
