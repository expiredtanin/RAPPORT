// Reiter «Dokumente & Formate»: Nummernformate mit Vorschau, PDF-Dateiname, Seitenränder,
// Druckoptionen, Protokoll-Typkürzel und -Genehmigung. Bearbeitet den Entwurf `s`.

import { applyProjectNumberFormat, applyProtoNumberFormat, approvalDeadlineText, localISODate } from "../../utils";
import { FormField } from "../../components/UI";
import { Section, type DraftProps } from "./shared";
import type { ProtocolApproval } from "../../types";

function FmtRow({ label, value, onChange, placeholder, preview }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; preview?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={value} onChange={e => onChange(e.target.value)} style={{ maxWidth: 160, fontFamily: "monospace" }} placeholder={placeholder} />
        {preview && <span style={{ fontSize: 12, color: "var(--positive)", fontWeight: 500 }}>→ {preview}</span>}
      </div>
    </div>
  );
}

/** Formate und Druckeinstellungen der Dokumente. */
export function DocumentsTab({ s, setField }: DraftProps) {
  // Number format previews
  const invFmt = s.invoiceNumberFormat || "YYYY-NNN";
  const _now = new Date(); const _yyyy = String(_now.getFullYear()); const _yy = _yyyy.slice(2); const _mm = String(_now.getMonth() + 1).padStart(2, "0");
  const _invPadLen = (invFmt.match(/N+/) || ["NNN"])[0].length;
  const invFmtPreview = invFmt.replace(/YYYY/g, _yyyy).replace(/YY/g, _yy).replace(/MM/g, _mm).replace(/N+/, String(1).padStart(_invPadLen, "0"));
  const vertragFmt = s.vertragNumberFormat || "V-YYYY-NNN";
  const _vertragPadLen = (vertragFmt.match(/N+/) || ["NNN"])[0].length;
  const vertragFmtPreview = vertragFmt.replace(/YYYY/g, _yyyy).replace(/YY/g, _yy).replace(/MM/g, _mm).replace(/N+/, String(1).padStart(_vertragPadLen, "0"));
  const protoFmt = s.protokollNumberFormat || "PP-TT-NN";
  const protoAbbr = s.protokollTypeAbbreviations || {};
  const protoFmtPreview = applyProtoNumberFormat(protoFmt, {
    date: localISODate(),
    projectNumber: "2026-01",
    seq: 1,
    typKuerzel: Object.values(protoAbbr)[0] || "BS",
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
      <div className="card">
        <Section title="NUMMERNFORMATE">
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 14 }}>
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>YYYY</code> = {_yyyy} &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>YY</code> = {_yy} &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>MM</code> = Monat &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>NN</code> = laufende Nr.
          </div>
          <FmtRow label="Projektnummer" value={s.projectNumberFormat || "YYYY/NN"} onChange={v => setField({ projectNumberFormat: v })} placeholder="YYYY/NN" preview={applyProjectNumberFormat(s.projectNumberFormat || "YYYY/NN", 1)} />
          <FmtRow label="Rechnungsnummer" value={invFmt} onChange={v => setField({ invoiceNumberFormat: v })} placeholder="YYYY-NNN" preview={invFmtPreview} />
          <FmtRow label="Vertragsnummer" value={vertragFmt} onChange={v => setField({ vertragNumberFormat: v })} placeholder="V-YYYY-NNN" preview={vertragFmtPreview} />
          <FmtRow label="Protokollnummer" value={protoFmt} onChange={v => setField({ protokollNumberFormat: v })} placeholder="PP-TT-NN" preview={protoFmtPreview} />
          <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 8, lineHeight: 1.8 }}>
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>PP</code> = Projektnr. ohne Jahreszahl &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>PPP</code> = Projektnr. komplett &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>TT</code> = Sitzungstyp
          </div>
        </Section>

        <Section title="PDF-DATEINAME">
          <div style={{ marginBottom: 8 }}>
            <input value={s.pdfNameFormat || "{studio}_{typ}_{nummer}"} onChange={e => setField({ pdfNameFormat: e.target.value })} style={{ width: "100%", fontFamily: "monospace" }} placeholder="{studio}_{typ}_{nummer}" />
          </div>
          <div style={{ fontSize: 11, color: "var(--text5)", lineHeight: 1.8 }}>
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>{"{studio}"}</code> &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>{"{typ}"}</code> &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>{"{nummer}"}</code> &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>{"{kunde}"}</code> &nbsp;
            <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>{"{datum}"}</code>
          </div>
        </Section>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="card">
          <Section title="SEITENRÄNDER (MM)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              {[["pageMarginTop", "Oben"], ["pageMarginBottom", "Unten"], ["pageMarginLeft", "Links"], ["pageMarginRight", "Rechts"]].map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 4 }}>{label}</div>
                  <input type="number" min={0} max={60} value={(s[key] as number | undefined) ?? 20} onChange={e => setField({ [key]: +e.target.value })} style={{ width: "100%", fontFamily: "monospace" }} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 10 }}>Gilt für alle Dokumente ausser QR-Rechnung. Oben/unten auf der ersten Seite; Folgeseiten und Briefpapier unter «Erscheinungsbild».</div>
          </Section>
        </div>

        <div className="card">
          <Section title="DRUCKOPTIONEN">
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)", marginBottom: 10 }}>
              <input type="checkbox" checked={!!s.autoPrint} onChange={e => setField({ autoPrint: e.target.checked })} style={{ width: "auto" }} />
              Druckdialog automatisch öffnen
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={s.qrNewPage !== false} onChange={e => setField({ qrNewPage: e.target.checked })} style={{ width: "auto" }} />
              QR-Rechnung auf separater Seite
            </label>
          </Section>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600 }}>PROTOKOLL-TYPKÜRZEL</div>
            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setField({ protokollTypeAbbreviations: { ...protoAbbr, "Neuer Typ": "NT" } })}>+ Typ</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>
            Kürzel für Platzhalter <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>TT</code> in der Protokollnummer.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(protoAbbr).map(([typName, kuerzel]) => (
              <div key={typName} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input defaultValue={typName} onBlur={e => {
                  const newName = e.target.value.trim();
                  if (!newName || newName === typName) { e.target.value = typName; return; }
                  const newAbbr = Object.fromEntries(Object.entries(protoAbbr).map(([k, v]) => [k === typName ? newName : k, v]));
                  setField({ protokollTypeAbbreviations: newAbbr });
                }} placeholder="Sitzungstyp" style={{ flex: 1, fontSize: 12 }} />
                <input value={kuerzel} onChange={e => setField({ protokollTypeAbbreviations: { ...protoAbbr, [typName]: e.target.value.toUpperCase().slice(0, 4) } })}
                  placeholder="BS" style={{ width: 52, textAlign: "center", fontWeight: 600, fontSize: 12, fontFamily: "monospace" }} maxLength={4} />
                <button className="btn btn-danger" style={{ padding: "0 7px", height: 30, fontSize: 11 }} onClick={() => setField({ protokollTypeAbbreviations: Object.fromEntries(Object.entries(protoAbbr).filter(([k]) => k !== typName)) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text5)", fontWeight: 600, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>PROTOKOLL-GENEHMIGUNG</div>
          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12 }}>
            Vorgabe für den Schluss des gedruckten Protokolls. Pro Protokoll übersteuerbar.
          </div>
          <div className="form-row">
            <FormField label="Vermerk">
              <select value={s.protokollApproval || "unterschrift"} onChange={e => setField({ protokollApproval: e.target.value as ProtocolApproval })}>
                {[["unterschrift", "Unterschriftenfelder"], ["stillschweigend", "Stillschweigend nach Frist"], ["keine", "Kein Vermerk"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            {(s.protokollApproval || "unterschrift") === "stillschweigend" && (
              <FormField label="Frist (Stunden)">
                <input type="number" min={1} value={s.protokollApprovalHours ?? 24} onChange={e => setField({ protokollApprovalHours: Math.max(1, +e.target.value || 24) })} style={{ maxWidth: 110 }} />
              </FormField>
            )}
          </div>
          {(s.protokollApproval || "unterschrift") === "stillschweigend" && (
            <div style={{ fontSize: 11, color: "var(--text4)", lineHeight: 1.5 }}>
              Im Druck: «Einwände und Ergänzungen sind innert {approvalDeadlineText(s.protokollApprovalHours ?? 24)} nach Versand an {s.name || "das Büro"} zu richten. Ohne Rückmeldung gilt das Protokoll als genehmigt.»
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
