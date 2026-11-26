// Vollbild-Ansicht eines Belegs (Spesen, interne Ausgaben); genutzt von Spesen, Zeiterfassung und Buchhaltung.
// Im Datenordner und in der Cloud ist `receiptData` ein Verweis auf die Datei; gelesen wird sie erst hier (useAttachment).

import { useEffect } from "react";
import type { Expense } from "../types";
import { useAttachment } from "../hooks/useAttachment";
import { isCloudBackend } from "../storage/adapter";

/** Das, was `ReceiptViewer` von einer Spese/Ausgabe braucht. */
export type ReceiptTarget = Pick<Expense, "receiptData" | "receiptName" | "description" | "category">;

/** Vollbild-Ansicht eines Belegs (Bild oder PDF) mit Download. Rendert nichts, wenn kein Beleg vorhanden ist. */
export function ReceiptViewer({ expense, onClose }: {
  expense: ReceiptTarget | null;
  onClose: () => void;
}) {
  const receipt = useAttachment(expense?.receiptData);
  const open = !!expense?.receiptData;
  // Esc schliesst den Beleg (nicht den Dialog darunter, der sonst zuerst zuging — Runde 33)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!expense?.receiptData) return null;
  const url = receipt.url;
  const isPdf = !!url?.startsWith("data:application/pdf");
  // Endung passend zum Inhalt (Bilder werden beim Hochladen zu JPEG; «gross.png» war sonst ein JPEG mit .png)
  const mime = url?.match(/^data:([^;,]+)/)?.[1] || "";
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime.startsWith("image/") ? mime.slice(6).replace("svg+xml", "svg") : "";
  const base = (expense.receiptName || "beleg").replace(/\.[a-z0-9]{2,5}$/i, "");
  const fileName = ext ? `${base}.${ext}` : (expense.receiptName || "beleg");
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", borderRadius: 8, maxWidth: 860, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {expense.description || expense.category || "Beleg"}
            </div>
            {expense.receiptName && <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 2 }}>{expense.receiptName}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {url && <a href={url} download={fileName} className="btn btn-ghost" style={{ fontSize: 12 }}>↓ Herunterladen</a>}
            <button className="btn btn-ghost" onClick={onClose}><span className="msr" style={{ fontSize: 16, verticalAlign: "middle" }}>close</span> Schliessen</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          {receipt.status === "loading" && <div style={{ padding: 40, fontSize: 13, color: "var(--text4)" }}>Beleg wird geladen …</div>}
          {receipt.status === "missing" && (
            <div style={{ padding: 40, fontSize: 13, color: "var(--text3)", lineHeight: 1.7, maxWidth: 460, textAlign: "center" }}>
              {isCloudBackend
                ? "Der Beleg konnte nicht vom Server geladen werden (keine Verbindung oder keine Berechtigung). Der Beleg bleibt verknüpft; bitte später erneut öffnen."
                : "Die Datei dieses Belegs ist im Datenordner (noch) nicht vorhanden — vermutlich ist sie noch nicht synchronisiert. Der Beleg bleibt verknüpft; bitte später erneut öffnen."}
            </div>
          )}
          {url && (isPdf ? (
            <iframe src={url} style={{ width: "100%", height: "75vh", border: "none" }} title="Beleg" />
          ) : (
            <img src={url} alt="Beleg" style={{ maxWidth: "100%", maxHeight: "75vh", objectFit: "contain", borderRadius: 4 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
