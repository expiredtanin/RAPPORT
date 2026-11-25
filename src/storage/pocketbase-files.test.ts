// Tests für die PocketBase-Dateiablage (Verweise, Upload-Vorbereitung, Zuordnung data:-URL ↔ Verweis, Abgleich).

import { describe, expect, it, vi } from "vitest";
import {
  PbFileStore, isDataUrl, parseDataUrl, parsePbRef, pbFileRef, replacePbRefs, uploadName,
} from "./pocketbase-files";
import { baseFrom, planSync } from "./pocketbase-sync";
import { toDB, fromDB } from "./pocketbase-mappers";
import { PocketBaseAdapter } from "./pocketbase-adapter";
import type { Expense } from "../types";
import type { RecordModel } from "pocketbase";

const PDF = "data:application/pdf;base64," + btoa("%PDF-1.4 Beleg");
const PNG = "data:image/png;base64," + btoa("\x89PNG Logo");

describe("Verweise", () => {
  it("baut und zerlegt Verweise", () => {
    const ref = pbFileRef("expenses", "e1", "beleg_ab12cd.pdf");
    expect(ref).toBe("rapport-pb:expenses/e1/beleg_ab12cd.pdf");
    expect(parsePbRef(ref)).toEqual({ collection: "expenses", recordId: "e1", filename: "beleg_ab12cd.pdf" });
    expect(pbFileRef("expenses", "e1", "")).toBe("");
    expect(pbFileRef("expenses", "e1", undefined)).toBe("");
  });

  it("verwirft manipulierte Verweise", () => {
    expect(parsePbRef("rapport-pb:expenses/e1/../x")).toBeNull();
    expect(parsePbRef("rapport-pb:expenses/e1/..")).toBeNull();
    expect(parsePbRef("rapport-pb:exp enses/e1/a.pdf")).toBeNull();
    expect(parsePbRef("rapport-pb:expenses/e1/a.pdf?token=x")).toBeNull();
    expect(parsePbRef("rapport-datei:Dateien/Belege/a.pdf")).toBeNull();
    expect(parsePbRef(PDF)).toBeNull();
  });
});

describe("data:-URLs", () => {
  it("liest Base64 und Prozent-kodierte data:-URLs", () => {
    expect(isDataUrl(PDF)).toBe(true);
    expect(isDataUrl("rapport-pb:expenses/e1/a.pdf")).toBe(false);
    expect(new TextDecoder().decode(parseDataUrl(PDF)!.bytes)).toBe("%PDF-1.4 Beleg");
    const svg = parseDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E")!;
    expect(svg.mime).toBe("image/svg+xml");
    expect(new TextDecoder().decode(svg.bytes)).toBe("<svg/>");
  });

  it("Dateiname aus Originalname und Typ", () => {
    expect(uploadName("application/pdf", "Quittung Migros.PDF", "beleg")).toBe("Quittung Migros.pdf");
    expect(uploadName("image/jpeg", "", "beleg")).toBe("beleg.jpg");
    expect(uploadName("application/octet-stream", "Plan.dwg", "beleg")).toBe("Plan.dwg");
  });
});

describe("PbFileStore.prepareBody", () => {
  const store = (download = vi.fn(async () => new Blob(["kopie"], { type: "application/pdf" }))) =>
    ({ s: new PbFileStore(download), download });

  it("data:-URL → File (multipart), Name aus receiptName", async () => {
    const { s } = store();
    const p = await s.prepareBody("expenses", "e1", { id: "e1", receiptFile: PDF, receiptName: "Taxi.pdf" });
    expect(p.multipart).toBe(true);
    expect(p.upload).toBe(PDF);
    const f = p.body.receiptFile as File;
    expect(f).toBeInstanceOf(File);
    expect(f.name).toBe("Taxi.pdf");
    expect(f.type).toBe("application/pdf");
    expect(await f.text()).toBe("%PDF-1.4 Beleg");
  });

  it("eigener Verweis → Dateiname bleibt, leer → Datei entfernen", async () => {
    const { s, download } = store();
    const own = await s.prepareBody("expenses", "e1", { receiptFile: "rapport-pb:expenses/e1/a_x.pdf" });
    expect(own).toEqual({ body: { receiptFile: "a_x.pdf" }, upload: null, multipart: false });
    const cleared = await s.prepareBody("expenses", "e1", { receiptFile: null, amount: 3 });
    expect(cleared).toEqual({ body: { receiptFile: "", amount: 3 }, upload: null, multipart: false });
    expect(download).not.toHaveBeenCalled();
  });

  it("Rückgängig nach Löschen: eigener Verweis beim Anlegen lädt den gemerkten Inhalt wieder hoch", async () => {
    const { s } = store();
    await s.keepBeforeDelete("rapport-pb:expenses/e1/a_x.pdf");
    const p = await s.prepareBody("expenses", "e1", { id: "e1", receiptFile: "rapport-pb:expenses/e1/a_x.pdf", receiptName: "Taxi.pdf" }, true);
    expect(p.multipart).toBe(true);
    expect((p.body.receiptFile as File).name).toBe("Taxi.pdf");
    // ohne gemerkten Inhalt: Datensatz ohne Datei statt «Invalid new files»
    const none = await new PbFileStore(async () => new Blob()).prepareBody("expenses", "e9", { id: "e9", receiptFile: "rapport-pb:expenses/e9/b.pdf" }, true);
    expect(none).toEqual({ body: { id: "e9" }, upload: null, multipart: false });
  });

  it("Verweis auf einen anderen Datensatz wird heruntergeladen und neu hochgeladen", async () => {
    const { s, download } = store();
    const p = await s.prepareBody("expenses", "e2", { receiptFile: "rapport-pb:expenses/e1/a_x.pdf", receiptName: "Kopie.pdf" });
    expect(download).toHaveBeenCalledWith({ collection: "expenses", recordId: "e1", filename: "a_x.pdf" });
    expect(p.multipart).toBe(true);
    expect((p.body.receiptFile as File).name).toBe("Kopie.pdf");
  });

  it("nicht ladbarer fremder Verweis wird nicht gesendet (kein Abbruch)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = new PbFileStore(async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }); });
    const p = await s.prepareBody("expenses", "e2", { receiptFile: "rapport-pb:expenses/e1/a_x.pdf", amount: 2 });
    expect(p).toEqual({ body: { amount: 2 }, upload: null, multipart: false });
  });

  it("unbekannte Werte (z.B. Datenordner-Verweis) werden nicht gesendet", async () => {
    const { s } = store();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await s.prepareBody("expenses", "e1", { receiptFile: "rapport-datei:Dateien/Belege/a.pdf", amount: 1 });
    expect(p).toEqual({ body: { amount: 1 }, upload: null, multipart: false });
  });

  it("Collections ohne Dateifeld bleiben unverändert", async () => {
    const { s } = store();
    const body = { id: "p1", name: PDF };
    expect((await s.prepareBody("projects", "p1", body)).body).toBe(body);
  });
});

describe("PbFileStore Zuordnung", () => {
  it("nach dem Upload erscheint die data:-URL als Verweis (kein zweiter Upload)", () => {
    const s = new PbFileStore(vi.fn());
    const ref = s.remember("expenses", { id: "e1", receiptFile: "taxi_q1w2e3.pdf" }, PDF);
    expect(ref).toBe("rapport-pb:expenses/e1/taxi_q1w2e3.pdf");
    expect(s.toRefs("expenses", { id: "e1", receiptFile: PDF })).toEqual({ id: "e1", receiptFile: ref });
    // unbekannte data:-URL bleibt (wird hochgeladen)
    const row = { id: "e1", receiptFile: PNG };
    expect(s.toRefs("expenses", row)).toBe(row);
  });

  it("Server-Zeile: Dateiname → Verweis; ohne Dateifeld (nur id geladen) unverändert", () => {
    const s = new PbFileStore(vi.fn());
    expect(s.fromRecord("blogPosts", { id: "b1", imageFile: "bild_x.jpg" })).toEqual({ id: "b1", imageFile: "rapport-pb:blogPosts/b1/bild_x.jpg" });
    expect(s.fromRecord("blogPosts", { id: "b1", imageFile: "" })).toEqual({ id: "b1", imageFile: "" });
    const onlyId = { id: "b1" };
    expect(s.fromRecord("blogPosts", onlyId)).toBe(onlyId);
  });

  it("inline lädt einmal und merkt sich die Zuordnung; read speichert nichts", async () => {
    const download = vi.fn(async () => new Blob(["\x89PNG Logo"], { type: "image/png" }));
    const s = new PbFileStore(download);
    const ref = "rapport-pb:studioSettings/s1/logo_x.png";
    const url = await s.inline(ref);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(await s.inline(ref)).toBe(url);
    expect(download).toHaveBeenCalledTimes(1);
    expect(s.toRefs("studioSettings", { logoFile: url })).toEqual({ logoFile: ref });

    await s.read("rapport-pb:expenses/e1/a.pdf");
    await s.read("rapport-pb:expenses/e1/a.pdf");
    expect(download).toHaveBeenCalledTimes(3);

    s.retainOnly(new Set());
    expect(s.toRefs("studioSettings", { logoFile: url })).toEqual({ logoFile: url });
  });

  it("read liefert null, wenn der Download scheitert (z.B. 404 für fremdes Büro)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = new PbFileStore(async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }); });
    expect(await s.read("rapport-pb:expenses/e1/a.pdf")).toBeNull();
    expect(await s.read("kein-verweis")).toBeNull();
  });
});

describe("replacePbRefs", () => {
  it("ersetzt tief und lässt Unverändertes identisch", async () => {
    const untouched = { name: "x" };
    const v = { settings: { logo: "rapport-pb:studioSettings/s1/l.png", other: untouched }, list: [untouched] };
    const out = await replacePbRefs(v, async () => "data:image/png;base64,AA==");
    expect(out.settings.logo).toBe("data:image/png;base64,AA==");
    expect(out.settings.other).toBe(untouched);
    expect(out.list).toBe(v.list);
    expect(await replacePbRefs(v.list, async () => "x")).toBe(v.list);
  });
});

describe("Abgleich mit Dateifeldern", () => {
  const exp = (over: Partial<Expense> = {}): Expense => ({
    id: "e1", employeeId: null, projectId: null, date: "2026-11-20", category: "Taxi", description: "",
    amount: 12, mwstRate: 8.1, inclMwst: true, status: "offen", receiptData: "", receiptName: "", lohnEntryId: null, ...over,
  } as Expense);
  const fromServer = (r: Record<string, unknown>) => fromDB.expense({ collectionId: "c", collectionName: "expenses", ...r } as unknown as RecordModel) as Expense;

  it("geladener Verweis bleibt unverändert, neue data:-URL → Update nur mit dem Dateifeld", () => {
    const loaded = fromServer({ id: "e1", date: "2026-11-20 00:00:00.000Z", category: "Taxi", amount: 12, mwstRate: 8.1, inclMwst: true, status: "offen", receiptFile: "taxi_abc.pdf", receiptName: "Taxi.pdf" });
    expect(loaded.receiptData).toBe("rapport-pb:expenses/e1/taxi_abc.pdf");
    const base = baseFrom([toDB.expense(loaded, "s1")], "id");
    const existing = [{ id: "e1" }];
    expect(planSync([toDB.expense(loaded, "s1")], existing, "id", base)).toEqual([]);

    const replaced = { ...loaded, receiptData: PDF, receiptName: "Neu.pdf" };
    expect(planSync([toDB.expense(replaced, "s1")], existing, "id", base)).toEqual([
      { type: "update", id: "e1", body: { receiptFile: PDF, receiptName: "Neu.pdf" } },
    ]);
    const removed = { ...loaded, receiptData: null, receiptName: null };
    expect(planSync([toDB.expense(removed, "s1")], existing, "id", base)).toEqual([
      { type: "update", id: "e1", body: { receiptFile: "", receiptName: null } },
    ]);
  });

  it("Adapter: Upload einzeln (nicht im Batch), danach ist die Zeile wieder unverändert", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    a.setStudioId("s1");
    const calls: string[] = [];
    const coll = {
      getFullList: vi.fn(async () => [{ id: "e1" }]),
      create: vi.fn(async (b: Record<string, unknown>) => { calls.push("create"); return { id: b.id, receiptFile: "" }; }),
      update: vi.fn(async (id: string, b: Record<string, unknown>) => {
        calls.push(b.receiptFile instanceof File ? "upload" : "update");
        return { id, receiptFile: b.receiptFile instanceof File ? "neu_k9.pdf" : b.receiptFile };
      }),
      delete: vi.fn(),
    };
    a.client = { collection: () => coll, createBatch: () => { throw new Error("kein Batch erwartet"); } } as never;
    a._base.set("expenses", baseFrom([toDB.expense(exp({ receiptData: "rapport-pb:expenses/e1/alt_x.pdf" }), "s1")], "id"));

    const next = exp({ receiptData: PDF, receiptName: "Neu.pdf" });
    await a._syncTable("expenses", "s1", a._toRows("expense", [next], "s1", "expenses"), "id");
    expect(calls).toEqual(["upload"]);
    expect((coll.update.mock.calls[0][1] as Record<string, unknown>).receiptName).toBe("Neu.pdf");
    // gleicher App-Stand (noch data:-URL) → keine weitere Operation
    await a._syncTable("expenses", "s1", a._toRows("expense", [next], "s1", "expenses"), "id");
    expect(calls).toEqual(["upload"]);
    expect(a._base.get("expenses")!.get("e1")!.receiptFile).toBe("rapport-pb:expenses/e1/neu_k9.pdf");
  });

  it("Adapter: Upload bei 429 nach kurzer Wartezeit wiederholt", async () => {
    const a = new PocketBaseAdapter("http://test.invalid");
    const delays = PocketBaseAdapter.UPLOAD_RETRY_MS;
    PocketBaseAdapter.UPLOAD_RETRY_MS = [0, 0];
    let fails = 1;
    const coll = {
      create: vi.fn(async (b: Record<string, unknown>) => {
        if (fails-- > 0) throw Object.assign(new Error("429"), { status: 429 });
        return { id: b.id, receiptFile: "a_1.pdf" };
      }),
    };
    a.client = { collection: () => coll } as never;
    try {
      await a._applyOps("expenses", [{ type: "create", body: { id: "e9", receiptFile: PDF } }]);
    } finally {
      PocketBaseAdapter.UPLOAD_RETRY_MS = delays;
    }
    expect(coll.create).toHaveBeenCalledTimes(2);
    expect(a._files.toRefs("expenses", { receiptFile: PDF })).toEqual({ receiptFile: "rapport-pb:expenses/e9/a_1.pdf" });
  });
});
