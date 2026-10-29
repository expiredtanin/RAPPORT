// Druckvorlagen Rechnung (`invoice`, `invoice+qr`) und QR-Zahlteil (`qrbill`).
// Der Zahlteil kommt als SVG von swissqrbill (lazy geladen) und ist pixelgenau — Änderungen im Druck prüfen.

import { useState, useEffect } from "react";
import { formatCHF, formatDate, formatSenderAddress, isQRIban, generateQRReference } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Data } from "swissqrbill/types";
import type { Invoice, Settings } from "../../types";
import { HEADING, type Client } from "./shared";

export function InvoicePrint({ inv, client, settings }: { inv: Invoice; client: Client; settings: Settings }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 60 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={24} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#666" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>RECHNUNG</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, marginTop: 4 }}>Nr. {inv.number}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 6 }}>RECHNUNG AN</div>
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
          {inv.dueDate && <div><span style={{ color: "#888" }}>Fällig:</span> <strong>{formatDate(inv.dueDate)}</strong></div>}
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
            const lineTotal = item.qty * item.price;
            const lineDisc = (item.discount || 0) > 0 ? lineTotal * ((item.discount as number) / 100) : 0;
            const hasAnyDiscount = (inv.items || []).some(it => (it.discount || 0) > 0);
            return (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 0" }}>{item.desc}</td>
                <td className="align-right" style={{ textAlign: "right", padding: "10px 8px" }}>{item.qty}</td>
                <td className="align-right" style={{ textAlign: "right", padding: "10px 8px" }}>{formatCHF(item.price)}</td>
                {hasAnyDiscount && (
                  <td className="align-right" style={{ textAlign: "right", padding: "10px 8px", color: "#b5621e" }}>
                    {(item.discount || 0) > 0 ? `−${item.discount}%` : "—"}
                  </td>
                )}
                <td className="align-right" style={{ textAlign: "right", padding: "10px 0" }}>{formatCHF(lineTotal - lineDisc)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 50 }}>
        <div style={{ width: 300 }}>
          {(inv.globalDisc || 0) > 0 && <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>Zwischentotal</span><span>{formatCHF((inv.items || []).reduce((s, it) => { const l = it.qty * it.price; return s + l - ((it.discount||0) > 0 ? l*((it.discount as number)/100) : 0); }, 0))}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#b5621e" }}><span>{inv.discountLabel || "Rabatt"}</span><span>−{formatCHF(inv.globalDisc)}</span></div>
          </>}
          {inv.mwst && <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>Netto</span><span>{formatCHF(inv.sub)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "#666" }}>MWST {inv.mwstRate ?? settings.mwstRate}%</span><span>{formatCHF(inv.tax)}</span></div>
          </>}
          <div className="doc-heading" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "2px solid var(--doc-accent)", marginTop: 6, ...HEADING, fontSize: 16, fontWeight: 700 }}>
            <span>Total</span><span>{formatCHF(inv.total)}</span>
          </div>
        </div>
      </div>

      {inv.notes && <div style={{ marginBottom: 40, fontSize: 10, color: "#555", lineHeight: 1.7 }}>{inv.notes}</div>}

      <div style={{ marginTop: 60, paddingTop: 20, borderTop: "1px solid #ddd", fontSize: 9, color: "#888", display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ letterSpacing: "0.1em", marginBottom: 3 }}>ZAHLUNG AUF</div>
          <div>{settings.iban}</div>
          <div style={{ marginTop: 3 }}>Referenz: {inv.number}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div>{settings.mwst}</div>
        </div>
      </div>
    </>
  );
}

export function QRBillPrint({ inv, client, settings }: { inv: Invoice; client: Client; settings: Settings }) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { SwissQRBill: SVG } = await import("swissqrbill/svg");
        if (cancelled) return;

        const ibanClean = (settings.iban || "").replace(/\s/g, "").toUpperCase();
        const hasQRIban = isQRIban(ibanClean);
        const data: Data = {
          currency: "CHF",
          amount: inv.total,
          creditor: {
            name: settings.name || "—",
            address: settings.street || "—",
            zip: settings.zip || "",
            city: settings.city || "",
            account: ibanClean,
            country: settings.country || "CH",
          },
        };
        if (client) {
          data.debtor = {
            name: client.company || client.name || "—",
            address: client.street || "—",
            zip: client.zip || "",
            city: client.city || "",
            country: client.country || "CH",
          };
        }
        if (hasQRIban) {
          data.reference = generateQRReference(inv.number);
        }
        if (inv.notes || inv.number) {
          data.message = `Rechnung ${inv.number}`;
        }

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
          Mögliche Ursachen: fehlende Empfänger-Adresse (Strasse, PLZ, Ort) oder ungültige IBAN.
        </div>
      </div>
    );
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
