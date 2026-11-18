// Druckvorlage Terminprogramm (`schedule`): Planungsterminprogramm oder Bauprogramm eines Projekts
// auf A3 quer — Kopf mit Absender und Projekt, Zeitstrahl über die ganze Breite, darunter die Meilensteine.

import { GanttChart } from "../../views/schedule/GanttChart";
import { TRACK_LABELS, addDays, dayNum, scheduleRange } from "../../schedule";
import { formatSenderAddress, localISODate } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Project, ScheduleBaseline, ScheduleItem, ScheduleTrack, Settings } from "../../types";
import { HEADING, type Content } from "./shared";

/** Nutzbare Breite in px bei 420 mm Blatt und 20 mm Rand je Seite (96 dpi). */
const PRINT_WIDTH_PX = (420 - 40) * 3.78;
const LABEL_WIDTH = 270;

const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function SchedulePrint({ content, settings }: { content: Content; settings: Settings }) {
  const { project, track, items, baseline, critical, holidays, data } = content as unknown as {
    project: Project; track: ScheduleTrack; items: ScheduleItem[]; baseline?: ScheduleBaseline;
    critical: string[]; holidays: string[]; data: AppData;
  };
  const range = scheduleRange(items);
  // Ganzer Zeitraum auf die Blattbreite (Montag davor bis eine Woche danach)
  const from = range ? range.start : localISODate();
  const days = range ? dayNum(range.end) - dayNum(range.start) + 15 : 60;
  const dayWidth = (PRINT_WIDTH_PX - LABEL_WIDTH - 2) / days;
  const client = (data.persons || []).find(p => p.id === project.clientId);
  const employees = data.employees || [];
  const milestones = items.filter(it => it.kind === "milestone").sort((a, b) => a.start.localeCompare(b.start));
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={20} />
          <div style={{ whiteSpace: "pre-line", marginTop: 4, fontSize: 9, color: "#666" }}>{formatSenderAddress(settings)}</div>
        </div>
        <div className="align-right" style={{ textAlign: "right", fontSize: 10, color: "#666" }}>
          <div style={{ letterSpacing: "0.15em" }}>{TRACK_LABELS[track].toUpperCase()}</div>
          <div style={{ marginTop: 4 }}>Stand {fmt(localISODate())}</div>
          {baseline && <div>Vergleich mit Stand vom {fmt(baseline.savedAt)}</div>}
        </div>
      </div>
      <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "2px solid var(--doc-accent)", display: "flex", alignItems: "baseline", gap: 18 }}>
        <div className="doc-heading" style={{ ...HEADING, fontSize: 22, fontWeight: 400 }}>{project.number ? `${project.number} ` : ""}{project.name}</div>
        {client && <div style={{ fontSize: 11, color: "#666" }}>{client.name}</div>}
        {range && <div style={{ fontSize: 11, color: "#666", marginLeft: "auto" }}>{fmt(range.start)} – {fmt(range.end)}</div>}
      </div>
      <GanttChart
        items={items} dayWidth={dayWidth} labelWidth={LABEL_WIDTH} from={from} to={addDays(from, days - 1)}
        today={localISODate()} holidays={holidays} critical={critical.length ? new Set(critical) : undefined}
        baseline={baseline} collapsible={false}
        renderMeta={it => {
          const emp = employees.find(e => e.id === it.assigneeId);
          const firm = (data.persons || []).find(p => p.id === it.contractorId);
          const who = [firm?.name, emp?.name].filter(Boolean).join(" · ");
          return who ? <span style={{ fontSize: 9, color: "#777", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span> : null;
        }}
      />
      <div style={{ display: "flex", gap: 30, marginTop: 14, fontSize: 9, color: "#666", alignItems: "flex-start" }}>
        {milestones.length > 0 && (
          <div>
            <div style={{ letterSpacing: "0.12em", marginBottom: 4 }}>MEILENSTEINE</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 14 }}>
              {milestones.map(m => <span key={m.id} style={{ display: "contents" }}><span>{fmt(m.start)}</span><span>{m.label}</span></span>)}
            </div>
          </div>
        )}
        <div style={{ marginLeft: "auto", lineHeight: 1.7 }}>
          <div>Rote Linie = heute{critical.length ? " · rot umrandet = kritischer Weg" : ""}{baseline ? " · grauer Strich = eingefrorener Stand" : ""}</div>
          <div>Pfeile = «beginnt nach» · KW nach ISO 8601 · Feiertage hinterlegt</div>
        </div>
      </div>
    </>
  );
}
