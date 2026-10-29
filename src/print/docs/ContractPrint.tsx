// Druckvorlage Vertrag (`vertrag`).

import { formatCHF, formatDate, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Project, Settings, Contract } from "../../types";
import { HEADING, type Client } from "./shared";

export function VertragPrint({ vertrag, client, project, settings }: { vertrag: Contract; client: Client; project?: Project; settings: Settings }) {
  const isUnterauftrag = vertrag.contractType === "unterauftrag";
  const partnerLabel = isUnterauftrag ? "AUFTRAGNEHMER (FACHPLANER)" : "AUFTRAGGEBER";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#666" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>{isUnterauftrag ? "UNTERAUFTRAG" : "VERTRAG"}</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, marginTop: 4 }}>Nr. {vertrag.number}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 4 }}>{partnerLabel}</div>
          {client ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{client.name || "—"}</div>
              {client.street && <div style={{ color: "#555" }}>{client.street}</div>}
              {(client.zip || client.city) && <div style={{ color: "#555" }}>{[client.zip, client.city].filter(Boolean).join(" ")}</div>}
              {!client.street && !client.city && client.address && <div style={{ whiteSpace: "pre-line", color: "#555" }}>{client.address}</div>}
            </>
          ) : <div style={{ color: "#aaa" }}>—</div>}
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10 }}>
          <div><span style={{ color: "#888" }}>Datum:</span> <strong>{formatDate(vertrag.date)}</strong></div>
          {vertrag.signedDate && <div><span style={{ color: "#888" }}>Unterzeichnet:</span> <strong>{formatDate(vertrag.signedDate)}</strong></div>}
          {project && <div><span style={{ color: "#888" }}>Projekt:</span> <strong>{project.number ? project.number + " " : ""}{project.name}</strong></div>}
        </div>
      </div>

      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 6, paddingBottom: 5, borderBottom: "1.5px solid var(--doc-accent)" }}>
        VERTRAGSBESTIMMUNGEN
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18, fontSize: 11 }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "7px 0", width: "38%", color: "#888" }}>Vertragsart</td>
            <td style={{ padding: "7px 0" }}>{isUnterauftrag ? "Unterauftrag (Fachplaner)" : "Hauptauftrag (Bauherr)"}</td>
          </tr>
          {vertrag.legalBasis && (
            <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "7px 0", color: "#888" }}>Rechtsgrundlage</td>
              <td style={{ padding: "7px 0" }}>{vertrag.legalBasis}</td>
            </tr>
          )}
          <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "7px 0", color: "#888" }}>Vergütung</td>
            <td style={{ padding: "7px 0", fontWeight: 600 }}>
              {vertrag.billingType === "stundensatz" ? `${formatCHF(vertrag.hourlyRate)}/h` : formatCHF(vertrag.amount)}
              {vertrag.billingType === "stundensatz" && <span style={{ fontWeight: 400, color: "#888" }}> (nach effektivem Aufwand)</span>}
            </td>
          </tr>
          {vertrag.paymentTerms && (
            <tr>
              <td style={{ padding: "7px 0", color: "#888", verticalAlign: "top" }}>Zahlungsbedingungen</td>
              <td style={{ padding: "7px 0", whiteSpace: "pre-line" }}>{vertrag.paymentTerms}</td>
            </tr>
          )}
        </tbody>
      </table>

      {vertrag.notes && (
        <>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#888", marginBottom: 6, paddingBottom: 5, borderBottom: "1.5px solid var(--doc-accent)" }}>
            WEITERE BESTIMMUNGEN
          </div>
          <div style={{ marginBottom: 24, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-line" }}>{vertrag.notes}</div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 60 }}>
        <div>
          <div style={{ borderTop: "1px solid var(--doc-ink)", paddingTop: 6, fontSize: 9, color: "#888" }}>Ort, Datum</div>
          <div style={{ borderTop: "1px solid var(--doc-ink)", paddingTop: 6, marginTop: 40, fontSize: 9, color: "#888" }}>Unterschrift {isUnterauftrag ? "Auftraggeber" : "Bauherrschaft"}</div>
        </div>
        <div>
          <div style={{ borderTop: "1px solid var(--doc-ink)", paddingTop: 6, fontSize: 9, color: "#888" }}>Ort, Datum</div>
          <div style={{ borderTop: "1px solid var(--doc-ink)", paddingTop: 6, marginTop: 40, fontSize: 9, color: "#888" }}>Unterschrift {isUnterauftrag ? "Auftragnehmer" : "Auftragnehmer/in"}</div>
        </div>
      </div>
    </>
  );
}
