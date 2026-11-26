// Kennzahlen-Band für Spesen und Ausgaben (wie der Projekt-Arbeitsraum, `.ws-figs`):
// Total brutto, Netto, Vorsteuer und die grössten Kategorien als runde Balken.

import { formatCHF } from "../utils";

/** Band mit drei Kennzahlen und den grössten Kategorien (max. 4). */
export function ExpenseFigures({ count, brutto, netto, vorsteuer, totalSub, categories, saldo = false }: {
  count: number;
  brutto: number;
  netto: number;
  vorsteuer: number;
  /** Zusatz unter «Total brutto», z.B. «2 offen» */
  totalSub?: string;
  categories: { cat: string; amount: number }[];
  /** Saldosteuersatz (`settings.mwstMethode === "saldo"`): keine Vorsteuer abziehbar */
  saldo?: boolean;
}) {
  const max = categories[0]?.amount || 1;
  return (
    <div className="ws-figs exp-figs" style={{ marginBottom: 18 }}>
      <div><small>Total brutto</small><strong className="num">{formatCHF(brutto)}</strong><em>{count} {count === 1 ? "Eintrag" : "Einträge"}{totalSub ? ` · ${totalSub}` : ""}</em></div>
      <div><small>Netto</small><strong className="num">{formatCHF(netto)}</strong><em>ohne Vorsteuer</em></div>
      <div><small>Vorsteuer</small><strong className="num">{formatCHF(vorsteuer)}</strong><em>{saldo ? "nicht abziehbar (Saldosteuersatz)" : "rückforderbar"}</em></div>
      <div className="exp-cats">
        <small>Grösste Kategorien</small>
        {categories.length === 0 && <em>—</em>}
        {categories.slice(0, 3).map(c => (
          <div key={c.cat} className="exp-cat" title={`${c.cat}: ${formatCHF(c.amount)}`}>
            <span>{c.cat}</span><i className="num">{formatCHF(c.amount).replace(/^(−?)CHF\s*/u, "$1")}</i>
            <b style={{ width: `${Math.max(4, (c.amount / max) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
