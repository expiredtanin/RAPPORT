// Einstellungen → Erscheinungsbild: Corporate Design für alle gedruckten Dokumente.
//
// Bearbeitet `settings.docDesign` in der lokalen Einstellungs-Kopie von Settings.tsx
// (übernommen mit «Speichern», wie die übrigen Reiter) und die Dateien in
// `data.docAssets` (Schriften, Briefpapier) — diese werden beim Hochladen/Löschen
// sofort gespeichert, weil sie gross sind und nicht mit jeder Einstellung neu
// geschrieben werden sollen. Rechts eine Live-Vorschau (DocPreview aus dem Druckmodul,
// lazy geladen).
//
// Lokaler Modus: alle Dateien teilen sich den ~5-MB-localStorage-Eintrag, deshalb
// prüft jeder Upload das Budget (print/docAssets.ts) und die Anzeige zeigt den Verbrauch.

import React, { useState, useMemo, lazy, Suspense } from "react";
import { DOC_FONTS, DEFAULT_DOC_DESIGN } from "../print/docDesign";
import { FONT_ACCEPT, LETTERHEAD_ACCEPT, CLOUD_ASSET_LIMIT, fontAssetFromFile, letterheadFromFile, assetSize } from "../print/docAssets";
import { isCloudBackend, isFileBackend } from "../storage/adapter";
import { generateId, LOCAL_STORAGE_BUDGET, checkLocalBudget, formatSize } from "../utils";
import type { AppData, DocAsset, DocDesign, Settings, UpdateFn } from "../types";

const DocPreview = lazy(() => import("../print/PrintComponents").then(m => ({ default: m.DocPreview })));

const cardTitle: React.CSSProperties = { fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" };
const hint: React.CSSProperties = { fontSize: 11, color: "var(--text5)", lineHeight: 1.6 };
const code: React.CSSProperties = { background: "var(--surface3)", padding: "1px 4px", borderRadius: 2, fontFamily: "monospace" };

const CSS_EXAMPLE = `/* Beispiel: Titel in Grossbuchstaben, Tabellenköpfe in Akzentfarbe */
.doc-heading { text-transform: uppercase; letter-spacing: 0.04em; }
.print-page th { color: var(--doc-accent) !important; }
/* Nur Rechnungen: Nummer kleiner */
[data-doc="invoice"] .doc-heading { font-size: 18px !important; }`;

/** Reiter «Erscheinungsbild» in den Einstellungen. */
export default function DocDesignSettings({ s, setField, data, update }: {
  s: Settings;
  setField: (changes: Partial<Settings>) => void;
  data: AppData;
  update: UpdateFn;
}) {
  const d: DocDesign = s.docDesign || {};
  const assets = data.docAssets || [];
  const fonts = assets.filter(a => a.kind === "font");
  const families = [...new Set(fonts.map(f => f.family || ""))].filter(Boolean);
  const first = assets.find(a => a.kind === "letterheadFirst");
  const follow = assets.find(a => a.kind === "letterheadFollow");
  const [sample, setSample] = useState<"invoice" | "letter" | "protokoll">("invoice");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  const setDesign = (changes: Partial<DocDesign>) => setField({ docDesign: { ...d, ...changes } });
  // Nur der lokale Speicher (localStorage) hat eine Grenze; Cloud und Datenordner nicht.
  const limited = !isCloudBackend && !isFileBackend;
  const dpi = limited ? 200 : 300;
  const localUsed = useMemo(() => (limited ? JSON.stringify(data).length : 0), [limited, data]);
  const sumSize = (list: DocAsset[]) => list.reduce((n, a) => n + assetSize(a), 0);

  /** Fügt `added` hinzu und entfernt `removed` — ein einziges update(), vorher Grössenprüfung. false = abgelehnt (Meldung gesetzt). */
  const commitAssets = (added: DocAsset[], removed: DocAsset[]): boolean => {
    if (limited) {
      const problem = checkLocalBudget(data, sumSize(added), sumSize(removed));
      if (problem) { setMsg({ error: true, text: problem }); return false; }
    } else {
      const tooBig = added.find(a => assetSize(a) > CLOUD_ASSET_LIMIT);
      if (tooBig) { setMsg({ error: true, text: `«${tooBig.name}» ist zu gross (${formatSize(assetSize(tooBig))}, max. ${formatSize(CLOUD_ASSET_LIMIT)}).` }); return false; }
    }
    const removedIds = new Set(removed.map(a => a.id));
    update("docAssets", [...assets.filter(a => !removedIds.has(a.id)), ...added]);
    return true;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ error: true, text: (e as Error).message || "Die Datei konnte nicht verarbeitet werden." }); }
    finally { setBusy(false); }
  };

  const uploadFonts = (files: FileList | null) => run(async () => {
    if (!files?.length) return;
    const added: DocAsset[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 3_000_000) throw new Error(`«${file.name}» ist zu gross für eine Schriftdatei (max. 3 MB).`);
      added.push({ id: generateId(), ...(await fontAssetFromFile(file)) });
    }
    if (commitAssets(added, [])) {
      const fam = added[0].family!;
      setMsg({ error: false, text: `${added.length === 1 ? "Schrift" : `${added.length} Schnitte`} «${fam}» hinzugefügt — jetzt oben als Titel- oder Textschrift wählen.` });
    }
  });

  /** `slot` = welcher Platz; bei «both» füllt ein zweiseitiges PDF beide. */
  const uploadLetterhead = (files: FileList | null, slot: "both" | "letterheadFirst" | "letterheadFollow") => run(async () => {
    const file = files?.[0];
    if (!file) return;
    const { pages, warning } = await letterheadFromFile(file, dpi);
    const kinds = slot === "both" ? (["letterheadFirst", "letterheadFollow"] as const).slice(0, pages.length) : [slot];
    const added: DocAsset[] = kinds.map((kind, i) => ({ id: generateId(), kind, name: i ? `${file.name} (Seite 2)` : file.name, data: pages[i] }));
    if (commitAssets(added, assets.filter(a => (kinds as readonly string[]).includes(a.kind)))) {
      setDesign({ letterhead: true });
      const what = added.length === 2 ? "Erste Seite und Folgeseiten übernommen" : added[0].kind === "letterheadFirst" ? "Erste Seite übernommen" : "Folgeseiten übernommen";
      setMsg({ error: false, text: `${what} (${formatSize(sumSize(added))}).${warning ? " " + warning : ""} Mit «Speichern» aktivieren.` });
    }
  });

  const removeAsset = (a: DocAsset) => { commitAssets([], [a]); setMsg(null); };
  const renameFamily = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from) return;
    update("docAssets", assets.map(a => a.kind === "font" && a.family === from ? { ...a, family: name } : a));
    const changes: Partial<DocDesign> = {};
    if (d.headingFont === from) changes.headingFont = name;
    if (d.bodyFont === from) changes.bodyFont = name;
    if (Object.keys(changes).length) setDesign(changes);
  };

  const fontSelect = (value: string | undefined, onChange: (v: string) => void, standard: string) => {
    const known = !value || families.includes(value) || DOC_FONTS.some(f => f.family === value);
    return (
      <select value={value || ""} onChange={e => onChange(e.target.value)} style={{ width: "100%" }}>
        <option value="">Standard ({standard})</option>
        {!known && <option value={value}>{value} (Datei fehlt)</option>}
        {families.length > 0 && <optgroup label="Eigene Schriften">{families.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>}
        {(["Google Fonts", "Systemschriften (macOS)"] as const).map(g => (
          <optgroup key={g} label={g}>{DOC_FONTS.filter(f => f.group === g).map(f => <option key={f.family} value={f.family}>{f.family}</option>)}</optgroup>
        ))}
      </select>
    );
  };

  const colorField = (label: string, value: string | undefined, fallback: string, onChange: (v: string | undefined) => void, resetLabel: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 12, color: "var(--text3)", width: 90 }}>{label}</span>
      <input type="color" value={value || fallback} onChange={e => onChange(e.target.value)} style={{ width: 40, height: 30, padding: 2, cursor: "pointer" }} />
      <input value={value || ""} placeholder={fallback} onChange={e => onChange(e.target.value || undefined)} style={{ width: 90, fontFamily: "monospace", fontSize: 12 }} />
      {value && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", height: 28 }} onClick={() => onChange(undefined)}>↺ {resetLabel}</button>}
    </div>
  );

  const mmField = (label: string, value: number, onChange: (v: number) => void) => (
    <div>
      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>{label}</div>
      <input type="number" min={0} max={120} value={value} onChange={e => onChange(Math.max(0, +e.target.value || 0))} style={{ width: "100%", fontFamily: "monospace" }} />
    </div>
  );

  const letterheadSlot = (label: string, asset: DocAsset | undefined, kind: "letterheadFirst" | "letterheadFollow") => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
      <div style={{ width: 42, height: 59, border: "1px solid var(--border2)", background: asset ? `#fff url("${asset.data}") 0 0 / 100% 100% no-repeat` : "var(--surface2)", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text2)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset ? `${asset.name} · ${formatSize(assetSize(asset))}` : "keines"}</div>
      </div>
      <label className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 11, cursor: busy ? "wait" : "pointer", height: 30 }}>
        {asset ? "Ersetzen" : "Hochladen"}
        <input type="file" accept={LETTERHEAD_ACCEPT} disabled={busy} style={{ display: "none" }} onChange={e => { uploadLetterhead(e.target.files, kind); e.target.value = ""; }} />
      </label>
      {asset && <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11, height: 30 }} onClick={() => removeAsset(asset)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }} className="responsive-grid-2">
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ ...hint, color: "var(--text4)" }}>
          Gilt für alle gedruckten Dokumente und PDFs (ausser dem QR-Zahlteil, dessen Gestaltung die Norm vorgibt).
          Einstellungen werden mit «Speichern» übernommen; hochgeladene Dateien sind sofort gespeichert.
        </div>
        {msg && (
          <div style={{ fontSize: 12, lineHeight: 1.5, padding: "10px 12px", borderRadius: 6, border: `1px solid ${msg.error ? "#e8b0b0" : "#b8dcc8"}`, background: msg.error ? "var(--negative-bg)" : "#f0f8f4", color: msg.error ? "var(--negative)" : "var(--positive)" }}>{msg.text}</div>
        )}

        {/* Schriften */}
        <div className="card">
          <div style={cardTitle}>SCHRIFTEN</div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Titel, Nummern, Totale</label>
            {fontSelect(d.headingFont, v => setDesign({ headingFont: v || undefined }), DEFAULT_DOC_DESIGN.headingFont)}
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>Fliesstext</label>
            {fontSelect(d.bodyFont, v => setDesign({ bodyFont: v || undefined }), DEFAULT_DOC_DESIGN.bodyFont)}
          </div>

          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Eigene Schriften</div>
          {families.length === 0 && <div style={{ ...hint, marginBottom: 10 }}>Noch keine hochgeladen.</div>}
          {families.map(fam => (
            <div key={fam} style={{ border: "1px solid var(--border2)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
              <input defaultValue={fam} onBlur={e => renameFamily(fam, e.target.value)} title="Name der Schrift (umbenennen)" style={{ fontFamily: `"${fam}", sans-serif`, fontSize: 14, width: "100%", marginBottom: 6 }} />
              {fonts.filter(f => f.family === fam).map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text4)", padding: "2px 0" }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span>{f.weight || 400}{f.style === "italic" ? " kursiv" : ""} · {formatSize(assetSize(f))}</span>
                  <button className="btn btn-ghost" style={{ padding: "0 8px", height: 24, fontSize: 11 }} onClick={() => removeAsset(f)} title="Schnitt entfernen"><span className="msr" style={{ fontSize: 14 }}>delete</span></button>
                </div>
              ))}
            </div>
          ))}
          <label className="btn btn-ghost" style={{ fontSize: 12, cursor: busy ? "wait" : "pointer", marginTop: 4 }}>
            <span className="msr" style={{ fontSize: 16 }}>upload</span> Schrift hochladen
            <input type="file" multiple accept={FONT_ACCEPT} disabled={busy} style={{ display: "none" }} onChange={e => { uploadFonts(e.target.files); e.target.value = ""; }} />
          </label>
          <div style={{ ...hint, marginTop: 10 }}>
            .woff2, .woff, .otf oder .ttf — mehrere Schnitte (Regular, Bold, Italic) auf einmal möglich; Gewicht und Stil werden aus dem Dateinamen erkannt.
            Hochgeladene Schriften funktionieren offline, Google Fonts brauchen beim Drucken Internet. Bitte die Lizenz der Schrift beachten.
          </div>
        </div>

        {/* Farben */}
        <div className="card">
          <div style={cardTitle}>FARBEN</div>
          {colorField("Text", d.inkColor, DEFAULT_DOC_DESIGN.inkColor, v => setDesign({ inkColor: v }), "Standard")}
          {colorField("Akzent", d.accentColor, d.inkColor || DEFAULT_DOC_DESIGN.inkColor, v => setDesign({ accentColor: v }), "wie Text")}
          <div style={hint}>Akzent färbt Titel, Dokumentnummern, Totale und die kräftigen Linien.</div>
        </div>

        {/* Briefpapier */}
        <div className="card">
          <div style={cardTitle}>BRIEFPAPIER</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
            <input type="checkbox" checked={!!d.letterhead} onChange={e => setDesign({ letterhead: e.target.checked })} style={{ width: "auto" }} />
            Briefpapier hinterlegen
          </label>
          <label className="btn btn-ghost" style={{ fontSize: 12, cursor: busy ? "wait" : "pointer", marginBottom: 12 }}>
            <span className="msr" style={{ fontSize: 16 }}>upload</span> {busy ? "Wird verarbeitet …" : "Briefpapier-PDF hochladen"}
            <input type="file" accept={LETTERHEAD_ACCEPT} disabled={busy} style={{ display: "none" }} onChange={e => { uploadLetterhead(e.target.files, "both"); e.target.value = ""; }} />
          </label>
          <div style={{ ...hint, marginBottom: 12 }}>
            PDF vom Grafiker (A4 hoch): Seite 1 wird die erste Seite, Seite 2 (falls vorhanden) die Folgeseiten.
            Oder pro Seite ein PNG, JPG oder SVG. PDFs werden mit {dpi} dpi übernommen.
          </div>
          {letterheadSlot("Erste Seite", first, "letterheadFirst")}
          {letterheadSlot("Folgeseiten", follow, "letterheadFollow")}
          {first && !follow && (
            <button className="btn btn-ghost" style={{ fontSize: 11, height: 28, padding: "0 12px", marginBottom: 10 }}
              onClick={() => commitAssets([{ ...first, id: generateId(), kind: "letterheadFollow" }], [])}>Erste Seite auch für Folgeseiten verwenden</button>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 12, color: "var(--text2)", margin: "6px 0 14px" }}>
            <input type="checkbox" checked={d.letterheadHideSender !== false} onChange={e => setDesign({ letterheadHideSender: e.target.checked })} style={{ width: "auto" }} />
            Logo und Absender im Dokumentkopf ausblenden (stehen auf dem Briefpapier)
          </label>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Ränder (mm) — so wählen, dass der Text nicht in Kopf und Fuss des Briefpapiers läuft</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            {mmField("1. Seite oben", s.pageMarginTop ?? 20, v => setField({ pageMarginTop: v }))}
            {mmField("1. Seite unten", s.pageMarginBottom ?? 20, v => setField({ pageMarginBottom: v }))}
            {mmField("Folges. oben", d.followMarginTop ?? s.pageMarginTop ?? 20, v => setDesign({ followMarginTop: v }))}
            {mmField("Folges. unten", d.followMarginBottom ?? s.pageMarginBottom ?? 20, v => setDesign({ followMarginBottom: v }))}
          </div>
          <div style={{ ...hint, marginTop: 8 }}>Links/rechts: unter «Dokumente & Formate → Seitenränder». Die Folgeseiten-Ränder gelten auch ohne Briefpapier.</div>
          <div style={{ ...hint, marginTop: 10, color: "var(--text4)" }}>
            {isCloudBackend ? "Dateien liegen auf dem Server und stehen allen Mitgliedern des Büros zur Verfügung."
              : isFileBackend ? "Dateien liegen im Datenordner (ohne Speichergrenze)."
              : `Lokaler Speicher: ${formatSize(localUsed)} von ${formatSize(LOCAL_STORAGE_BUDGET)} belegt (alle Daten zusammen).`}
          </div>
        </div>

        {/* Eigenes CSS */}
        <div className="card">
          <div style={cardTitle}>EIGENES CSS (FÜR FORTGESCHRITTENE)</div>
          <textarea value={d.customCss || ""} onChange={e => setDesign({ customCss: e.target.value || undefined })} rows={8} spellCheck={false}
            placeholder={CSS_EXAMPLE} style={{ width: "100%", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, resize: "vertical" }} />
          {!d.customCss && <button className="btn btn-ghost" style={{ fontSize: 11, height: 28, padding: "0 12px", marginTop: 8 }} onClick={() => setDesign({ customCss: CSS_EXAMPLE })}>Beispiel einfügen</button>}
          <div style={{ ...hint, marginTop: 10 }}>
            Wird nach allen anderen Regeln eingefügt. Die Vorlagen setzen viele Werte direkt am Element — solche Werte mit <code style={code}>!important</code> überschreiben.<br />
            Ansatzpunkte: <code style={code}>.print-page</code> (Blatt), <code style={code}>[data-doc="invoice"]</code> (auch quote, vertrag, letter, protokoll, lieferschein, lohn …),
            {" "}<code style={code}>.doc-heading</code> (Titel/Totale), <code style={code}>.doc-sender</code> (Absender im Kopf), <code style={code}>table</code>/<code style={code}>th</code>/<code style={code}>td</code>,
            {" "}<code style={code}>.doc-letterhead-first</code>/<code style={code}>-follow</code>.<br />
            Variablen: <code style={code}>--doc-font-heading</code>, <code style={code}>--doc-font-body</code>, <code style={code}>--doc-font-plain</code> (Protokoll), <code style={code}>--doc-ink</code>, <code style={code}>--doc-accent</code>.
          </div>
        </div>
      </div>

      {/* Vorschau */}
      <div className="card" style={{ position: "sticky", top: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...cardTitle }}>
          <span>VORSCHAU</span>
          <div style={{ display: "flex", gap: 6 }}>
            {([["invoice", "Rechnung"], ["letter", "Brief"], ["protokoll", "Protokoll"]] as const).map(([id, label]) => (
              <button key={id} className={`pill${sample === id ? " active" : ""}`} style={{ fontSize: 11 }} onClick={() => setSample(id)}>{label}</button>
            ))}
          </div>
        </div>
        <Suspense fallback={<div style={hint}>Vorschau wird geladen …</div>}>
          <DocPreview settings={s} assets={assets} sample={sample} width={follow && d.letterhead ? 250 : 380} />
        </Suspense>
        <div style={{ ...hint, marginTop: 12 }}>Zeigt den ungespeicherten Stand. Die Druckansicht markiert Seitenumbrüche am Bildschirm mit einer feinen Linie.</div>
      </div>
    </div>
  );
}
