// Offerte, Modus «Aufwand»: Stunden aus eigenen abgeschlossenen Projekten schätzen.
//
// Gleicher Aufbau wie die ETH Value-Methode (Geschossfläche × Stunden je m² × Anpassungsfaktor, mit
// Bandbreite), aber mit den Erfahrungswerten des eigenen Büros (utils `calcOfficeBenchmarks`). Der
// Median wird nach den bisherigen Phasenanteilen verteilt und auf Knopfdruck einer Rolle in die Phasen
// der Offerte geschrieben; die Grundlage bleibt als `quote.estimate` an der Offerte stehen.

import { useMemo, useState } from "react";
import { ESTIMATE_FACTORS, PROJECT_USAGES } from "../../constants";
import { calcOfficeBenchmarks, estimateEffort, formatCHF } from "../../utils";
import type { AppData, ManualPhase, ProjectUsage, QuoteEstimate, Role } from "../../types";

/** Zahl mit höchstens einer Nachkommastelle, Schweizer Schreibweise. */
const fmt = (v: number, digits = 1) => v.toLocaleString("de-CH", { maximumFractionDigits: digits });

/** Schätzfeld über den Phasen einer Offerte im Modus «Aufwand». */
export function EffortEstimatePanel({ data, projectId, estimate, phases, roles, onApply }: {
  data: Pick<AppData, "projects" | "timeEntries">;
  /** verknüpftes Projekt der Offerte: liefert Nutzung und Fläche als Vorschlag */
  projectId?: string | null;
  estimate?: QuoteEstimate | null;
  phases: ManualPhase[];
  roles: Role[];
  /** schreibt die geschätzten Stunden in die Phasen und merkt sich die Grundlage */
  onApply: (phases: ManualPhase[], estimate: QuoteEstimate) => void;
}) {
  const project = (data.projects || []).find(p => p.id === projectId);
  const [open, setOpen] = useState(!!estimate);
  const [usage, setUsage] = useState<ProjectUsage | "">(estimate?.usage || project?.usage || "");
  const [area, setArea] = useState<number>(estimate?.floorArea || project?.floorArea || 0);
  const [factor, setFactor] = useState<number>(estimate?.factor || 1);
  const [roleId, setRoleId] = useState(roles[0]?.id || "");

  const benchmarks = useMemo(() => calcOfficeBenchmarks(data.projects || [], data.timeEntries || []), [data.projects, data.timeEntries]);
  const bench = usage ? benchmarks[usage] : undefined;
  const result = estimateEffort(bench, area, factor, phases.map(p => p.id));
  const role = roles.find(r => r.id === roleId);
  const usableCount = Object.values(benchmarks).reduce((s, b) => s + (b?.samples.length || 0), 0);

  const apply = () => {
    if (!result || !bench || !role) return;
    const hoursById = Object.fromEntries(result.phases.map(p => [p.id, p.hours]));
    const next = phases.map(ph => {
      const hours = hoursById[ph.id];
      if (!hours) return ph;
      return { ...ph, enabled: true, hoursByRole: { ...Object.fromEntries(Object.keys(ph.hoursByRole || {}).map(k => [k, 0])), [role.id]: hours } };
    });
    onApply(next, { usage: usage as ProjectUsage, floorArea: area, factor, sampleCount: bench.samples.length, hoursPerM2: bench.hoursPerM2.median });
  };

  const box = { marginBottom: 14, padding: 12, background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border)" } as const;
  if (!open) {
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", gap: 10 }}>
        <span className="msr" style={{ fontSize: 18, color: "var(--text4)" }}>insights</span>
        <div style={{ flex: 1, fontSize: 12, color: "var(--text3)" }}>
          Stunden aus eigenen abgeschlossenen Projekten schätzen ({usableCount} {usableCount === 1 ? "Projekt" : "Projekte"} mit Nutzung und Fläche)
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setOpen(true)}>Schätzen</button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>SCHÄTZUNG AUS EIGENEN PROJEKTEN</div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setOpen(false)}>Schliessen</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.2fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: "var(--text4)" }}>Nutzung
          <select value={usage} onChange={e => setUsage(e.target.value as ProjectUsage | "")} style={{ marginTop: 4 }}>
            <option value="">— wählen —</option>
            {PROJECT_USAGES.map(u => (
              <option key={u.id} value={u.id} title={u.hint}>{u.label} ({benchmarks[u.id]?.samples.length || 0})</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--text4)" }}>Geschossfläche GF (m²)
          <input type="number" min={0} step={10} value={area || ""} onChange={e => setArea(Math.max(0, Number(e.target.value) || 0))} style={{ marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11, color: "var(--text4)" }}>Schwierigkeit
          <select value={factor} onChange={e => setFactor(Number(e.target.value))} style={{ marginTop: 4 }}
            title={ESTIMATE_FACTORS.find(f => f.value === factor)?.hint}>
            {ESTIMATE_FACTORS.map(f => <option key={f.value} value={f.value} title={f.hint}>{f.label} (× {fmt(f.value, 2)})</option>)}
            {!ESTIMATE_FACTORS.some(f => f.value === factor) && <option value={factor}>× {fmt(factor, 2)}</option>}
          </select>
        </label>
      </div>

      {!usage ? (
        <div style={{ fontSize: 12, color: "var(--text4)" }}>Nutzung wählen, um die Erfahrungswerte zu sehen.</div>
      ) : !bench ? (
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6 }}>
          Noch keine Erfahrungswerte für «{PROJECT_USAGES.find(u => u.id === usage)?.label}». Sie entstehen aus abgeschlossenen
          Projekten mit Nutzung und Geschossfläche (Projekt bearbeiten) und erfassten Stunden.
        </div>
      ) : (<>
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, marginBottom: 8 }}>
          Grundlage: <strong style={{ color: "var(--text)" }}>{bench.samples.length} {bench.samples.length === 1 ? "Projekt" : "Projekte"}</strong>,
          im Mittel <strong style={{ color: "var(--text)" }}>{fmt(bench.hoursPerM2.median, 2)} h/m²</strong>
          {bench.samples.length > 1 && <> (Bandbreite {fmt(bench.hoursPerM2.low, 2)}–{fmt(bench.hoursPerM2.high, 2)})</>}
          <div style={{ fontSize: 11, color: "var(--text4)" }} title={bench.samples.map(s => `${s.name}: ${fmt(s.hoursPerM2, 2)} h/m²`).join("\n")}>
            {bench.samples.map(s => s.name).join(", ")}
          </div>
          {bench.samples.length < 3 && (
            <div style={{ fontSize: 11, color: "var(--warning)" }}>Wenige Projekte — die Schätzung ist nur ein grober Anhaltspunkt.</div>
          )}
        </div>
        {result && (<>
          <div style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "8px 10px", background: "var(--surface)", borderRadius: 6, marginBottom: 8, fontSize: 12 }}>
            <div>Geschätzt <strong style={{ fontSize: 15 }}>{fmt(result.total.median, 0)} h</strong></div>
            {result.total.n > 1 && <div style={{ color: "var(--text4)" }}>Bandbreite {fmt(result.total.low, 0)}–{fmt(result.total.high, 0)} h</div>}
            {role && <div style={{ marginLeft: "auto", color: "var(--text4)" }}>≈ {formatCHF(result.total.median * role.rate)} zu {role.id}</div>}
          </div>
          {result.phases.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {result.phases.map(ph => (
                <span key={ph.id} className="pill" style={{ fontSize: 11 }}>{ph.id}: {fmt(ph.hours, 0)} h</span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 10 }}>
              In den Vergleichsprojekten wurden keine Stunden auf Phasen dieser Offerte erfasst — die Verteilung auf Phasen bitte von Hand.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={roleId} onChange={e => setRoleId(e.target.value)} style={{ width: "auto", height: 30, fontSize: 12 }}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.id} · {r.label}</option>)}
            </select>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!result.phases.length || !role} onClick={apply}>
              In Phasen übernehmen
            </button>
            <span style={{ fontSize: 11, color: "var(--text4)" }}>ersetzt die Stunden dieser Phasen; danach von Hand auf Rollen verteilen</span>
          </div>
        </>)}
        {!result && <div style={{ fontSize: 12, color: "var(--text4)" }}>Geschossfläche eingeben.</div>}
      </>)}
      {estimate && (
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--text4)" }}>
          Übernommen: {PROJECT_USAGES.find(u => u.id === estimate.usage)?.label}, {fmt(estimate.floorArea, 0)} m², × {fmt(estimate.factor, 2)},
          {" "}{fmt(estimate.hoursPerM2, 2)} h/m² aus {estimate.sampleCount} {estimate.sampleCount === 1 ? "Projekt" : "Projekten"}
        </div>
      )}
    </div>
  );
}
