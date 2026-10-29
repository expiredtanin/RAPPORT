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
