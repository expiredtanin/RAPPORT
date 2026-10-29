// Zeiterfassung, Tagesansicht: Tabelle der Zeiteinträge mit Tagestotal/Soll sowie die Blöcke Absenzen und Spesen.

import type { RefObject, ChangeEvent } from "react";
import { SIA_PHASES, EXPENSE_CATEGORIES } from "../../constants";
import { formatHours } from "../../utils";
import type { AppData, Absence, Employee, Expense, TimeEntry } from "../../types";
import { getFirstPhaseForProject } from "./timeUtils";

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
  absenzTypes: { id: string; label: string }[];
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
}

/** Tagesliste: Einträge bearbeiten, Absenzen und Spesen des gewählten Tages erfassen. */
export function DayView({ data, selectedEmp, dayEntries, dayTotalMins, daySoll, dayIst, dayDiff, isMonthClosed, updateEntry, delEntry, addEntry, dayAbs, absenzTypes, updateAbs, delAbs, addAbs, dayExpenses, updateExp, delExp, addExp, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload }: DayViewProps) {
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: "24%" }}>Projekt</th>
              <th style={{ width: 130 }}>Phase / Position</th>
              <th>Tätigkeit</th>
              <th style={{ width: 80 }}>Std</th>
              <th style={{ width: 80 }}>Min</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {dayEntries.length === 0 && (
              <tr><td colSpan={6} className="empty-state">Keine Einträge an diesem Tag</td></tr>
            )}
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
              return (
                <tr key={e.id} style={isInvoiced ? { opacity: 0.6, background: "#f5f2ed" } : {}}>
                  <td style={{ padding: "6px 8px" }}>
                    <select disabled={disabled} value={e.projectId} onChange={ev => { const proj = data.projects.find(p => p.id === ev.target.value); const { phaseId, positionId } = getFirstPhaseForProject(proj); updateEntry(e.id, { projectId: ev.target.value, phaseId, positionId }); }} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                      <option value="">—</option>
                      {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <select disabled={disabled || !hasAnyPhase} value={combinedVal} onChange={ev => onCombinedChange(ev.target.value)} style={{ border: `1px solid ${hasAnyPhase && !combinedVal && !disabled ? "var(--warning)" : "#e0dbd4"}`, height: 32, fontSize: 12, color: e.positionId ? "var(--pending)" : "inherit", fontWeight: e.positionId ? 600 : 400, opacity: !hasAnyPhase ? 0.4 : 1 }}>
                      <option value="">—</option>
                      {customPhases.length > 0 && (enabledPhases.length > 0 || positions.length > 0) && (<optgroup label="Eigene Phasen">{customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}</optgroup>)}
                      {customPhases.length > 0 && enabledPhases.length === 0 && positions.length === 0 && customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                      {positions.length === 0 && enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                      {positions.length > 0 && (<>{enabledPhases.length > 0 && (<optgroup label="Hauptauftrag">{enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>)}{positions.map(pos => { const pp = (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph); if(!pp.length) return null; return <optgroup key={pos.code} label={pos.code+(pos.label?" · "+pos.label:"")}>{pp.map(ph=><option key={ph.id} value={ph.id+"|"+pos.code}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}</optgroup>; })}</>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input disabled={disabled} value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} placeholder="Was wurde gemacht?" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input disabled={disabled} type="number" min={0} max={24} value={Math.floor((e.minutes || 0) / 60)} onChange={ev => updateEntry(e.id, { minutes: (+ev.target.value * 60) + ((e.minutes || 0) % 60) })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <select disabled={disabled} value={(e.minutes || 0) % 60} onChange={ev => updateEntry(e.id, { minutes: Math.floor((e.minutes || 0) / 60) * 60 + +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                      {[0, 15, 30, 45].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    <button disabled={disabled} className="btn btn-sm btn-danger" onClick={() => delEntry(e.id)}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ padding: "12px 12px" }}>
                <button className="btn btn-ghost" onClick={addEntry} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button>
              </td>
              <td colSpan={2} style={{ padding: "12px 8px", textAlign: "right", fontSize: 13 }}>
                <span style={{ color: "var(--text4)" }}>Tagestotal:&nbsp;</span><strong>{formatHours(dayTotalMins)}</strong>
              </td>
              <td></td>
            </tr>
            {selectedEmp && (daySoll > 0 || dayTotalMins > 0) && (
              <tr style={{ borderTop: "1px solid var(--border2)", background: "var(--surface2)" }}>
                <td colSpan={3} style={{ padding: "6px 12px", fontSize: 11, color: "var(--text4)" }}>{selectedEmp.name}{daySoll === 0 ? " · Wochenende / Feiertag" : " · Soll heute"}</td>
                <td colSpan={2} style={{ padding: "6px 8px", textAlign: "right", fontSize: 12 }}>
                  {daySoll > 0 ? (<><span style={{ color: "var(--text4)" }}>{Math.round(daySoll * 10) / 10}h Soll&nbsp;·&nbsp;</span><span style={{ fontWeight: 600, color: dayDiff === 0 ? "var(--text2)" : dayDiff > 0 ? "var(--positive)" : "var(--negative)" }}>{dayDiff === 0 ? "±0h" : `${dayDiff > 0 ? "+" : ""}${dayDiff}h`}</span></>) : (<span style={{ fontWeight: 600, color: "#b07848" }}>{Math.round(dayIst * 10) / 10}h</span>)}
                </td>
                <td></td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {dayAbs.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>ABSENZEN</div>
          <table style={{ fontSize: 12 }}>
            <thead><tr><th style={{ width: "22%" }}>Typ</th><th>Bemerkung</th><th style={{ width: 70 }}>Std</th><th style={{ width: 70 }}>Min</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {dayAbs.map(a => {
                const absTotalMins = a.startTime && a.endTime
                  ? (() => { const [sh,sm]=a.startTime.split(":").map(Number); const [eh,em]=(a.endTime as string).split(":").map(Number); return Math.max(0,(eh*60+em)-(sh*60+sm)); })()
                  : (a.hours||0)*60+(a.minutes||0);
                const absH = Math.floor(absTotalMins / 60);
                const absM = absTotalMins % 60;
                return (
                  <tr key={a.id}>
                    <td style={{ padding: "6px 8px" }}>
                      <select value={a.type || ""} onChange={ev => updateAbs(a.id, { type: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                        {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input value={a.note || ""} onChange={ev => updateAbs(a.id, { note: ev.target.value })} placeholder="Bemerkung…" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="number" min={0} max={24} value={absH} onChange={ev => updateAbs(a.id, { hours: +ev.target.value, minutes: absM })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select value={absM} onChange={ev => updateAbs(a.id, { hours: absH, minutes: +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>
                        {[0, 15, 30, 45].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      <button className="btn btn-danger" style={{ padding: "0 8px", height: 28, fontSize: 12 }} onClick={() => delAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={4} style={{ padding: "10px 12px" }}><button className="btn btn-ghost" onClick={addAbs} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button></td><td></td></tr></tfoot>
          </table>
        </div>
      )}

      {dayAbs.length === 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px", background: "var(--surface)" }} onClick={addAbs}>+ Absenz erfassen</button>
        </div>
      )}

      {dayExpenses.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>SPESEN</div>
          <input ref={expReceiptInputRef} type="file" accept="image/*,application/pdf" onChange={handleExpReceiptUpload} style={{ display: "none" }} />
          <table style={{ fontSize: 12 }}>
            <thead><tr><th style={{ width: "22%" }}>Kategorie</th><th style={{ width: "20%" }}>Projekt</th><th>Beschreibung</th><th style={{ width: 90 }}>Betrag CHF</th><th style={{ width: 36, textAlign: "center" }}>Beleg</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {dayExpenses.map(e => (
                <tr key={e.id}>
                  <td style={{ padding: "6px 8px" }}><select value={e.category} onChange={ev => updateExp(e.id, { category: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}>{(data.settings.expenseCategories || EXPENSE_CATEGORIES).map(c => <option key={c}>{c}</option>)}</select></td>
                  <td style={{ padding: "6px 8px" }}><select value={e.projectId || ""} onChange={ev => updateExp(e.id, { projectId: ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }}><option value="">— kein Projekt —</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                  <td style={{ padding: "6px 8px" }}><input value={e.description || ""} onChange={ev => updateExp(e.id, { description: ev.target.value })} placeholder="Beschreibung…" style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} /></td>
                  <td style={{ padding: "6px 8px" }}><input type="number" step="0.05" min={0} value={e.amount || ""} onChange={ev => updateExp(e.id, { amount: +ev.target.value })} style={{ border: "1px solid var(--border)", height: 32, fontSize: 12 }} /></td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    {e.receiptData ? (
                      <button className="btn btn-ghost" title={e.receiptName || "Beleg anzeigen"} onClick={() => setReceiptView(e)} style={{ padding: "0 6px", height: 28 }}>
                        <span className="msr" style={{ fontSize: 16, verticalAlign: "middle", color: "var(--positive)" }}>receipt_long</span>
                      </button>
                    ) : (
                      <button className="btn btn-ghost" title="Beleg hochladen" onClick={() => { setUploadingExpId(e.id); expReceiptInputRef.current?.click(); }} style={{ padding: "0 6px", height: 28 }}>
                        <span className="msr" style={{ fontSize: 16, verticalAlign: "middle", color: "var(--text5)" }}>upload</span>
                      </button>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}><button className="btn btn-danger" style={{ padding: "0 8px", height: 28, fontSize: 12 }} onClick={() => delExp(e.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} style={{ padding: "10px 12px" }}><button className="btn btn-ghost" onClick={addExp} style={{ fontSize: 12 }}>+ Zeile hinzufügen</button></td><td style={{ padding: "10px 8px", textAlign: "right", fontSize: 13 }}><span style={{ color: "var(--text4)" }}>Total:&nbsp;</span><strong>{(dayExpenses.reduce((s, e) => s + (e.amount || 0), 0)).toFixed(2)}</strong></td><td></td></tr></tfoot>
          </table>
        </div>
      )}

      {dayExpenses.length === 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 12px", background: "var(--surface)" }} onClick={addExp}>+ Spese erfassen</button>
        </div>
      )}
    </>
  );
}
