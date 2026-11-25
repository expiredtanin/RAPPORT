// Reiter «Studio»: Logo, Adresse, Finanzen (IBAN, MWST, Stundensatz) und Kategorienlisten.
// Bearbeitet den Entwurf `s`; gespeichert wird mit «Speichern» in Settings.tsx.

import { DEFAULT_LEAD_SOURCES } from "../../constants";
import { showToast } from "../../toast";
import { isLocalBackend } from "../../storage/adapter";
import { formatIban, isQRIban, isValidIban, readAsDataUrl, checkLocalBudget, DEFAULT_MAHNGEBUEHREN } from "../../utils";
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
                  // nur ein Bild, das sich wirklich laden lässt (eine leere oder falsche Datei ersetzte sonst das Logo in allen Dokumenten)
                  let logo = "";
                  try {
                    logo = await readAsDataUrl(file);
                    if (!/^data:image\/(svg\+xml|png|jpeg);/.test(logo)) throw new Error("typ");
                    await new Promise<void>((ok, fail) => { const img = new Image(); img.onload = () => ok(); img.onerror = () => fail(new Error("bild")); img.src = logo; });
                  } catch { showToast("Das Logo konnte nicht gelesen werden (SVG, PNG oder JPG)."); return; }
                  const problem = isLocalBackend ? checkLocalBudget(data, logo.length, s.logo?.length || 0) : null;
                  if (problem) { showToast(problem); return; }
                  setField({ logo });
                }} />
              </label>
              {s.logo && <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => setField({ logo: null })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
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
              {s.iban && !isValidIban(s.iban) ? <span style={{ color: "var(--negative)" }}>IBAN ungültig (Prüfziffer stimmt nicht) — QR-Rechnungen lassen sich so nicht erstellen</span>
                : isQRIban(s.iban) ? "✓ QR-IBAN — strukturierte Referenz verfügbar" : "Normale IBAN — ohne strukturierte Referenz"}
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
          <div className="form-row">
            <FormField label="MWST-Abrechnungsmethode">
              <select value={s.mwstMethode || "effektiv"} onChange={e => setField({ mwstMethode: e.target.value as "effektiv" | "saldo" })}>
                <option value="effektiv">Effektiv</option>
                <option value="saldo">Saldosteuersatz</option>
              </select>
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>{s.mwstMethode === "saldo" ? "halbjährlich, ohne Vorsteuerabzug" : "vierteljährlich, mit Vorsteuerabzug"}</div>
            </FormField>
            <FormField label="Abrechnungsart">
              <select value={s.mwstAbrechnungsart || "vereinbart"} onChange={e => setField({ mwstAbrechnungsart: e.target.value as "vereinbart" | "vereinnahmt" })}>
                <option value="vereinbart">Vereinbarte Entgelte</option>
                <option value="vereinnahmt">Vereinnahmte Entgelte</option>
              </select>
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>{s.mwstAbrechnungsart === "vereinnahmt" ? "nach Zahlungseingang (Bewilligung ESTV)" : "nach Rechnungsdatum (Standard)"}</div>
            </FormField>
          </div>
          {s.mwstMethode === "saldo" && (
            <FormField label="Saldosteuersatz (%)">
              <input type="number" step="0.1" min={0} value={s.mwstSaldoSatz ?? ""} placeholder="laut Bewilligung der ESTV" onChange={e => setField({ mwstSaldoSatz: e.target.value === "" ? undefined : +e.target.value })} style={{ maxWidth: 160 }} />
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Den Satz aus der Bewilligung der ESTV eintragen. Rechnungen weisen weiterhin den Normalsatz aus; abgerechnet wird Entgelt inkl. MWST × Saldosteuersatz, ohne Vorsteuerabzug.</div>
            </FormField>
          )}
        </Section>
      </div>
    </div>

    <div className="card" style={{ marginTop: 20 }}>
      <Section title="LOHNKOSTEN ARBEITGEBER">
        <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Zusätzlich zu AHV/IV/EO, ALV (paritätisch) und Pensionskasse. Sätze laut Ausgleichskasse und Versicherern; sie gelten für neue Lohnabrechnungen.</div>
        <div className="form-row">
          <FormField label="Familienausgleichskasse FAK (%)">
            <input type="number" step="0.01" min={0} value={s.lohnFakSatz ?? 1.0} onChange={e => setField({ lohnFakSatz: +e.target.value })} />
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>der AHV-Lohnsumme, kantonal</div>
          </FormField>
          <FormField label="Verwaltungskosten AK (%)">
            <input type="number" step="0.1" min={0} value={s.lohnVkSatz ?? 3.0} onChange={e => setField({ lohnVkSatz: +e.target.value })} />
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>der AHV/IV/EO-Beiträge</div>
          </FormField>
          <FormField label="Berufsunfall UVG-BU (%)">
            <input type="number" step="0.01" min={0} value={s.lohnBuSatz ?? 0.1} onChange={e => setField({ lohnBuSatz: +e.target.value })} />
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>der UVG-Lohnsumme, trägt AG</div>
          </FormField>
          <FormField label="Krankentaggeld AG (%)">
            <input type="number" step="0.01" min={0} value={s.lohnKtgAGSatz ?? ""} placeholder="= AN-Satz" onChange={e => setField({ lohnKtgAGSatz: e.target.value === "" ? undefined : +e.target.value })} />
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>leer = paritätisch</div>
          </FormField>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", fontSize: 13, color: "var(--text2)", marginTop: 6 }}>
          <input type="checkbox" checked={!!s.familienzulagenAnteilig} onChange={e => setField({ familienzulagenAnteilig: e.target.checked })} style={{ width: "auto" }} />
          Familienzulagen im Ein- und Austrittsmonat anteilig nach Kalendertagen
        </label>
        <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3, marginLeft: 24 }}>Je nach Familienausgleichskasse; ausgeschaltet wird der volle Monatsbetrag ausbezahlt.</div>
      </Section>
    </div>

    <div className="card" style={{ marginTop: 20 }}>
      <Section title="MAHNWESEN">
        <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Beträge erscheinen in Zahlungserinnerung und Mahnungen. Ohne MWST und nicht in der Buchhaltung gebucht — erfasst wird erst der Zahlungseingang.</div>
        <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "4px 16px", alignItems: "start" }}>
          <FormField label="Verzugszins">
            <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", fontSize: 13, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!s.verzugszinsAktiv} onChange={e => setField({ verzugszinsAktiv: e.target.checked })} style={{ width: "auto" }} />
              ab dem Tag nach der Fälligkeit verlangen
            </label>
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>gesetzlich 5 % p.a. (OR 104), tagesgenau</div>
          </FormField>
          {s.verzugszinsAktiv && (
            <FormField label="Zinssatz (% p.a.)">
              <input type="number" step="0.25" min={0} value={s.verzugszinsSatz ?? 5} onChange={e => setField({ verzugszinsSatz: Math.max(0, +e.target.value) })} style={{ maxWidth: 120 }} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>höher nur, wenn vertraglich vereinbart</div>
            </FormField>
          )}
          {s.verzugszinsAktiv ? <div style={{ gridColumn: "span 2" }} /> : <div style={{ gridColumn: "span 3" }} />}
          <FormField label="Mahngebühren">
            <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", fontSize: 13, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!s.mahngebuehrAktiv} onChange={e => setField({ mahngebuehrAktiv: e.target.checked })} style={{ width: "auto" }} />
              je Mahnstufe verlangen
            </label>
            <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>nur zulässig, wenn mit dem Kunden vereinbart (AGB, Vertrag)</div>
          </FormField>
          {s.mahngebuehrAktiv && ["Zahlungserinnerung", "2. Mahnung", "ab 3. Mahnung"].map((label, i) => (
            <FormField key={label} label={`${label} (CHF)`}>
              <input type="number" step="5" min={0} value={(s.mahngebuehren?.length ? s.mahngebuehren : DEFAULT_MAHNGEBUEHREN)[i] ?? 0}
                onChange={e => { const list = [...(s.mahngebuehren?.length ? s.mahngebuehren : DEFAULT_MAHNGEBUEHREN)]; list[i] = Math.max(0, +e.target.value); setField({ mahngebuehren: list }); }} style={{ maxWidth: 120 }} />
            </FormField>
          ))}
        </div>
      </Section>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }} className="responsive-grid-2">
      <div className="card">
        <Section title="SPESENKATEGORIEN">
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>Kategorien für Mitarbeiterspesen.</div>
          {(s.expenseCategories || []).map((cat, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={cat} onChange={e => setField({ expenseCategories: (s.expenseCategories || []).map((c, j) => j === i ? e.target.value : c) })} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => setField({ expenseCategories: (s.expenseCategories || []).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
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
              <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => setField({ internalExpenseCategories: (s.internalExpenseCategories || []).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
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
              <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => setField({ leadSources: (s.leadSources || DEFAULT_LEAD_SOURCES).filter((_, j) => j !== i) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setField({ leadSources: [...(s.leadSources || DEFAULT_LEAD_SOURCES), ""] })}>+ Herkunft</button>
        </Section>
      </div>
    </div>
    </>
  );
}
