// Spesen und interne Ausgaben: Netto/MWST-Hinweis unter dem Betrag und — für Belege mit mehreren MWST-Sätzen (Hotel
// 3.8 % + Frühstück 8.1 %) — die Aufteilung in Teilbeträge (`mwstAufteilung`, Regel 28.11.2026). Die Vorsteuer rechnet
// `expenseTax` (accounting.ts) je Teilbetrag; die Prüfung beim Speichern macht `mwstAufteilungFehler`.

import { expenseNet, expenseTax, mwstAufteilungFehler, type MwstFelder as Felder } from "../accounting";
import { formatCHF, roundCHF } from "../utils";
import type { MwstTeil } from "../types";


/** Netto/MWST-Hinweis und Aufteilung auf mehrere MWST-Sätze. */
export function MwstAufteilung({ form, onChange }: { form: Felder; onChange: (patch: Partial<Felder>) => void }) {
  const teile = form.mwstAufteilung || [];
  const aktiv = form.inclMwst && teile.length > 0;
  const setTeil = (k: number, patch: Partial<MwstTeil>) => onChange({ mwstAufteilung: teile.map((t, j) => j === k ? { ...t, ...patch } : t) });
  const fehler = aktiv ? mwstAufteilungFehler(form) : null;
  if (!(form.amount > 0)) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--text4)", padding: "8px 12px", background: "var(--surface2)", borderRadius: 4, marginBottom: 12 }}>
      {!form.inclMwst ? `Ohne MWST-Abzug — ${formatCHF(form.amount)} wird 1:1 als Netto gebucht` : (
        <>
          {aktiv && (
            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              {teile.map((t, k) => (
                <div key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" step="0.05" aria-label={`Teilbetrag ${k + 1}`} value={t.betrag} onChange={e => setTeil(k, { betrag: +e.target.value })} style={{ width: 110, height: 30, fontSize: 12 }} />
                  <span>CHF zu</span>
                  <input type="number" step="0.1" aria-label={`MWST-Satz ${k + 1}`} value={t.satz} onChange={e => setTeil(k, { satz: +e.target.value })} style={{ width: 70, height: 30, fontSize: 12 }} />
                  <span>%</span>
                  {teile.length > 2 && <button className="btn-icon" aria-label="Teilbetrag entfernen" onClick={() => onChange({ mwstAufteilung: teile.filter((_, j) => j !== k) })}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-quiet btn-sm" onClick={() => onChange({ mwstAufteilung: [...teile, { betrag: 0, satz: form.mwstRate || 8.1 }] })}>+ Teilbetrag</button>
                <button className="btn btn-quiet btn-sm" onClick={() => onChange({ mwstAufteilung: null })}>Ein Satz für den ganzen Beleg</button>
              </div>
              {fehler && <div style={{ color: "var(--warning)" }}>{fehler}</div>}
            </div>
          )}
          {`Netto: ${formatCHF(expenseNet(form))} · MWST: ${formatCHF(expenseTax(form))}`}
          {!aktiv && (
            <button className="btn btn-quiet btn-sm" style={{ marginLeft: 8, fontSize: 11 }}
              onClick={() => onChange({ mwstAufteilung: [{ betrag: roundCHF(form.amount), satz: form.mwstRate || 8.1 }, { betrag: 0, satz: 8.1 }] })}>
              Mehrere MWST-Sätze auf dem Beleg
            </button>
          )}
        </>
      )}
    </div>
  );
}
