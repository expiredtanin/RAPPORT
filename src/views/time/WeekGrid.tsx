// Zeiterfassung, Wochenansicht: Tageskopf mit Soll/Ist und das 15-Minuten-Zeitgitter mit Einträgen, Absenzen und Jetzt-Linie.

import React from "react";
import type { RefObject, MutableRefObject } from "react";
import { SIA_PHASES } from "../../constants";
import type { AppData, Employee, Feiertag } from "../../types";
import {
  SLOT_COUNT, SLOT_H, SLOT_START_H, PROJ_COLORS, slotToTime, getSollForDay, isApprovedVacationDay,
  type SlotPoint, type WeekForm, type ResizeState, type ContextMenuState,
} from "./timeUtils";

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
  resizing: ResizeState | null;
  resizingRef: MutableRefObject<ResizeState | null>;
  weekGridRef: RefObject<HTMLDivElement | null>;
  absenzTypes: { id: string; label: string; color?: string }[];
  setWeekHover: (p: SlotPoint | null) => void;
  setCurrentDate: (ds: string) => void;
  setViewMode: (mode: string) => void;
  setContextMenu: (m: ContextMenuState | null) => void;
  handleSlotClick: (dayStr: string, slotIdx: number) => void;
  isMonthClosed: (date?: string) => boolean;
  syncResizing: () => void;
}

/** Scrollbares Wochenraster (Tageskopf + Zeitgitter). */
export function WeekGrid({ data, weekDays, weekFTs, todayStr, currentDate, selectedEmp, selectedEmpId, weekSelectStart, weekHover, weekForm, resizing, resizingRef, weekGridRef, absenzTypes, setWeekHover, setCurrentDate, setViewMode, setContextMenu, handleSlotClick, isMonthClosed, syncResizing }: WeekGridProps) {
  return (
    <>
      {/* Zeitraster mit sticky Tageskopf */}
      <div ref={weekGridRef} style={{ isolation: "isolate", overflowY: "auto", maxHeight: "calc(100vh - 260px)" }} onMouseLeave={() => setWeekHover(null)}>

        {/* Sticky Tageskopf */}
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "var(--surface)", borderBottom: "2px solid #e8e3dc", transform: "translateZ(0)", willChange: "transform" }}>
          <div style={{ width: 44, flexShrink: 0 }} />
          {weekDays.map(ds => {
            const d = new Date(ds);
            const isThisToday = ds === todayStr;
            const isCurDay = ds === currentDate;
            const ft = weekFTs.find(f => f.date === ds);
            const isFeiertag = ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);
            const dow = d.getDay();
            const noWork = dow === 0 || dow === 6 || isFeiertag;
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
            const isPast = ds <= todayStr;
            const isVacDay = selectedEmpId ? isApprovedVacationDay(data, selectedEmpId, ds) : false;
            const isPendingVacDay = !isVacDay && selectedEmpId ? (data.ferienEntries || []).some(f => f.employeeId === selectedEmpId && f.status === "pending" && !f.originalData && ds >= f.dateFrom && ds <= f.dateTo) : false;
            const diff = Math.round((istH - sollH) * 10) / 10;
            return (
              <div key={ds} style={{ flex: 1, textAlign: "center", padding: "8px 4px 6px", position: "relative", borderLeft: "1px solid var(--border2)", cursor: "pointer", background: isCurDay ? "#1a1a18" : isVacDay ? ((!isPast && Math.ceil((new Date(ds).getTime() - new Date(todayStr).getTime()) / 86400000) > 21) ? "var(--info-bg)" : "var(--positive-bg)") : isPendingVacDay ? "#fff8e8" : isFeiertag ? "#f5f2ed" : "var(--surface)" }}
                onClick={() => { setCurrentDate(ds); setViewMode("tag"); }}>
                <div style={{ fontSize: 9, letterSpacing: "0.1em", color: isCurDay ? "#e8e5df" : isBeforeEintritt ? "#ddd" : "var(--text5)" }}>{d.toLocaleDateString("de-CH", { weekday: "short" }).toUpperCase()}</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, lineHeight: 1.2, color: isCurDay ? "#e8e5df" : isBeforeEintritt ? "var(--text5)" : isThisToday ? "var(--accent)" : isFeiertag ? "#bbb" : "var(--text)" }}>{d.getDate()}</div>
                <div style={{ position: "absolute", top: 8, right: 4, textAlign: "right", lineHeight: 1.2 }}>
                  {(() => {
                    if (!selectedEmp || noWork || isBeforeEintritt) return wkTotal > 0 ? <div style={{ fontSize: 9, fontWeight: 500, color: isCurDay ? "#e8e5df" : "#8a6a3a" }}>{istH.toFixed(1)}h</div> : null;
                    if (isVacDay && wkTotal === 0) {
                      const daysAway = Math.ceil((new Date(ds).getTime() - new Date(todayStr).getTime()) / 86400000);
                      const isPlanned = !isPast && daysAway > 21;
                      const color = isCurDay ? "#a0c4e8" : isPlanned ? "var(--info)" : "var(--positive)";
                      return <div style={{ fontSize: 8, fontWeight: 600, color }}>Ferien</div>;
                    }
                    if (isPendingVacDay && wkTotal === 0) return <div style={{ fontSize: 8, fontWeight: 600, color: isCurDay ? "#e8e5df" : "var(--warning)" }}>Ferien?</div>;
                    if (!isPast) return wkTotal > 0 ? <div style={{ fontSize: 9, fontWeight: 500, color: isCurDay ? "#e8e5df" : "#8a6a3a" }}>{istH.toFixed(1)}h</div> : null;
                    const saldoColor = isCurDay ? "#e8e5df" : diff === 0 ? "#555" : diff > 0 ? "var(--positive)" : "var(--warning)";
                    const saldoText = (wkTotal + absMinutes) === 0 ? `-${sollH.toFixed(1)}h` : diff === 0 ? `${istH.toFixed(1)}h` : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}h`;
                    return <div style={{ fontSize: 9, fontWeight: 600, color: saldoColor }}>{saldoText}</div>;
                  })()}
                </div>
              </div>
            );
          })}
        </div>


        {/* Zeitgitter */}
        <div style={{ display: "flex" }}>
        <div style={{ width: 44, flexShrink: 0, pointerEvents: "none" }}>
          {Array.from({ length: SLOT_COUNT }, (_, i) => {
            const hour = i / 4;
            const isOffHour = hour < 7 || hour >= 19;
            const isHourMark = i % 4 === 0 && i > 0;
            const labelColor = isOffHour ? "#7a9db8" : "#888";
            return (
              <div key={i} style={{ height: SLOT_H, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 6, paddingTop: 2, fontSize: 10, color: labelColor, lineHeight: 1, boxSizing: "border-box", borderTop: isHourMark ? `1px solid ${isOffHour ? "#e8eef2" : "#f0ede8"}` : "none", fontWeight: isOffHour ? 400 : 500 }}>
                {isHourMark ? slotToTime(i) : ""}
              </div>
            );
          })}
        </div>
        {weekDays.map(ds => {
          const colTimed = data.timeEntries.filter(e => e.date === ds && e.startTime && (!selectedEmpId || e.employeeId === selectedEmpId));
          const ft = weekFTs.find(f => f.date === ds);
          const isFeiertag = ft && (ft.stundenDelta === 0 || ft.stundenDelta === null || ft.stundenDelta === undefined);
          const colBeforeEintritt = !!(selectedEmp?.eintrittsdatum && ds < selectedEmp.eintrittsdatum);
          const isMaiTag = ds.slice(5) === "05-01";
          const maiTagBlocked = isMaiTag && (data.settings.blockMaiTag !== false);
          return (
            <div key={ds} style={{ flex: 1, position: "relative", borderLeft: "1px solid var(--border2)", background: maiTagBlocked || colBeforeEintritt ? "#faf8f5" : isFeiertag ? "#f7f5f1" : "var(--surface)" }}>
              {Array.from({ length: SLOT_COUNT }, (_, slotIdx) => {
                const isHour = slotIdx % 4 === 0;
                const isHalf = slotIdx % 2 === 0 && !isHour;
                const slotHour = slotIdx / 4;
                const isOffHours = slotHour < 7 || slotHour >= 19;
                const inHover = weekSelectStart?.dayStr === ds && weekHover?.dayStr === ds && slotIdx >= Math.min(weekSelectStart.slotIdx, weekHover.slotIdx) && slotIdx <= Math.max(weekSelectStart.slotIdx, weekHover.slotIdx);
                const isStart = weekSelectStart?.dayStr === ds && slotIdx === weekSelectStart.slotIdx && !weekHover;
                const inSel = weekForm?.dayStr === ds && slotIdx >= weekForm.startSlot && slotIdx <= weekForm.endSlot;
                const blocked = maiTagBlocked || colBeforeEintritt;
                const offBg = isOffHours ? "rgba(100,140,175,0.06)" : "transparent";
                return (
                  <div key={slotIdx} style={{ height: SLOT_H, boxSizing: "border-box", borderTop: slotIdx > 0 ? `1px solid ${isHour ? (isOffHours ? "#e4eaf0" : "#e8e3dc") : isHalf ? "#f0ede8" : "#f7f5f2"}` : "none", background: inSel ? "rgba(212,168,90,0.15)" : (inHover || isStart) ? "rgba(212,168,90,0.08)" : offBg, cursor: blocked ? "default" : "crosshair" }}
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
                const top = ((sh * 60 + sm) - SLOT_START_H * 60) / 15 * SLOT_H;
                if (top < 0) return null;
                const height = Math.max(SLOT_H, (dispMins / 15) * SLOT_H) - 2;
                const proj = data.projects.find(p => p.id === e.projectId);
                const bg = PROJ_COLORS[data.projects.findIndex(p => p.id === e.projectId) % PROJ_COLORS.length] || PROJ_COLORS[0];
                const handleH = Math.min(5, Math.floor(height / 3));
                const phaseDisplay = e.phaseId ? (() => {
                  const cp = (proj?.customPhases||[]).find(c => c.id === e.phaseId);
                  if (cp) return cp.label;
                  const sia = SIA_PHASES.find(p => p.id === e.phaseId);
                  return sia ? (e.positionId ? `${e.positionId}·${e.phaseId}` : e.phaseId) : e.phaseId;
                })() : null;
                const startResizing = (ev: React.MouseEvent, edge: string) => {
                  if (isMonthClosed(ds)) return;
                  ev.stopPropagation(); ev.preventDefault();
                  const [s, m] = (e.startTime as string).split(":").map(Number);
                  const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                  resizingRef.current = { entryId: e.id, dayStr: ds, empId: selectedEmpId, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: e.minutes, origStartTime: e.startTime, origSlot, previewStart: e.startTime, previewMins: e.minutes };
                  syncResizing();
                };
                const isMoving = isRes && r?.edge === "move";
                return (
                  <div key={e.id} title={`${proj?.name||"—"}: ${(dispMins/60).toFixed(1)}h${e.description?" · "+e.description:""}`}
                    onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                    style={{ position: "absolute", top, left: 2, right: 2, height, background: bg, borderRadius: 3, padding: `${handleH}px 4px`, fontSize: 9, color: "#fff", overflow: "hidden", zIndex: isRes ? 10 : 2, boxSizing: "border-box", userSelect: "none" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: handleH, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "3px 3px 0 0", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "top")} />
                    <div style={{ position: "absolute", top: handleH, left: 0, right: 0, bottom: handleH, cursor: isMoving ? "grabbing" : "grab", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "move")} />
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingTop: 1, pointerEvents: "none" }}>{proj?.name||"—"}</div>
                    {phaseDisplay && height > 24 && <div style={{ fontSize: 7, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 0, pointerEvents: "none" }}>{phaseDisplay}</div>}
                    {height > 36 && <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1, pointerEvents: "none" }}>{slotToTime((sh*60+sm-SLOT_START_H*60)/15)} – {slotToTime((sh*60+sm-SLOT_START_H*60)/15 + dispMins/15)}</div>}
                    {height > 52 && e.description && <div style={{ opacity: 0.75, fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{e.description}</div>}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: handleH, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "0 0 3px 3px", zIndex: 1 }} onMouseDown={ev => startResizing(ev, "bottom")} />
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
                const topA = ((shA * 60 + smA) - SLOT_START_H * 60) / 15 * SLOT_H;
                if (topA < 0) return null;
                const heightA = Math.max(SLOT_H, (dispMinsA / 15) * SLOT_H) - 2;
                const handleHA = Math.min(5, Math.floor(heightA / 3));
                const t = absenzTypes.find(x => x.id === a.type);
                const bg = t?.color || "#888";
                const isMovingA = isResA && rA?.edge === "move";
                const origDurA = (() => { const [eh,em]=(a.endTime as string).split(":").map(Number); return (eh*60+em)-(shA*60+smA); })();
                const startResizingA = (ev: React.MouseEvent, edge: string) => {
                  if (isMonthClosed(ds)) return;
                  ev.stopPropagation(); ev.preventDefault();
                  const [s, m] = (a.startTime as string).split(":").map(Number);
                  const origSlot = Math.round((s * 60 + m - SLOT_START_H * 60) / 15);
                  resizingRef.current = { entryId: a.id, dayStr: ds, empId: selectedEmpId, isAbs: true, edge, moved: false, startAbsY: ev.clientY + (weekGridRef.current?.scrollTop || 0), origMinutes: origDurA, origStartTime: a.startTime, origSlot, previewStart: a.startTime, previewMins: origDurA };
                  syncResizing();
                };
                return (
                  <div key={a.id} title={`${t?.label || a.type}: ${(dispMinsA/60).toFixed(1)}h${a.note ? " · " + a.note : ""}`}
                    style={{ position: "absolute", top: topA, left: 2, right: 2, height: heightA, background: bg, opacity: 0.85, borderRadius: 3, padding: `${handleHA}px 5px`, fontSize: 9, color: "#fff", overflow: "hidden", zIndex: isResA ? 10 : 2, boxSizing: "border-box", userSelect: "none" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: handleHA, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "3px 3px 0 0", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "top")} />
                    <div style={{ position: "absolute", top: handleHA, left: 0, right: 0, bottom: handleHA, cursor: isMovingA ? "grabbing" : "grab", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "move")} />
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{t?.label || a.type}</div>
                    {heightA > 28 && <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1, pointerEvents: "none" }}>{dispStartA} – {slotToTime((shA*60+smA-SLOT_START_H*60)/15 + dispMinsA/15)}</div>}
                    {heightA > 44 && a.note && <div style={{ opacity: 0.75, fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{a.note}</div>}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: handleHA, cursor: "ns-resize", background: "rgba(0,0,0,0.15)", borderRadius: "0 0 3px 3px", zIndex: 1 }} onMouseDown={ev => startResizingA(ev, "bottom")} />
                  </div>
                );
              })}
              {ds === todayStr && (() => {
                const now = new Date();
                const top = (now.getHours() * 60 + now.getMinutes() - SLOT_START_H * 60) / 15 * SLOT_H;
                if (top < 0 || top > SLOT_COUNT * SLOT_H) return null;
                return <div style={{ position: "absolute", left: 0, right: 0, top, height: 2, background: "var(--accent)", zIndex: 5, pointerEvents: "none" }} />;
              })()}
            </div>
          );
        })}
        </div>{/* end display:flex time grid */}
      </div>{/* end scroll container */}
    </>
  );
}
