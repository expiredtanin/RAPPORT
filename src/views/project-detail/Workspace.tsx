// Projekt-Arbeitsraum (Beta 26.11): Projektliste links, Phasenleiste, Überblick und Beteiligte.
// Die übrigen Reiter (Stunden, Termine, Honorar, Protokolle) zeigen die bestehenden Karten aus diesem Ordner;
// ProjectDetail.tsx setzt alles zusammen. Logik (Phasenleiste, Pendenzen, Termine) in today.ts.

import { useState } from "react";
import type { AppData, Project, TimeEntry } from "../../types";
import { formatHours, localISODate } from "../../utils";
import { phaseStrip, openTasks, weekAgenda } from "../../today";
import { setLinkedStatus } from "../../schedule";
import { changeWithUndo } from "../../undo";
import { EmptyState } from "../../components/UI";

/** Projektliste links (Suche, Laufend/Abgeschlossen); markiert das offene Projekt. */
export function ProjectList({ data, currentId, onSelect }: { data: AppData; currentId: string; onSelect: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<"laufend" | "archiv">(() => data.projects.find(p => p.id === currentId)?.status === "abgeschlossen" ? "archiv" : "laufend");
  const minsBy = new Map<string, number>();
  const entriesBy = new Map<string, TimeEntry[]>();   // Einträge je Projekt einmal gruppieren (nicht je Listenzeile alle durchsuchen)
  for (const e of data.timeEntries || []) {
    minsBy.set(e.projectId, (minsBy.get(e.projectId) || 0) + (e.minutes || 0));
    const l = entriesBy.get(e.projectId); if (l) l.push(e); else entriesBy.set(e.projectId, [e]);
  }
  const client = (id?: string) => (data.persons || []).find(p => p.id === id)?.name || "";
  const running = data.projects.filter(p => p.status !== "abgeschlossen");
  const archive = data.projects.filter(p => p.status === "abgeschlossen");
  const needle = q.trim().toLowerCase();
  const list = (needle ? data.projects : seg === "laufend" ? running : archive)
    .filter(p => !needle || [p.name, p.number, client(p.clientId)].some(x => (x || "").toLowerCase().includes(needle)))
    .sort((a, b) => (b.number || "").localeCompare(a.number || ""));
  return (
    <aside className="ws-list" aria-label="Projekte">
      <div className="ws-list-head">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Projekt suchen …" aria-label="Projekt suchen" />
        {!needle && (
          <div className="ws-seg">
            <button className={seg === "laufend" ? "on" : ""} onClick={() => setSeg("laufend")}>Laufend {running.length}</button>
            <button className={seg === "archiv" ? "on" : ""} onClick={() => setSeg("archiv")}>Abgeschlossen {archive.length}</button>
          </div>
        )}
      </div>
      <div className="ws-list-items">
        {list.length === 0 && <div className="ws-empty">Keine Projekte</div>}
        {list.map(p => {
          const strip = phaseStrip(p, entriesBy.get(p.id) || []);
          const pct = p.budgetHours ? Math.round(((minsBy.get(p.id) || 0) / 60 / p.budgetHours) * 100) : null;
          return (
            <button key={p.id} className={`ws-item${p.id === currentId ? " on" : ""}${p.status === "abgeschlossen" ? " done" : ""}`} onClick={() => onSelect(p.id)} aria-current={p.id === currentId ? "page" : undefined}>
              <span className="ws-item-top"><b>{p.name}</b><i className="num">{p.number}</i></span>
              <span className="ws-item-sub"><span>{client(p.clientId) || "—"}</span>{pct !== null && <span className="num" style={{ color: pct >= 100 ? "var(--negative)" : pct >= 80 ? "var(--warning)" : undefined }}>{pct} %</span>}</span>
              {strip.length > 0 && <span className="ws-mini">{strip.map(s => <u key={s.id} className={s.state} />)}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/** Phasenleiste der aktivierten SIA-Phasen (erledigt · aktuell · offen). */
export function PhaseBar({ project, entries }: { project: Project; entries: TimeEntry[] }) {
  const strip = phaseStrip(project, entries);
  if (strip.length === 0) return null;
  return (
    <div className="ws-phases" role="list" aria-label="Phasen">
      {strip.map(s => (
        <div key={s.id} role="listitem" className={s.state} title={s.label}>
          {s.label}{s.state === "current" && <span> · jetzt</span>}
        </div>
      ))}
    </div>
  );
}

/** Kennzahl im Überblick. */
export interface WsFigure { label: string; value: string; sub?: string; tone?: "warn" | "neg" }

/**
 * Reiter «Überblick»: Kennzahlen, Phasen-Aufwand (als `phaseCard` hereingereicht), Pendenzen aus Protokollen;
 * rechts nächste Termine, Beteiligte und ein Hinweis bei überzogenen Phasen.
 */
export function OverviewTab({ data, project, figures, phaseCard, overrun, onNachtrag, onOpenTab, canSeeProtocols = true, canSeeMitarbeiter = true }: {
  /** Pendenzen aus Protokollen und Knopf «Protokolle →» nur mit Recht «Protokolle» */
  canSeeProtocols?: boolean;
  /** Stunden je Person (Beteiligte) nur mit Recht «mitarbeiter» */
  canSeeMitarbeiter?: boolean;
  data: AppData;
  project: Project;
  figures: WsFigure[];
  phaseCard: React.ReactNode;
  /** Phasen über Budget (Label) */
  overrun: string[];
  onNachtrag?: () => void;
  onOpenTab: (tab: string) => void;
}) {
  const today = localISODate();
  const tasks = openTasks(data.protocols || [], data.employees || [], today, { projectId: project.id });
  const agenda = weekAgenda(data, today, 28, { projectId: project.id }).slice(0, 6);
  const done = (t: (typeof tasks)[number]) => changeWithUndo("Pendenz erledigt", prev => ({
    ...prev, protocols: setLinkedStatus(prev.protocols || [], t.projectId, { protocolId: t.protocolId, entryId: t.entryId, kind: "aufgabe", text: t.textKey }, true),
  }));
  const openProtocol = (id: string) => window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id } }));
  return (
    <div className="ws-body">
      <div className="ws-col">
        <div className="ws-figs">
          {figures.map(f => (
            <div key={f.label}><small>{f.label}</small><strong className={`num${f.tone ? ` ${f.tone}` : ""}`} title={typeof f.value === "string" ? f.value : undefined}>{f.value}</strong>{f.sub && <em>{f.sub}</em>}</div>
          ))}
        </div>
        {phaseCard}
        {canSeeProtocols && <section className="card">
          <div className="today-k">Pendenzen aus Protokollen {canSeeProtocols && <button className="btn btn-quiet btn-sm" onClick={() => onOpenTab("protokolle")}>Protokolle →</button>}</div>
          {tasks.length === 0 && <div className="today-meta">Keine offenen Aufgaben.</div>}
          {tasks.map(t => (
            <div key={t.key} className="task-row">
              <button className={`chk${t.overdue ? " late" : ""}`} onClick={() => done(t)} title="Erledigt" aria-label={`«${t.label}» erledigt`} />
              <button className="task-text" onClick={() => openProtocol(t.protocolId)}>
                {t.label}<span className="today-meta">{t.responsible ? `${t.responsible} · ` : ""}{t.protocolLabel}</span>
              </button>
              {t.due && <span className={`today-pill${t.overdue ? " late" : ""}`}>{t.overdue ? "überfällig" : `${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.`}</span>}
            </div>
          ))}
        </section>}
      </div>
      <div className="ws-col ws-side">
        <section className="card">
          <div className="today-k">Nächste Termine <button className="btn btn-quiet btn-sm" onClick={() => onOpenTab("termine")}>Terminprogramm →</button></div>
          {agenda.length === 0 && <div className="today-meta">Keine Termine in den nächsten vier Wochen.</div>}
          {agenda.map((a, i) => (
            <div key={i} className="agenda-row" style={{ cursor: "default" }}>
              <span className="agenda-glyph">{a.glyph}</span>
              <span><span className="agenda-label">{a.label}</span><span className="today-meta">{new Date(a.date + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" })}</span></span>
            </div>
          ))}
        </section>
        <PeopleList data={data} project={project} compact onMore={() => onOpenTab("beteiligte")} showHours={canSeeMitarbeiter} />
        {overrun.length > 0 && (
          <section className="card ws-hint">
            <div className="today-k" style={{ color: "var(--accent)" }}>Hinweis</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              {overrun.length === 1 ? `Phase ${overrun[0]} ist` : `Die Phasen ${overrun.join(", ")} sind`} über dem Stundenbudget. Mehraufwand als Nachtrag offerieren?
            </div>
            {onNachtrag && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onNachtrag}>Budget / Offerten öffnen</button>}
          </section>
        )}
      </div>
    </div>
  );
}

/** Beteiligte: Firmen mit gewählten Ansprechpersonen und das Team aus dem Büro (Stunden aus den Zeiteinträgen). */
export function PeopleList({ data, project, compact, onMore, onEdit, showHours = true }: { data: AppData; project: Project; compact?: boolean; onMore?: () => void; onEdit?: () => void; /** Stunden je Person nur mit Recht «mitarbeiter» (Runde 41) */ showHours?: boolean }) {
  const firms = (project.projectContacts || []).map(pc => {
    const firm = (data.persons || []).find(p => p.id === pc.contactId);
    if (!firm) return null;
    const people = (firm.contacts || []).filter(c => (pc.personIds || []).includes(c.id));
    return { firm, people };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const client = (data.persons || []).find(p => p.id === project.clientId);
  const minsBy = new Map<string, number>();
  for (const e of data.timeEntries || []) if (e.projectId === project.id) minsBy.set(e.employeeId, (minsBy.get(e.employeeId) || 0) + (e.minutes || 0));
  const team = (data.employees || []).filter(e => minsBy.has(e.id) || (project.internalMembers || []).includes(e.id))
    .sort((a, b) => (minsBy.get(b.id) || 0) - (minsBy.get(a.id) || 0));
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const rows = [
    ...(client ? [{ key: `c-${client.id}`, av: initials(client.name), name: client.name, role: "Bauherrschaft", right: client.email ? <a href={`mailto:${client.email}`} className="ws-mail" title={client.email}><span className="msr" style={{ fontSize: 17 }}>mail</span></a> : null }] : []),
    ...firms.filter(f => f.firm.id !== client?.id).flatMap(f => f.people.length > 0
      ? f.people.map(c => ({ key: `${f.firm.id}-${c.id}`, av: initials(c.name), name: c.name, role: [c.position, f.firm.name].filter(Boolean).join(" · "), right: c.email ? <a href={`mailto:${c.email}`} className="ws-mail" title={c.email}><span className="msr" style={{ fontSize: 17 }}>mail</span></a> : null }))
      : [{ key: f.firm.id, av: initials(f.firm.name), name: f.firm.name, role: f.firm.type || "Beteiligte", right: null }]),
    ...team.map(e => ({ key: `e-${e.id}`, av: initials(e.name), name: e.name, role: e.role ? `${e.role} (Büro)` : "Büro", right: showHours ? <span className="num" style={{ fontSize: 12, color: "var(--text4)" }}>{formatHours(minsBy.get(e.id) || 0)}</span> : null })),
  ];
  const shown = compact ? rows.slice(0, 5) : rows;
  return (
    <section className="card">
      <div className="today-k">Beteiligte {compact && rows.length > 5 && onMore ? <button className="btn btn-quiet btn-sm" onClick={onMore}>alle {rows.length} →</button> : onEdit ? <button className="btn btn-quiet btn-sm" onClick={onEdit}>Bearbeiten</button> : null}</div>
      {rows.length === 0 && (compact ? <div className="today-meta">Noch niemand zugeordnet.</div> : <EmptyState icon="group" title="Noch keine Beteiligten" text="Bauherrschaft, Fachplaner und Unternehmer in den Projekteinstellungen zuordnen." action={onEdit ? <button className="btn btn-primary" onClick={onEdit}>Beteiligte zuordnen</button> : undefined} />)}
      {shown.map(r => (
        <div key={r.key} className="ws-person">
          <span className="ws-av">{r.av}</span>
          <span style={{ minWidth: 0, flex: 1 }}><span className="agenda-label">{r.name}</span><span className="today-meta">{r.role}</span></span>
          {r.right}
        </div>
      ))}
    </section>
  );
}
