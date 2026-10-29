// Reiter «Studio»: Logo, Adresse, Finanzen (IBAN, MWST, Stundensatz) und Kategorienlisten.
// Bearbeitet den Entwurf `s`; gespeichert wird mit «Speichern» in Settings.tsx.

import { DEFAULT_LEAD_SOURCES } from "../../constants";
import { isLocalBackend } from "../../storage/adapter";
import { formatIban, isQRIban, readAsDataUrl, checkLocalBudget } from "../../utils";
import { FormField } from "../../components/UI";
import { Section, type DraftProps } from "./shared";
import type { AppData } from "../../types";

/** Stammdaten des Büros; das Logo prüft im lokalen Modus das Speicherbudget. */
export function StudioTab({ s, setField, data }: DraftProps & { data: AppData }) {
  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
      <div className="card">
        <Section title="STUDIO & ERSCHEINUNGSBILD">
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>Logo (SVG / PNG)</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {s.logo && <img src={s.logo} alt="Logo" style={{ maxHeight: 40, maxWidth: 120, border: "1px solid var(--border2)", borderRadius: 4, padding: 4, background: "var(--surface)" }} />}
              <label className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer" }}>
                {s.logo ? "Ersetzen" : "Hochladen"}
                <input type="file" accept="image/svg+xml,image/png,image/jpeg" style={{ display: "none" }} onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const logo = await readAsDataUrl(file);
                  const problem = isLocalBackend ? checkLocalBudget(data, logo.length, s.logo?.length || 0) : null;
                  if (problem) { alert(problem); return; }
                  setField({ logo });
                }} />
              </label>
              {s.logo && <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => setField({ logo: null })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Logohöhe auf PDFs</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={20} max={200} step={5} value={s.logoSize || 60} onChange={e => setField({ logoSize: +e.target.value })} style={{ width: 70 }} />
              <span style={{ fontSize: 11, color: "var(--text4)" }}>px</span>
              {(s.logoSize || 60) !== 60 && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setField({ logoSize: 60 })}>↺ Standard</button>}
            </div>
          </div>
          <FormField label="Name / Firma"><input value={s.name} onChange={e => setField({ name: e.target.value })} /></FormField>
        </Section>

        <Section title="ADRESSE">
          <FormField label="Strasse + Nr."><input value={s.street || ""} onChange={e => setField({ street: e.target.value })} placeholder="z.B. Bahnhofstrasse 1" /></FormField>
          <div className="form-row">
            <FormField label="PLZ"><input value={s.zip || ""} onChange={e => setField({ zip: e.target.value })} style={{ maxWidth: 120 }} /></FormField>
            <FormField label="Ort"><input value={s.city || ""} onChange={e => setField({ city: e.target.value })} /></FormField>
            <FormField label="Land"><input value={s.country || "CH"} onChange={e => setField({ country: e.target.value.toUpperCase() })} maxLength={2} style={{ maxWidth: 80 }} /></FormField>
          </div>
          <div className="form-row">
            <FormField label="E-Mail"><input type="email" value={s.email} onChange={e => setField({ email: e.target.value })} /></FormField>
            <FormField label="Telefon"><input value={s.phone} onChange={e => setField({ phone: e.target.value })} /></FormField>
          </div>
        </Section>
      </div>

      <div className="card">
        <Section title="FINANZEN">
          <FormField label="IBAN">
            <input value={s.iban} onChange={e => { const f = formatIban(e.target.value); setField({ iban: f, ibanType: isQRIban(f) ? "qr" : "normal" }); }} placeholder="CH00 0000 0000 0000 0000 0" />
            <div style={{ fontSize: 11, color: isQRIban(s.iban) ? "var(--positive)" : "var(--warning)", marginTop: 4 }}>
              {isQRIban(s.iban) ? "✓ QR-IBAN — strukturierte Referenz verfügbar" : "Normale IBAN — ohne strukturierte Referenz"}
            </div>
          </FormField>
          <FormField label="MWST-Nr."><input value={s.mwst} onChange={e => setField({ mwst: e.target.value })} /></FormField>
          <div className="form-row">
            <FormField label="MWST-Satz (%)">
              <input type="number" step="0.1" value={s.mwstRate} onChange={e => setField({ mwstRate: +e.target.value })} />
            </FormField>
            <FormField label="Standard-Stundensatz (CHF)">
              <input type="number" value={s.defaultHourlyRate} onChange={e => setField({ defaultHourlyRate: +e.target.value })} />
            </FormField>
          </div>
        </Section>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }} className="responsive-grid-2">
      <div className="card">
        <Section title="SPESENKATEGORIEN">
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Kategorien für Mitarbeiterspesen.</div>
          {(s.expenseCategories || []).map((cat, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={cat} onChange={e => setField({ expenseCategories: (s.expenseCategories || []).map((c, j) => j === i ? e.target.value : c) })} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-danger" style={{ padding: "0 7px", height: 30, fontSize: 11 }} onClick={() => setField({ expenseCategories: (s.expenseCategories || []).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setField({ expenseCategories: [...(s.expenseCategories || []), ""] })}>+ Kategorie</button>
        </Section>
      </div>
      <div className="card">
        <Section title="INTERNE AUSGABEN-KATEGORIEN">
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Kategorien für interne Büroausgaben.</div>
          {(s.internalExpenseCategories || []).map((cat, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={cat} onChange={e => setField({ internalExpenseCategories: (s.internalExpenseCategories || []).map((c, j) => j === i ? e.target.value : c) })} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-danger" style={{ padding: "0 7px", height: 30, fontSize: 11 }} onClick={() => setField({ internalExpenseCategories: (s.internalExpenseCategories || []).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setField({ internalExpenseCategories: [...(s.internalExpenseCategories || []), ""] })}>+ Kategorie</button>
        </Section>
      </div>
      <div className="card">
        <Section title="HERKUNFT DER AUFTRÄGE (AKQUISE)">
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Auswahl für «Herkunft» bei Kontakten und Leads; Grundlage der Akquise-Auswertung.</div>
          {(s.leadSources || DEFAULT_LEAD_SOURCES).map((src, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={src} onChange={e => setField({ leadSources: (s.leadSources || DEFAULT_LEAD_SOURCES).map((c, j) => j === i ? e.target.value : c) })} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-danger" style={{ padding: "0 7px", height: 30, fontSize: 11 }} onClick={() => setField({ leadSources: (s.leadSources || DEFAULT_LEAD_SOURCES).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setField({ leadSources: [...(s.leadSources || DEFAULT_LEAD_SOURCES), ""] })}>+ Herkunft</button>
        </Section>
      </div>
    </div>
    </>
  );
}
