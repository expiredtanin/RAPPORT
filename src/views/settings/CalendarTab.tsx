// Reiter «Feiertage & Absenzen»: Feiertage (auch jährlich wiederkehrend, Vorlage je Kanton mit
// beweglichen Feiertagen) und Absenzarten. Speichert sofort, nicht über den Entwurf `s`; die Kantonswahl
// (`settings.kanton`) geht direkt in die Einstellungen und über `onSettingsSaved` auch in den Entwurf.

import { useState } from "react";
import { DEFAULT_ABSENZ_TYPES } from "../../constants";
import { generateId, getAbsenzTypes } from "../../utils";
import { KANTON_FEIERTAGE, KANTONE, replaceHolidayTemplate, swissHolidayTemplate } from "../../worktime";
import { useConfirm } from "../../hooks/useConfirm";
import { showToast } from "../../toast";
import { changeWithUndo, removeWithUndo } from "../../undo";
import { FormField, Modal, DateInput } from "../../components/UI";
import type { AbsenzType, Feiertag, Kanton, Settings, ViewProps } from "../../types";

/** Feiertage und Absenztypen bearbeiten; `onSettingsSaved` hält den Einstellungs-Entwurf mit der Kantonswahl gleich. */
export function CalendarTab({ data, update, onSettingsSaved }: Pick<ViewProps, "data" | "update"> & { onSettingsSaved?: (changes: Partial<Settings>) => void }) {
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const kanton: Kanton = data.settings.kanton && KANTON_FEIERTAGE[data.settings.kanton] ? data.settings.kanton : "ZH";
  const kantonName = KANTON_FEIERTAGE[kanton].name;
  const vortagStunden = data.settings.vortagStunden ?? 1;
  const [ftForm, setFtForm] = useState<Partial<Feiertag>>({ date: "", label: "", stundenDelta: 0, repeatsYearly: true });
  const [absenzTypeForm, setAbsenzTypeForm] = useState<Partial<AbsenzType>>({ label: "", color: "#555" });
  const [kalModal, setKalModal] = useState<"ft" | "absenztype" | null>(null);

  // Feiertage & Absenztypen
  const feiertage = data.feiertage || [];
  const absenzTypes = getAbsenzTypes(data);
  const defaultAbsenzIds = new Set(DEFAULT_ABSENZ_TYPES.map(t => t.id));

  const saveFt = () => {
    if (!ftForm.date || ftForm.date < "2000-01-01" || ftForm.date > "2100-12-31") { showToast("Bitte ein Datum angeben (2000–2100)."); return; }
    if (!(ftForm.label || ftForm.name || "").trim()) { showToast("Bitte eine Bezeichnung angeben."); return; }
    // Anpassung höchstens einen Tag in jede Richtung (+50 h erhöhte sonst das Tagessoll — Runde 32)
    if (ftForm.stundenDelta != null && String(ftForm.stundenDelta) !== "" && !(Math.abs(Number(ftForm.stundenDelta)) <= 24)) { showToast("Stundenanpassung zwischen −24 und +24 h."); return; }
    // ein Feiertag je Datum (in der Cloud ist das Datum der Schlüssel: ein zweiter würde den ersten überschreiben)
    if (feiertage.some(f => f.date === ftForm.date && f.id !== ftForm.id)) { showToast("Für dieses Datum gibt es schon einen Feiertag."); return; }
    const isNew = !ftForm.id;
    const ft = { ...ftForm, id: ftForm.id || generateId() } as Feiertag;
    update("feiertage", isNew ? [...feiertage, ft] : feiertage.map(f => f.id === ft.id ? ft : f));
    setKalModal(null);
  };
  // Löschen mit «Rückgängig» wie sonst überall (undo.ts)
  const delFt = (id: string) => removeWithUndo(`Feiertag «${feiertage.find(f => f.id === id)?.label || ""}» gelöscht`, "feiertage", f => f.id === id);

  /** Kanton wählen; bestehende Vorlagen-Feiertage auf Wunsch durch die des neuen Kantons ersetzen (eigene bleiben). */
  const changeKanton = async (k: Kanton) => {
    const setKanton = () => { update("settings", prev => ({ ...prev, kanton: k })); onSettingsSaved?.({ kanton: k }); };
    if (feiertage.length === 0) { setKanton(); return; }
    // erst nach der Rückfrage umstellen: «Abbrechen» liess sonst den neuen Kanton mit den alten Feiertagen stehen
    const ok = await askConfirm(`Feiertage auf die Vorlage Kanton ${KANTON_FEIERTAGE[k].name} umstellen? Feiertage der bisherigen Vorlage ab ${new Date().getFullYear()} werden ersetzt; selbst erfasste (andere Bezeichnung) und frühere Jahre bleiben.`, "Umstellen");
    if (!ok) return;
    setKanton();
    const yr = new Date().getFullYear();
    update("feiertage", prev => replaceHolidayTemplate(prev, yr, yr + 3, k).map(f => f.id ? f : { ...f, id: generateId() }));
    showToast(`Feiertage Kanton ${KANTON_FEIERTAGE[k].name} geladen`);
  };

  const saveAbsenzType = () => {
    if (!(absenzTypeForm.label || "").trim()) { showToast("Bitte eine Bezeichnung angeben."); return; }
    // nur gültige Farbwerte (beliebiger Text landete sonst im style); bestehende CSS-Farben wie var(--…)/rgb() bleiben
    const c = (absenzTypeForm.color || "").trim();
    const validColor = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) || (/^[\w\s#(),.%/-]+$/.test(c) && typeof CSS !== "undefined" && CSS.supports("color", c));
    const color = validColor ? c : "#888888";
    const t = { ...absenzTypeForm, label: (absenzTypeForm.label || "").trim(), color, id: absenzTypeForm.id || generateId() } as AbsenzType;
    const custom = data.absenzTypes || [];
    const exists = custom.some(x => x.id === t.id);
    update("absenzTypes", exists ? custom.map(x => x.id === t.id ? t : x) : [...custom, t]);
    setKalModal(null);
  };
  const delAbsenzType = (id: string) => {
    const inUse = (data.absences || []).some(a => a.type === id);
    if (inUse) { showToast("Dieser Absenztyp ist bereits vergeben und kann nicht gelöscht werden."); return; }
    const label = absenzTypes.find(t => t.id === id)?.label || "";
    changeWithUndo(`Absenztyp «${label}» gelöscht`, prev => {
      const custom = prev.absenzTypes || [];
      if (!defaultAbsenzIds.has(id)) return { ...prev, absenzTypes: custom.filter(t => t.id !== id) };
      const exists = custom.some(x => x.id === id);
      return { ...prev, absenzTypes: exists ? custom.map(x => x.id === id ? { ...x, deleted: true } : x) : [...custom, { id, deleted: true } as AbsenzType] };
    });
  };

  return (
    <>
      {ConfirmModalEl}
      {/* Feiertage / Absenztypen Modals */}
      {kalModal === "ft" && (
        <Modal title={ftForm.id ? "Feiertag bearbeiten" : "Neuer Feiertag"} onClose={() => setKalModal(null)} onSave={saveFt}>
          <div className="form-row">
            <FormField label="Datum"><DateInput value={ftForm.date || ""} onChange={e => setFtForm({ ...ftForm, date: e.target.value })} autoFocus /></FormField>
            <FormField label="Bezeichnung"><input value={ftForm.label || ""} onChange={e => setFtForm({ ...ftForm, label: e.target.value })} placeholder="z.B. Nationalfeiertag" /></FormField>
          </div>
          <div className="form-row">
            <FormField label="Stunden-Delta (0 = ganzer Tag frei)">
              <input type="number" step={0.5} value={ftForm.stundenDelta ?? 0} onChange={e => setFtForm({ ...ftForm, stundenDelta: +e.target.value })} />
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>z.B. −3.5 für Halbtag, −1 für 1h früher</div>
            </FormField>
            <FormField label=" ">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
                <input type="checkbox" checked={!!ftForm.repeatsYearly} onChange={e => setFtForm({ ...ftForm, repeatsYearly: e.target.checked })} style={{ width: "auto" }} />
                Jährlich wiederkehrend
              </label>
            </FormField>
          </div>
        </Modal>
      )}

      {kalModal === "absenztype" && (
        <Modal title={absenzTypeForm.id ? "Absenztyp bearbeiten" : "Neuer Absenztyp"} onClose={() => setKalModal(null)} onSave={saveAbsenzType}>
          <div className="form-row">
            <FormField label="Bezeichnung"><input value={absenzTypeForm.label || ""} onChange={e => setAbsenzTypeForm({ ...absenzTypeForm, label: e.target.value })} autoFocus /></FormField>
            <FormField label="Farbe">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={absenzTypeForm.color || "#555"} onChange={e => setAbsenzTypeForm({ ...absenzTypeForm, color: e.target.value })} style={{ width: 44, height: 36, padding: 2, border: "1px solid var(--border)", borderRadius: 4 }} />
                <input value={absenzTypeForm.color || ""} onChange={e => setAbsenzTypeForm({ ...absenzTypeForm, color: e.target.value })} style={{ flex: 1 }} placeholder="#555" />
              </div>
            </FormField>
          </div>
        </Modal>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>FEIERTAGE</div>
            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => { setFtForm({ date: "", label: "", stundenDelta: 0, repeatsYearly: true }); setKalModal("ft"); }}>+ Feiertag</button>
          </div>
          <FormField label="Kanton (Vorlage)">
            <select value={kanton} onChange={e => changeKanton(e.target.value as Kanton)}>
              {KANTONE.map(k => <option key={k} value={k}>{KANTON_FEIERTAGE[k].name} ({k})</option>)}
            </select>
          </FormField>
          <FormField label="Vortag vor ganzem Feiertag (Stunden weniger Soll)">
            <input type="number" min={0} max={8} step={0.5} value={vortagStunden} style={{ maxWidth: 120 }}
              onChange={e => { const v = Math.max(0, +e.target.value || 0); update("settings", prev => ({ ...prev, vortagStunden: v })); onSettingsSaved?.({ vortagStunden: v }); }} />
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Büro-Usanz, gesetzlich nicht vorgeschrieben (allenfalls Arbeitsvertrag oder GAV). Gilt für 100 %, bei Teilzeit anteilig; 0 = aus.</div>
          </FormField>
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 14, lineHeight: 1.6 }}>
            Vorlage: gesetzliche bzw. üblicherweise arbeitsfreie Tage des Kantons (bei Unterschieden nach Gemeinde oder Konfession die Regel des Hauptorts) — eigene Tage ergänzen oder streichen.
            Gelten für alle Mitarbeiter. Jährlich wiederkehrende werden automatisch übertragen. Mit «Stunden-Delta» lassen sich Halbfeiertage definieren (z.B. −3.5h für den 24.12.; gilt für 100 %, bei Teilzeit anteilig). Am Werktag direkt vor einem ganzen Feiertag (auch Freitag vor einem Samstag-Feiertag) zählt das Soll {vortagStunden > 0 ? `${vortagStunden} h weniger` : "normal"}.
          </div>
          <div className="card" style={{ padding: 0, marginBottom: feiertage.length === 0 ? 12 : 0 }}>
            <table>
              <thead><tr><th>Datum</th><th>Bezeichnung</th><th style={{ textAlign: "right" }}>Delta</th><th></th></tr></thead>
              <tbody>
                {feiertage.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text5)", padding: 24 }}>Noch keine Feiertage erfasst</td></tr>}
                {[...feiertage].sort((a, b) => (a.date || "").slice(5).localeCompare((b.date || "").slice(5))).map(f => (
                  <tr key={f.id}>
                    <td style={{ fontSize: 12 }}>{f.repeatsYearly ? `${f.date.slice(8, 10)}.${f.date.slice(5, 7)}. ↻` : f.date ? new Date(`${f.date.slice(0, 10)}T12:00:00`).toLocaleDateString("de-CH") : "—"}</td>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{f.label}</td>
                    <td style={{ textAlign: "right", fontSize: 12, color: (f.stundenDelta ?? 0) < 0 ? "var(--warning)" : "var(--text5)" }}>{f.stundenDelta === 0 || f.stundenDelta === null ? "ganztag" : `${f.stundenDelta}h`}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11, marginRight: 4 }} onClick={() => { setFtForm({ ...f }); setKalModal("ft"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                      <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => delFt(f.id as string)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(() => {
            // Vorlage des gewählten Kantons: fehlende feste Feiertage und die beweglichen (Ostern-abhängigen u.a.)
            // für dieses und die nächsten drei Jahre ergänzen. Bewegliche gibt es nur pro Jahr — der Knopf bleibt deshalb
            // sichtbar, solange für eines der Jahre etwas fehlt (vorher nur bei leerer Liste, danach nie mehr).
            const yr = new Date().getFullYear();
            const missing = swissHolidayTemplate(feiertage, yr, yr + 3, kanton);
            if (missing.length === 0) return null;
            const label = feiertage.length === 0 ? `↓ Feiertage Kanton ${kantonName} laden (inkl. Ostern, Auffahrt, Pfingsten …)` : `↓ Fehlende Feiertage ${yr}–${yr + 3} ergänzen (${missing.length})`;
            return (
              <button className="btn btn-ghost" style={{ fontSize: 11, width: "100%", marginTop: feiertage.length === 0 ? 0 : 12 }}
                onClick={() => update("feiertage", [...feiertage, ...missing.map(f => ({ ...f, id: generateId() }))])}>{label}</button>
            );
          })()}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>ABSENZTYPEN</div>
            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => { setAbsenzTypeForm({ label: "", color: "#6a6660" }); setKalModal("absenztype"); }}>+ Typ</button>
          </div>
          <table>
            <thead><tr><th>Bezeichnung</th><th>Farbe</th><th>Typ</th><th></th></tr></thead>
            <tbody>
              {absenzTypes.map(t => {
                const inUse = (data.absences || []).some(a => a.type === t.id);
                const isDefault = defaultAbsenzIds.has(t.id);
                const isOverridden = isDefault && (data.absenzTypes || []).some(x => x.id === t.id);
                return (
                  <tr key={t.id}>
                    <td><span className="tag" style={{ background: t.color, fontSize: 10 }}>{t.label}</span></td>
                    <td style={{ color: "var(--text4)", fontSize: 12 }}>{t.color}</td>
                    <td style={{ fontSize: 11, color: isDefault ? (isOverridden ? "var(--accent)" : "var(--text5)") : "var(--positive)" }}>
                      {isDefault ? (isOverridden ? "Angepasst" : "Standard") : "Eigener"}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11, marginRight: 4 }} onClick={() => { setAbsenzTypeForm(t); setKalModal("absenztype"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                      <button className="btn-icon danger" aria-label="Entfernen" style={{ opacity: inUse ? 0.35 : 1 }} onClick={() => delAbsenzType(t.id)} title={inUse ? "In Verwendung" : "Löschen"}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
