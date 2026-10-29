// Druckvorlage Brief (`letter`), Text als Klartext oder bereinigtes HTML.

import { formatSenderAddress, sanitizeHtml } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { Settings } from "../../types";
import type { Client } from "./shared";

export function LetterPrint({ client, subject, body, isHtml, settings }: { client: Client; subject?: string; body: string; isHtml?: boolean; settings: Settings }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 80 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div className="align-right doc-sender" style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div>{settings.email}</div>
          <div>{settings.phone}</div>
        </div>
      </div>

      <div style={{ marginBottom: 50, fontSize: 11 }}>
        {client ? (<>
          <div style={{ fontWeight: 500 }}>{client.name}</div>
          {client.company && <div>{client.company}</div>}
          {client.street && <div>{client.street}</div>}
          {(client.zip || client.city) && <div>{[client.zip, client.city].filter(Boolean).join(" ")}</div>}
          {!client.street && !client.city && client.address && <div style={{ whiteSpace: "pre-line" }}>{client.address}</div>}
        </>) : <div style={{ color: "#aaa" }}>[Empfänger]</div>}
      </div>

      <div style={{ marginBottom: 30, fontSize: 10, color: "#666" }}>
        {settings.city || ((settings.address || "").split("\n").pop() || "").replace(/^\d{4,5}\s*/, "").trim() || "Zürich"}, {new Date().toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}
      </div>

      {subject && <div style={{ fontWeight: 500, marginBottom: 30, fontSize: 11 }}>{subject}</div>}

      <style>{`
        .letter-body p { margin: 0 0 0.7em; }
        .letter-body h2 { font-size: 12px; font-weight: 600; margin: 0.8em 0 0.3em; }
        .letter-body ul, .letter-body ol { margin: 0.3em 0 0.7em 1.4em; }
        .letter-body li { margin-bottom: 0.2em; }
      `}</style>
      {isHtml
        ? <div className="letter-body" style={{ lineHeight: 1.8, fontSize: 11 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />
        // Ein Block pro Absatz (statt eines langen), damit der Seitenumbruch zwischen Absätzen setzen kann
        : <div style={{ lineHeight: 1.8, fontSize: 11 }}>
            {body.split(/\n[ \t]*\n/).map((para, i) => <div key={i} style={{ whiteSpace: "pre-line", marginTop: i ? "1.8em" : 0 }}>{para}</div>)}
          </div>
      }

      <div style={{ marginTop: 60, fontSize: 11 }}>{settings.name}</div>
    </>
  );
}
