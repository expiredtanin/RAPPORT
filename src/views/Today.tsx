// «Heute»: persönliche Startseite (Beta 26.11, Konzept «Heute» + Projekt-Arbeitsraum).
//
// Links die Stoppuhr (läuft pro Gerät, `rapport_timer`; Stopp/Wechseln schreibt einen normalen Zeiteintrag
// mit «Rückgängig») und die Einträge von heute mit Wochensumme; Mitte die eigenen Pendenzen aus Protokollen
// (abhaken setzt den Status im neuesten Protokoll) und Rechnungsvorschläge; rechts die nächsten Termine und
// ein paar Büro-Zahlen. Logik in today.ts; Navigation über `run` (dieselben Ziele wie die Befehlspalette).

import { useEffect, useState } from "react";
import type { AppData, CurrentUser, Employee, ViewProps } from "../types";
import type { PaletteTarget } from "../commandPalette";
import { NON_BILLING_CATEGORIES, SIA_PHASES } from "../constants";
import { formatCHF, formatHours, generateId, getKW, localISODate, yearRevenue } from "../utils";
import { addDays, setLinkedStatus } from "../schedule";
import { getFirstPhaseForProject } from "./time/timeUtils";
import { formatElapsed, openTasks, readTimer, timerElapsedMs, timerToEntries, weekAgenda, writeTimer, TIMER_KEY, type RunningTimer } from "../today";
import { getSollForDay } from "./time/timeUtils";
import { changeWithUndo } from "../undo";
import { showToast } from "../toast";
import { EmptyState } from "../components/UI";
import { dueFollowUps } from "../crm";

/** Betrag ohne Rappen und ohne «CHF» (kompakt für Kennzahlen). */
const chf0 = (n: number) => formatCHF(Math.round(n)).replace(/^(−?)CHF\s*/u, "$1").replace(/\.00$/, "");

/** Phasen eines Projekts zur Auswahl (SIA + eigene). */
function projectPhases(data: AppData, projectId: string) {
  const p = data.projects.find(x => x.id === projectId);
  if (!p) return [];
  return [
    ...SIA_PHASES.filter(s => (p.enabledPhases || []).includes(s.id)),
    ...(p.customPhases || []).map(c => ({ id: c.id, label: c.label })),
  ];
}

export default function Today({ data, currentUser, userPermissions, run, onOpenPalette }: Pick<ViewProps, "data" | "currentUser" | "userPermissions"> & {
  run: (t: PaletteTarget) => void;
  onOpenPalette: () => void;
}) {
  const today = localISODate();
  const can = (perm: string) => userPermissions === null || userPermissions.includes(perm);
  const employees = data.employees || [];
  const linkedEmp = employees.find(e => e.id === (currentUser as CurrentUser | null)?.employeeId) || null;
  const [timer, setTimerState] = useState<RunningTimer | null>(readTimer);
  // Ohne verknüpfte Person: zuletzt gewählte Person dieses Geräts (gleicher Schlüssel wie die Zeiterfassung)
  const [pickedEmpId, setPickedEmpIdState] = useState<string>(() => { if (timer?.employeeId) return timer.employeeId; try { return localStorage.getItem("rapport_time_employee") || ""; } catch { return ""; } });
  const setPickedEmpId = (id: string) => { setPickedEmpIdState(id); try { if (id) localStorage.setItem("rapport_time_employee", id); } catch { /* privater Modus */ } };
  // Person frei wählen nur mit Recht «mitarbeiter» (wie die Zeiterfassung) — sonst Stunden/Pendenzen beliebiger
  // Kollegen sicht- und buchbar, wenn das Login nicht verknüpft ist (Runde 40)
  const canPick = can("mitarbeiter");
  const me: Employee | null = linkedEmp || (canPick ? employees.find(e => e.id === pickedEmpId) : null) || null;
  const [now, setNow] = useState(() => new Date());
  const [form, setForm] = useState({ projectId: "", phaseId: "", description: "" });
  const [switching, setSwitching] = useState(false);

  const setTimer = (t: RunningTimer | null) => { writeTimer(t); setTimerState(t); };
  // Stoppuhr in einem anderen Fenster gestartet/gestoppt (wie die Zeiterfassung) — sonst lief sie hier weiter
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === TIMER_KEY) setTimerState(readTimer()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (!timer) return;
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  const activeProjects = data.projects.filter(p => p.status !== "abgeschlossen");
  const projectName = (id?: string) => data.projects.find(p => p.id === id)?.name || "—";
  const phaseLabel = (pid: string, ph?: string) => projectPhases(data, pid).find(x => x.id === ph)?.label || "";
  const closed = data.settings.closedMonths || [];

  /** Stoppt die Stoppuhr und schreibt den Eintrag (mit Rückgängig). false = Stoppuhr läuft weiter (Monat abgeschlossen). */
  const stop = (t: RunningTimer): boolean => {
    const { entries: raws, truncated } = timerToEntries(t, new Date(), generateId);
    // abgeschlossener Monat: Stoppuhr weiterlaufen lassen statt die Zeit zu verwerfen
    if (raws.some(r => closed.includes(r.date.slice(0, 7)))) { showToast("Monat ist abgeschlossen — Eintrag nicht gespeichert, Stoppuhr läuft weiter (oben «Verwerfen»)"); return false; }
    setTimer(null);
    if (!raws.length) { showToast("Weniger als eine Minute — nichts erfasst"); return true; }
    // Ohne gewählte Phase die erste des Projekts (wie «+ Eintrag» in der Zeiterfassung) — sonst fehlte der Eintrag
    // in der Phasenauswertung und im Wochenraster war die Phase leer
    const phase = getFirstPhaseForProject(data.projects.find(p => p.id === t.projectId));
    const entries = raws.map(raw => raw.phaseId ? raw : { ...raw, ...phase });
    const mins = entries.reduce((sum, e) => sum + e.minutes, 0);
    changeWithUndo(`${formatHours(mins)} auf ${projectName(t.projectId)} erfasst${entries.length > 1 ? " (über Mitternacht geteilt)" : ""}${truncated ? " — nur bis Mitternacht des Starttags, Rest bitte nachtragen" : ""}`,
      prev => ({ ...prev, timeEntries: [...(prev.timeEntries || []), ...entries] }));
    return true;
  };
  const start = () => {
    if (!me || !form.projectId) return;
    // Wechseln: scheitert das Stoppen (abgeschlossener Monat), bleibt die alte Stoppuhr — vorher war ihre Zeit weg (Runde 30)
    if (timer && !stop(timer)) return;
    setTimer({ employeeId: me.id, projectId: form.projectId, phaseId: form.phaseId || undefined, description: form.description.trim() || undefined, start: new Date().toISOString() });
    setForm({ projectId: "", phaseId: "", description: "" });
    setSwitching(false);
    setNow(new Date());
  };

  // Heute und diese Woche
  const myEntries = me ? (data.timeEntries || []).filter(e => e.employeeId === me.id) : [];
  const todays = myEntries.filter(e => e.date === today).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const monday = addDays(today, -((new Date(today + "T12:00:00").getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekMins = myEntries.filter(e => e.date >= monday && e.date <= weekDays[6]).reduce((s, e) => s + (e.minutes || 0), 0)
    + (timer && timer.employeeId === me?.id ? Math.round(timerElapsedMs(timer, now) / 60000) : 0);
  const weekSoll = me ? weekDays.reduce((s, d) => s + getSollForDay(data, me, d), 0) : 0;
  const todaySoll = me ? getSollForDay(data, me, today) : 0;

  const tasks = me ? openTasks(data.protocols || [], employees, today, { employeeId: me.id }).slice(0, 8) : [];
  const agenda = weekAgenda(data, today, 8, { employeeId: me?.id }).slice(0, 9);

  // Rechnungsvorschläge: laufende Stundensatz-Projekte mit mindestens 8 unverrechneten Stunden
  const invoiceHints = can("invoices") ? activeProjects.filter(p => (p.billingType || "stundensatz") === "stundensatz" && !NON_BILLING_CATEGORIES.includes(p.category as string)).map(p => ({
    p, mins: (data.timeEntries || []).filter(e => e.projectId === p.id && !e.invoiceId).reduce((s, e) => s + (e.minutes || 0), 0),
  })).filter(x => x.mins >= 8 * 60).sort((a, b) => b.mins - a.mins).slice(0, 2) : [];

  const doneTask = (t: (typeof tasks)[number]) => {
    changeWithUndo("Pendenz erledigt", prev => ({ ...prev, protocols: setLinkedStatus(prev.protocols || [], t.projectId, { protocolId: t.protocolId, entryId: t.entryId, kind: "aufgabe", text: t.textKey }, true) }));
  };

  const hour = now.getHours();
  const greet = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  const firstName = (me?.name || currentUser?.displayName || currentUser?.username || "").split(/\s+/)[0];
  const dateLabel = new Date(today + "T12:00:00").toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" });

  // Büro-Zahlen
  const showOffice = can("invoices");
  const open = (data.invoices || []).filter(i => i.status === "gesendet" || i.status === "überfällig");
  const overdue = open.filter(i => i.status === "überfällig").length;
  // Umsatz wie Übersicht und Buchhaltung: gestellte Rechnungen (ohne Entwürfe) nach Rechnungsdatum, netto
  const yearPaid = yearRevenue(data.invoices || [], today.slice(0, 4));
  // wie Übersicht/Akquise: ohne Wiedervorlagen abgeschlossener Leads und gelöschter Kontakte (Review R32)
  const followUps = dueFollowUps(data, today).filter(a => (a.followUpDate as string) <= today).length;
  const monthMins = (data.timeEntries || []).filter(e => e.date.startsWith(today.slice(0, 7))).reduce((s, e) => s + (e.minutes || 0), 0);

  const startForm = (
    <div className="today-form">
      {!linkedEmp && !canPick && <div style={{ fontSize: 12, color: "var(--text4)" }}>Login nicht mit einer Person verknüpft — bitte beim Admin melden.</div>}
      {!linkedEmp && canPick && (
        <select value={pickedEmpId} onChange={e => setPickedEmpId(e.target.value)} aria-label="Person">
          <option value="">Für wen? (Login nicht mit Person verknüpft)</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
      <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value, phaseId: "" })} aria-label="Projekt">
        <option value="">Projekt wählen …</option>
        {activeProjects.map(p => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
      </select>
      {form.projectId && projectPhases(data, form.projectId).length > 0 && (
        <select value={form.phaseId} onChange={e => setForm({ ...form, phaseId: e.target.value })} aria-label="Phase">
          <option value="">Phase (optional)</option>
          {projectPhases(data, form.projectId).map(ph => <option key={ph.id} value={ph.id}>{ph.label}</option>)}
        </select>
      )}
      <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Tätigkeit (optional)"
        onKeyDown={e => { if (e.key === "Enter") start(); }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={!me || !form.projectId} onClick={start}><span className="msr" style={{ fontSize: 18 }}>play_arrow</span>{timer ? "Wechseln" : "Start"}</button>
        {switching && <button className="btn btn-ghost" onClick={() => setSwitching(false)}>Abbrechen</button>}
      </div>
    </div>
  );

  return (
    <div className="today">
      <button className="today-search" onClick={onOpenPalette}>
        <span className="msr">search</span>
        <span>Suchen oder Befehl, z. B. Projekt, Rechnung, Kontakt oder «Neue Offerte»</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="today-head">
        <div>
          <h1>{greet}{firstName ? `, ${firstName}` : ""}</h1>
          <div className="today-sub">{dateLabel} · {getKW(today)}{me ? ` · heute ${todaySoll.toFixed(1).replace(".0", "")} h Soll` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can("time") && <button className="btn btn-ghost" onClick={() => run({ kind: "view", view: "time" })}><span className="msr" style={{ fontSize: 17 }}>calendar_view_week</span>Zeiterfassung</button>}
          {can("expenses") && <button className="btn btn-ghost" onClick={() => run({ kind: "view", view: "expenses" })}><span className="msr" style={{ fontSize: 17 }}>receipt</span>Spese</button>}
        </div>
      </div>

      <div className="today-grid">
        {/* ── Stoppuhr und heute ── */}
        <section className={`card today-timer${timer ? " running" : ""}`}>
          {timer ? (
            <>
              <div className="today-k">Läuft gerade <span className="today-live">● seit {new Date(timer.start).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}</span></div>
              <button className="today-proj" onClick={() => run({ kind: "project", id: timer.projectId })}>{projectName(timer.projectId)}</button>
              <div className="today-meta">{[phaseLabel(timer.projectId, timer.phaseId), timer.description].filter(Boolean).join(" · ") || "ohne Tätigkeit"}</div>
              <div className="today-clock">{formatElapsed(timerElapsedMs(timer, now))}</div>
              {switching ? startForm : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => stop(timer)}><span className="msr" style={{ fontSize: 18 }}>stop</span>Stopp</button>
                  <button className="btn btn-ghost" onClick={() => setSwitching(true)}><span className="msr" style={{ fontSize: 18 }}>swap_horiz</span>Wechseln</button>
                  <button className="btn btn-quiet" onClick={() => { setTimer(null); showToast("Stoppuhr verworfen"); }} title="Ohne Eintrag verwerfen">Verwerfen</button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="today-k">Stoppuhr</div>
              {employees.length === 0
                ? <div className="today-meta">Zuerst unter «Mitarbeiter» Personen erfassen.</div>
                : startForm}
            </>
          )}

          <div className="today-k" style={{ marginTop: 22 }}>Heute <span className="num">{formatHours(todays.reduce((s, e) => s + (e.minutes || 0), 0))}</span></div>
          <div className="today-list">
            {todays.length === 0 && !timer && <div className="today-meta">Noch nichts erfasst.</div>}
            {todays.map(e => (
              <button key={e.id} className="today-row" onClick={() => run({ kind: "view", view: "time" })}>
                <span className="num today-time">{e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "—"}</span>
                <span className="today-what">{projectName(e.projectId)}{e.description ? ` · ${e.description}` : ""}</span>
                <b className="num">{formatHours(e.minutes)}</b>
              </button>
            ))}
            {timer && (
              <div className="today-row live">
                <span className="num today-time">{new Date(timer.start).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}–läuft</span>
                <span className="today-what">{projectName(timer.projectId)}{timer.description ? ` · ${timer.description}` : ""}</span>
                <b>…</b>
              </div>
            )}
          </div>
          {me && (
            <div className="today-week">
              <span>Woche <b className="num">{formatHours(weekMins)}</b> von {weekSoll.toFixed(1).replace(".0", "")} h</span>
              <span className="today-bar"><i style={{ width: `${Math.min(100, weekSoll > 0 ? (weekMins / 60 / weekSoll) * 100 : 0)}%` }} /></span>
            </div>
          )}
        </section>

        {/* ── Pendenzen ── */}
        <section className="card">
          <div className="today-k">Meine Pendenzen <span>{tasks.length > 0 ? "aus Protokollen" : ""}</span></div>
          {tasks.length === 0 && invoiceHints.length === 0 && (
            <EmptyState icon="task_alt" title="Keine offenen Pendenzen" text={me ? "Aufgaben aus Protokollen, bei denen du unter «Wer» stehst, erscheinen hier." : "Mit einer Person verknüpfen, um eigene Pendenzen zu sehen."} />
          )}
          {tasks.map(t => (
            <div key={t.key} className="task-row">
              <button className={`chk${t.overdue ? " late" : ""}`} onClick={() => doneTask(t)} title="Erledigt" aria-label={`«${t.label}» erledigt`} />
              <button className="task-text" onClick={() => window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: t.protocolId } }))}>
                {t.label}
                <span className="today-meta">{projectName(t.projectId)} · {t.protocolLabel}</span>
              </button>
              {t.due && <span className={`today-pill${t.overdue ? " late" : t.due <= addDays(today, 7) ? " soon" : ""}`}>{t.overdue ? "überfällig" : `${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.`}</span>}
            </div>
          ))}
          {invoiceHints.map(h => (
            <div key={h.p.id} className="task-row">
              <span className="msr" style={{ fontSize: 18, color: "var(--accent)", marginTop: 1 }}>receipt_long</span>
              <button className="task-text" onClick={() => run({ kind: "action", action: "newInvoice" })}>
                Rechnung {h.p.name}
                <span className="today-meta">{formatHours(h.mins)} unverrechnet</span>
              </button>
              <span className="today-pill">Vorschlag</span>
            </div>
          ))}
        </section>

        {/* ── Termine und Büro ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <section className="card">
            <div className="today-k">Nächste Tage</div>
            {agenda.length === 0 && <div className="today-meta">Keine Termine in den nächsten Tagen.</div>}
            {agenda.map((a, i) => (
              <button key={i} className="agenda-row" onClick={() => a.projectId && run({ kind: "project", id: a.projectId })} disabled={!a.projectId}>
                <span className="agenda-glyph">{a.glyph}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="agenda-label">{a.label}</span>
                  <span className="today-meta">{new Date(a.date + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" })}{a.projectName ? ` · ${a.projectName}` : ""}</span>
                </span>
              </button>
            ))}
          </section>
          {showOffice && (
            <section className="card">
              <div className="today-k">Büro <button className="btn-quiet btn btn-sm" onClick={() => run({ kind: "view", view: "dashboard" })}>Übersicht →</button></div>
              <div className="office-figs">
                <div><span>Ausstehend</span><b className="num">{chf0(open.reduce((s, i) => s + (i.total || 0), 0))}</b>{overdue > 0 && <em className="late">{overdue} überfällig</em>}</div>
                <div><span>Umsatz {today.slice(0, 4)}</span><b className="num">{chf0(yearPaid)}</b></div>
                <div><span>Wiedervorlagen</span><b className={followUps > 0 ? "warn" : ""}>{followUps > 0 ? `${followUps} fällig` : "keine"}</b></div>
                <div><span>Büro gesamt {new Date(today + "T12:00:00").toLocaleDateString("de-CH", { month: "short" })}</span><b className="num">{formatHours(monthMins)}</b></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
