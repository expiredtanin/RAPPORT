// Zeiterfassung, Wochenansicht: Formular unter dem Raster für neue Einträge/Absenzen, Hinweis zur Zeitauswahl und
// Bearbeitungsformular für einen bestehenden Eintrag oder eine Absenz.

import { SIA_PHASES } from "../../constants";
import type { AppData, TimeEntry, UpdateFn } from "../../types";
import { PROJ_COLORS, slotToTime, getFirstPhaseForProject, type SlotPoint, type WeekForm, type WeekEditForm } from "./timeUtils";

/** Props der Formulare unter dem Wochenraster. */
interface WeekFormsProps {
  data: AppData;
  update: UpdateFn;
  weekSelectStart: SlotPoint | null;
  setWeekSelectStart: (p: SlotPoint | null) => void;
  weekForm: WeekForm | null;
  setWeekForm: (f: WeekForm | null) => void;
  weekEditForm: WeekEditForm | null;
  setWeekEditForm: (f: WeekEditForm | null) => void;
  absenzTypes: { id: string; label: string; color?: string }[];
  saveWeekEntry: () => void;
  updateEntry: (id: string, changes: Partial<TimeEntry>) => void;
  delEntry: (id: string) => void;
  isMonthClosed: (date?: string) => boolean;
}

/** Auswahl-Hinweis, Erfassungsformular und Bearbeitungsformular der Wochenansicht. */
export function WeekForms({ data, update, weekSelectStart, setWeekSelectStart, weekForm, setWeekForm, weekEditForm, setWeekEditForm, absenzTypes, saveWeekEntry, updateEntry, delEntry, isMonthClosed }: WeekFormsProps) {
  return (
    <>
      {weekSelectStart && !weekForm && (
        <div style={{ borderTop: "1px solid var(--border2)", padding: "8px 16px 8px 56px", fontSize: 11, color: "var(--text4)", background: "var(--surface2)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>{slotToTime(weekSelectStart.slotIdx)}</span>
          <span>ausgewählt — Endzeit anklicken</span>
          <button className="btn btn-ghost" onClick={() => setWeekSelectStart(null)} style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px" }}>Abbrechen</button>
        </div>
      )}

      {weekForm && (() => {
        const isAbsMode = weekForm.mode === "absenz";
        const accentColor = isAbsMode ? (absenzTypes.find(t => t.id === weekForm.absType)?.color || "#6b5a8a") : "var(--accent)";
        const proj = data.projects.find(p => p.id === weekForm.projectId);
        const enabledPhases = (proj?.enabledPhases||[]).map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
        const customPhases = proj?.customPhases || [];
        const positions = proj?.positions || [];
        const hasPhase = enabledPhases.length > 0 || customPhases.length > 0 || positions.some(pos => (pos.enabledPhases||[]).length > 0);
        const combinedVal = weekForm.phaseId ? (weekForm.positionId ? weekForm.phaseId+"|"+weekForm.positionId : weekForm.phaseId) : "";
        const onPhaseChange = (val: string) => { if (!val) { setWeekForm({...weekForm, phaseId:"", positionId:""}); return; } const [ph,pos]=val.split("|"); setWeekForm({...weekForm, phaseId:ph, positionId:pos||""}); };
        const mins = (weekForm.endSlot - weekForm.startSlot + 1) * 15;
        return (
          <div style={{ borderTop: `2px solid ${accentColor}`, padding: "12px 16px", background: "var(--surface2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", color: accentColor, fontWeight: 600 }}>
                {new Date(weekForm.dayStr).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {slotToTime(weekForm.startSlot)} – {slotToTime(weekForm.endSlot + 1)} · {mins >= 60 ? `${mins%60===0?mins/60:(mins/60).toFixed(1)}h` : `${mins} min`}
              </div>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
                {[["projekt", "Projekt"], ["absenz", "Intern / Absenz"]].map(([m, label]) => (
                  <button key={m} className={`pill${weekForm.mode === m ? " active" : ""}`} onClick={() => setWeekForm({ ...weekForm, mode: m })}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              {isAbsMode ? (
                <>
                  <div style={{ flex: "1 1 180px" }}>
                    <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TYP</div>
                    <select value={weekForm.absType || ""} onChange={e => setWeekForm({ ...weekForm, absType: e.target.value })} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                      <option value="">— wählen —</option>
                      {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "2 1 180px" }}>
                    <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>NOTIZ</div>
                    <input value={weekForm.absNote || ""} onChange={e => setWeekForm({ ...weekForm, absNote: e.target.value })} placeholder="Notiz…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && saveWeekEntry()} />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ flex: "1 1 150px" }}>
                    <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PROJEKT</div>
                    <select value={weekForm.projectId} onChange={e => { const proj = data.projects.find(p => p.id === e.target.value); const { phaseId, positionId } = getFirstPhaseForProject(proj); setWeekForm({...weekForm, projectId:e.target.value, phaseId, positionId: positionId || ""}); }} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                      <option value="">— wählen —</option>
                      {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  {hasPhase && (
                    <div style={{ flex: "1 1 120px" }}>
                      <div style={{ fontSize: 10, color: !combinedVal ? "var(--warning)" : "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PHASE *</div>
                      <select value={combinedVal} onChange={e => onPhaseChange(e.target.value)} style={{ height: 34, fontSize: 12, width: "100%", borderColor: !combinedVal ? "var(--warning)" : undefined }}>
                        <option value="">— wählen —</option>
                        {customPhases.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                        {enabledPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                        {positions.flatMap(pos => (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph).map(ph => <option key={ph.id+"|"+pos.code} value={ph.id+"|"+pos.code}>{pos.code} · {ph.id}</option>))}
                      </select>
                    </div>
                  )}
                  <div style={{ flex: "2 1 180px" }}>
                    <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TÄTIGKEIT</div>
                    <input value={weekForm.description} onChange={e => setWeekForm({...weekForm, description:e.target.value})} placeholder="Beschreibung…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && saveWeekEntry()} />
                  </div>
                </>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary" onClick={saveWeekEntry} disabled={isAbsMode ? !weekForm.absType : (!weekForm.projectId || (hasPhase && !combinedVal))} style={{ fontSize: 12, height: 34 }}>Speichern</button>
                <button className="btn btn-ghost" onClick={() => { setWeekForm(null); setWeekSelectStart(null); }} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
              </div>
            </div>
          </div>
        );
      })()}

      {weekEditForm && !weekForm && (() => {
        if (weekEditForm.isAbs) {
          const a = (data.absences||[]).find(x => x.id === weekEditForm.entryId);
          if (!a) return null;
          const t = absenzTypes.find(x => x.id === a.type);
          const accentColor = t?.color || "#6b5a8a";
          const [shE,smE]=(a.startTime as string).split(":").map(Number); const [ehE,emE]=(a.endTime as string).split(":").map(Number);
          const durE = (ehE*60+emE)-(shE*60+smE);
          return (
            <div style={{ borderTop: `2px solid ${accentColor}`, padding: "12px 16px", background: "var(--surface2)" }}>
              <div style={{ fontSize: 10, color: accentColor, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 10 }}>
                {new Date(a.date as string).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {a.startTime} – {a.endTime} · {(durE/60).toFixed(1)}h
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TYP</div>
                  <select value={a.type || ""} onChange={ev => update("absences", (data.absences||[]).map(x => x.id === a.id ? {...x, type: ev.target.value} : x))} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                    <option value="">— wählen —</option>
                    {absenzTypes.map(at => <option key={at.id} value={at.id}>{at.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: "2 1 180px" }}>
                  <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>NOTIZ</div>
                  <input value={a.note || ""} onChange={ev => update("absences", (data.absences||[]).map(x => x.id === a.id ? {...x, note: ev.target.value} : x))} placeholder="Notiz…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-danger" onClick={() => { update("absences", (data.absences||[]).filter(x => x.id !== a.id)); setWeekEditForm(null); }} style={{ fontSize: 12, height: 34 }}>Löschen</button>
                  <button className="btn btn-ghost" onClick={() => setWeekEditForm(null)} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                </div>
              </div>
            </div>
          );
        } else {
          const e = data.timeEntries.find(x => x.id === weekEditForm.entryId);
          if (!e) return null;
          const projE = data.projects.find(p => p.id === e.projectId);
          const enabledPhasesE = (projE?.enabledPhases||[]).map(id => SIA_PHASES.find(ph => ph.id === id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph);
          const customPhasesE = projE?.customPhases || [];
          const positionsE = projE?.positions || [];
          const hasPhaseE = enabledPhasesE.length > 0 || customPhasesE.length > 0 || positionsE.some(pos => (pos.enabledPhases||[]).length > 0);
          const combinedValE = e.phaseId ? (e.positionId ? e.phaseId+"|"+e.positionId : e.phaseId) : "";
          const onPhaseChangeE = (val: string) => { if (!val) { updateEntry(e.id, { phaseId: "", positionId: "" }); return; } const [ph, pos] = val.split("|"); updateEntry(e.id, { phaseId: ph, positionId: pos || "" }); };
          const isInvoiced = !!e.invoiceId;
          const disabledE = isInvoiced || isMonthClosed(e.date);
          const bgE = PROJ_COLORS[data.projects.findIndex(p => p.id === e.projectId) % PROJ_COLORS.length] || PROJ_COLORS[0];
          const durE = e.startTime && e.endTime ? (() => { const [sh,sm]=e.startTime.split(":").map(Number); const [eh,em]=e.endTime.split(":").map(Number); return (eh*60+em)-(sh*60+sm); })() : e.minutes;
          return (
            <div style={{ borderTop: `2px solid ${bgE}`, padding: "12px 16px", background: "var(--surface2)" }}>
              <div style={{ fontSize: 10, color: bgE, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{new Date(e.date).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} · {e.startTime} – {e.endTime} · {(durE/60).toFixed(1)}h</span>
                {isInvoiced && <span style={{ fontSize: 9, color: "var(--warning)", fontWeight: 400 }}>verrechnet</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 150px" }}>
                  <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PROJEKT</div>
                  <select disabled={disabledE} value={e.projectId} onChange={ev => updateEntry(e.id, { projectId: ev.target.value, phaseId: "", positionId: "" })} style={{ height: 34, fontSize: 12, width: "100%" }} autoFocus>
                    <option value="">—</option>
                    {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {hasPhaseE && (
                  <div style={{ flex: "1 1 120px" }}>
                    <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>PHASE</div>
                    <select disabled={disabledE} value={combinedValE} onChange={ev => onPhaseChangeE(ev.target.value)} style={{ height: 34, fontSize: 12, width: "100%" }}>
                      <option value="">—</option>
                      {customPhasesE.map(cp => <option key={cp.id} value={cp.id}>{cp.label}</option>)}
                      {enabledPhasesE.map(ph => <option key={ph.id} value={ph.id}>{ph.id} · {ph.label.split(" ").slice(1).join(" ")}</option>)}
                      {positionsE.flatMap(pos => (pos.enabledPhases||[]).map(id=>SIA_PHASES.find(ph=>ph.id===id)).filter((ph): ph is (typeof SIA_PHASES)[number] => !!ph).map(ph => <option key={ph.id+"|"+pos.code} value={ph.id+"|"+pos.code}>{pos.code} · {ph.id}</option>))}
                    </select>
                  </div>
                )}
                <div style={{ flex: "2 1 180px" }}>
                  <div style={{ fontSize: 10, color: "var(--text5)", marginBottom: 3, letterSpacing: "0.06em" }}>TÄTIGKEIT</div>
                  <input disabled={disabledE} value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} placeholder="Beschreibung…" style={{ height: 34, fontSize: 12, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-danger" disabled={disabledE} onClick={() => { delEntry(e.id); setWeekEditForm(null); }} style={{ fontSize: 12, height: 34, opacity: disabledE ? 0.4 : 1 }}>Löschen</button>
                  <button className="btn btn-ghost" onClick={() => setWeekEditForm(null)} style={{ fontSize: 12, height: 34 }}><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
                </div>
              </div>
            </div>
          );
        }
      })()}
    </>
  );
}
