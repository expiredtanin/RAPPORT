// Druck-/PDF-Ansichten aller Dokumente. `PrintView` ist der Einstieg: App.jsx rendert
// ihn, sobald eine View `setPrintContent({ type, ... })` aufruft. `content.type` wählt
// das Dokument, die übrigen Felder von `content` sind dessen Daten (siehe die
// Aufrufe in den Views). Gedruckt wird über den Browser-/Tauri-Druckdialog
// (`window.print()` bzw. Webview-Print) — «Als PDF sichern» im Dialog. Der Dateiname
// kommt aus `buildPdfName` (utils.ts, Format in den Einstellungen).
//
// Dokumenttypen: invoice, invoice+qr, qrbill (Zahlteil), quote, vertrag, lieferschein,
// protokoll, letter, lohn, buchhaltung, studioBudget, projectDetail, projectsOverview,
// mitarbeiterOverview, timeReport. Die Vorlagen liegen je Fachbereich in print/docs/
// (z.B. docs/InvoicePrint.tsx); gemeinsame Typen und `HEADING` in docs/shared.ts.
//
// Layout: A4 (QR-Zahlteil: 210×105 mm), Seitenränder aus den Einstellungen
// (`pageMargin*`), helle Farben unabhängig vom App-Theme. Die Seite wird per CSS
// (`@page`, `@media print`) im Block unten gesteuert; der QR-Zahlteil kommt von der
// Bibliothek swissqrbill (in QRBillPrint). Im Druck zählen nur die gespeicherten
// Beträge der Dokumente (sub/tax/total), es wird nichts neu gerechnet.
//
// Erscheinungsbild: Schriften und Farben kommen nie fest, sondern als CSS-Variablen
// (`--doc-font-heading`, `--doc-font-body`, `--doc-font-plain`, `--doc-ink`, `--doc-accent`)
// aus `settings.docDesign` (docDesign.ts); Titelelemente nutzen `HEADING` und tragen die
// Klasse `doc-heading`, der Absenderblock im Kopf `doc-sender` — beides Ansatzpunkte für
// eigenes CSS. Briefpapier (`data.docAssets`) liegt als Ebene hinter dem Inhalt
// (`LetterheadLayers`). Mehrseitige Dokumente verteilt `paginate()` (paginate.ts) auf
// A4-Seiten, damit auch Folgeseiten oben und unten Rand haben. Neue Dokumente: Farben
// über die Variablen, Titel mit `...HEADING`, Absender in `className="doc-sender"`.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { buildPdfName } from "../utils";
import { buildDocCss, buildFontFaces, resolveDocDesign, type ResolvedDocDesign } from "./docDesign";
import { paginate, PAGE_HEIGHT_MM } from "./paginate";
import type { AppData, DocAsset, Invoice, Person, Protocol, Settings } from "../types";
import type { Content } from "./docs/shared";
import { InvoicePrint, QRBillPrint } from "./docs/InvoicePrint";
import { QuotePrint } from "./docs/QuotePrint";
import { VertragPrint } from "./docs/ContractPrint";
import { LieferscheinPrint } from "./docs/DeliveryNotePrint";
import { ProtokollPrint } from "./docs/ProtocolPrint";
import { LetterPrint } from "./docs/LetterPrint";
import { ProjectDetailPrint, ProjectsOverviewPrint } from "./docs/ProjectPrints";
import { LohnPrint } from "./docs/PayrollPrint";
import { BuchhaltungPrint } from "./docs/AccountingPrint";
import { MitarbeiterOverviewPrint, TimeReportPrint } from "./docs/EmployeePrints";
import { StudioBudgetPrint } from "./docs/StudioBudgetPrint";

/** Briefpapier-Ebenen hinter dem Inhalt: erste Seite oben, Folgeseiten als Raster ab 297 mm (Höhe setzt der Paginator). */
function LetterheadLayers({ design, followRef }: { design: ResolvedDocDesign; followRef?: React.Ref<HTMLDivElement> }) {
  const layer: React.CSSProperties = { position: "absolute", left: 0, width: "210mm", zIndex: 0, pointerEvents: "none" };
  return (
    <>
      {design.letterheadFollow && (
        <div ref={followRef} className="doc-letterhead doc-letterhead-follow" style={{ ...layer, top: "297mm", height: 0, backgroundImage: `url("${design.letterheadFollow}")`, backgroundSize: "210mm 297mm", backgroundRepeat: "repeat-y" }} />
      )}
      {design.letterheadFirst && (
        <div className="doc-letterhead doc-letterhead-first" style={{ ...layer, top: 0, height: "297mm", background: `#fff url("${design.letterheadFirst}") 0 0 / 210mm 297mm no-repeat` }} />
      )}
    </>
  );
}

/** Klassen am Blatt: `paged` (Seitenumbruch aktiv), `has-letterhead`, `hide-sender` (Absender steht schon auf dem Briefpapier). */
const sheetClass = (design: ResolvedDocDesign, paged: boolean) =>
  ["print-page", paged && "paged", (design.letterheadFirst || design.letterheadFollow) && "has-letterhead", design.hideSender && "hide-sender"].filter(Boolean).join(" ");

/** Einstieg: wählt anhand von `content.type` das Dokument, bietet «Drucken»/«Schliessen» (nicht im Ausdruck). */
export function PrintView({ content, onClose, settings, assets }: { content: Content; onClose: () => void; settings: Settings; assets?: DocAsset[] }) {
  const design = useMemo(() => resolveDocDesign(settings, assets), [settings, assets]);
  const docCss = useMemo(() => buildDocCss(design), [design]);
  const fontFaces = useMemo(() => buildFontFaces(assets), [assets]);
  const isQrOnly = content.type === "qrbill";
  const paged = !isQrOnly;
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(-1);

  const mTop = settings?.pageMarginTop ?? 20;
  const mBottom = settings?.pageMarginBottom ?? 20;
  const mLeft = settings?.pageMarginLeft ?? 20;
  const mRight = settings?.pageMarginRight ?? 20;

  // Seitenumbrüche neu setzen (siehe paginate.ts): nach dem Rendern, wenn Schriften/Bilder/QR
  // nachladen (ResizeObserver) und direkt vor dem Drucken.
  const runPagination = useCallback(() => {
    const sheet = sheetRef.current, body = contentRef.current;
    if (!paged || !sheet || !body) return;
    sheet.style.minHeight = "";
    const { pages, qrPage } = paginate(sheet, body, { firstBottom: mBottom, followTop: design.followTop, followBottom: design.followBottom });
    sheet.style.minHeight = `calc(${pages * PAGE_HEIGHT_MM}mm - 2px)`;
    if (followRef.current) followRef.current.style.height = `${Math.max(0, (qrPage ?? pages) - 1) * PAGE_HEIGHT_MM}mm`;
    lastHeight.current = body.offsetHeight;
  }, [paged, mBottom, design.followTop, design.followBottom]);

  useLayoutEffect(() => { runPagination(); }, [runPagination, content, settings, assets]);
  useEffect(() => {
    const body = contentRef.current;
    if (!paged || !body) return;
    // Nicht im Observer-Callback selbst umbrechen (die Abstände ändern die Grösse erneut → «ResizeObserver loop»)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (Math.abs(body.offsetHeight - lastHeight.current) >= 1) runPagination(); }, 0);
    });
    ro.observe(body);
    document.fonts?.ready.then(() => runPagination());
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [paged, runPagination]);

  const triggerPrint = async () => {
    const pdfName = buildPdfName(settings?.pdfNameFormat, content, settings);
    const prevTitle = document.title;
    document.title = pdfName;
    try {
      await document.fonts?.ready;
      runPagination();
      if (window.__TAURI_INTERNALS__) {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        // `print()` fehlt in den mitgelieferten Typen von @tauri-apps/api, existiert aber zur Laufzeit.
        await (getCurrentWebviewWindow() as unknown as { print: () => Promise<void> }).print();
      } else {
        window.print();
      }
    } catch {
      window.print();
    } finally {
      setTimeout(() => { document.title = prevTitle; }, 2000);
    }
  };

  useEffect(() => {
    if (!settings.autoPrint) return;
    const timer = setTimeout(() => triggerPrint(), 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur einmal beim Öffnen der Druckansicht drucken
  }, [settings.autoPrint]);

  return (
    <div className="print-wrapper" style={{ background: "#d6d2cc", minHeight: "100vh", padding: "20px 0", overflowX: "auto" }}>
      {/* Druckbreite exakt 210 mm: WebKit setzt im Druck mit 744 px (Papierbreite × 1,25) und verkleinert nur,
          wenn der Inhalt breiter ist — mit «width: 100%» würde alles ~7 % grösser gedruckt als in mm eingestellt
          und die Seitenhöhe passte nicht mehr zu den 297 mm, mit denen paginate() rechnet. */}
      <style>{`
        :root { color-scheme: light; }
        .print-page, .print-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: ${isQrOnly ? "210mm 105mm" : "A4"}; margin: 0; }
        .print-page, .print-page * { text-align: left; }
        .print-page .align-right, .print-page .align-right * { text-align: right; }
        .print-page.hide-sender .doc-sender { visibility: hidden; }
        .print-page.paged { padding-bottom: 0 !important; }
        .doc-page-guides { position: absolute; inset: 0; z-index: 2; pointer-events: none;
          background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(297mm - 1px), rgba(0,0,0,0.28) calc(297mm - 1px), rgba(0,0,0,0.28) 297mm); }
        .qr-bill-wrapper {
          display: flex;
          justify-content: center;
          margin: 10mm -${mLeft}mm 0 -${mLeft}mm;
          width: 210mm;
        }
        .print-page.paged .qr-bill-wrapper { margin-top: 0; }
        @media print {
          :root { color-scheme: light; }
          html, body, #root, #root > div, .print-wrapper { background: white !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .print-wrapper { overflow: visible !important; }
          .print-page { box-shadow: none !important; margin: 0 !important; padding-top: ${mTop}mm !important; padding-bottom: ${mBottom}mm !important; padding-left: ${mLeft}mm !important; padding-right: ${mRight}mm !important; max-width: none !important; width: 210mm !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .print-page.paged { padding-bottom: 0 !important; }
          .print-page, .print-page * { text-align: left !important; }
          .print-page .align-right, .print-page .align-right * { text-align: right !important; }
          .qr-bill-wrapper { margin: 0 -${mLeft}mm 0 -${mLeft}mm !important; width: 210mm !important; }
          .qr-bill-newpage { page-break-before: always !important; break-before: page !important; }
          .print-page.paged .qr-bill-newpage { page-break-before: auto !important; break-before: auto !important; }
          .qr-bill-wrapper > div { width: 210mm !important; }
          .qr-bill-wrapper svg { width: 210mm !important; }
        }
      `}</style>
      {docCss.imports && <style>{docCss.imports}</style>}
      {fontFaces && <style>{fontFaces}</style>}
      <style>{docCss.css}</style>
      <div className="no-print" style={{ width: "210mm", margin: "0 auto 14px", display: "flex", gap: 10 }}>
        <button onClick={onClose} style={{ padding: "9px 18px", background: "#2a2a22", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontFamily: "DM Mono, monospace", fontSize: 13 }}>← Zurück</button>
        <button onClick={triggerPrint} style={{ padding: "9px 18px", background: "#252520", color: "#f0ede8", border: "none", borderRadius: 4, cursor: "pointer", fontFamily: "DM Mono, monospace", fontSize: 13, fontWeight: 500 }}>Drucken / PDF</button>
      </div>

      <div ref={sheetRef} className={sheetClass(design, paged)} data-doc={content.type} style={{
        position: "relative",
        width: "210mm",
        margin: "0 auto",
        background: "#fff",
        padding: isQrOnly ? 0 : `${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm`,
        minHeight: "auto",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        fontFamily: "var(--doc-font-body)",
        fontSize: 11,
        lineHeight: 1.6,
        color: "var(--doc-ink)"
      }}>
        {!isQrOnly && <LetterheadLayers design={design} followRef={followRef} />}
        {paged && <div className="doc-page-guides no-print" />}
        <div ref={contentRef} className="doc-content" style={{ position: "relative", zIndex: 1 }}>
          {content.type === "invoice" && <InvoicePrint inv={content.inv} client={content.client} settings={settings} />}
          {content.type === "invoice+qr" && (
            <>
              <InvoicePrint inv={content.inv} client={content.client} settings={settings} />
              <div className={`qr-bill-wrapper${settings?.qrNewPage !== false ? " qr-bill-newpage" : ""}`}>
                <QRBillPrint inv={content.inv} client={content.client} settings={settings} />
              </div>
            </>
          )}
          {content.type === "letter" && <LetterPrint client={content.client} subject={content.subject} body={content.body} isHtml={content.isHtml} settings={settings} />}
          {content.type === "projectDetail" && <ProjectDetailPrint content={content} settings={settings} />}
          {content.type === "projectsOverview" && <ProjectsOverviewPrint projects={content.projects} data={content.data} settings={settings} />}
          {content.type === "qrbill" && <QRBillPrint inv={content.inv} client={content.client} settings={settings} />}
          {content.type === "quote" && <QuotePrint quote={content.quote} client={content.client} settings={settings} />}
          {content.type === "vertrag" && <VertragPrint vertrag={content.vertrag} client={content.client} project={content.project} settings={settings} />}
          {content.type === "buchhaltung" && <BuchhaltungPrint data={content.data} filterYear={content.filterYear} settings={settings} />}
          {content.type === "lohn" && <LohnPrint entry={content.entry} emp={content.emp} data={content.data} monatLabel={content.monatLabel} settings={settings} />}
          {content.type === "lieferschein" && <LieferscheinPrint note={content.note} client={content.client} data={content.data} settings={settings} />}
          {content.type === "studioBudget" && <StudioBudgetPrint snapshot={content.snapshot} settings={settings} />}
          {content.type === "protokoll" && <ProtokollPrint protokoll={content.protokoll} data={content.data} settings={settings} />}
          {content.type === "mitarbeiterOverview" && <MitarbeiterOverviewPrint employees={content.employees} settings={settings} />}
          {content.type === "timeReport" && <TimeReportPrint employee={content.employee} entries={content.entries} month={content.month} data={content.data} settings={settings} />}
        </div>
      </div>
    </div>
  );
}

/** Beispielinhalte für die Vorschau in den Einstellungen. */
const PREVIEW_CLIENT = { id: "preview-client", name: "Muster Immobilien AG", street: "Bahnhofstrasse 1", zip: "8001", city: "Zürich", country: "CH" } as Person;

const PREVIEW_INVOICE = {
  id: "preview-inv", number: "2026-042", clientId: "preview-client", date: "2026-10-23", dueDate: "2026-11-22", status: "offen",
  items: [
    { desc: "Vorprojekt, SIA-Phase 31", qty: 1, price: 18400 },
    { desc: "Bauprojekt, SIA-Phase 32 (Akonto)", qty: 1, price: 12600 },
    { desc: "Nebenkosten pauschal", qty: 1, price: 450 },
  ],
  mwst: true, mwstRate: 8.1, sub: 31450, tax: 2547.45, total: 33997.45,
  notes: "Zahlbar innert 30 Tagen netto. Besten Dank für den Auftrag.",
} as Invoice;

const PREVIEW_LETTER = "Sehr geehrte Damen und Herren\n\nGerne bestätigen wir den Termin für die Baubesprechung vom kommenden Dienstag auf der Baustelle. Die überarbeiteten Pläne der Fassade liegen bei.\n\nFür Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.\n\nFreundliche Grüsse";

const PREVIEW_PROTOCOL = {
  id: "preview-proto", title: "Baubesprechung Nr. 7", type: "Baubesprechung", date: "2026-10-20", time: "09:00", endTime: "10:30", location: "Baustelle", nummer: "26-BB-07",
  projectManual: "Neubau Wohnhaus Seefeld",
  participants: [
    { id: "p1", name: "Anna Muster", role: "Bauherrschaft", status: "anwesend" },
    { id: "p2", name: "Beat Beispiel", role: "Bauleitung", status: "anwesend" },
  ],
  traktanden: [
    { id: "t1", nr: "1", title: "Termine", items: [
      { id: "e1", type: "info", text: "Rohbau im Zeitplan, Aufrichte KW 46." },
      { id: "e2", type: "aufgabe", text: "Terminprogramm Ausbau nachführen.", responsible: "p2", dueDateType: "kw", dueKW: 45, dueYear: 2026 },
    ] },
    { id: "t2", nr: "2", title: "Fassade", items: [
      { id: "e3", type: "beschluss", text: "Bemusterung Klinker gemäss Variante B.", date: "2026-10-20" },
    ] },
  ],
} as unknown as Protocol;

/**
 * Vorschau der ersten Seite (und bei Briefpapier einer Folgeseite) mit dem aktuellen Design,
 * für Einstellungen → Erscheinungsbild. Skaliert auf `width` px; eigenes CSS wirkt nur innerhalb der Vorschau.
 */
export function DocPreview({ settings, assets, sample, width }: { settings: Settings; assets?: DocAsset[]; sample: "invoice" | "letter" | "protokoll"; width: number }) {
  const design = useMemo(() => resolveDocDesign(settings, assets), [settings, assets]);
  const docCss = useMemo(() => buildDocCss(design, ".doc-preview"), [design]);
  const fontFaces = useMemo(() => buildFontFaces(assets), [assets]);
  const scale = width / (210 * 96 / 25.4);
  const mTop = settings.pageMarginTop ?? 20, mBottom = settings.pageMarginBottom ?? 20, mLeft = settings.pageMarginLeft ?? 20, mRight = settings.pageMarginRight ?? 20;
  const sheet: React.CSSProperties = { position: "relative", width: "210mm", height: "297mm", overflow: "hidden", background: "#fff", fontSize: 11, lineHeight: 1.6, color: "var(--doc-ink)", fontFamily: "var(--doc-font-body)", textAlign: "left" };
  const frame = (children: React.ReactNode, label: string) => (
    <div>
      <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>{label}</div>
      <div style={{ width, height: width * 297 / 210, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.15)", border: "1px solid var(--border2)" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
    </div>
  );
  const guide = (top: string, label: string): React.ReactNode => (
    <div style={{ position: "absolute", left: 0, right: 0, top, borderTop: "1px dashed #c33", zIndex: 3 }}>
      <span style={{ position: "absolute", right: "4mm", top: 2, fontFamily: "Inter, sans-serif", fontSize: 9, color: "#c33" }}>{label}</span>
    </div>
  );
  return (
    <div className="doc-preview" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {docCss.imports && <style>{docCss.imports}</style>}
      {fontFaces && <style>{fontFaces}</style>}
      <style>{`.doc-preview .print-page.hide-sender .doc-sender { visibility: hidden; } .doc-preview .print-page * { text-align: left; } .doc-preview .print-page .align-right, .doc-preview .print-page .align-right * { text-align: right; }`}</style>
      <style>{docCss.css}</style>
      {frame(
        <div className={sheetClass(design, false)} data-doc={sample} style={{ ...sheet, padding: `${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm` }}>
          <LetterheadLayers design={design} />
          <div className="doc-content" style={{ position: "relative", zIndex: 1 }}>
            {sample === "invoice" && <InvoicePrint inv={PREVIEW_INVOICE} client={PREVIEW_CLIENT} settings={settings} />}
            {sample === "letter" && <LetterPrint client={PREVIEW_CLIENT} subject="Neubau Wohnhaus Seefeld — Baubesprechung" body={PREVIEW_LETTER} settings={settings} />}
            {sample === "protokoll" && <ProtokollPrint protokoll={PREVIEW_PROTOCOL} data={{ projects: [] } as unknown as AppData} settings={settings} />}
          </div>
          {design.letterheadFirst && guide(`${297 - mBottom}mm`, `Rand unten ${mBottom} mm`)}
        </div>,
        "Seite 1"
      )}
      {design.letterheadFollow && frame(
        <div className={sheetClass(design, false)} data-doc={sample} style={{ ...sheet, padding: `${design.followTop}mm ${mRight}mm 0 ${mLeft}mm` }}>
          <div style={{ position: "absolute", inset: 0, background: `url("${design.letterheadFollow}") 0 0 / 210mm 297mm no-repeat`, zIndex: 0 }} />
          {guide(`${design.followTop}mm`, `Rand oben ${design.followTop} mm`)}
          {guide(`${297 - design.followBottom}mm`, `Rand unten ${design.followBottom} mm`)}
          <div style={{ position: "relative", zIndex: 1, color: "#999" }}>Fortsetzung des Dokuments …</div>
        </div>,
        "Folgeseiten"
      )}
    </div>
  );
}
