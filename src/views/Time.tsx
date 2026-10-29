// Zeiterfassung. Drei Ansichten (`viewMode`):
//   "woche" – Wochenraster in 15-Minuten-Schritten: Zeitspanne anklicken (Start,
//             dann Ende) → Eintrag (Projekt/Phase/Position oder Absenz) anlegen;
//             Einträge per Ziehen an Ober-/Unterkante in der Länge anpassen;
//             Rechtsklick: auf den nächsten Tag duplizieren.
//   "tag"   – Tagesliste mit Formular.
//   Monats-/Jahresübersichten mit Soll/Ist, Ferien- und Absenz-Anzeige.
// Zusätzlich: Spesen erfassen, Ferienanträge stellen (Status «pending» bis zur
// Genehmigung in Employees.tsx), PDF-Stundenrapport.
//
// Einheiten: Einträge speichern `minutes` (Dauer) und optional `startTime`/`endTime`
// ("HH:MM"); das Raster rechnet in Slots à 15 Minuten (`SLOT_*`). Ein Eintrag gehört
// zu einem Mitarbeiter (`employeeId`) und Projekt (`projectId`, optional Phase/Position).
// Berechtigung: Administratoren (userPermissions === null) und Rollen mit
// «mitarbeiter» dürfen den Mitarbeiter wechseln, alle anderen sehen nur sich selbst.
// Gesperrt sind Monate in `settings.closedMonths` (Monatsabschluss) und Einträge,
// die bereits auf einer Rechnung stehen (`invoiceId`).
// Feiertage kommen aus `data.feiertage` (jährlich wiederkehrende werden aufs Jahr
// aufgelöst); der Tag vor einem Feiertag zählt 1 h weniger Soll (`resolveFTs`).

import React, { useState, useRef, useEffect } from "react";
import { generateId, localISODate } from "../utils";
import { Header, NavArrows, CalendarPopup, ShareButton } from "../components/UI";
import { useCalendarNav } from "../hooks/useCalendarNav";
import { ReceiptViewer } from "../components/ReceiptViewer";
import type { Absence, TimeEntry, ViewProps } from "../types";
import {
  SLOT_START_H, SLOT_H, slotToTime, resolveFTs, getSollForDay, calcMonthSaldo, calcTotalSaldo, calcFerienSaldo, buildMonthCells,
  type SlotPoint, type WeekForm, type WeekEditForm, type ContextMenuState, type MonthCell,
} from "./time/timeUtils";
import { createEntryActions } from "./time/timeEntries";
import { buildAbsenceState } from "./time/timeAbsences";
import { useExpenses } from "./time/useExpenses";
import { useFerienAntrag } from "./time/useFerienAntrag";
import { useWeekResize } from "./time/useWeekResize";
import { DayView } from "./time/DayView";
import { WeekGrid } from "./time/WeekGrid";
import { WeekForms } from "./time/WeekForms";
import { FerienModals } from "./time/FerienModals";
import { MonthCalendar } from "./time/MonthCalendar";
import { SaldoCards } from "./time/SaldoCards";

export default
function Time({ data, update, currentUser, userPermissions, setPrintContent }: Pick<ViewProps, "data" | "update" | "currentUser" | "userPermissions" | "setPrintContent">) {
  const myEmployeeId = currentUser?.employeeId || null;
  // userPermissions === null bedeutet Vollzugriff (Admin bzw. Rolle ohne Einschränkung) —
  // nicht aus dem Fehlen einer employeeId-Verknüpfung ableiten, sonst sehen frisch
  // eingeladene, noch nicht verknüpfte Nutzer versehentlich alle Zeiteinträge.
  const isAdmin = userPermissions === null;
  const [currentDate, setCurrentDate] = useState(localISODate());
  const [selectedEmpId, setSelectedEmpId] = useState(() => myEmployeeId || "");
  const [viewMode, setViewMode] = useState<string>("woche");
  const [weekSelectStart, setWeekSelectStart] = useState<SlotPoint | null>(null);
  const [weekHover, setWeekHover] = useState<SlotPoint | null>(null);
  const [weekForm, setWeekForm] = useState<WeekForm | null>(null);
  const [weekEditForm, setWeekEditForm] = useState<WeekEditForm | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const weekGridRef = useRef<HTMLDivElement>(null);
  const { resizingRef, resizing, syncResizing } = useWeekResize(weekGridRef, data, update, setWeekEditForm);

  const employees = data.employees || [];
  const selectedEmp = employees.find(e => e.id === selectedEmpId) || null;

  const changeDate = (delta: number) => {
    const d = new Date(`${currentDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    setCurrentDate(d.toISOString().slice(0, 10));
  };
  const goToday = () => setCurrentDate(localISODate());

  // Wenn MA gewählt: nur dessen Einträge + Einträge ohne MA-Zuweisung ausblenden
  // Wenn kein MA gewählt: alle Einträge (inkl. ohne MA)
  const dayEntries = data.timeEntries.filter(e => {
    if (e.date !== currentDate) return false;
    if (selectedEmpId) return e.employeeId === selectedEmpId;
    return true;
  }).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const dayTotalMins = dayEntries.reduce((s, e) => s + (e.minutes || 0), 0);

  const daySoll = getSollForDay(data, selectedEmp, currentDate);

  // Monatssaldo
  const viewDate2 = new Date(currentDate);
  const monthSaldo = calcMonthSaldo(data, selectedEmp, viewDate2);

  // Totalsaldo (Eintrittsdatum bis heute)
  const totalSaldo = calcTotalSaldo(data, selectedEmp);

  // Feriensaldo
  const ferienSaldo = calcFerienSaldo(data, selectedEmp, viewDate2);

  const closedMonths = data.settings.closedMonths || [];
  const isMonthClosed = (date?: string) => closedMonths.includes((date || "").slice(0, 7));

  const { addEntry, updateEntry, delEntry, duplicateToNextDay } = createEntryActions({ data, update, currentDate, selectedEmpId, isMonthClosed });

  const { dayExpenses, addExp, updateExp, delExp, receiptView, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload } = useExpenses(data, update, currentDate, selectedEmpId);

  const { absenzTypes, dayAbs, dayIst, dayDiff, addAbs, updateAbs, delAbs } = buildAbsenceState({ data, update, currentDate, selectedEmpId, selectedEmp, employees, daySoll, dayTotalMins });

  const { antragModal, setAntragModal, antragForm, setAntragForm, openFerienAntrag, saveAntrag, deleteFerien, cancelFerienEdit, editFerien, ferienUebersicht, setFerienUebersicht } = useFerienAntrag(data, update, employees, selectedEmpId, currentDate);
  const { ref: navCalRef, open: navCalOpen, setOpen: setNavCalOpen } = useCalendarNav();

  const viewDate = new Date(currentDate);
  const todayStr = localISODate();
  const monthCells: (MonthCell | null)[] = buildMonthCells(data, currentDate, selectedEmpId, selectedEmp);

  const monthTotalMins = monthCells.filter((c): c is MonthCell => !!c).reduce((s, c) => s + c.mins, 0);

  const weekdayLabel = new Date(currentDate).toLocaleDateString("de-CH", { weekday: "long" });
  const monthLabel = viewDate.toLocaleDateString("de-CH", { month: "long", year: "numeric" });
  const isToday = currentDate === localISODate();

  // Reine UTC-Arithmetik wie im Rest der Datei (lokales setDate() + toISOString() stimmt nur in
  // Zeitzonen östlich von UTC, z.B. Zürich).
  const getWeekDays = (ds: string) => {
    const mon = new Date(`${ds}T00:00:00Z`);
    const dow = mon.getUTCDay();
    mon.setUTCDate(mon.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(mon); day.setUTCDate(mon.getUTCDate() + i);
      return day.toISOString().slice(0, 10);
    });
  };
  const weekDays = getWeekDays(currentDate);
  // calFTs ist nur für "year" (das Jahr von currentDate) aufgelöst — eine Woche kann
  // aber über den Jahreswechsel hinausreichen (z.B. 29.12.–4.1.). Für die Feiertags-
  // Markierung in der Wochenansicht deshalb pro Tag das jeweils richtige Jahr auflösen,
  // sonst wird Neujahr/Berchtoldstag in der Jahreswechsel-Woche fälschlich nicht als
  // Feiertag erkannt (repeatsYearly-Einträge matchen nur im aufgelösten Jahr).
  const weekFTs = [...new Set(weekDays.map(ds => new Date(ds).getFullYear()))].flatMap(y => resolveFTs(data, y));
  const weekLabel = (() => {
    const from = new Date(weekDays[0]); const to = new Date(weekDays[6]);
    return `${from.toLocaleDateString("de-CH", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" })}`;
  })();
  const changeWeek = (delta: number) => {
    const d = new Date(`${currentDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta * 7);
    setCurrentDate(d.toISOString().slice(0, 10)); setWeekForm(null); setWeekSelectStart(null); setWeekEditForm(null);
  };
  const handleSlotClick = (dayStr: string, slotIdx: number) => {
    if (isMonthClosed(dayStr)) return;
    if (selectedEmp?.eintrittsdatum && dayStr < selectedEmp.eintrittsdatum) return;
    if (!weekSelectStart) { setWeekSelectStart({ dayStr, slotIdx }); return; }
    if (weekSelectStart.dayStr !== dayStr) { setWeekSelectStart({ dayStr, slotIdx }); return; }
    const startSlot = Math.min(weekSelectStart.slotIdx, slotIdx);
    const endSlot = Math.max(weekSelectStart.slotIdx, slotIdx);
    const firstActive = data.projects.find(p => p.status === "aktiv") || data.projects[0];
    setWeekForm({ dayStr, startSlot, endSlot, mode: "projekt", projectId: firstActive?.id || "", phaseId: "", positionId: "", description: "", absType: absenzTypes[0]?.id || "", absNote: "" });
    setWeekEditForm(null); setWeekSelectStart(null);
  };
  const saveWeekEntry = () => {
    if (isMonthClosed(weekForm?.dayStr)) return;
    if (!weekForm) return;
    const mins = (weekForm.endSlot - weekForm.startSlot + 1) * 15;
    if (weekForm?.mode === "absenz") {
      update("absences", [...(data.absences || []), {
        id: generateId(), date: weekForm.dayStr,
        employeeId: selectedEmpId || "",
        type: weekForm.absType || (absenzTypes[0]?.id || ""),
        startTime: slotToTime(weekForm.startSlot), endTime: slotToTime(weekForm.endSlot + 1),
        minutes: mins, hours: 0,
        note: weekForm.absNote || "", status: "pending",
        createdAt: new Date().toISOString(),
      } as Absence]);
      setWeekForm(null);
      return;
    }
    if (!weekForm?.projectId) return;
    update("timeEntries", [...data.timeEntries, {
      id: generateId(), date: weekForm.dayStr,
      projectId: weekForm.projectId, phaseId: weekForm.phaseId || "", positionId: weekForm.positionId || "",
      minutes: mins, startTime: slotToTime(weekForm.startSlot), endTime: slotToTime(weekForm.endSlot + 1),
      description: weekForm.description || "", employeeId: selectedEmpId || "",
      createdAt: new Date().toISOString(),
    } as TimeEntry]);
    setWeekForm(null);
  };


  useEffect(() => {
    if (viewMode === "woche" && weekGridRef.current) {
      weekGridRef.current.scrollTop = (7 - SLOT_START_H) * 4 * SLOT_H;
    }
  }, [viewMode]);

  if (!isAdmin && !myEmployeeId) {
    // Nicht-Admin ohne Mitarbeiter-Verknüpfung: selectedEmpId bliebe "" und würde von
    // den Filtern unten (!selectedEmpId) fälschlich als "alle Mitarbeitenden" gelesen —
    // also hier komplett blockieren statt fremde Zeiteinträge offenzulegen.
    return (
      <div>
        <Header title="Zeiterfassung" />
        <div style={{ padding: 40, textAlign: "center", color: "var(--text4)" }}>
          Dein Account ist noch keinem Mitarbeiter-Datensatz zugeordnet. Bitte einen Administrator kontaktieren.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Zeiterfassung" action={selectedEmp ? (
        <div style={{ display: "flex", gap: 8 }}>
          <ShareButton options={[{ label: "PDF Stunden", onClick: () => setPrintContent({ type: "timeReport", employee: selectedEmp, entries: (data.timeEntries || []).filter(e => e.employeeId === selectedEmpId), month: currentDate.slice(0, 7), data, settings: data.settings }) }]} />
          <button className="btn btn-ghost" onClick={() => setFerienUebersicht(true)}>Übersicht ↗</button>
          <button className="btn btn-primary" onClick={openFerienAntrag}>Ferien beantragen</button>
        </div>
      ) : null} />


      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        {/* Tages-Erfassung */}
        <div style={{ position: "relative" }}>
          {!selectedEmpId && isAdmin && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(250,248,245,0.88)", zIndex: 10, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(1px)" }}>
              <div style={{ textAlign: "center", color: "var(--text4)" }}>
                {employees.length === 0 ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text3)" }}>Noch keine Mitarbeiter erfasst</div>
                    <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 4 }}>Mitarbeiter unter «Mitarbeiter» anlegen</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text3)" }}>Bitte zuerst einen Mitarbeiter wählen</div>
                    <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 4 }}>Mitarbeiterwahl rechts →</div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8, padding: "12px 16px" }}>
            <NavArrows onPrev={() => viewMode === "tag" ? changeDate(-1) : changeWeek(-1)} onNext={() => viewMode === "tag" ? changeDate(1) : changeWeek(1)} />
            <div ref={navCalRef} style={{ flex: 1, textAlign: "center", position: "relative" }}>
              {viewMode === "tag" ? (
                <div onClick={() => setNavCalOpen(o => !o)} style={{ cursor: "pointer", display: "inline-block" }} title="Datum wählen">
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 400 }}>
                    {`${weekdayLabel}, ${new Date(currentDate).toLocaleDateString("de-CH", { day: "numeric", month: "long" })}`}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 400 }}>{weekLabel}</div>
              )}
              {navCalOpen && (
                <CalendarPopup
                  value={currentDate}
                  onChange={ds => { setCurrentDate(ds); setNavCalOpen(false); }}
                  onClose={() => setNavCalOpen(false)}
                  showClear={false}
                />
              )}
            </div>
            {!isToday && <button className="btn btn-ghost" onClick={goToday} style={{ fontSize: 11 }}>Heute</button>}
            <div style={{ display: "flex", border: "1px solid var(--border2)", borderRadius: 20, overflow: "hidden", marginLeft: 4 }}>
              {[["tag", "Tag"], ["woche", "Woche"]].map(([mode, label], i) => (
                <React.Fragment key={mode}>
                  {i > 0 && <div style={{ width: 1, background: "var(--border2)", alignSelf: "stretch" }} />}
                  <button onClick={() => { setViewMode(mode); setWeekSelectStart(null); setWeekForm(null); setWeekEditForm(null); }} style={{
                    fontSize: 11, padding: "0 12px", height: 30, border: "none", cursor: "pointer", fontFamily: "inherit",
                    background: viewMode === mode ? "var(--text)" : "transparent",
                    color: viewMode === mode ? "var(--bg)" : "var(--text3)", transition: "all 0.15s",
                  }}>{label}</button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {viewMode === "tag" ? (
            <DayView
              data={data} selectedEmp={selectedEmp} dayEntries={dayEntries} dayTotalMins={dayTotalMins} daySoll={daySoll} dayIst={dayIst} dayDiff={dayDiff}
              isMonthClosed={isMonthClosed} updateEntry={updateEntry} delEntry={delEntry} addEntry={addEntry}
              dayAbs={dayAbs} absenzTypes={absenzTypes} updateAbs={updateAbs} delAbs={delAbs} addAbs={addAbs}
              dayExpenses={dayExpenses} updateExp={updateExp} delExp={delExp} addExp={addExp}
              setReceiptView={setReceiptView} setUploadingExpId={setUploadingExpId}
              expReceiptInputRef={expReceiptInputRef} handleExpReceiptUpload={handleExpReceiptUpload}
            />
          ) : (
            /* WOCHENANSICHT */
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {resizing && <style>{`* { cursor: ${resizing.edge === "move" ? "grabbing" : "ns-resize"} !important; user-select: none !important; }`}</style>}
              <WeekGrid
                data={data} weekDays={weekDays} weekFTs={weekFTs} todayStr={todayStr} currentDate={currentDate}
                selectedEmp={selectedEmp} selectedEmpId={selectedEmpId} weekSelectStart={weekSelectStart} weekHover={weekHover}
                weekForm={weekForm} resizing={resizing} resizingRef={resizingRef} weekGridRef={weekGridRef} absenzTypes={absenzTypes}
                setWeekHover={setWeekHover} setCurrentDate={setCurrentDate} setViewMode={setViewMode} setContextMenu={setContextMenu}
                handleSlotClick={handleSlotClick} isMonthClosed={isMonthClosed} syncResizing={syncResizing}
              />
              <WeekForms
                data={data} update={update} weekSelectStart={weekSelectStart} setWeekSelectStart={setWeekSelectStart}
                weekForm={weekForm} setWeekForm={setWeekForm} weekEditForm={weekEditForm} setWeekEditForm={setWeekEditForm}
                absenzTypes={absenzTypes} saveWeekEntry={saveWeekEntry} updateEntry={updateEntry} delEntry={delEntry} isMonthClosed={isMonthClosed}
              />
            </div>
          )}
        </div>

        <FerienModals
          data={data} selectedEmp={selectedEmp} employees={employees}
          ferienUebersicht={ferienUebersicht} setFerienUebersicht={setFerienUebersicht}
          antragModal={antragModal} setAntragModal={setAntragModal} antragForm={antragForm} setAntragForm={setAntragForm}
          saveAntrag={saveAntrag} editFerien={editFerien} cancelFerienEdit={cancelFerienEdit} deleteFerien={deleteFerien}
        />

        <div>
          {employees.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 6 }}>MITARBEITER</div>
              {(() => {
                const canSwitchEmployee = isAdmin || (userPermissions || []).includes("mitarbeiter");
                if (canSwitchEmployee) {
                  return (
                    <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)} style={{ width: "100%", fontSize: 13 }}>
                      {isAdmin && <option value="">— Alle / Kein Filter —</option>}
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.pensum||100}%</option>)}
                    </select>
                  );
                }
                return (
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                    {employees.find(e => e.id === myEmployeeId)?.name || "—"}
                  </div>
                );
              })()}
            </div>
          )}
          <MonthCalendar
            currentDate={currentDate} setCurrentDate={setCurrentDate} monthLabel={monthLabel}
            monthCells={monthCells} monthTotalMins={monthTotalMins} selectedEmp={selectedEmp}
          />

          <SaldoCards selectedEmp={selectedEmp} currentDate={currentDate} totalSaldo={totalSaldo} monthSaldo={monthSaldo} ferienSaldo={ferienSaldo} />


        </div>
      </div>

      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />

      {contextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} onContextMenu={ev => { ev.preventDefault(); setContextMenu(null); }} />
          <div style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 1000, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 180, padding: "4px 0" }}>
            <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "var(--text)" }}
              onMouseEnter={ev => ev.currentTarget.style.background = "#faf8f5"}
              onMouseLeave={ev => ev.currentTarget.style.background = "none"}
              onClick={() => { duplicateToNextDay(contextMenu.entry); setContextMenu(null); }}>
              Auf morgen kopieren
            </button>
          </div>
        </>
      )}
    </div>
  );
}

