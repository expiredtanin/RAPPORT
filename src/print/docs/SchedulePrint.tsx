// Druckvorlage Terminprogramm (`schedule`): Planungsterminprogramm oder Bauprogramm eines Projekts auf
// einem Blatt — Kopf mit Absender und Projekt, Zeitstrahl über die ganze Breite, darunter Termine und Legende.
// Blattgrösse, Massstab und Zeitraum kommen aus `layout` (scheduleLayout.ts, gewählt in PrintView).

import { GanttChart, ScheduleLegend } from "../../views/schedule/GanttChart";
import { TRACK_LABELS, glyphOf, isDone, seriesSessions } from "../../schedule";
import { formatSenderAddress, localISODate } from "../../utils";
import { StudioLogo } from "../../components/UI";
import type { AppData, Project, ScheduleBaseline, ScheduleBreak, ScheduleItem, ScheduleTrack, Settings } from "../../types";
import { HEADING, type Content } from "./shared";
import { PRINT_LABEL_WIDTH, SCHEDULE_SCALES, type SchedulePrintLayout } from "./scheduleLayout";

const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function SchedulePrint({ content, settings, layout }: { content: Content; settings: Settings; layout: SchedulePrintLayout }) {
  const { project, track, baseline, critical, holidays, breaks = [], data } = content as unknown as {
    project: Project; track: ScheduleTrack; items: ScheduleItem[]; baseline?: ScheduleBaseline;
    critical: string[]; holidays: string[]; breaks?: ScheduleBreak[]; data: AppData;
  };
  const { items, from, to, dayWidth, rowHeight } = layout;
  const scale = layout.pageH === null ? SCHEDULE_SCALES.find(s => Math.abs(s.mmPerDay - dayWidth * 25.4 / 96) < 0.01)?.label : undefined;
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
        <div style={{ fontSize: 11, color: "#666", marginLeft: "auto", textAlign: "right" }} className="align-right">
          {layout.cropped ? "Ausschnitt " : ""}{fmt(from)} – {fmt(to)}{scale ? ` · Massstab ${scale}` : ""}
        </div>
      </div>
      <GanttChart
        items={items} dayWidth={dayWidth} labelWidth={PRINT_LABEL_WIDTH} from={from} to={to}
        today={localISODate()} holidays={holidays} critical={critical.length ? new Set(critical) : undefined}
        baseline={baseline} breaks={breaks} collapsible={false}
        rowHeight={rowHeight}
        isDone={it => isDone(it, data.protocols || [], project.id)}
        sessions={it => seriesSessions(it, data.protocols || [], project.id, localISODate())}
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
            <div style={{ letterSpacing: "0.12em", marginBottom: 4 }}>TERMINE</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", columnGap: 10 }}>
              {milestones.map(m => <span key={m.id} style={{ display: "contents" }}><span>{glyphOf(m)}</span><span>{fmt(m.start)}</span><span>{m.label}</span></span>)}
            </div>
          </div>
        )}
        <div style={{ marginLeft: "auto", lineHeight: 1.7, maxWidth: "60%" }}>
          <div style={{ letterSpacing: "0.12em", marginBottom: 4 }}>LEGENDE</div>
          <ScheduleLegend items={items} breaks={breaks.length} critical={critical.length > 0} baseline={!!baseline} compact />
          <div style={{ marginTop: 4 }}>Pfeile = «beginnt nach» · KW nach ISO 8601 · Feiertage hinterlegt</div>
        </div>
      </div>
    </>
  );
}
