// Kontaktverlauf (CRM): Aktivitäten einer Person erfassen und anzeigen, optional mit
// Wiedervorlage. Wird in der Personen-Detailansicht (alle Aktivitäten der Person) und im
// Lead-Dialog der Pipeline (nur die des Leads, `leadId`) verwendet. Schreibt direkt nach
// `data.activities`; die Auswertung (Meetings, letzter Kontakt) liegt in crm.ts.

import { useState } from "react";
import { ACTIVITY_TYPES } from "../constants";
import { formatDate, generateId, localISODate } from "../utils";
import { DateInput } from "./UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Activity, ActivityType, AppData, UpdateFn } from "../types";

const today = () => localISODate();

/** @param leadId Wenn gesetzt: zeigt nur Aktivitäten dieses Leads und verknüpft neue damit. */
export default function ActivityLog({ data, update, personId, leadId }: { data: AppData; update: UpdateFn; personId: string; leadId?: string }) {
  const activities = data.activities || [];
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [type, setType] = useState<ActivityType>("anruf");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  const list = activities
    .filter(a => a.personId === personId && (!leadId || a.leadId === leadId))
    .sort((a, b) => b.date.localeCompare(a.date));

  const add = () => {
    if (!note.trim() && !followUpDate) return;
    const entry: Activity = { id: generateId(), personId, leadId, type, date: date || today(), note: note.trim(), followUpDate: followUpDate || undefined };
    update("activities", [...activities, entry]);
    setNote(""); setFollowUpDate(""); setDate(today());
  };
  const patch = (id: string, p: Partial<Activity>) => update("activities", activities.map(a => a.id === id ? { ...a, ...p } : a));
  const remove = async (id: string) => {
    if (!(await askConfirm("Eintrag aus dem Verlauf löschen?"))) return;
    update("activities", activities.filter(a => a.id !== id));
  };

  return (
    <div>
      {ConfirmModalEl}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div style={{ width: 150 }}>
          <label>Art</label>
          <select value={type} onChange={e => setType(e.target.value as ActivityType)}>
            {ACTIVITY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ width: 130 }}><label>Datum</label><DateInput value={date} onChange={e => setDate(e.target.value)} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label>Notiz</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Worum ging es?" onKeyDown={e => { if (e.key === "Enter") add(); }} /></div>
        <div style={{ width: 130 }}><label>Wiedervorlage</label><DateInput value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={add}>Erfassen</button>
      </div>
      {list.length === 0 && <div className="empty-state" style={{ padding: "16px !important" }}>Noch kein Kontakt erfasst.</div>}
      {list.map(a => {
        const t = ACTIVITY_TYPES.find(x => x.id === a.type);
        const lead = a.leadId ? (data.leads || []).find(l => l.id === a.leadId) : undefined;
        const overdue = !!a.followUpDate && !a.followUpDone && a.followUpDate < today();
        return (
          <div key={a.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border2)", alignItems: "flex-start" }}>
            <span className="msr" style={{ fontSize: 18, color: "var(--text4)", marginTop: 1 }}>{t?.icon || "edit_note"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text)" }}>
                <strong>{t?.label || a.type}</strong> · {formatDate(a.date)}
                {lead && !leadId && <span style={{ color: "var(--text4)" }}> · {lead.title}</span>}
              </div>
              {a.note && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, whiteSpace: "pre-wrap" }}>{a.note}</div>}
              {a.followUpDate && (
                <div style={{ fontSize: 11, marginTop: 4, color: a.followUpDone ? "var(--text5)" : overdue ? "var(--warning)" : "var(--text3)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{a.followUpDone ? "✓ Wiedervorlage erledigt" : `Wiedervorlage ${formatDate(a.followUpDate)}${overdue ? " (überfällig)" : ""}`}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => patch(a.id, { followUpDone: !a.followUpDone })}>{a.followUpDone ? "Wieder öffnen" : "Erledigt"}</button>
                </div>
              )}
            </div>
            <button onClick={() => remove(a.id)} title="Löschen" style={{ background: "none", border: "none", color: "var(--text5)", padding: 2, lineHeight: 1 }}>
              <span className="msr" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
