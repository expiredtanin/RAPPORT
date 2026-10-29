// Reiter «Feiertage & Absenzen»: Feiertage (auch jährlich wiederkehrend, CH-Vorlage mit
// beweglichen Feiertagen) und Absenzarten. Speichert sofort, nicht über den Entwurf `s`.

import { useState } from "react";
import { DEFAULT_ABSENZ_TYPES } from "../../constants";
import { generateId, getAbsenzTypes } from "../../utils";
import { FormField, Modal, DateInput } from "../../components/UI";
import type { AbsenzType, Feiertag, ViewProps } from "../../types";

/** Feiertage und Absenztypen bearbeiten. */
export function CalendarTab({ data, update }: Pick<ViewProps, "data" | "update">) {
  const [ftForm, setFtForm] = useState<Partial<Feiertag>>({ date: "", label: "", stundenDelta: 0, repeatsYearly: true });
  const [absenzTypeForm, setAbsenzTypeForm] = useState<Partial<AbsenzType>>({ label: "", color: "#555" });
  const [kalModal, setKalModal] = useState<"ft" | "absenztype" | null>(null);

  // Feiertage & Absenztypen
  const feiertage = data.feiertage || [];
  const absenzTypes = getAbsenzTypes(data);
  const defaultAbsenzIds = new Set(DEFAULT_ABSENZ_TYPES.map(t => t.id));

  const saveFt = () => {
    const isNew = !ftForm.id;
    const ft = { ...ftForm, id: ftForm.id || generateId() } as Feiertag;
    update("feiertage", isNew ? [...feiertage, ft] : feiertage.map(f => f.id === ft.id ? ft : f));
    setKalModal(null);
  };
  const delFt = (id: string) => update("feiertage", feiertage.filter(f => f.id !== id));

  const saveAbsenzType = () => {
    const t = { ...absenzTypeForm, id: absenzTypeForm.id || generateId() } as AbsenzType;
    const custom = data.absenzTypes || [];
    const exists = custom.some(x => x.id === t.id);
    update("absenzTypes", exists ? custom.map(x => x.id === t.id ? t : x) : [...custom, t]);
    setKalModal(null);
  };
  const delAbsenzType = (id: string) => {
    const inUse = (data.absences || []).some(a => a.type === id);
    if (inUse) { alert("Dieser Absenztyp ist bereits vergeben und kann nicht gelöscht werden."); return; }
    if (defaultAbsenzIds.has(id)) {
      const custom = data.absenzTypes || [];
      const exists = custom.some(x => x.id === id);
      update("absenzTypes", exists ? custom.map(x => x.id === id ? { ...x, deleted: true } : x) : [...custom, { id, deleted: true } as AbsenzType]);
    } else {
      update("absenzTypes", (data.absenzTypes || []).filter(t => t.id !== id));
    }
  };

  return (
    <>
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
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 14, lineHeight: 1.6 }}>
            Gelten für alle Mitarbeiter. Jährlich wiederkehrende werden automatisch übertragen. Mit «Stunden-Delta» lassen sich Halbfeiertage definieren (z.B. −3.5h für den 24.12.).
          </div>
          <div className="card" style={{ padding: 0, marginBottom: feiertage.length === 0 ? 12 : 0 }}>
            <table>
              <thead><tr><th>Datum</th><th>Bezeichnung</th><th style={{ textAlign: "right" }}>Delta</th><th></th></tr></thead>
              <tbody>
                {feiertage.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text5)", padding: 24 }}>Noch keine Feiertage erfasst</td></tr>}
                {[...feiertage].sort((a, b) => (a.date || "").slice(5).localeCompare((b.date || "").slice(5))).map(f => (
                  <tr key={f.id}>
                    <td style={{ fontSize: 12 }}>{f.repeatsYearly ? f.date.slice(5).replace("-", ".") + " ↻" : f.date ? new Date(f.date).toLocaleDateString("de-CH") : "—"}</td>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{f.label}</td>
                    <td style={{ textAlign: "right", fontSize: 12, color: (f.stundenDelta ?? 0) < 0 ? "var(--warning)" : "var(--text5)" }}>{f.stundenDelta === 0 || f.stundenDelta === null ? "ganztag" : `${f.stundenDelta}h`}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11, marginRight: 4 }} onClick={() => { setFtForm({ ...f }); setKalModal("ft"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                      <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => delFt(f.id as string)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {feiertage.length === 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 11, width: "100%" }} onClick={() => {
              const easterSunday = (year: number) => {
                const a = year%19, b = Math.floor(year/100), c = year%100;
                const d = Math.floor(b/4), e = b%4, f = Math.floor((b+8)/25);
                const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15)%30;
                const i = Math.floor(c/4), k = c%4;
                const l = (32+2*e+2*i-h-k)%7;
                const m = Math.floor((a+11*h+22*l)/451);
                const month = Math.floor((h+l-7*m+114)/31);
                const day = ((h+l-7*m+114)%31)+1;
                return new Date(year, month-1, day);
              };
              const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate()+days); return d; };
              const fmt = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
              const yr = new Date().getFullYear();
              const fixe = [
                { label: "Neujahr", date: "2000-01-01", stundenDelta: 0, repeatsYearly: true },
                { label: "Berchtoldstag", date: "2000-01-02", stundenDelta: 0, repeatsYearly: true },
                { label: "Tag der Arbeit", date: "2000-05-01", stundenDelta: 0, repeatsYearly: true },
                { label: "Nationalfeiertag", date: "2000-08-01", stundenDelta: 0, repeatsYearly: true },
                { label: "Weihnachten", date: "2000-12-25", stundenDelta: 0, repeatsYearly: true },
                { label: "Stephanstag", date: "2000-12-26", stundenDelta: 0, repeatsYearly: true },
                { label: "Heiligabend (Halbtag)", date: "2000-12-24", stundenDelta: -3.5, repeatsYearly: true },
                { label: "Silvester (Halbtag)", date: "2000-12-31", stundenDelta: -3.5, repeatsYearly: true },
              ].map(f => ({ ...f, id: generateId() }));
              const beweglich: Feiertag[] = [];
              for (let y = yr; y <= yr+3; y++) {
                const ostern = easterSunday(y);
                [
                  { label: "Karfreitag", offset: -2 },
                  { label: "Ostermontag", offset: 1 },
                  { label: "Auffahrt", offset: 39 },
                  { label: "Auffahrt Vortag (Halbtag)", offset: 38, stundenDelta: -3.5 },
                  { label: "Pfingstmontag", offset: 50 },
                ].forEach(({ label, offset, stundenDelta = 0 }) => {
                  beweglich.push({ id: generateId(), label, date: fmt(addDays(ostern, offset)), stundenDelta, repeatsYearly: false });
                });
              }
              update("feiertage", [...feiertage, ...fixe, ...beweglich]);
            }}>↓ CH-Vorlagen laden (inkl. Ostern, Auffahrt, Pfingsten…)</button>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>ABSENZTYPEN</div>
            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => { setAbsenzTypeForm({ label: "", color: "var(--text2)" }); setKalModal("absenztype"); }}>+ Typ</button>
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
                    <td style={{ fontSize: 11, color: isDefault ? (isOverridden ? "#b07848" : "var(--text5)") : "var(--positive)" }}>
                      {isDefault ? (isOverridden ? "Angepasst" : "Standard") : "Eigener"}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11, marginRight: 4 }} onClick={() => { setAbsenzTypeForm(t); setKalModal("absenztype"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                      <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 11, opacity: inUse ? 0.35 : 1 }} onClick={() => delAbsenzType(t.id)} title={inUse ? "In Verwendung" : "Löschen"}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
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
