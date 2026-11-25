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
// aufgelöst); der Tag vor einem Feiertag zählt 1 h weniger Soll. Alle Soll-/Saldo-/Ferienregeln: worktime.ts.

import { useState, useRef, useEffect } from "react";
import { arbeitszeitAm, generateId, localISODate, getKW } from "../utils";
import { Header, NavArrows, CalendarPopup, ShareButton } from "../components/UI";
import { readTimer, TIMER_KEY, type RunningTimer } from "../today";
import { useCalendarNav } from "../hooks/useCalendarNav";
import { ReceiptViewer } from "../components/ReceiptViewer";
import type { Absence, TimeEntry, ViewProps } from "../types";
import { showToast } from "../toast";
import {
  SLOT_START_H, SLOT_H, slotToTime, resolveFTs, getSollForDay, calcMonthSaldo, calcTotalSaldo, calcFerienSaldo, buildMonthCells, overlapsEntry,
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

/** Pro Gerät gemerkte Person der Zeiterfassung (nur für Logins, die die Person wechseln dürfen; ARCHITECTURE §4). */
const EMP_KEY = "rapport_time_employee";

/** Initialen einer Person für den Avatar («Julian Roth» → «JR»). */
const initials = (name?: string) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

export default
function Time({ data, update, currentUser, userPermissions, setPrintContent }: Pick<ViewProps, "data" | "update" | "currentUser" | "userPermissions" | "setPrintContent">) {
  const myEmployeeId = currentUser?.employeeId || null;
  // userPermissions === null bedeutet Vollzugriff (Admin bzw. Rolle ohne Einschränkung) —
  // nicht aus dem Fehlen einer employeeId-Verknüpfung ableiten, sonst sehen frisch
  // eingeladene, noch nicht verknüpfte Nutzer versehentlich alle Zeiteinträge.
  const isAdmin = userPermissions === null;
  const canSwitchEmployee = isAdmin || (userPermissions || []).includes("mitarbeiter");
  const [currentDate, setCurrentDate] = useState(localISODate());
  // Wer die Person wechseln darf, bekommt die zuletzt auf diesem Gerät gewählte; alle anderen immer sich selbst
  const [selectedEmpId, setSelectedEmpIdState] = useState(() => {
    if (canSwitchEmployee) {
      try {
        const stored = localStorage.getItem(EMP_KEY);
        if (stored && (data.employees || []).some(e => e.id === stored)) return stored;
      } catch { /* privater Modus */ }
    }
    return myEmployeeId || "";
  });
  const setSelectedEmpId = (id: string) => {
    setSelectedEmpIdState(id);
    if (!canSwitchEmployee) return;
    try { if (id) localStorage.setItem(EMP_KEY, id); else localStorage.removeItem(EMP_KEY); } catch { /* privater Modus */ }
  };
  // Uhrzeit (Jetzt-Linie) und Stoppuhr dieses Geräts: alle 30 s und bei Änderung in einem anderen Fenster nachführen
  const [now, setNow] = useState(() => new Date());
  const [timer, setTimer] = useState<RunningTimer | null>(() => readTimer());
  useEffect(() => {
    const tick = () => { setNow(new Date()); setTimer(readTimer()); };
    const id = window.setInterval(tick, 30000);
    const onStorage = (ev: StorageEvent) => { if (!ev.key || ev.key === TIMER_KEY) tick(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(id); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", tick); };
  }, []);
  const [viewMode, setViewMode] = useState<string>(() => (typeof window !== "undefined" && window.innerWidth < 700 ? "tag" : "woche"));
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
  const viewDate2 = new Date(`${currentDate}T12:00:00`);
  const monthSaldo = calcMonthSaldo(data, selectedEmp, viewDate2);

  // Totalsaldo (Eintrittsdatum bis heute)
  const totalSaldo = calcTotalSaldo(data, selectedEmp);

  // Feriensaldo
  const ferienSaldo = calcFerienSaldo(data, selectedEmp, viewDate2);

  const closedMonths = data.settings.closedMonths || [];
  const isMonthClosed = (date?: string) => closedMonths.includes((date || "").slice(0, 7));

  const { addEntry, updateEntry, delEntry, duplicateToNextDay } = createEntryActions({ data, update, currentDate, selectedEmpId, isMonthClosed });

  const { dayExpenses, addExp, updateExp, delExp, receiptView, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload } = useExpenses(data, update, currentDate, selectedEmpId);

  const { absenzTypes, dayAbs, dayIst, dayDiff, addAbs, updateAbs, delAbs } = buildAbsenceState({ data, update, currentDate, selectedEmpId, selectedEmp, employees, daySoll, dayTotalMins, lockApproved: !isAdmin && !!myEmployeeId && selectedEmpId === myEmployeeId });

  const { antragModal, setAntragModal, antragForm, setAntragForm, openFerienAntrag, saveAntrag, deleteFerien, cancelFerienEdit, editFerien, ferienUebersicht, setFerienUebersicht } = useFerienAntrag(data, update, employees, selectedEmpId, currentDate);
  const { ref: navCalRef, open: navCalOpen, setOpen: setNavCalOpen } = useCalendarNav();

  const viewDate = new Date(`${currentDate}T12:00:00`);
  const todayStr = localISODate();
  const monthCells: (MonthCell | null)[] = buildMonthCells(data, currentDate, selectedEmpId, selectedEmp);

  const monthTotalMins = monthCells.filter((c): c is MonthCell => !!c).reduce((s, c) => s + c.mins, 0);

  const weekdayLabel = new Date(`${currentDate}T12:00:00`).toLocaleDateString("de-CH", { weekday: "long" });
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
  const weekFTs = [...new Set(weekDays.map(ds => Number(ds.slice(0, 4))))].flatMap(y => resolveFTs(data, y));
  // «16.–22. November 2026», über Monats- bzw. Jahresgrenzen ausgeschrieben
  const weekLabel = (() => {
    const from = new Date(`${weekDays[0]}T12:00:00`); const to = new Date(`${weekDays[6]}T12:00:00`);
    const sameYear = from.getFullYear() === to.getFullYear();
    if (sameYear && from.getMonth() === to.getMonth()) return `${from.getDate()}.–${to.toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}`;
    return `${from.toLocaleDateString("de-CH", sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" })} – ${to.toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}`;
  })();
  const isThisWeek = weekDays.includes(todayStr);
  // Stoppuhr nur zeigen, wenn sie der angezeigten Person gehört
  const shownTimer = timer && selectedEmpId && timer.employeeId === selectedEmpId ? timer : null;
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
    if (overlapsEntry(data.timeEntries, selectedEmpId || "", weekForm.dayStr, slotToTime(weekForm.startSlot), mins)) {
      showToast("Der Zeitraum überschneidet sich mit einem bestehenden Eintrag."); return;
    }
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
      weekGridRef.current.scrollTop = (7 - SLOT_START_H) * 4 * SLOT_H - SLOT_H; // 07:00 knapp unter dem Tageskopf
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

  const resetWeekSel = () => { setWeekSelectStart(null); setWeekForm(null); setWeekEditForm(null); };
  const shownEmpName = selectedEmp?.name || (canSwitchEmployee ? "" : employees.find(e => e.id === myEmployeeId)?.name || "");

  // Personenwahl im Kopf: Avatar mit Auswahl (wer wechseln darf) bzw. nur der eigene Name
  const personSwitch = employees.length > 0 && (canSwitchEmployee ? (
    <label className="zeit-person" title="Person wählen">
      <span className="zeit-avatar" aria-hidden="true">{selectedEmp ? initials(selectedEmp.name) : <span className="msr" style={{ fontSize: 16 }}>group</span>}</span>
      <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)} aria-label="Person">
        {isAdmin && <option value="">Alle Personen</option>}
        {employees.map(e => { const p = arbeitszeitAm(e, localISODate()).pensum; return <option key={e.id} value={e.id}>{e.name}{p !== 100 ? ` · ${p} %` : ""}</option>; })}
      </select>
    </label>
  ) : (
    <span className="zeit-person" title="Eigene Zeiterfassung">
      <span className="zeit-avatar" aria-hidden="true">{initials(shownEmpName)}</span>
      <span className="zeit-person-name">{shownEmpName || "—"}</span>
    </span>
  ));

  return (
    <div>
      <Header title="Zeiterfassung" action={
        <div className="zeit-actions">
          {personSwitch}
          {selectedEmp && (
            <>
              <ShareButton options={[{ label: "PDF Stunden", onClick: () => setPrintContent({ type: "timeReport", employee: selectedEmp, entries: (data.timeEntries || []).filter(e => e.employeeId === selectedEmpId), month: currentDate.slice(0, 7), data, settings: data.settings }) }]} />
              <button className="btn btn-ghost" onClick={() => setFerienUebersicht(true)}>Ferienübersicht</button>
              <button className="btn btn-primary" onClick={openFerienAntrag}>Ferien beantragen</button>
            </>
          )}
        </div>
      } />

      {/* Werkzeugleiste: blättern, heute, Zeitraum (öffnet Kalender), Tag/Woche */}
      <div className="zeit-toolbar">
        <NavArrows onPrev={() => viewMode === "tag" ? changeDate(-1) : changeWeek(-1)} onNext={() => viewMode === "tag" ? changeDate(1) : changeWeek(1)} />
        <button className="btn btn-ghost" style={{ height: 32 }} onClick={() => { goToday(); resetWeekSel(); }} disabled={viewMode === "tag" ? isToday : isThisWeek && currentDate === todayStr}>Heute</button>
        <div ref={navCalRef} className="zeit-range-wrap">
          <button className="zeit-range" onClick={() => setNavCalOpen(o => !o)} title="Datum wählen">
            {viewMode === "tag"
              ? <span>{`${weekdayLabel}, ${new Date(`${currentDate}T12:00:00`).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}`}</span>
              : <span>{weekLabel}</span>}
            <span className="zeit-kw">{getKW(viewMode === "tag" ? currentDate : weekDays[0])}</span>
          </button>
          {navCalOpen && (
            <CalendarPopup
              value={currentDate}
              onChange={ds => { setCurrentDate(ds); setNavCalOpen(false); resetWeekSel(); }}
              onClose={() => setNavCalOpen(false)}
              showClear={false}
            />
          )}
        </div>
        <div className="zeit-seg" role="tablist" aria-label="Ansicht">
          {[["tag", "Tag"], ["woche", "Woche"]].map(([mode, label]) => (
            <button key={mode} role="tab" aria-selected={viewMode === mode} className={viewMode === mode ? "on" : ""}
              onClick={() => { setViewMode(mode); resetWeekSel(); }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="zeit-layout">
        <div className="zeit-main">
          {!selectedEmpId && isAdmin && (
            <div style={{ position: "absolute", inset: 0, background: "color-mix(in srgb, var(--bg) 82%, transparent)", zIndex: 30, borderRadius: "var(--r-card)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 120, backdropFilter: "blur(2px)" }}>
              <div className="card" style={{ textAlign: "center", maxWidth: 420, boxShadow: "var(--shadow-pop)" }}>
                {employees.length === 0 ? (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Noch keine Mitarbeitenden erfasst</div>
                    <div style={{ fontSize: 13, color: "var(--text4)", marginTop: 4 }}>Mitarbeitende unter «Mitarbeiter» anlegen, dann hier Stunden erfassen.</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Für wen erfassen?</div>
                    <div style={{ fontSize: 13, color: "var(--text4)", marginTop: 4, marginBottom: 14 }}>Dein Login ist mit keiner Person verknüpft (Einstellungen → Team).</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {employees.map(e => (
                        <button key={e.id} className="pill" onClick={() => setSelectedEmpId(e.id)}>{e.name}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {viewMode === "tag" ? (
            <DayView
              data={data} selectedEmp={selectedEmp} dayEntries={dayEntries} dayTotalMins={dayTotalMins} daySoll={daySoll} dayIst={dayIst} dayDiff={dayDiff}
              isMonthClosed={isMonthClosed} updateEntry={updateEntry} delEntry={delEntry} addEntry={addEntry}
              dayAbs={dayAbs} absenzTypes={absenzTypes} updateAbs={updateAbs} delAbs={delAbs} addAbs={addAbs}
              dayExpenses={dayExpenses} updateExp={updateExp} delExp={delExp} addExp={addExp}
              setReceiptView={setReceiptView} setUploadingExpId={setUploadingExpId}
              expReceiptInputRef={expReceiptInputRef} handleExpReceiptUpload={handleExpReceiptUpload}
              liveTimer={shownTimer && currentDate === todayStr && localISODate(new Date(shownTimer.start)) === todayStr ? shownTimer : null} now={now}
            />
          ) : (
            /* WOCHENANSICHT */
            <div className="card zeit-week">
              {resizing && <style>{`* { cursor: ${resizing.edge === "move" ? "grabbing" : "ns-resize"} !important; user-select: none !important; }`}</style>}
              <WeekGrid
                data={data} weekDays={weekDays} weekFTs={weekFTs} todayStr={todayStr} currentDate={currentDate}
                selectedEmp={selectedEmp} selectedEmpId={selectedEmpId} weekSelectStart={weekSelectStart} weekHover={weekHover}
                weekForm={weekForm} selectedEntryId={weekEditForm?.entryId || null} resizing={resizing} resizingRef={resizingRef} weekGridRef={weekGridRef} absenzTypes={absenzTypes}
                timer={shownTimer} now={now}
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
          canWithdrawApproved={isAdmin || (canSwitchEmployee && selectedEmp?.id !== myEmployeeId)}
        />

        <aside className="zeit-side">
          <MonthCalendar
            currentDate={currentDate} setCurrentDate={setCurrentDate} monthLabel={monthLabel}
            monthCells={monthCells} monthTotalMins={monthTotalMins} selectedEmp={selectedEmp}
            weekDays={viewMode === "woche" ? weekDays : []}
          />
          <SaldoCards selectedEmp={selectedEmp} currentDate={currentDate} totalSaldo={totalSaldo} monthSaldo={monthSaldo} ferienSaldo={ferienSaldo} />
        </aside>
      </div>

      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />

      {contextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} onContextMenu={ev => { ev.preventDefault(); setContextMenu(null); }} />
          <div className="zeit-ctx" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => { duplicateToNextDay(contextMenu.entry); setContextMenu(null); }}>
              <span className="msr" style={{ fontSize: 17, color: "var(--text4)" }}>content_copy</span>Auf morgen kopieren
            </button>
          </div>
        </>
      )}
    </div>
  );
}
