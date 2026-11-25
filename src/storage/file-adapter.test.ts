/// <reference types="node" />
// Tests für den Datenordner (FileStorageAdapter) samt Dateiablage (file-assets.ts) auf einem echten
// Temp-Ordner mit Node-`fs` statt Tauri.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorageAdapter, type FsApi } from "./file-adapter";
import { FILE_REF_PREFIX, bytesToBase64 } from "./file-assets";
import { defaultData } from "../constants";
import type { AppData } from "../types";

/** FsApi auf Node-`fs` (gleiches Verhalten wie tauriFs, ohne Überwachung). */
const nodeFs: FsApi = {
  readText: p => readFile(p, "utf8"),
  writeText: (p, t) => writeFile(p, t, "utf8"),
  readBytes: async p => new Uint8Array(await readFile(p)),
  writeBytes: (p, b) => writeFile(p, b),
  rename: (a, b) => rename(a, b),
  remove: p => rm(p, { force: true }),
  mkdir: async p => { await mkdir(p, { recursive: true }); },
  stat: async p => { try { const s = await stat(p); return { mtime: s.mtimeMs, size: s.size }; } catch { return null; } },
  list: async p => { try { return await readdir(p); } catch { return []; } },
  watch: async () => () => {},
};

/** Pseudo-PDF mit genug Inhalt, damit es als eigene Datei abgelegt wird. */
const pdfBytes = new Uint8Array(4000).map((_, i) => (i * 7) % 256);
const pdfUrl = `data:application/pdf;base64,${bytesToBase64(pdfBytes)}`;

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "rapport-test-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function sampleData(): AppData {
  return {
    ...defaultData,
    settings: { ...defaultData.settings, setupCompleted: true, name: "Atelier Test" },
    expenses: [{ id: "x1", date: "2026-10-01", amount: 42, receiptData: pdfUrl, receiptName: "Quittung Baumarkt.pdf" } as never],
    timeEntries: [{ id: "t1", date: "2026-10-02", employeeId: "e1", minutes: 60 } as never],
  };
}

describe("Datenordner mit Dateiablage", () => {
  it("legt Anhänge als Dateien ab; Belege bleiben beim Laden Verweis und werden erst beim Anzeigen gelesen", async () => {
    const a = new FileStorageAdapter(dir, nodeFs, "test");
    await a.save(sampleData());

    const studio = JSON.parse(await readFile(join(dir, "studio.json"), "utf8"));
    const ref: string = studio.data.expenses[0].receiptData;
    expect(ref.startsWith(`${FILE_REF_PREFIX}Dateien/Belege/Quittung Baumarkt-`)).toBe(true);
    expect(ref.endsWith(".pdf")).toBe(true);
    const onDisk = new Uint8Array(await readFile(join(dir, ref.slice(FILE_REF_PREFIX.length))));
    expect(onDisk).toEqual(pdfBytes);
    // studio.json enthält kein Base64 mehr
    expect(await readFile(join(dir, "studio.json"), "utf8")).not.toContain("base64");

    const b = new FileStorageAdapter(dir, nodeFs, "test2");
    const loaded = await b.load();
    expect(loaded?.expenses?.[0].receiptData).toBe(ref);
    expect(await b.readAttachment(ref)).toBe(pdfUrl);
    expect(await b.embedAttachments(loaded)).toMatchObject({ expenses: [{ receiptData: pdfUrl }] });
    expect(loaded?.timeEntries).toHaveLength(1);
    expect(loaded?.settings?.name).toBe("Atelier Test");
  });

  it("gleicher Inhalt = eine Datei; Backups verweisen auf die Ablage", async () => {
    const a = new FileStorageAdapter(dir, nodeFs, "test");
    const d = sampleData();
    await a.save({ ...d, expenses: [...d.expenses, { ...d.expenses[0], id: "x2" }] });
    expect(await readdir(join(dir, "Dateien", "Belege"))).toHaveLength(1);
    const backups = await readdir(join(dir, "backups"));
    expect(backups).toHaveLength(1);
    const backup = await readFile(join(dir, "backups", backups[0]), "utf8");
    expect(backup).not.toContain("base64");
    expect(backup).toContain(FILE_REF_PREFIX);
  });

  it("fehlende Datei: Verweis bleibt stehen und wird unverändert zurückgeschrieben", async () => {
    await new FileStorageAdapter(dir, nodeFs, "test").save(sampleData());
    await rm(join(dir, "Dateien"), { recursive: true });

    const b = new FileStorageAdapter(dir, nodeFs, "test");
    const loaded = (await b.load())!;
    const ref = loaded.expenses![0].receiptData!;
    expect(ref.startsWith(FILE_REF_PREFIX)).toBe(true);
    expect(b.missingFiles).toHaveLength(1);

    await b.save({ ...(loaded as AppData), settings: { ...loaded.settings!, name: "Neu" } });
    const studio = JSON.parse(await readFile(join(dir, "studio.json"), "utf8"));
    expect(studio.data.expenses[0].receiptData).toBe(ref);
    expect(studio.data.settings.name).toBe("Neu");
  });

  it("Verweise ausserhalb der Ablage werden nicht gelesen", async () => {
    await writeFile(join(dir, "geheim.txt"), "x".repeat(10));
    await writeFile(join(dir, "studio.json"), JSON.stringify({ format: 1, data: { settings: {}, logo: `${FILE_REF_PREFIX}Dateien/../geheim.txt` } }));
    const loaded = await new FileStorageAdapter(dir, nodeFs, "test").load();
    expect((loaded as Record<string, unknown>).logo).toBe(`${FILE_REF_PREFIX}Dateien/../geheim.txt`);
  });

  it("kleine data:-URLs bleiben im JSON", async () => {
    const small = "data:image/png;base64,iVBORw0KGgo=";
    await new FileStorageAdapter(dir, nodeFs, "test").save({ ...sampleData(), settings: { ...sampleData().settings, logo: small } });
    const studio = JSON.parse(await readFile(join(dir, "studio.json"), "utf8"));
    expect(studio.data.settings.logo).toBe(small);
  });

  it("Dateityp bleibt erhalten, auch wenn die Endung ihn nicht kennt", async () => {
    const b64 = (seed: number) => bytesToBase64(pdfBytes.map(b => (b + seed) % 256));
    const d = sampleData();
    const expenses = [
      { ...d.expenses[0], id: "a", receiptData: `data:image/tiff;base64,${b64(1)}`, receiptName: "Scan.tif" },
      { ...d.expenses[0], id: "b", receiptData: `data:application/octet-stream;base64,${b64(2)}`, receiptName: "Plan.dwg" },
      { ...d.expenses[0], id: "c", receiptData: `data:image/x-sonderformat;base64,${b64(3)}`, receiptName: "Bild" },
    ];
    await new FileStorageAdapter(dir, nodeFs, "test").save({ ...d, expenses });
    const refs = JSON.parse(await readFile(join(dir, "studio.json"), "utf8")).data.expenses.map((e: { receiptData: string }) => e.receiptData);
    expect(refs[0]).toMatch(/\.tif$/);
    expect(refs[1]).toMatch(/\.dwg\?typ=application%2Foctet-stream$/);
    expect(refs[2]).toMatch(/\.bin\?typ=image%2Fx-sonderformat$/);

    const b = new FileStorageAdapter(dir, nodeFs, "test2");
    const loaded = (await b.embedAttachments(await b.load()))!;
    expect(loaded.expenses!.map(e => e.receiptData)).toEqual(expenses.map(e => e.receiptData));
  });

  it("Aufräumen entfernt nur alte Dateien, auf die nichts mehr verweist", async () => {
    const a = new FileStorageAdapter(dir, nodeFs, "test");
    await a.save(sampleData());
    const belege = join(dir, "Dateien", "Belege");
    const [used] = await readdir(belege);
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    // verwaist und alt → weg; verwaist und neu → bleibt (andere Person hat sie evtl. gerade abgelegt)
    await writeFile(join(belege, "alt-111111111111.pdf"), "x".repeat(100));
    await utimes(join(belege, "alt-111111111111.pdf"), old, old);
    await writeFile(join(belege, "neu-222222222222.pdf"), "x");
    // nur noch von einem Backup verwendet → bleibt
    await writeFile(join(belege, "backup-333333333333.pdf"), "x");
    await utimes(join(belege, "backup-333333333333.pdf"), old, old);
    await writeFile(join(dir, "backups", "backup-2020-01-01-x.json"), JSON.stringify({ logo: `${FILE_REF_PREFIX}Dateien/Belege/backup-333333333333.pdf?typ=application%2Fpdf` }));
    await utimes(join(belege, used), old, old);

    const { removed, bytes } = await a.cleanupFiles();
    expect(removed).toEqual(["Dateien/Belege/alt-111111111111.pdf"]);
    expect(bytes).toBe(100);
    expect((await readdir(belege)).sort()).toEqual([used, "backup-333333333333.pdf", "neu-222222222222.pdf"].sort());
  });

  it("Aufräumen bricht ab, wenn eine Datendatei nicht lesbar ist", async () => {
    const a = new FileStorageAdapter(dir, nodeFs, "test");
    await a.save(sampleData());
    const belege = join(dir, "Dateien", "Belege");
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await writeFile(join(belege, "alt-111111111111.pdf"), "x");
    await utimes(join(belege, "alt-111111111111.pdf"), old, old);
    await writeFile(join(dir, "time", ".e1_2026-09.json.icloud"), "");
    await expect(a.cleanupFiles()).rejects.toThrow(/iCloud/);
    await rm(join(dir, "time", ".e1_2026-09.json.icloud"));
    await writeFile(join(dir, "backups", "kaputt.json"), "{");
    await expect(a.cleanupFiles()).rejects.toThrow(/nicht lesbar/);
    expect(await readdir(belege)).toContain("alt-111111111111.pdf");
  });

  it("Logo und Bilder werden beim Laden gelesen, nur Belege bleiben Verweis", async () => {
    const logo = `data:image/png;base64,${bytesToBase64(pdfBytes.map(b => (b + 9) % 256))}`;
    await new FileStorageAdapter(dir, nodeFs, "test").save({ ...sampleData(), settings: { ...sampleData().settings, logo } });
    const loaded = (await new FileStorageAdapter(dir, nodeFs, "test2").load())!;
    expect(loaded.settings!.logo).toBe(logo);
    expect(loaded.expenses![0].receiptData!.startsWith(FILE_REF_PREFIX)).toBe(true);
  });

  it("geladene Belege werden unverändert zurückgeschrieben", async () => {
    await new FileStorageAdapter(dir, nodeFs, "test").save(sampleData());
    const before = await readFile(join(dir, "studio.json"), "utf8");
    const b = new FileStorageAdapter(dir, nodeFs, "test");
    const loaded = (await b.load())! as AppData;
    await b.save({ ...loaded, expenses: [...loaded.expenses] });
    expect(await readFile(join(dir, "studio.json"), "utf8")).toBe(before);
    expect(await readdir(join(dir, "Dateien", "Belege"))).toHaveLength(1);
  });

  it("Verweise ausserhalb der Ablage liefert readAttachment nicht", async () => {
    await writeFile(join(dir, "geheim.txt"), "x".repeat(10));
    const a = new FileStorageAdapter(dir, nodeFs, "test");
    expect(await a.readAttachment(`${FILE_REF_PREFIX}Dateien/Belege/../../geheim.txt`)).toBeNull();
  });
});

describe("Datenordner mit zwei Personen", () => {
  it("Änderung in der App während des Nachladens einer fremden Änderung: beide bleiben erhalten", async () => {
    // Lesen verlangsamt, damit die Eingabe genau in das Nachladen fällt
    let slow = false;
    const slowFs: FsApi = { ...nodeFs, readText: async p => { if (slow) await new Promise(r => setTimeout(r, 120)); return nodeFs.readText(p); } };
    const base = sampleData();
    const mine = new FileStorageAdapter(dir, slowFs, "ich");
    await mine.save(base);
    await mine.load();
    const seen: unknown[] = [];
    mine.onExternalChange(d => seen.push(d));

    // die andere Person legt einen Kontakt an
    const other = new FileStorageAdapter(dir, nodeFs, "du");
    const theirs = (await other.load())!;
    await other.save({ ...(theirs as AppData), persons: [{ id: "p-du", name: "Kontakt der anderen" } as never] });

    slow = true;
    const check = mine.checkExternal();
    await new Promise(r => setTimeout(r, 30));
    // ich erfasse eine Rechnung — auf meinem (alten) Stand ohne den neuen Kontakt
    const saved = mine.save({ ...base, invoices: [{ id: "r-ich", number: "R1" } as never] });
    await check;
    await saved;
    slow = false;
    await mine.flush();

    const disk = JSON.parse(await readFile(join(dir, "studio.json"), "utf8"));
    expect(disk.data.persons.map((p: { id: string }) => p.id)).toEqual(["p-du"]);
    expect(disk.data.invoices.map((i: { id: string }) => i.id)).toEqual(["r-ich"]);
    // die App bekommt am Ende den gemeinsamen Stand (nicht den ohne meine Rechnung)
    const last = seen[seen.length - 1] as AppData;
    expect(last.persons.map(p => p.id)).toEqual(["p-du"]);
    expect(last.invoices.map(i => i.id)).toEqual(["r-ich"]);
  });
});

describe("Datenordner: zwei Personen, Zeitdateien (Test 25.11.2026)", () => {
  const te = (id: string, emp: string, date: string, extra = {}) => ({ id, employeeId: emp, date, minutes: 60, ...extra }) as never;
  const base = (): AppData => ({ ...sampleData(), expenses: [], timeEntries: [te("t1", "e1", "2026-11-03"), te("t2", "e2", "2026-11-04"), te("t3", "e2", "2026-11-05")] });
  const setup = async () => {
    await new FileStorageAdapter(dir, nodeFs, "init").save(base());
    const A = new FileStorageAdapter(dir, nodeFs, "A"), B = new FileStorageAdapter(dir, nodeFs, "B");
    const a = (await A.load()) as unknown as AppData, b = (await B.load()) as unknown as AppData;
    return { A, B, a, b };
  };
  const ids = async () => (((await new FileStorageAdapter(dir, nodeFs, "C").load()) as unknown as AppData).timeEntries).map(e => `${e.id}:${e.description || ""}`).sort();

  it("A leert eine Zeitdatei (Datei entfernt), B ändert einen Eintrag daraus: nur dieser bleibt", async () => {
    const { A, B, a, b } = await setup();
    await A.save({ ...a, timeEntries: a.timeEntries.filter(e => e.employeeId !== "e2") });
    await B.save({ ...b, timeEntries: b.timeEntries.map(e => e.id === "t3" ? { ...e, description: "B" } : e) });
    expect(await ids()).toEqual(["t1:", "t3:B"]);
  });

  it("Eintrag gleichzeitig verschoben (anderer Monat) und geändert: kommt nur einmal vor", async () => {
    const { A, B, a, b } = await setup();
    await A.save({ ...a, timeEntries: a.timeEntries.map(e => e.id === "t2" ? { ...e, date: "2026-12-01" } : e) });
    await B.save({ ...b, timeEntries: b.timeEntries.map(e => e.id === "t2" ? { ...e, description: "B" } : e) });
    const list = await ids();
    expect(list.filter(x => x.startsWith("t2:"))).toHaveLength(1);
  });
});

describe("Datenordner: Zeitdatei von iCloud ausgelagert", () => {
  it("ein Platzhalter «.name.icloud» gilt nicht als gelöscht — Speichern scheitert statt Einträge zu verwerfen", async () => {
    const te = (id: string, date: string) => ({ id, employeeId: "e2", date, minutes: 60 }) as never;
    const start: AppData = { ...sampleData(), expenses: [], timeEntries: [te("t1", "2026-11-03"), te("t2", "2026-11-04")] };
    const A = new FileStorageAdapter(dir, nodeFs, "A");
    await A.save(start);
    const a = (await A.load()) as unknown as AppData;
    // iCloud lagert die Datei aus: nur noch der Platzhalter liegt im Ordner
    await rename(join(dir, "time/e2_2026-11.json"), join(dir, "time/.e2_2026-11.json.icloud"));
    await expect(A.save({ ...a, timeEntries: a.timeEntries.map(e => e.id === "t1" ? { ...e, minutes: 90 } : e) })).rejects.toThrow(/nicht lesbar/);
    await rename(join(dir, "time/.e2_2026-11.json.icloud"), join(dir, "time/e2_2026-11.json"));
    const back = (await new FileStorageAdapter(dir, nodeFs, "C").load()) as unknown as AppData;
    expect(back.timeEntries.map(e => e.id).sort()).toEqual(["t1", "t2"]);
  });

  it("ausgelagerte Zeitdatei: Laden ohne sie (gemeldet), Speichern in diesen Monat scheitert statt sie neu anzulegen", async () => {
    const te = (id: string, date: string) => ({ id, employeeId: "e2", date, minutes: 60 }) as never;
    await new FileStorageAdapter(dir, nodeFs, "A").save({ ...sampleData(), expenses: [], timeEntries: [te("t1", "2026-10-03")] });
    await rename(join(dir, "time/e2_2026-10.json"), join(dir, "time/.e2_2026-10.json.icloud"));
    // Platzhalter einer Konfliktkopie stört nicht
    await writeFile(join(dir, "time/.e2_2026-09 2.json.icloud"), "");
    const B = new FileStorageAdapter(dir, nodeFs, "B");
    const loaded = (await B.load()) as unknown as AppData;
    expect(loaded.timeEntries).toEqual([]);
    expect(B.pendingTimeFiles).toEqual(["time/e2_2026-10.json"]);
    // ein Eintrag im ausgelagerten Monat blockiert nicht die anderen Monate
    await expect(B.save({ ...loaded, timeEntries: [te("t3", "2026-10-05"), te("t4", "2026-11-05")] })).rejects.toThrow(/nicht lesbar/);
    const files = await readdir(join(dir, "time"));
    expect(files).not.toContain("e2_2026-10.json");
    expect(files).toContain("e2_2026-11.json");
  });

  it("Kopien «name (1).json» (Drive/Windows) gelten als Konfliktkopie", async () => {
    const te = (id: string, date: string) => ({ id, employeeId: "e2", date, minutes: 60 }) as never;
    await new FileStorageAdapter(dir, nodeFs, "A").save({ ...sampleData(), expenses: [], timeEntries: [te("t1", "2026-11-03")] });
    await writeFile(join(dir, "time/e2_2026-11 (1).json"), JSON.stringify({ format: 1, entries: [{ id: "tY", employeeId: "e2", date: "2026-11-09", minutes: 5 }] }));
    const back = (await new FileStorageAdapter(dir, nodeFs, "C").load()) as unknown as AppData;
    expect(back.timeEntries.map(e => e.id)).toEqual(["t1"]);
  });

  it("gültiges JSON mit falscher Form gilt als beschädigt (kein roher TypeError)", async () => {
    await new FileStorageAdapter(dir, nodeFs, "A").save(sampleData());
    await writeFile(join(dir, "time/e9_2026-01.json"), JSON.stringify({ format: 1, entries: [null] }));
    await expect(new FileStorageAdapter(dir, nodeFs, "C").load()).rejects.toThrow(/beschädigt/);
  });
});
