import { describe, expect, it } from "vitest";
import { applyEdit } from "../storage/merge";
import { firmEditForm } from "./personForm";
import type { Person } from "../types";

const legacy = { id: "p1", name: "Familie Keller", type: "", street: "", zip: "", city: "", email: "", phone: "", website: "", note: "", contacts: [], honorarOffers: [], isAuftraggeber: true, isPartner: false } as Person;

describe("firmEditForm", () => {
  it("lässt bei Altkontakten ohne Kategorie die Kategorie leer", () => {
    expect(firmEditForm(legacy).category).toBeUndefined();
  });
  it("zeigt Altpartner als Unternehmer, wie die Liste", () => {
    expect(firmEditForm({ ...legacy, isPartner: true }).category).toBe("unternehmer");
  });
  it("behält eine gesetzte Kategorie", () => {
    expect(firmEditForm({ ...legacy, category: "oeffentlich" }).category).toBe("oeffentlich");
  });
  it("Speichern ohne Änderung schreibt nichts Neues in den Kontakt (kein Land, keine Kategorie)", () => {
    const { _tags, ...rest } = firmEditForm(legacy);
    void _tags;
    const saved = applyEdit<Person>(legacy, { ...legacy, ...rest, note: "neu" } as Person, legacy);
    expect(saved.category).toBeUndefined();
    expect(saved.country).toBeUndefined();
    expect(saved.note).toBe("neu");
  });
});
