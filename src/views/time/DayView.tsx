// Zeiterfassung, Tagesansicht: Liste der Zeiteinträge (Zeilen wie auf «Heute», Felder erst beim Überfahren
// umrandet) mit Tagestotal/Soll, darunter Absenzen und Spesen des Tages. Gestaltung in time.css.

import type { RefObject, ChangeEvent, CSSProperties } from "react";
import { SIA_PHASES, EXPENSE_CATEGORIES } from "../../constants";
import { formatHours } from "../../utils";
import type { RunningTimer } from "../../today";
import type { AppData, Absence, Employee, Expense, TimeEntry } from "../../types";
import { getFirstPhaseForProject } from "./timeUtils";
import { projectColor } from "./projectColor";

/** Props der Tagesansicht: Daten des Tages und die Aktionen aus Time.tsx. */
interface DayViewProps {
  data: AppData;
  selectedEmp: Employee | null;
  dayEntries: TimeEntry[];
  dayTotalMins: number;
  daySoll: number;
  dayIst: number;
  dayDiff: number;
  isMonthClosed: (date?: string) => boolean;
  updateEntry: (id: string, changes: Partial<TimeEntry>) => void;
  delEntry: (id: string) => void;
  addEntry: () => void;
  dayAbs: Absence[];
  absenzTypes: { id: string; label: string; color?: string }[];
  updateAbs: (id: string, changes: Partial<Absence>) => void;
  delAbs: (id: string) => void;
  addAbs: () => void;
  dayExpenses: Expense[];
  updateExp: (id: string, changes: Partial<Expense>) => void;
  delExp: (id: string) => void;
  addExp: () => void;
  setReceiptView: (e: Expense | null) => void;
  setUploadingExpId: (id: string | null) => void;
  expReceiptInputRef: RefObject<HTMLInputElement | null>;
  handleExpReceiptUpload: (ev: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  /** Laufende Stoppuhr, falls sie an diesem Tag für diese Person läuft (sonst null) */
  liveTimer?: RunningTimer | null;
  now?: Date;
}

/** «7.5» bzw. «8» (eine Dezimale, ohne «.0»). */
const h1 = (h: number) => { const r = Math.round(h * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };

/** Löschknopf einer Zeile. */
function DelBtn({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button className="btn-icon x" disabled={disabled} onClick={onClick} title={label} aria-label={label}>
      <span className="msr" style={{ fontSize: 18 }}>close</span>
    </button>
  );
}

/** Tagesliste: Einträge bearbeiten, Absenzen und Spesen des gewählten Tages erfassen. */
export function DayView({ data, selectedEmp, dayEntries, dayTotalMins, daySoll, dayIst, dayDiff, isMonthClosed, updateEntry, delEntry, addEntry, dayAbs, absenzTypes, updateAbs, delAbs, addAbs, dayExpenses, updateExp, delExp, addExp, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload, liveTimer, now }: DayViewProps) {
  const liveMins = liveTimer && now ? Math.max(0, Math.round((now.getTime() - new Date(liveTimer.start).getTime()) / 60000)) : 0;
  const under = daySoll > 0 && dayDiff < -0.5;
  const expTotal = dayExpenses.reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <div className="card zeit-day">
      {/* ── Einträge ── */}
      <section className="zeit-day-sec">
        <div className="zeit-k">
          Einträge
          <button className="btn btn-ghost btn-sm" onClick={addEntry}><span className="msr" style={{ fontSize: 16 }}>add</span>Eintrag</button>
        </div>
        <div className="zeit-list">
          {dayEntries.length === 0 && !liveTimer && <div className="zeit-empty">Keine Einträge an diesem Tag.</div>}
          {dayEntries.map(e => {
            const proj = data.projects.find(p => p.id === e.projectId);
            const projEnabledIds = proj?.enabledPhases || [];
            const enabledPhases = projEnabledIds.map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
            const positions = proj?.positions || [];
            const customPhases = proj?.customPhases || [];
            const isInvoiced = !!e.invoiceId;
            const disabled = isInvoiced || isMonthClosed(e.date);
            const hasAnyPhase = enabledPhases.length > 0 || customPhases.length > 0 || positions.some(pos => (pos.enabledPhases || []).length > 0);
            const combinedVal = e.phaseId ? (e.positionId ? e.phaseId + "|" + e.positionId : e.phaseId) : "";
            const onCombinedChange = (val: string) => {
              if (!val) { updateEntry(e.id, { phaseId: "", positionId: "" }); return; }
              const [ph, pos] = val.split("|");
              updateEntry(e.id, { phaseId: ph, positionId: pos || "" });
            };
            const pc = e.projectId ? projectColor(e.projectId) : null;
            const phaseCls = [hasAnyPhase && !combinedVal && !disabled && "need", e.positionId && "pos"].filter(Boolean).join(" ");
            return (
              <div key={e.id} className={`zeit-drow entry${disabled ? " is-locked" : ""}`} style={pc ? { "--pc-solid": pc.solid } as CSSProperties : undefined}
                title={isInvoiced ? "Bereits verrechnet — nicht mehr änderbar" : disabled ? "Monat abgeschlossen" : undefined}>
                <span className="s" />
                <span className="t">{e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "—"}</span>
                <select className="p" aria-label="Projekt" disabled={disabled} value={e.projectId} onChange={ev => { const proj = data.projects.find(p => p.id === ev.target.value); const { phaseId, positionId } = getFirstPhaseForProject(proj); updateEntry(e.id, { projectId: ev.target.value, phaseId, positionId }); }} style={{ fontWeight: 550 }}>
                  <option value="">Projekt …</option>
                  {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className={`ph ${phaseCls}`} aria-label="Phase / Position" disabled={disabled || !hasAnyPhase} value={combinedVal} onChange={ev => onCombinedChange(ev.target.value)} style={!hasAnyPhase ? { opacity: 0.45 } : undefined}>
                  <option value="">Phase …</option>
                  {customPhases.length > 0 && (enabledPhases.length > 0 || positions.length > 0) && (<optgroup label="Eigene Phasen">{customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}</optgroup>)}
                  {customPhases.length > 0 && enabledPhases.length === 0 && positions.length === 0 && customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                  {positions.length === 0 && enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                  {positions.length > 0 && (<>{enabledPhases.length > 0 && (<optgroup label="Hauptauftrag">{enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>)}{positions.map(pos => { const pp = (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph); if(!pp.length) return null; return <optgroup key={pos.code} label={pos.code+(pos.label?" · "+pos.label:"")}>{pp.map(ph=><option key={ph.id} value={ph.id+"|"+pos.code}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>; })}</>)}
                </select>
                <input className="d" aria-label="Tätigkeit" disabled={disabled} value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} placeholder="Was wurde gemacht?" />
                <input className="h" aria-label="Stunden" title="Stunden" disabled={disabled} type="number" min={0} max={24} value={Math.floor((e.minutes || 0) / 60)} onChange={ev => updateEntry(e.id, { minutes: (+ev.target.value * 60) + ((e.minutes || 0) % 60) })} />
                <select className="m" aria-label="Minuten" title="Minuten" disabled={disabled} value={(e.minutes || 0) % 60} onChange={ev => updateEntry(e.id, { minutes: Math.floor((e.minutes || 0) / 60) * 60 + +ev.target.value })}>
                  {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}′</option>)}
                </select>
                <DelBtn disabled={disabled} onClick={() => delEntry(e.id)} label="Eintrag löschen" />
              </div>
            );
          })}
          {liveTimer && (
            <div className="zeit-drow live" title="Stoppuhr läuft — stoppen unter «Heute»">
              <span className="s" />
              <span className="t">{new Date(liveTimer.start).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}–läuft</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b style={{ fontWeight: 600 }}>{data.projects.find(p => p.id === liveTimer.projectId)?.name || "—"}</b>
                {liveTimer.description ? <span style={{ color: "var(--text4)" }}> · {liveTimer.description}</span> : null}
              </span>
              <span className="num" style={{ color: "var(--accent)", fontWeight: 600, paddingRight: 8, display: "inline-flex", alignItems: "center", gap: 6 }}><span className="zeit-pulse" />{formatHours(liveMins)}</span>
            </div>
          )}
        </div>

        <div className={`zeit-day-foot${under ? " under" : ""}`}>
          <span>Total <b className="num">{formatHours(dayTotalMins)}</b></span>
          {selectedEmp && daySoll > 0 && (
            <>
              <span className="zeit-bar"><i style={{ width: `${Math.min(100, (dayIst / daySoll) * 100)}%` }} /></span>
              <span className="num">Soll {h1(daySoll)} h</span>
              <span className={`num zeit-diff${dayDiff >= 0.5 ? " pos" : under ? " neg" : ""}`}>{dayDiff === 0 ? "±0 h" : `${dayDiff > 0 ? "+" : "−"}${h1(Math.abs(dayDiff))} h`}</span>
            </>
          )}
          {selectedEmp && daySoll === 0 && <span style={{ color: "var(--text4)" }}>kein Soll (Wochenende, Feiertag oder Ferien)</span>}
        </div>
      </section>

      {/* ── Absenzen ── */}
      {dayAbs.length > 0 && (
        <section className="zeit-day-sec">
          <div className="zeit-k">
            Absenzen
            <button className="btn btn-quiet btn-sm" onClick={addAbs}><span className="msr" style={{ fontSize: 16 }}>add</span>Absenz</button>
          </div>
          <div className="zeit-list">
            {dayAbs.map(a => {
              const absTotalMins = a.startTime && a.endTime
                ? (() => { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return Math.max(0,(eh*60+em)-(sh*60+sm)); })()
                : (a.hours||0)*60+(a.minutes||0);
              const absH = Math.floor(absTotalMins / 60);
              const absM = absTotalMins % 60;
              const color = absenzTypes.find(t => t.id === a.type)?.color;
              return (
                <div key={a.id} className="zeit-drow abs" style={color ? { "--pc-solid": color } as CSSProperties : undefined}
                  title={a.status === "pending" ? "Beantragt — noch nicht bewilligt" : undefined}>
                  <span className="s" />
                  <select className="p" aria-label="Absenztyp" value={a.type || ""} onChange={ev => updateAbs(a.id, { type: ev.target.value })} style={{ fontWeight: 550 }}>
                    {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <input className="d" aria-label="Bemerkung" value={a.note || ""} onChange={ev => updateAbs(a.id, { note: ev.target.value })} placeholder="Bemerkung …" />
                  <input className="h" aria-label="Stunden" title="Stunden" type="number" min={0} max={24} value={absH} onChange={ev => updateAbs(a.id, { hours: +ev.target.value, minutes: absM })} />
                  <select className="m" aria-label="Minuten" title="Minuten" value={absM} onChange={ev => updateAbs(a.id, { hours: absH, minutes: +ev.target.value })}>
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}′</option>)}
                  </select>
                  <DelBtn onClick={() => delAbs(a.id)} label="Absenz löschen" />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Spesen ── */}
      {dayExpenses.length > 0 && (
        <section className="zeit-day-sec">
          <div className="zeit-k">
            <span style={{ textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Spesen</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="num" style={{ color: "var(--text3)" }}>CHF <b style={{ color: "var(--text)" }}>{expTotal.toFixed(2)}</b></span>
              <button className="btn btn-quiet btn-sm" onClick={addExp}><span className="msr" style={{ fontSize: 16 }}>add</span>Spese</button>
            </span>
          </div>
          <div className="zeit-list">
            {dayExpenses.map(e => (
              <div key={e.id} className="zeit-drow exp" style={e.projectId ? { "--pc-solid": projectColor(e.projectId).solid } as CSSProperties : undefined}>
                <span className="s" />
                <select className="p" aria-label="Kategorie" value={e.category} onChange={ev => updateExp(e.id, { category: ev.target.value })} style={{ fontWeight: 550 }}>{(data.settings.expenseCategories || EXPENSE_CATEGORIES).map(c => <option key={c}>{c}</option>)}</select>
                <select className="ph" aria-label="Projekt" value={e.projectId || ""} onChange={ev => updateExp(e.id, { projectId: ev.target.value })}><option value="">kein Projekt</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input className="d" aria-label="Beschreibung" value={e.description || ""} onChange={ev => updateExp(e.id, { description: ev.target.value })} placeholder="Beschreibung …" />
                <input className="h" aria-label="Betrag CHF" title="Betrag CHF" type="number" step="0.05" min={0} value={e.amount || ""} onChange={ev => updateExp(e.id, { amount: +ev.target.value })} placeholder="CHF" style={{ textAlign: "right" }} />
                {e.receiptData ? (
                  <button className="btn-icon rcpt r" title={e.receiptName || "Beleg anzeigen"} aria-label="Beleg anzeigen" onClick={() => setReceiptView(e)}>
                    <span className="msr ok" style={{ fontSize: 18 }}>receipt_long</span>
                  </button>
                ) : (
                  <button className="btn-icon rcpt r" title="Beleg hochladen" aria-label="Beleg hochladen" onClick={() => { setUploadingExpId(e.id); expReceiptInputRef.current?.click(); }}>
                    <span className="msr" style={{ fontSize: 18 }}>upload</span>
                  </button>
                )}
                <DelBtn onClick={() => delExp(e.id)} label="Spese löschen" />
              </div>
            ))}
          </div>
        </section>
      )}
      {/* Das Datei-Feld bleibt immer im DOM, damit «Beleg hochladen» auch direkt nach dem Anlegen funktioniert */}
      <input ref={expReceiptInputRef} type="file" accept="image/*,application/pdf" onChange={handleExpReceiptUpload} style={{ display: "none" }} />

      {(dayAbs.length === 0 || dayExpenses.length === 0) && (
        <div className="zeit-day-more">
          {dayAbs.length === 0 && <button className="btn btn-quiet btn-sm" onClick={addAbs}><span className="msr" style={{ fontSize: 16 }}>add</span>Absenz erfassen</button>}
          {dayExpenses.length === 0 && <button className="btn btn-quiet btn-sm" onClick={addExp}><span className="msr" style={{ fontSize: 16 }}>add</span>Spese erfassen</button>}
        </div>
      )}
    </div>
  );
}
