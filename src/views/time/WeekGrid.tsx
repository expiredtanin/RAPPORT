// Zeiterfassung, Wochenansicht: Tageskopf mit Ist/Soll-Balken und das 15-Minuten-Zeitgitter mit Einträgen,
// Absenzen, Jetzt-Linie und laufender Stoppuhr. Gestaltung in time.css (Klassen «zeit-*»): heute mit
// Akzentlinie und leichter Tönung, Wochenende/Feiertage ruhiger und schmaler (nur flex-grow; das Ziehen
// rechnet nur vertikal und ist von der Spaltenbreite unabhängig).

import React from "react";
import type { RefObject, MutableRefObject, CSSProperties } from "react";
import { SIA_PHASES } from "../../constants";
import { formatHours, localISODate } from "../../utils";
import type { RunningTimer } from "../../today";
import type { AppData, Employee, Feiertag, Project, TimeEntry } from "../../types";
import {
  SLOT_COUNT, SLOT_H, SLOT_START_H, slotToTime, getSollForDay, isApprovedVacationDay,
  type SlotPoint, type WeekForm, type ResizeState, type ContextMenuState,
} from "./timeUtils";
import { projectColor } from "./projectColor";

/** Props des Wochenrasters: Zustand der Auswahl/Vorschau und die Handler aus Time.tsx. */
interface WeekGridProps {
  data: AppData;
  weekDays: string[];
  weekFTs: Feiertag[];
  todayStr: string;
  currentDate: string;
  selectedEmp: Employee | null;
  selectedEmpId: string;
  weekSelectStart: SlotPoint | null;
  weekHover: SlotPoint | null;
  weekForm: WeekForm | null;
  /** Id des Eintrags/der Absenz, deren Bearbeitungsformular offen ist (Hervorhebung) */
  selectedEntryId?: string | null;
  resizing: ResizeState | null;
  resizingRef: MutableRefObject<ResizeState | null>;
  weekGridRef: RefObject<HTMLDivElement | null>;
  absenzTypes: { id: string; label: string; color?: string }[];
  /** Laufende Stoppuhr dieses Geräts (nur gezeigt, wenn sie der gewählten Person gehört und heute begann) */
  timer?: RunningTimer | null;
  /** Aktuelle Zeit für Jetzt-Linie und Stoppuhr-Block (Time.tsx aktualisiert sie regelmässig) */
  now: Date;
  setWeekHover: (p: SlotPoint | null) => void;
  setCurrentDate: (ds: string) => void;
  setViewMode: (mode: string) => void;
  setContextMenu: (m: ContextMenuState | null) => void;
  handleSlotClick: (dayStr: string, slotIdx: number) => void;
  isMonthClosed: (date?: string) => boolean;
  syncResizing: () => void;
}

/** «7.5» bzw. «8» (eine Dezimale, ohne «.0»). */
const h1 = (h: number) => { const r = Math.round(h * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };

/** Minuten seit Rasterbeginn → Pixel. */
const minsToY = (mins: number) => (mins - SLOT_START_H * 60) / 15 * SLOT_H;

/** Kurze Phasenangabe eines Eintrags («52», «A·52» oder Name der eigenen Phase) und die lange Fassung für den Tooltip. */
function phaseLabels(e: TimeEntry, proj: Project | undefined): { short: string; long: string } | null {
  if (!e.phaseId) return null;
  const cp = (proj?.customPhases || []).find(c => c.id === e.phaseId);
  if (cp) return { short: cp.label, long: cp.label };
  const sia = SIA_PHASES.find(p => p.id === e.phaseId);
  if (!sia) return { short: e.phaseId, long: e.phaseId };
  return e.positionId ? { short: `${e.positionId}·${e.phaseId}`, long: `${e.positionId} · ${sia.label}` } : { short: e.phaseId, long: sia.label };
}

/** Feiertag ohne Stundenabzug = freier Tag. */
const isFreeFT = (ft?: Feiertag) => !!ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);

/** Scrollbares Wochenraster (Tageskopf + Zeitgitter). */
export function WeekGrid({ data, weekDays, weekFTs, todayStr, currentDate, selectedEmp, selectedEmpId, weekSelectStart, weekHover, weekForm, selectedEntryId, resizing, resizingRef, weekGridRef, absenzTypes, timer, now, setWeekHover, setCurrentDate, setViewMode, setContextMenu, handleSlotClick, isMonthClosed, syncResizing }: WeekGridProps) {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isWeekend = (ds: string) => { const dow = new Date(`${ds}T00:00:00Z`).getUTCDay(); return dow === 0 || dow === 6; };

  return (
    <div ref={weekGridRef} className="zeit-scroll" onMouseLeave={() => setWeekHover(null)}>

      {/* Sticky Tageskopf */}
      <div className="zeit-head">
        <div className="zeit-gutter" />
        {weekDays.map(ds => {
          const d = new Date(ds);
          const isThisToday = ds === todayStr;
          const ft = weekFTs.find(f => f.date === ds);
          const isFeiertag = isFreeFT(ft);
          const we = isWeekend(ds);
          const noWork = we || isFeiertag;
          const isBeforeEintritt = !!(selectedEmp?.eintrittsdatum && ds < selectedEmp.eintrittsdatum);
          const wkTotal = data.timeEntries.filter(e => e.date === ds && (!selectedEmpId || e.employeeId === selectedEmpId)).reduce((s, e) => s + (e.minutes || 0), 0);
          const absMinutes = selectedEmpId ? (data.absences || []).filter(a => {
            const matchDate = a.date === ds || (a.dateFrom && a.dateTo && ds >= a.dateFrom && ds <= a.dateTo);
            return matchDate && a.employeeId === selectedEmpId && (!a.status || a.status === "approved");
          }).reduce((s, a) => {
            if (a.startTime && a.endTime) { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return s+(eh*60+em)-(sh*60+sm); }
            const ex=(a.hours||0)*60+(a.minutes||0); return s+(ex>0?ex:getSollForDay(data, selectedEmp, ds)*60);
          }, 0) : 0;
          const istH = (wkTotal + absMinutes) / 60;
          const sollH = selectedEmp ? getSollForDay(data, selectedEmp, ds) : 0;
          const isVacDay = selectedEmpId ? isApprovedVacationDay(data, selectedEmpId, ds) : false;
          const isPendingVacDay = !isVacDay && selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && !f.originalData && ds >= f.dateFrom && ds <= f.dateTo) : false;
          const daysAway = Math.ceil((new Date(ds).getTime() - new Date(todayStr).getTime()) / 86400000);
          // Nur ein vergangener Arbeitstag, der mehr als eine halbe Stunde unter Soll liegt, wird orange
          const under = !!selectedEmp && !noWork && !isBeforeEintritt && !isVacDay && sollH > 0 && ds < todayStr && sollH - istH > 0.5;

          let meta: React.ReactNode = null;
          if (isVacDay && wkTotal === 0) meta = <span className={`zeit-tag ${daysAway > 21 ? "planned" : "ferien"}`}>Ferien</span>;
          else if (isPendingVacDay && wkTotal === 0) meta = <span className="zeit-tag pending" title="Ferienantrag noch nicht bewilligt">Ferien beantragt</span>;
          else if (selectedEmp && sollH > 0 && !isBeforeEintritt) meta = (
            <>
              <span className="zeit-dh-ist num" title={`Ist ${h1(istH)} h von ${h1(sollH)} h Soll`}><b>{h1(istH)}</b> / {h1(sollH)} h</span>
              <span className="zeit-bar"><i style={{ width: `${Math.min(100, (istH / sollH) * 100)}%` }} /></span>
            </>
          );
          else if (istH > 0) meta = <span className="zeit-dh-ist num"><b>{h1(istH)}</b> h</span>;
          const ftTag = isFeiertag && ft ? <span className="zeit-tag" title={ft.label}>{ft.label || "Feiertag"}</span> : null;

          const cls = ["zeit-dh", we && "zeit-we", isThisToday && "is-today", ds === currentDate && "sel", noWork && "quiet", isBeforeEintritt && "off", under && "under"].filter(Boolean).join(" ");
          return (
            <div key={ds} className={cls} onClick={() => { setCurrentDate(ds); setViewMode("tag"); }} title="Tagesansicht öffnen">
              <div className="zeit-dh-top">
                <span className="zeit-dh-wd">{d.toLocaleDateString("de-CH", { weekday: "short" }).replace(".", "")}</span>
                <span className="zeit-dh-d num">{d.getDate()}.</span>
              </div>
              <div className="zeit-dh-meta">{ftTag}{meta}</div>
            </div>
          );
        })}
      </div>

      {/* Zeitgitter */}
      <div className="zeit-body">
        <div className="zeit-gutter zeit-hours" style={{ height: SLOT_COUNT * SLOT_H }}>
          {Array.from({ length: SLOT_COUNT / 4 - 1 }, (_, i) => {
            const hour = SLOT_START_H + i + 1;
            return <span key={hour} className={`zeit-hl${hour < 7 || hour > 19 ? " off" : ""}`} style={{ top: (i + 1) * 4 * SLOT_H }}>{slotToTime((i + 1) * 4)}</span>;
          })}
        </div>
        {weekDays.map(ds => {
          const colTimed = data.timeEntries.filter(e => e.date === ds && e.startTime && (!selectedEmpId || e.employeeId === selectedEmpId));
          const ft = weekFTs.find(f => f.date === ds);
          const isFeiertag = isFreeFT(ft);
          const we = isWeekend(ds);
          const colBeforeEintritt = !!(selectedEmp?.eintrittsdatum && ds < selectedEmp.eintrittsdatum);
          const isMaiTag = ds.slice(5) === "05-01";
          const maiTagBlocked = isMaiTag && (data.settings.blockMaiTag !== false);
          const blocked = maiTagBlocked || colBeforeEintritt;
          const colCls = ["zeit-col", we && "zeit-we", ds === todayStr && "is-today", (we || isFeiertag) && "quiet", blocked && "blocked"].filter(Boolean).join(" ");
          return (
            <div key={ds} className={colCls}>
              {Array.from({ length: SLOT_COUNT }, (_, slotIdx) => {
                const slotHour = SLOT_START_H + slotIdx / 4;
                const isOffHours = slotHour < 7 || slotHour >= 19;
                const inHover = weekSelectStart?.dayStr === ds && weekHover?.dayStr === ds && slotIdx >= Math.min(weekSelectStart.slotIdx, weekHover.slotIdx) && slotIdx <= Math.max(weekSelectStart.slotIdx, weekHover.slotIdx);
                const isStart = weekSelectStart?.dayStr === ds && slotIdx === weekSelectStart.slotIdx && !weekHover;
                const inSel = weekForm?.dayStr === ds && slotIdx >= weekForm.startSlot && slotIdx <= weekForm.endSlot;
                const cls = `zeit-slot${isOffHours ? " off" : ""}${inSel ? " sel" : (inHover || isStart) ? " hov" : ""}`;
                return (
                  <div key={slotIdx} className={cls} style={{ height: SLOT_H }}
                    onClick={() => !blocked && !resizingRef.current && handleSlotClick(ds, slotIdx)}
                    onMouseEnter={() => setWeekHover({ dayStr: ds, slotIdx })} />
                );
              })}
              {colTimed.map(e => {
                const r = resizing;
                const isRes = r?.entryId === e.id;
                const dispStart = isRes && r.previewStart !== undefined ? r.previewStart : e.startTime;
                const dispMins = isRes && r.previewMins !== undefined ? r.previewMins : e.minutes;
                const [sh, sm] = (dispStart as string).split(":").map(Number);
                const top = minsToY(sh * 60 + sm);
                if (top < 0) return null;
                const height = Math.max(SLOT_H, (dispMins / 15) * SLOT_H) - 2;
                const proj = data.projects.find(p => p.id === e.projectId);
                const pc = projectColor(e.projectId);
                const handleH = Math.min(6, Math.floor(height / 3));
                const phase = phaseLabels(e, proj);
                const startSlot = (sh * 60 + sm - SLOT_START_H * 60) / 15;
                const range = `${slotToTime(startSlot)}–${slotToTime(startSlot + dispMins / 15)}`;
                const startResizing = (ev: React.MouseEvent, edge: string) => {
                  if (isMonthClosed(ds)) return;
                  ev.stopPropagation(); ev.preventDefault();
                  const [s, m] = (e.startTime as string).split(":").map(Number);
                  const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                  resizingRef.current = { entryId: e.id, dayStr: ds, empId: selectedEmpId, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: e.minutes, origStartTime: e.startTime, origSlot, previewStart: e.startTime, previewMins: e.minutes };
                  syncResizing();
                };
                const cls = ["zeit-entry", isRes && "is-drag", selectedEntryId === e.id && "is-sel", (e.invoiceId || isMonthClosed(ds)) && "is-locked"].filter(Boolean).join(" ");
                const title = [proj ? `${proj.number ? proj.number + " · " : ""}${proj.name}` : "—", phase?.long, `${range} · ${formatHours(dispMins)}`, e.description, e.invoiceId ? "verrechnet" : ""].filter(Boolean).join("\n");
                return (
                  <div key={e.id} className={cls} title={title}
                    onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                    style={{ top, height, "--pc-solid": pc.solid, "--pc-tint": pc.tint, paddingTop: height < 20 ? 0 : 3 } as CSSProperties}>
                    <span className="zeit-grip top" style={{ height: handleH }} onMouseDown={ev => startResizing(ev, "top")} />
                    <span className="zeit-move" style={{ top: handleH, bottom: handleH }} onMouseDown={ev => startResizing(ev, "move")} />
                    <div className="zeit-e-name" style={height < 20 ? { lineHeight: `${height}px` } : undefined}>{proj?.name || "—"}</div>
                    {height >= 30 && <div className="zeit-e-meta"><span>{range}</span>{phase && <span>{phase.short}</span>}</div>}
                    {height >= 46 && e.description && <div className="zeit-e-desc">{e.description}</div>}
                    <span className="zeit-grip bottom" style={{ height: handleH }} onMouseDown={ev => startResizing(ev, "bottom")} />
                  </div>
                );
              })}
              {/* Absenz-Blöcke im Zeitraster */}
              {(data.absences || []).filter(a => a.date === ds && a.startTime && a.endTime && (!selectedEmpId || a.employeeId === selectedEmpId)).map(a => {
                const rA = resizing;
                const isResA = rA?.entryId === a.id;
                const dispStartA = isResA && rA.previewStart !== undefined ? rA.previewStart : a.startTime;
                const [shA, smA] = (dispStartA as string).split(":").map(Number);
                const dispMinsA = isResA && rA.previewMins !== undefined ? rA.previewMins : (() => { const [eh,em]=(a.endTime as string).split(":").map(Number); return (eh*60+em)-(shA*60+smA); })();
                const topA = minsToY(shA * 60 + smA);
                if (topA < 0) return null;
                const heightA = Math.max(SLOT_H, (dispMinsA / 15) * SLOT_H) - 2;
                const handleHA = Math.min(6, Math.floor(heightA / 3));
                const t = absenzTypes.find(x => x.id === a.type);
                const solid = t?.color || "var(--text4)";
                const origDurA = (() => { const [eh,em]=(a.endTime as string).split(":").map(Number); return (eh*60+em)-(shA*60+smA); })();
                const startResizingA = (ev: React.MouseEvent, edge: string) => {
                  if (isMonthClosed(ds)) return;
                  ev.stopPropagation(); ev.preventDefault();
                  const [s, m] = (a.startTime as string).split(":").map(Number);
                  const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                  resizingRef.current = { entryId: a.id, dayStr: ds, empId: selectedEmpId, isAbs: true, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: origDurA, origStartTime: a.startTime, origSlot, previewStart: a.startTime, previewMins: origDurA };
                  syncResizing();
                };
                const startSlotA = (shA * 60 + smA - SLOT_START_H * 60) / 15;
                const rangeA = `${dispStartA}–${slotToTime(startSlotA + dispMinsA / 15)}`;
                const cls = ["zeit-entry is-abs", isResA && "is-drag", selectedEntryId === a.id && "is-sel", isMonthClosed(ds) && "is-locked"].filter(Boolean).join(" ");
                return (
                  <div key={a.id} className={cls} title={`${t?.label || a.type}${a.status === "pending" ? " (beantragt)" : ""}\n${rangeA} · ${formatHours(dispMinsA)}${a.note ? "\n" + a.note : ""}`}
                    style={{ top: topA, height: heightA, "--pc-solid": solid, "--pc-tint": `color-mix(in srgb, ${solid} 16%, var(--surface))`, paddingTop: heightA < 20 ? 0 : 3 } as CSSProperties}>
                    <span className="zeit-grip top" style={{ height: handleHA }} onMouseDown={ev => startResizingA(ev, "top")} />
                    <span className="zeit-move" style={{ top: handleHA, bottom: handleHA }} onMouseDown={ev => startResizingA(ev, "move")} />
                    <div className="zeit-e-name" style={heightA < 20 ? { lineHeight: `${heightA}px` } : undefined}>{t?.label || a.type}</div>
                    {heightA >= 30 && <div className="zeit-e-meta"><span>{rangeA}</span></div>}
                    {heightA >= 46 && a.note && <div className="zeit-e-desc">{a.note}</div>}
                    <span className="zeit-grip bottom" style={{ height: handleHA }} onMouseDown={ev => startResizingA(ev, "bottom")} />
                  </div>
                );
              })}
              {ds === todayStr && timer && timer.employeeId === selectedEmpId && (() => {
                const start = new Date(timer.start);
                if (Number.isNaN(start.getTime()) || localISODate(start) !== todayStr) return null;
                const startMins = start.getHours() * 60 + start.getMinutes();
                const top = minsToY(startMins);
                const elapsed = Math.max(0, nowMins - startMins);
                const height = Math.max(SLOT_H * 2, (elapsed / 15) * SLOT_H) - 2;
                const proj = data.projects.find(p => p.id === timer.projectId);
                return (
                  <div className="zeit-live" style={{ top, height }} title="Stoppuhr läuft — stoppen unter «Heute»">
                    <div className="zeit-live-k"><span className="zeit-pulse" />läuft · <span className="num">{formatHours(elapsed)}</span></div>
                    {height >= 30 && <div style={{ fontWeight: 600 }}>{proj?.name || "—"}</div>}
                    {height >= 46 && timer.description && <div style={{ color: "var(--text4)" }}>{timer.description}</div>}
                  </div>
                );
              })()}
              {ds === todayStr && (() => {
                const top = minsToY(nowMins);
                if (top < 0 || top > SLOT_COUNT * SLOT_H) return null;
                return <div className="zeit-now" style={{ top }} />;
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
