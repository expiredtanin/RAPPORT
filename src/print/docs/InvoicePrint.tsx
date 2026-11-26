// Druckvorlagen Rechnung (`invoice`, `invoice+qr`) und QR-Zahlteil (`qrbill`).
// Der Zahlteil kommt als SVG von swissqrbill (lazy geladen) und ist pixelgenau — Änderungen im Druck prüfen.

import { useState, useEffect } from "react";
import { formatCHF, formatDate, formatIban, formatSenderAddress, invoiceNet, lineAmount, paymentReference } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Data } from "swissqrbill/types";
import type { Invoice, InvoiceBillingSummary, Settings } from "../../types";
import { HEADING, type Client } from "./shared";
import { buildQrBillData } from "./qrBillData";
import { PrintText } from "./PrintText";

export function InvoicePrint({ inv, client, settings }: { inv: Invoice; client: Client; settings: Settings }) {
  // Gutschrift (Total < 0): als solche betiteln, ohne Fälligkeit und Zahlungsangaben (Runde 34)
  const isCredit = (inv.total || 0) < 0;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 60 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={24} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#666" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>{isCredit ? "GUTSCHRIFT" : "RECHNUNG"}</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, marginTop: 4 }}>Nr. {inv.number}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 6 }}>{isCredit ? "GUTSCHRIFT AN" : "RECHNUNG AN"}</div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{client?.name || "—"}</div>
          {(() => {
            const contact = inv.contactId ? (client?.contacts || []).find(ct => ct.id === inv.contactId) : null;
            if (contact) return <div style={{ fontSize: 11 }}>z.H. {contact.name}{contact.position ? `, ${contact.position}` : ""}</div>;
            return null;
          })()}
          {client?.street && <div style={{ color: "#555" }}>{client.street}</div>}
          {(client?.zip || client?.city) && <div style={{ color: "#555" }}>{[client.zip, client.city].filter(Boolean).join(" ")}</div>}
          {!client?.street && client?.address && <div style={{ whiteSpace: "pre-line", color: "#555" }}>{client.address}</div>}
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10 }}>
          <div><span style={{ color: "#888" }}>Datum:</span> <strong>{formatDate(inv.date)}</strong></div>
          {inv.dueDate && !isCredit && <div><span style={{ color: "#888" }}>Fällig:</span> <strong>{formatDate(inv.dueDate)}</strong></div>}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24, fontSize: 11 }}>
        <thead>
          <tr style={{ borderTop: "2px solid var(--doc-accent)", borderBottom: "1px solid var(--doc-ink)" }}>
            <th style={{ textAlign: "left", padding: "10px 0", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500 }}>BESCHREIBUNG</th>
            <th className="align-right" style={{ textAlign: "right", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 70 }}>MENGE</th>
            <th className="align-right" style={{ textAlign: "right", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 100 }}>PREIS</th>
            {(inv.items || []).some(it => (it.discount || 0) > 0) && (
              <th className="align-right" style={{ textAlign: "right", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 70 }}>RABATT</th>
            )}
            <th className="align-right" style={{ textAlign: "right", padding: "10px 0", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 110 }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {(inv.items || []).map((item, i) => {
            const hasAnyDiscount = (inv.items || []).some(it => (it.discount || 0) > 0);
            return (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 0", overflowWrap: "anywhere" }}>{item.desc}</td>
                <td className="align-right" style={{ textAlign: "right", padding: "10px 8px" }}>{item.qty}</td>
                <td className="align-right" style={{ textAlign: "right", padding: "10px 8px" }}>{formatCHF(item.price)}</td>
                {hasAnyDiscount && (
                  <td className="align-right" style={{ textAlign: "right", padding: "10px 8px", color: "#b5621e" }}>
                    {(item.discount || 0) > 0 ? `−${item.discount}%` : "—"}
                  </td>
                )}
                <td className="align-right" style={{ textAlign: "right", padding: "10px 0" }}>{formatCHF(lineAmount(item.qty, item.price, item.discount))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 50 }}>
        <div style={{ width: 300 }}>
          {(inv.globalDisc || 0) !== 0 && <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>Zwischentotal</span><span>{formatCHF(inv.sub)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#b5621e" }}><span>{inv.discountLabel || "Rabatt"}</span><span>{(inv.globalDisc || 0) > 0 ? `−${formatCHF(inv.globalDisc)}` : `+${formatCHF(-(inv.globalDisc || 0))}`}</span></div>
          </>}
          {inv.mwst && <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>Netto</span><span>{formatCHF(invoiceNet(inv))}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>MWST {inv.mwstRate ?? settings.mwstRate}%</span><span>{formatCHF(inv.tax)}</span></div>
          </>}
          <div className="doc-heading" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "2px solid var(--doc-accent)", marginTop: 6, ...HEADING, fontSize: 16, fontWeight: 700 }}>
            <span>Total</span><span>{formatCHF(inv.total)}</span>
          </div>
        </div>
      </div>

      {inv.billingSummary && <BillingSummaryBlock s={inv.billingSummary} />}

      {inv.notes && <PrintText text={inv.notes} style={{ marginBottom: 40, fontSize: 10, color: "#555", lineHeight: 1.7 }} />}

      <div style={{ marginTop: 60, paddingTop: 20, borderTop: "1px solid #ddd", fontSize: 9, color: "#888", display: "flex", justifyContent: "space-between" }}>
        {isCredit ? <div /> : <div>
          <div style={{ letterSpacing: "0.1em", marginBottom: 3 }}>ZAHLUNG AUF</div>
          <div>{formatIban(settings.iban)}</div>
          {/* Bei einer QR-IBAN gilt nur die QR-Referenz — wer von Hand zahlt, muss genau diese angeben */}
          <div style={{ marginTop: 3 }}>Referenz: {paymentReference(inv.number, settings.iban).display}</div>
        </div>}
        <div className="align-right" style={{ textAlign: "right" }}>
          <div>{settings.mwst}</div>
        </div>
      </div>
    </>
  );
}

/**
 * Abrechnungsblock einer Akonto-/Teilrechnung: Honorar total, bisher in Rechnung gestellt, diese Rechnung,
 * Rest nach dieser Rechnung (netto exkl. MWST, mit Anteil am Honorar). Werte aus `inv.billingSummary`
 * (beim Speichern festgehalten, im Entwurf aktuell berechnet — invoiceHelpers.ts `invoiceForPrint`).
 */
function BillingSummaryBlock({ s }: { s: InvoiceBillingSummary }) {
  const pct = (x: number) => `${(s.fee > 0 ? x / s.fee * 100 : 0).toFixed(1)} %`;
  const nums = s.priorNumbers.length > 0 && s.priorNumbers.length <= 4 ? ` (${s.priorNumbers.join(", ")})` : s.priorNumbers.length > 4 ? ` (${s.priorNumbers.length} Rechnungen)` : "";
  const rows: { label: string; amt: number; strong?: boolean }[] = [
    { label: s.quoteNumber ? `Honorar total gemäss Offerte ${s.quoteNumber}` : "Honorar total", amt: s.fee },
    { label: `Bisher in Rechnung gestellt${nums}`, amt: s.prior },
    { label: "Diese Rechnung", amt: s.thisNet },
    // über dem Honorar: Betrag positiv mit eigener Beschriftung statt «CHF-…»
    s.rest < 0 ? { label: "Über dem Honorar nach dieser Rechnung", amt: -s.rest, strong: true } : { label: "Rest nach dieser Rechnung", amt: s.rest, strong: true },
  ];
  const cell = { padding: "3px 0", whiteSpace: "nowrap" } as const;
  return (
    <div className="billing-summary" style={{ marginBottom: 40, fontSize: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>STAND DER ABRECHNUNG (NETTO, EXKL. MWST)</div>
      <table style={{ width: "100%", borderCollapse: "collapse", borderTop: "1px solid #ddd" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={r.strong ? { borderTop: "1px solid var(--doc-ink)", fontWeight: 600 } : { borderBottom: i < rows.length - 2 ? "1px solid #eee" : undefined }}>
              <td style={{ ...cell, whiteSpace: "normal", color: r.strong ? undefined : "#555" }}>{r.label}</td>
              <td className="align-right" style={{ ...cell, textAlign: "right", width: 110 }}>{formatCHF(r.amt)}</td>
              <td className="align-right" style={{ ...cell, textAlign: "right", width: 64, paddingLeft: 12, color: r.strong ? undefined : "#888" }}>{pct(r.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QRBillPrint({ inv, client, settings }: { inv: Invoice; client: Client; settings: Settings }) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { SwissQRBill: SVG } = await import("swissqrbill/svg");
        if (cancelled) return;

        const res = buildQrBillData(inv, client, settings);
        if (!res.ok) {
          if (!cancelled) { if (res.error) setError(res.reason); else setNotice(res.reason); }
          return;
        }
        const data: Data = res.data;

        const qr = new SVG(data);
        const svgString = typeof qr.toString === "function"
          ? qr.toString()
          : ((qr as unknown as { element?: { outerHTML?: string }; outerHTML?: string }).element?.outerHTML || (qr as unknown as { outerHTML?: string }).outerHTML || String(qr));

        if (!cancelled) setQrSvg(svgString);
      } catch (err) {
        console.error("QR-Bill Fehler:", err);
        if (!cancelled) setError((err as Error).message || "Fehler beim Generieren der QR-Rechnung");
      }
    })();

    return () => { cancelled = true; };
  }, [inv, client, settings]);

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#8a1a1a", marginBottom: 10 }}>Fehler beim Generieren</div>
        <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{error}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 20, lineHeight: 1.7 }}>
          Mögliche Ursachen: ungültige IBAN oder unvollständige Absenderadresse (Einstellungen → Studio).
        </div>
      </div>
    );
  }

  if (notice) {
    // Hinweis fürs Büro (z.B. «Gutschrift — kein Einzahlungsschein»), nicht im Kunden-PDF
    return <div className="no-print" style={{ padding: 40, fontSize: 12, color: "#666" }}>{notice}</div>;
  }

  if (!qrSvg) {
    return (
      <div style={{ padding: 40, fontSize: 12, color: "#888" }}>QR-Rechnung wird generiert…</div>
    );
  }

  return (
    <div style={{ width: "210mm", height: "105mm" }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
  );
}
