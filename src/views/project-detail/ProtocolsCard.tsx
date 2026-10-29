// Karte «Protokolle» der Projekt-Detailansicht: Protokolle des Projekts, neues Protokoll anlegen und öffnen.

import { PROTOKOLL_TYPES } from "../../constants";
import { generateId, formatDate, nextProtoSeq, applyProtoNumberFormat, localISODate } from "../../utils";
import { type ViewProps } from "../../types";

/** Protokollliste des Projekts mit «+ Neues Protokoll» (legt an und springt per Event in die Protokoll-Ansicht). */
export function ProtocolsCard({ data, saveAll, projectId }: {
  data: ViewProps["data"];
  saveAll: ViewProps["saveAll"];
  projectId: string;
}) {
  const projProtokolle = (data.protocols || [])
    .filter(p => p.projectId === projectId)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return (
    <div className="card" style={{ padding: 0, marginTop: 20 }}>
      <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: projProtokolle.length > 0 ? "1px solid var(--border2)" : "none" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>PROTOKOLLE ({projProtokolle.length})</div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => {
          const p = {
            id: generateId(),
            title: "",
            type: PROTOKOLL_TYPES[0],
            date: localISODate(),
            time: "10:00",
            endTime: "",
            location: "",
            projectId,
            projectManual: "",
            nummer: (() => {
              const all = data.protocols || [];
              const abbr = data.settings.protokollTypeAbbreviations || {};
              const typKuerzel = abbr[PROTOKOLL_TYPES[0]] || "SO";
              const proj = data.projects.find(x => x.id === projectId);
              const seq = nextProtoSeq(all);
              return applyProtoNumberFormat(data.settings.protokollNumberFormat || "PP-TT-NN", {
                date: localISODate(),
                projectNumber: proj?.number || "",
                seq,
                typKuerzel,
              });
            })(),
            participants: [],
            traktanden: [{ id: generateId(), nr: "1", title: "", items: [] }],
            nextDate: "",
            verteiler: "",
            createdAt: new Date().toISOString(),
          };
          saveAll({ ...data, protocols: [...(data.protocols || []), p] });
          // navigate to protokolle view – signal via a custom event
          window.__openProtokoll = p.id;
          window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: p.id } }));
        }}>+ Neues Protokoll</button>
      </div>
      {projProtokolle.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Nr.</th>
              <th style={{ width: 100 }}>Datum</th>
              <th style={{ width: 160 }}>Typ</th>
              <th>Titel</th>
              <th style={{ width: 60, textAlign: "center" }}>TN</th>
              <th style={{ width: 50, textAlign: "center" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle" }}>push_pin</span></th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {projProtokolle.map(proto => {
              const anwesend = (proto.participants || []).filter(x => x.status === "anwesend").length;
              const total = (proto.participants || []).length;
              const offene = (proto.traktanden || []).flatMap(t => (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt")).length;
              return (
                <tr key={proto.id}>
                  <td><strong style={{ color: "#b07848" }}>{proto.nummer}</strong></td>
                  <td>{formatDate(proto.date)}</td>
                  <td style={{ fontSize: 11, color: "var(--text4)" }}>{proto.type}</td>
                  <td>{proto.title || <span style={{ color: "var(--text5)" }}>Kein Titel</span>}</td>
                  <td style={{ textAlign: "center", fontSize: 12, color: "var(--text4)" }}>{total > 0 ? `${anwesend}/${total}` : "—"}</td>
                  <td style={{ textAlign: "center" }}>{offene > 0 && <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>{offene}</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => { window.__openProtokoll = proto.id; window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: proto.id } })); }}>
                      Öffnen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
