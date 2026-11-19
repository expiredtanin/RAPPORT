// Terminplanung (Büroübersicht): Terminprogramme aller Projekte auf einem Zeitstrahl und die Auslastung
// der Mitarbeitenden (zugewiesene Aufgaben, Ferien und Absenzen).
//
// Nur Anzeige, bearbeitet wird im Projekt (views/schedule/ScheduleEditor). Klick auf eine Zeile öffnet
// das Projekt. Die Projektzeilen sind Sammelbalken je Gruppe (SIA-Phase bzw. BKP-Gruppe) plus die
// Meilensteine. Sichtbar mit der Berechtigung «termine» oder «projects» (NAV_ITEMS `alsoWith`).

import { useMemo, useState } from "react";
import { TRACK_LABELS, addDays, blockedDays, groupSpans, holidayDates, overlapDays, scheduleOf, trackItems } from "../schedule";
import { getAbsenzTypes, localISODate } from "../utils";
import { EmptyState, Header } from "../components/UI";
import { GanttChart } from "./schedule/GanttChart";
import { ZOOM_LEVELS } from "./schedule/zoom";
import type { ScheduleItem, ScheduleTrack, ViewProps } from "../types";

type Mode = "projekte" | "mitarbeitende";

export default function Schedules({ data, setView, onSelectProject }: Pick<ViewProps, "data" | "setView"> & {
  onSelectProject: (projectId: string) => void;
}) {
  const today = localISODate();
  const [mode, setMode] = useState<Mode>("projekte");
  const [tracks, setTracks] = useState<ScheduleTrack[]>(["planung", "bau"]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [zoom, setZoom] = useState("alles");
  const dayWidth = ZOOM_LEVELS.find(z => z.id === zoom)!.dayWidth;
  const projects = (data.projects || []).filter(p => !onlyActive || p.status !== "abgeschlossen");

  // Zeile-Id → Projekt (für den Klick)
  const projectOf = new Map<string, string>();

  const projectItems = useMemo(() => {
    const out: ScheduleItem[] = [];
    for (const p of projects) {
      const s = scheduleOf(p);
      const group = `${p.number ? p.number + " " : ""}${p.name}`;
      for (const track of tracks) {
        const list = trackItems(s, track);
        // Sammelbalken je Gruppe nur über Aufgaben (Meilensteine erscheinen einzeln); bei beiden Programmen mit Kennzeichen
        const prefix = tracks.length > 1 ? (track === "planung" ? "Planung · " : "Bau · ") : "";
        for (const g of groupSpans(list.filter(it => it.kind === "task"))) {
          out.push({ id: `${p.id}|${track}|${g.group}`, label: prefix + (g.group || TRACK_LABELS[track]), kind: "task", track, group, start: g.start, end: g.end });
        }
        for (const m of list.filter(it => it.kind === "milestone")) {
          out.push({ ...m, id: `${p.id}|${m.id}`, group, deps: [] });
        }
      }
    }
    // innerhalb eines Projekts nach Beginn
    return out.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.start.localeCompare(b.start));
  }, [projects, tracks]);

  const absenzTypes = getAbsenzTypes(data);
  const people = useMemo(() => {
    const employees = (data.employees || []).filter(e => e.active !== false);
    return employees.map(emp => {
      const tasks: ScheduleItem[] = [];
      for (const p of data.projects || []) {
        if (onlyActive && p.status === "abgeschlossen") continue;
        for (const it of scheduleOf(p).items) {
          if (it.assigneeId !== emp.id || !tracks.includes(it.track)) continue;
          tasks.push({ ...it, id: `${p.id}|${it.id}`, label: `${p.number || p.name}: ${it.bkp ? `${it.bkp} ` : ""}${it.label}`, bkp: undefined, group: emp.name, deps: [] });
        }
      }
      const off: ScheduleItem[] = [];
      for (const f of data.ferienEntries || []) {
        if (f.employeeId !== emp.id || f.status === "rejected" || !f.dateFrom) continue;
        off.push({ id: `ferien|${f.id}`, label: "Ferien", kind: "task", track: "planung", group: emp.name, start: f.dateFrom, end: f.dateTo || f.dateFrom });
      }
      for (const a of data.absences || []) {
        if (a.employeeId !== emp.id || a.status === "rejected") continue;
        const start = a.dateFrom || a.date, end = a.dateTo || a.date;
        if (!start || !end || end < addDays(today, -60)) continue;
        off.push({ id: `abs|${a.id}`, label: absenzTypes.find(t => t.id === a.type)?.label || a.type || "Absenz", kind: "task", track: "planung", group: emp.name, start, end });
      }
      const ranges = tasks.filter(t => t.kind === "task");
      return { emp, tasks, off, overlap: overlapDays(ranges), blocked: blockedDays(ranges, off) };
    });
  }, [data, onlyActive, tracks, today, absenzTypes]);

  const personItems = people.flatMap(p => [...p.tasks, ...p.off].sort((a, b) => a.start.localeCompare(b.start)));
  for (const it of [...projectItems, ...personItems]) {
    const pid = it.id.split("|")[0];
    if (pid !== "ferien" && pid !== "abs") projectOf.set(it.id, pid);
  }
  const items = mode === "projekte" ? projectItems : personItems;
  const without = projects.filter(p => !scheduleOf(p).items.some(it => tracks.includes(it.track)));
  const holidays = holidayDates(data.feiertage, addDays(today, -400), addDays(today, 1100));
  // Zeitraum: einen Monat zurück bis mindestens ein halbes Jahr voraus (oder bis zum letzten Termin)
  const lastEnd = items.reduce((m, it) => (it.end > m ? it.end : m), addDays(today, 180));
  const to = addDays(lastEnd, 14);

  const open = (id: string) => {
    const pid = projectOf.get(id);
    if (!pid) return;
    onSelectProject(pid);
    setView("projects");
  };
  const openProject = (pid: string) => { onSelectProject(pid); setView("projects"); };
  const toggleTrack = (t: ScheduleTrack) => setTracks(prev => prev.includes(t) ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t]);

  return (
    <div>
      <Header title="Terminplanung" />
      <div className="filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
        {(["projekte", "mitarbeitende"] as Mode[]).map(m => (
          <button key={m} className="pill" onClick={() => setMode(m)} style={mode === m ? { background: "var(--text)", color: "var(--surface)" } : {}}>
            {m === "projekte" ? "Projekte" : "Mitarbeitende"}
          </button>
        ))}
        <span style={{ width: 12 }} />
        {(["planung", "bau"] as ScheduleTrack[]).map(t => (
          <label key={t} style={{ fontSize: 12, color: "var(--text3)", display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={tracks.includes(t)} onChange={() => toggleTrack(t)} style={{ width: "auto" }} /> {t === "planung" ? "Planung" : "Bau"}
          </label>
        ))}
        <label style={{ fontSize: 12, color: "var(--text3)", display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} style={{ width: "auto" }} /> nur laufende Projekte
        </label>
        <div style={{ flex: 1 }} />
        {ZOOM_LEVELS.map(z => (
          <button key={z.id} className="pill" onClick={() => setZoom(z.id)} style={zoom === z.id ? { background: "var(--surface3)", fontWeight: 600 } : {}}>{z.label}</button>
        ))}
      </div>

      {mode === "mitarbeitende" && people.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr><th>Person</th><th style={{ textAlign: "right" }}>Aufgaben</th><th style={{ textAlign: "right" }}>davon laufend</th><th style={{ textAlign: "right" }}>Tage mit Überschneidung</th><th style={{ textAlign: "right" }}>Tage während Abwesenheit</th></tr>
            </thead>
            <tbody>
              {people.map(p => (
                <tr key={p.emp.id}>
                  <td>{p.emp.name}</td>
                  <td style={{ textAlign: "right" }}>{p.tasks.length}</td>
                  <td style={{ textAlign: "right" }}>{p.tasks.filter(t => t.start <= today && t.end >= today).length}</td>
                  <td style={{ textAlign: "right", color: p.overlap ? "var(--warning)" : "var(--text4)" }}>{p.overlap}</td>
                  <td style={{ textAlign: "right", color: p.blocked ? "var(--negative)" : "var(--text4)" }}>{p.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text4)" }}>
            Grundlage: Aufgaben mit «Verantwortlich» in den Terminprogrammen, Ferien und Absenzen. Überschneidung = mehrere Aufgaben am selben Tag (Hinweis, keine Stundenplanung).
          </div>
        </div>
      )}

      {items.length === 0 ? (
        mode === "projekte"
          ? <EmptyState
              icon="view_timeline"
              title="Noch keine Terminprogramme"
              text="Im Projekt unter «Terminprogramm» aus den SIA-Phasen oder der BKP-Vorlage erstellen."
              action={without.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  {without.map(p => (
                    <button key={p.id} className="btn btn-ghost" onClick={() => openProject(p.id)}>{p.name} — Terminprogramm anlegen</button>
                  ))}
                </div>
              )}
            />
          : <EmptyState icon="view_timeline" title="Noch keine zugewiesenen Aufgaben" text="Im Terminprogramm eines Projekts eine Aufgabe öffnen und «Verantwortlich» wählen." />
      ) : (
        <GanttChart
          items={items} dayWidth={dayWidth} fit={zoom === "alles"} today={today} holidays={holidays} labelWidth={320}
          labelTitle={mode === "projekte" ? "Projekt / Phase" : "Person / Aufgabe"}
          describe={it => (projectOf.has(it.id) ? "Klick öffnet das Projekt" : undefined)}
          from={addDays(today, -30)} to={to}
          onSelect={open}
          barColor={it => (it.id.startsWith("ferien|") || it.id.startsWith("abs|") ? "var(--info)" : undefined)}
        />
      )}
      {mode === "projekte" && items.length > 0 && without.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 10 }}>
          Ohne Terminprogramm: {without.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <button onClick={() => openProject(p.id)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--text3)", textDecoration: "underline", cursor: "pointer" }}>{p.name}</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
