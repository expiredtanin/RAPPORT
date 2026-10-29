// Vollbild-Ansicht eines Belegs (Spesen, interne Ausgaben); genutzt von Spesen, Zeiterfassung und Buchhaltung.

import type { Expense } from "../types";

/** Das, was `ReceiptViewer` von einer Spese/Ausgabe braucht. */
export type ReceiptTarget = Pick<Expense, "receiptData" | "receiptName" | "description" | "category">;

/** Vollbild-Ansicht eines Belegs (Bild oder PDF) mit Download. Rendert nichts, wenn kein Beleg vorhanden ist. */
export function ReceiptViewer({ expense, onClose }: {
  expense: ReceiptTarget | null;
  onClose: () => void;
}) {
  if (!expense?.receiptData) return null;
  const isPdf = expense.receiptData.startsWith("data:application/pdf");
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
            <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Inter', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {expense.description || expense.category || "Beleg"}
            </div>
            {expense.receiptName && <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 2 }}>{expense.receiptName}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <a href={expense.receiptData} download={expense.receiptName || "beleg"} className="btn btn-ghost" style={{ fontSize: 12 }}>↓ Herunterladen</a>
            <button className="btn btn-ghost" onClick={onClose}><span className="msr" style={{ fontSize: 16, verticalAlign: "middle" }}>close</span> Schliessen</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          {isPdf ? (
            <iframe src={expense.receiptData} style={{ width: "100%", height: "75vh", border: "none" }} title="Beleg" />
          ) : (
            <img src={expense.receiptData} alt="Beleg" style={{ maxWidth: "100%", maxHeight: "75vh", objectFit: "contain", borderRadius: 4 }} />
          )}
        </div>
      </div>
    </div>
  );
}
