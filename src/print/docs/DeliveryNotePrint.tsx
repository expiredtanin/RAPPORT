// Druckvorlage Lieferschein (`lieferschein`).

import { formatDate, formatSenderAddress } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, DeliveryNote, Settings } from "../../types";
import { HEADING, type Client } from "./shared";

export function LieferscheinPrint({ note, client, data, settings }: { note: DeliveryNote; client: Client; data: AppData; settings: Settings }) {
  const project = note.projectId ? (data?.projects || []).find(p => p.id === note.projectId) : null;
  const projectLabel = project?.name || note.projectManual || null;
  const addr = note.deliveryAddress || client?.address || "";

  return (
    <>
      {/* Kopf */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 60 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={24} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#666" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888" }}>LIEFERSCHEIN</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, marginTop: 4 }}>{note.number || "—"}</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>Datum: <strong style={{ color: "var(--doc-ink)" }}>{formatDate(note.date)}</strong></div>
        </div>
      </div>

      {/* Empfänger & Projektinfo */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 6 }}>LIEFERUNG AN</div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{client?.name || note.clientManual || "—"}</div>
          {client?.company && <div style={{ fontSize: 11 }}>{client.company}</div>}
          {addr && <div style={{ whiteSpace: "pre-line", fontSize: 11, color: "#555", marginTop: 2 }}>{addr}</div>}
        </div>
        {projectLabel && (
          <div className="align-right" style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#888", marginBottom: 6 }}>PROJEKT</div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{projectLabel}</div>
            {project?.number && <div style={{ fontSize: 10, color: "#888" }}>{project.number}</div>}
          </div>
        )}
      </div>

      {/* Positionen */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32, fontSize: 11 }}>
        <thead>
          <tr style={{ borderTop: "2px solid var(--doc-accent)", borderBottom: "1px solid var(--doc-ink)" }}>
            <th style={{ textAlign: "left", padding: "10px 0", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 30 }}>POS.</th>
            <th style={{ textAlign: "left", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500 }}>BESCHREIBUNG</th>
            <th className="align-right" style={{ textAlign: "right", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 70 }}>MENGE</th>
            <th style={{ textAlign: "left", padding: "10px 8px", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 60 }}>EINHEIT</th>
            <th style={{ textAlign: "left", padding: "10px 0", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: "25%" }}>BEMERKUNG</th>
            <th className="align-right" style={{ textAlign: "right", padding: "10px 0", fontSize: 9, letterSpacing: "0.12em", color: "#888", fontWeight: 500, width: 80 }}>EMPFANGEN ✓</th>
          </tr>
        </thead>
        <tbody>
          {(note.items || []).map((it, i) => (
            <tr key={it.id || i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px 0", color: "#888", fontSize: 10 }}>{i + 1}</td>
              <td style={{ padding: "10px 8px", fontWeight: it.desc ? 400 : 300 }}>{it.desc || "—"}</td>
              <td className="align-right" style={{ textAlign: "right", padding: "10px 8px", fontWeight: 500 }}>{it.qty}</td>
              <td style={{ padding: "10px 8px", color: "#555" }}>{it.unit}</td>
              <td style={{ padding: "10px 0", fontSize: 10, color: "#666" }}>{it.note || ""}</td>
              <td style={{ padding: "10px 0", textAlign: "right" }}>
                <div style={{ display: "inline-block", width: 18, height: 18, border: "1.5px solid #999", borderRadius: 2 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Notizen */}
      {note.notes && (
        <div style={{ marginBottom: 40, padding: "12px 16px", background: "#f8f8f6", borderLeft: "3px solid #ddd", fontSize: 10, color: "#555", lineHeight: 1.7 }}>
          {note.notes}
        </div>
      )}

      {/* Unterschriften */}
      <div style={{ marginTop: 60, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60 }}>
        <div>
          <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 9, color: "#888" }}>
            ÜBERGABE – {settings.name}
          </div>
          <div style={{ marginTop: 30, fontSize: 9, color: "#aaa" }}>Datum / Unterschrift</div>
        </div>
        <div>
          <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 9, color: "#888" }}>
            EMPFANG – {client?.name || note.clientManual || "Empfänger"}
          </div>
          <div style={{ marginTop: 30, fontSize: 9, color: "#aaa" }}>Datum / Unterschrift</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #ddd", fontSize: 9, color: "#aaa", display: "flex", justifyContent: "space-between" }}>
        <div>{settings.name} · {formatSenderAddress(settings).split("\n")[0]}</div>
        <div>{note.number}</div>
      </div>
    </>
  );
}
