// Druckvorlage Protokoll (`protokoll`): Kopf, Teilnehmende, Traktanden als Positionentabelle, Genehmigung.

import React from "react";
import { formatDate, formatSenderAddress, sanitizeHtml, participantKuerzel, responsibleLabel, protocolApproval, approvalDeadlineText } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Protocol, ProtocolEntry, Settings } from "../../types";

export function ProtokollPrint({ protokoll, data, settings }: { protokoll: Protocol; data: AppData; settings: Settings }) {
  const p = protokoll;
  const proj = data?.projects?.find(x => x.id === p.projectId);
  const projLabel = proj?.name || p.projectManual || null;
  const today = new Date().toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" });

  // Nüchternes Sitzungsprotokoll: eine Schrift, schwarz auf weiss, nummerierte Positionen (1.1, 1.2 …)
  // in einer Tabelle Pos | Art | Text | Wer | Termin. Die Art steht als Buchstabe am Rand (I, B, A),
  // Emoji und Farben gibt es bewusst nicht — das Dokument soll wie ein Protokoll aussehen, nicht wie eine Oberfläche.
  const mark: Record<string, string> = { info: "I", beschluss: "B", aufgabe: "A" };
  const presence: Record<string, string> = { anwesend: "anwesend", entschuldigt: "entschuldigt", abwesend: "abwesend", eingeladen: "eingeladen" };
  const dueOf = (it: ProtocolEntry) =>
    it.dueDateType === "kw" ? (it.dueKW ? `KW ${it.dueKW}/${it.dueYear || ""}` : "") : it.dueDate ? formatDate(it.dueDate) : "";
  const ink = "var(--doc-ink)", soft = "#666", rule = "var(--doc-accent)", hair = "#d8d8d4";
  const th: React.CSSProperties = { textAlign: "left", fontSize: 9.5, fontWeight: 600, color: soft, padding: "0 10px 5px 0", borderBottom: `1px solid ${rule}` };
  const meta = [
    ["Projekt", projLabel || "—"],
    ["Datum", p.date ? `${formatDate(p.date)}${p.time ? `, ${p.time}${p.endTime ? `–${p.endTime}` : ""} Uhr` : ""}` : "—"],
    ["Ort", p.location || "—"],
    ["Nächste Sitzung", p.nextDate ? formatDate(p.nextDate) : "—"],
  ];

  return (
    <div style={{ fontFamily: "var(--doc-font-plain)", color: ink, fontSize: 11.5, lineHeight: 1.5 }}>
      {/* Kopf */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 30 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={20} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 10, color: soft }}>{formatSenderAddress(settings)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: soft }}>Protokoll Nr.</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{p.nummer || "—"}</div>
        </div>
      </div>

      {/* Titel und Eckdaten */}
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{p.title || "Protokoll"}</div>
      {p.type && <div style={{ fontSize: 11, color: soft, marginBottom: 12 }}>{p.type}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px 1fr", columnGap: 12, rowGap: 3, fontSize: 11, padding: "10px 0", borderTop: `1px solid ${rule}`, borderBottom: `1px solid ${rule}`, marginBottom: 20 }}>
        {meta.map(([k, v]) => (
          <React.Fragment key={k}>
            <div style={{ color: soft }}>{k}</div>
            <div style={{ fontWeight: 500 }}>{v}</div>
          </React.Fragment>
        ))}
      </div>

      {/* Teilnehmer */}
      {(p.participants || []).length > 0 && (
        <div style={{ marginBottom: 22, breakInside: "avoid" }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Teilnehmer</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...th, width: 46 }}>Kürzel</th><th style={th}>Name</th><th style={th}>Funktion</th><th style={{ ...th, width: 110 }}>Anwesenheit</th>
            </tr></thead>
            <tbody>
              {(p.participants || []).map((tn, i) => (
                <tr key={i} style={{ breakInside: "avoid" }}>
                  <td style={{ padding: "4px 10px 4px 0", borderBottom: `1px solid ${hair}`, fontWeight: 600 }}>{participantKuerzel(tn)}</td>
                  <td style={{ padding: "4px 10px 4px 0", borderBottom: `1px solid ${hair}` }}>{tn.name}</td>
                  <td style={{ padding: "4px 10px 4px 0", borderBottom: `1px solid ${hair}`, color: soft }}>{tn.role || ""}</td>
                  <td style={{ padding: "4px 0", borderBottom: `1px solid ${hair}` }}>{presence[tn.status as string] || tn.status || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Positionen */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 6 }}>
        <thead><tr>
          <th style={{ ...th, width: 36 }}>Pos.</th>
          <th style={{ ...th, width: 22 }}>Art</th>
          <th style={th}>Text</th>
          <th style={{ ...th, width: 110 }}>Wer</th>
          <th style={{ ...th, width: 84, paddingRight: 0 }}>Termin</th>
        </tr></thead>
        <tbody>
          {(p.traktanden || []).map(t => {
            if (!(t.title || (t.items || []).length > 0)) return null;
            return (
              <React.Fragment key={t.id}>
                <tr style={{ breakAfter: "avoid" }}>
                  <td colSpan={5} style={{ padding: "14px 0 4px", fontWeight: 600, fontSize: 12, borderBottom: `1px solid ${hair}` }}>
                    <span style={{ display: "inline-block", width: 36 }}>{t.nr}</span>{t.title || "—"}
                  </td>
                </tr>
                {(t.items || []).map((it, ii) => {
                  const isTask = it.type === "aufgabe";
                  const due = isTask ? dueOf(it) : "";
                  const state = isTask && it.status && it.status !== "offen" ? it.status : "";
                  return (
                    <tr key={it.id || ii} style={{ breakInside: "avoid", verticalAlign: "top" }}>
                      <td style={{ padding: "5px 6px 5px 0", color: soft, borderBottom: `1px solid ${hair}` }}>{t.nr}.{ii + 1}</td>
                      <td style={{ padding: "5px 6px 5px 0", fontWeight: 700, borderBottom: `1px solid ${hair}` }}>{mark[it.type as string] || ""}</td>
                      <td style={{ padding: "5px 10px 5px 0", borderBottom: `1px solid ${hair}` }}>
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(it.text) || "—" }} />
                        {it.type === "beschluss" && it.date && <div style={{ fontSize: 10, color: soft }}>Beschluss vom {formatDate(it.date)}</div>}
                      </td>
                      <td style={{ padding: "5px 10px 5px 0", borderBottom: `1px solid ${hair}` }}>{isTask ? responsibleLabel(it.responsible, p.participants || []) : ""}</td>
                      <td style={{ padding: "5px 0", borderBottom: `1px solid ${hair}`, whiteSpace: "nowrap" }}>
                        {due}
                        {state && <div style={{ fontSize: 10, color: soft, whiteSpace: "normal" }}>{state}</div>}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 9.5, color: soft, marginBottom: 22 }}>Art: I = Information · B = Beschluss · A = Aufgabe</div>

      {p.verteiler && (
        <div style={{ fontSize: 11, marginBottom: 26, breakInside: "avoid" }}>
          <span style={{ color: soft }}>Verteiler: </span>{p.verteiler}
        </div>
      )}

      {/* Genehmigung: Unterschriftenfelder, stillschweigend nach Frist oder kein Vermerk (Protokoll vor Büro-Vorgabe) */}
      {(() => {
        const { mode, hours } = protocolApproval(p, settings);
        if (mode === "keine") return null;
        if (mode === "stillschweigend") return (
          <div style={{ marginTop: 24, fontSize: 11, lineHeight: 1.5, breakInside: "avoid" }}>
            Einwände und Ergänzungen zu diesem Protokoll sind innert {approvalDeadlineText(hours)} nach Versand an {settings.name || "die Protokollführung"} zu richten.
            Ohne Rückmeldung gilt das Protokoll als genehmigt.
          </div>
        );
        return (
          <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, breakInside: "avoid" }}>
            <div>
              <div style={{ height: 30 }} />
              <div style={{ borderTop: `1px solid ${rule}`, paddingTop: 5, fontSize: 10, color: soft }}>Protokollführung, Datum</div>
            </div>
            <div>
              <div style={{ height: 30 }} />
              <div style={{ borderTop: `1px solid ${rule}`, paddingTop: 5, fontSize: 10, color: soft }}>Genehmigt, Datum</div>
            </div>
          </div>
        );
      })()}

      {/* Fuss */}
      <div style={{ marginTop: 30, paddingTop: 8, borderTop: `1px solid ${hair}`, fontSize: 9.5, color: soft, display: "flex", justifyContent: "space-between", gap: 20 }}>
        <div>{settings.name}{p.nummer ? ` · Protokoll ${p.nummer}` : ""}</div>
        <div>Erstellt am {today}</div>
      </div>
    </div>
  );
}
