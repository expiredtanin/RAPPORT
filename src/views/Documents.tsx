// Übersicht «Dokumente»: Kacheln mit Anzahl Protokolle / Lieferscheine / Briefvorlagen
// (Klick öffnet die jeweilige Ansicht), die zuletzt erfassten Protokolle und
// Lieferscheine, Protokolle nach Typ und die Briefvorlagen. Reine Anzeige, ändert keine Daten.

import { PROTOKOLL_TYPES } from "../constants";
import { formatDate } from "../utils";
import { Header } from "../components/UI";
import type { DeliveryNote, ViewProps } from "../types";
import type { ReactNode } from "react";

/** Abschnitt der Übersicht: Titel mit Anzahl, Aktions-Button rechts, Inhalt darunter. */
function SectionCard({ title, count, action, onAction, children, accent }: {
  title: string; count: number; action: string; onAction: () => void; children?: ReactNode; accent?: string;
}) {
  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>{title}</span>
          {count > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, background: accent || "#ece8e2", color: "var(--text)", padding: "2px 7px", borderRadius: 20 }}>{count}</span>
          )}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={onAction}>
          {action}
        </button>
      </div>
      {children}
    </div>
  );
}

export default function Documents({ data, setView }: Pick<ViewProps, "data" | "setView">) {
  const protocols = [...(data.protocols || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const deliveryNotes = [...(data.deliveryNotes || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const letterTemplates = data.letterTemplates || [];

  const recentProtos = protocols.slice(0, 6);
  const recentNotes = deliveryNotes.slice(0, 5);

  const protoByType = PROTOKOLL_TYPES.map(t => ({
    type: t,
    count: protocols.filter(p => p.type === t).length,
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const maxTypeCount = protoByType[0]?.count || 1;

  const getClient = (n: DeliveryNote) => {
    if (n.clientId) return (data.persons||[]).find(c => c.id === n.clientId)?.name || "—";
    if (n.projectId) {
      const proj = data.projects?.find(p => p.id === n.projectId);
      if (proj?.clientId) return (data.persons||[]).find(c => c.id === proj.clientId)?.name || "—";
    }
    return "—";
  };

  const getProject = (n: Pick<DeliveryNote, "projectId">) => {
    if (!n.projectId) return null;
    return data.projects?.find(p => p.id === n.projectId)?.name || null;
  };


  return (
    <div>
      <Header title="Dokumente" />

      {/* KPI-Zeile */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Protokolle", count: protocols.length, sub: `${recentProtos.length > 0 ? formatDate(recentProtos[0]?.date) : "—"} zuletzt`, view: "protokolle", color: "var(--positive)", bg: "var(--positive-bg)" },
          { label: "Lieferscheine", count: deliveryNotes.length, sub: `${recentNotes.length > 0 ? formatDate(recentNotes[0]?.date) : "—"} zuletzt`, view: "lieferscheine", color: "var(--info)", bg: "var(--info-bg)" },
          { label: "Briefvorlagen", count: letterTemplates.length, sub: "Vorlagen", view: "letters", color: "#7a3e8a", bg: "#f3eafa" },
        ].map(({ label, count, sub, view: v, color, bg }) => (
          <div key={label} className="card" style={{ cursor: "pointer", transition: "box-shadow 0.15s" }}
            onClick={() => setView(v)}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 8 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize: 36, fontFamily: "'Inter', sans-serif", fontWeight: 700, color, lineHeight: 1, marginBottom: 4 }}>{count}</div>
            <div style={{ fontSize: 11, color: "var(--text5)" }}>{sub}</div>
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color, background: bg, padding: "3px 10px", borderRadius: 20 }}>→ Öffnen</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20, alignItems: "start" }}>

        {/* Linke Spalte */}
        <div>
          {/* Letzte Protokolle */}
          <SectionCard title="LETZTE PROTOKOLLE" count={protocols.length} action="Alle Protokolle →" onAction={() => setView("protokolle")} accent="#e8f5ee">
            {recentProtos.length === 0 ? (
              <div className="empty-state">Noch keine Protokolle erfasst.</div>
            ) : (
              <table style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: "11%" }}>Datum</th>
                    <th style={{ width: "18%" }}>Typ</th>
                    <th>Titel</th>
                    <th>Projekt</th>
                    <th style={{ width: "12%" }}>Einträge</th>
                  </tr>
                </thead>
                <tbody>
                  {recentProtos.map(p => {
                    const proj = getProject(p);
                    return (
                      <tr key={p.id}>
                        <td style={{ fontSize: 11, color: "var(--text4)" }}>{formatDate(p.date)}</td>
                        <td>
                          <span style={{ fontSize: 10, background: "var(--surface2)", color: "var(--text2)", padding: "2px 10px", borderRadius: 20 }}>{p.type || "—"}</span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{p.title || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                        <td style={{ fontSize: 11, color: "var(--text4)" }}>{proj || <span style={{ color: "#ddd" }}>—</span>}</td>
                        <td style={{ fontSize: 11, color: "var(--text4)", textAlign: "center" }}>{(p.traktanden || []).length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SectionCard>

          {/* Letzte Lieferscheine */}
          <SectionCard title="LETZTE LIEFERSCHEINE" count={deliveryNotes.length} action="Alle Lieferscheine →" onAction={() => setView("lieferscheine")} accent="#e8f0fa">
            {recentNotes.length === 0 ? (
              <div className="empty-state">Noch keine Lieferscheine erfasst.</div>
            ) : (
              <table style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: "14%" }}>Nr.</th>
                    <th style={{ width: "11%" }}>Datum</th>
                    <th>Kunde</th>
                    <th>Projekt</th>
                    <th style={{ width: "12%" }}>Positionen</th>
                  </tr>
                </thead>
                <tbody>
                  {recentNotes.map(n => (
                    <tr key={n.id}>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{n.number || "—"}</td>
                      <td style={{ fontSize: 11, color: "var(--text4)" }}>{formatDate(n.date)}</td>
                      <td style={{ fontSize: 12 }}>{getClient(n)}</td>
                      <td style={{ fontSize: 11, color: "var(--text4)" }}>{getProject(n) || <span style={{ color: "#ddd" }}>—</span>}</td>
                      <td style={{ fontSize: 11, color: "var(--text4)", textAlign: "center" }}>{(n.items || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        </div>

        {/* Rechte Spalte */}
        <div>
          {/* Protokoll-Typen */}
          {protoByType.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-label">PROTOKOLLE NACH TYP</div>
              {protoByType.map(({ type, count }) => {
                const pct = (count / maxTypeCount) * 100;
                return (
                  <div key={type} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: "var(--text3)" }}>{type}</span>
                      <span style={{ fontWeight: 600 }}>{count}</span>
                    </div>
                    <div style={{ height: 5, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "var(--positive)", borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Briefvorlagen */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: letterTemplates.length > 0 ? "1px solid var(--border2)" : "none" }}>
              <span className="section-label" style={{ marginBottom: 0 }}>BRIEFVORLAGEN</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => setView("letters")}>
                Verwalten →
              </button>
            </div>
            {letterTemplates.length === 0 ? (
              <div className="empty-state">Noch keine Briefvorlagen erstellt.</div>
            ) : (
              <div style={{ padding: "8px 0" }}>
                {letterTemplates.map(t => (
                  <div key={t.id} style={{ padding: "8px 20px", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text3)", flex: 1 }}>{t.name || "Unbenannt"}</span>
                    <span style={{ fontSize: 10, color: "var(--text5)" }}>
                      {t.body ? `${t.body.replace(/<[^>]+>/g, "").slice(0, 40)}…` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
