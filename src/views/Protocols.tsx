// Protokolle (Sitzungs- und Besprechungsprotokolle): Liste mit Filter/Sortierung
// und Detail-/Editieransicht. Enthält ausserdem `MahnModal` (Dialog «Mahnung»),
// das von Accounting.tsx und Invoices.tsx mitbenutzt wird.
//
// Ein Protokoll (`data.protocols`) hat Kopfdaten (Typ, Datum, Ort, Projekt),
// Teilnehmer (intern/extern/manuell, mit Anwesenheitsstatus) und Traktanden mit
// Einträgen vom Typ Information / Beschluss / Aufgabe (Aufgaben mit Verantwortlichem,
// Frist als KW oder Datum und Status). Texte sind HTML aus dem RichEditor.
//
// Nummer: konfigurierbares Format (`settings.protokollNumberFormat`, Standard
// «YYYY-TT-NN»); Typkürzel aus `settings.protokollTypeAbbreviations`. Die Nummer
// wird beim Ändern von Projekt, Datum oder Typ neu berechnet, die laufende Nummer
// bleibt dabei erhalten (siehe `setField`).
// «Folgeprotokoll»: übernimmt ausgewählte Traktanden/offene Aufgaben in ein neues Protokoll.
// Die Detailansicht arbeitet auf einer Kopie (`p`) und schreibt erst mit «Speichern»
// (`isDirty` zeigt ungespeicherte Änderungen). Sortierung der Traktanden und Einträge
// per Drag & Drop. `window.__openProtokoll` öffnet beim Einstieg ein bestimmtes Protokoll
// (von anderen Ansichten gesetzt).

import React, { useState, useEffect, useRef } from "react";
import { PROTOKOLL_TYPES } from "../constants";
import { generateId, formatDate, htmlToText, initialsOf, participantKuerzel, responsibleLabel, protocolApproval, nextProtoNumber, protoScopeKey, protoSeqOf, applyProtoNumberFormat, localISODate } from "../utils";
import { TableToolbar, Header, Modal, FormField, RichEditor, DateInput, ShareButton, SortTh, RowMenu, EmptyState } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import { changeWithUndo, removeWithUndo } from "../undo";
import { openTasks, type OpenTask } from "../today";
import { setLinkedStatus, baselineChanges, entryDue, glyphOf, scheduleOf, TRACK_LABELS, trackItems, upcomingItems } from "../schedule";
import type { AppData, Protocol, ProtocolApproval, ProtocolEntry, ProtocolParticipant, ProtocolTraktandum, ViewProps } from "../types";

/** Auswahl im Dialog «Folgesitzung erstellen»: pro Traktandum, welche Einträge übernommen werden. */
type FolgeSelection = {
  tId: string; tTitle: string; tNr: string; include: boolean;
  items: { id: string; type: string; text: string; include: boolean; isErledigt: boolean; original: ProtocolEntry }[];
};

declare global {
  interface Window {
    /** Einmaliger Hinweis von anderen Ansichten: Id eines Protokolls, das beim Öffnen direkt angezeigt wird. */
    __openProtokoll?: string | null;
  }
}


/** Neues Protokoll, an dem noch nichts eingetragen wurde (kein Titel, Ort, Teilnehmer, Traktandum, Eintrag). */
function isUntouchedProtocol(p: Protocol | undefined): boolean {
  return !!p && !p.title?.trim() && !(p.participants || []).length && !(p.location || "").trim()
    && (p.traktanden || []).every(t => !t.title?.trim() && !(t.items || []).length);
}
export default
function Protokolle({ data, saveAll, setPrintContent, modal, setModal }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent"> & Partial<Pick<ViewProps, "modal" | "setModal">>) {
  const today = localISODate();
  const [showAllTasks, setShowAllTasks] = useState(false);
  const protokolle = data.protocols || [];

  const [detailId, setDetailId] = useState<string | null>(() => {
    const id = window.__openProtokoll || null;
    window.__openProtokoll = null;
    return id;
  });
  const [filter, setFilter] = useState({ search: "", type: "", projectId: "" });
  const [sort, setSort] = useState({ col: "date", dir: -1 });

  const detail = detailId ? protokolle.find(p => p.id === detailId) : null;

  const deleteProtokoll = (id: string) => {
    const p = protokolle.find(x => x.id === id);
    removeWithUndo(`Protokoll ${p?.nummer || ""} gelöscht`, "protocols", x => x.id === id);
  };

  /** Neues Protokoll (optional gleich einem Projekt zugeordnet, z.B. aus dem Projekt-Arbeitsraum) und öffnen. */
  const newProtokoll = (projectId = "") => {
    const proj = projectId ? data.projects.find(x => x.id === projectId) : undefined;
    const defaultType = PROTOKOLL_TYPES[0];
    const abbr = data.settings.protokollTypeAbbreviations || {};
    const typKuerzel = abbr[defaultType] || "SO";
    const { nummer } = nextProtoNumber(protokolle, data.settings.protokollNumberFormat || "YYYY-TT-NN", {
      date: today, projectNumber: proj?.number || "", typKuerzel,
    });
    const p: Protocol = {
      id: generateId(),
      title: "",
      type: defaultType,
      date: today,
      time: "10:00",
      endTime: "",
      location: "",
      projectId: proj?.id || "",
      projectManual: "",
      nummer,
      participants: [],
      traktanden: [{ id: generateId(), nr: "1", title: "", items: [] }],
      nextDate: "",
      verteiler: "",
      createdAt: new Date().toISOString(),
    };
    saveAll({ ...data, protocols: [...protokolle, p] });
    setDetailId(p.id);
  };

  // Protokoll öffnen, während diese Ansicht schon offen ist (Befehlspalette, «Heute», Projekt): App.tsx wechselt
  // nur die Ansicht, die hier schon gemountet ist — ohne diesen Empfänger bliebe die Liste bzw. das alte Protokoll.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setDetailId(id);
      setTimeout(() => { if (window.__openProtokoll === id) window.__openProtokoll = null; });
    };
    window.addEventListener("openProtokoll", onOpen);
    return () => window.removeEventListener("openProtokoll", onOpen);
  }, []);

  // Befehlspalette (App.tsx): «Neues Protokoll»
  /* eslint-disable react-hooks/set-state-in-effect -- einmalige Übergabe aus der Befehlspalette */
  useEffect(() => {
    if (modal?.type !== "newProtocol") return;
    setModal?.(null);
    newProtokoll((modal.projectId as string) || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf neue Aufträge reagieren
  }, [modal?.type]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Ansicht verlassen (Seitenleiste, Befehlspalette): ein unberührtes neues Protokoll ebenfalls entfernen
  const leaveRef = useRef({ detailId, data, saveAll });
  useEffect(() => { leaveRef.current = { detailId, data, saveAll }; });
  // Entwurf des offenen Protokolls (vom Detail gemeldet): beim Verlassen wird Ungespeichertes gespeichert statt
  // verworfen (vorher war ein geänderter Titel nach Zurück/Seitenleiste weg), Unberührtes entfernt
  const draftRef = useRef<{ p: Protocol; dirty: boolean } | null>(null);
  const leaveDetail = () => {
    const { detailId: id, data: d, saveAll: save } = leaveRef.current;
    if (!id) return;
    const list = d.protocols || [];
    const draft = draftRef.current?.p.id === id ? draftRef.current : null;
    draftRef.current = null;
    const cur = draft ? draft.p : list.find(x => x.id === id);
    if (isUntouchedProtocol(cur)) save({ ...d, protocols: list.filter(x => x.id !== id) });
    else if (draft?.dirty) save({ ...d, protocols: list.map(x => x.id === id ? draft.p : x) });
  };
  const leaveDetailRef = useRef(leaveDetail);
  useEffect(() => { leaveDetailRef.current = leaveDetail; });
  useEffect(() => () => leaveDetailRef.current(), []);

  // «Protokolle» in der Seitenleiste, während ein Protokoll offen ist: zurück zur Liste (wie der Zurück-Pfeil)
  useEffect(() => {
    const onReselect = () => {
      if (!leaveRef.current.detailId) return;
      leaveDetailRef.current();
      setDetailId(null);
    };
    window.addEventListener("rapport:reselect-view", onReselect);
    return () => window.removeEventListener("rapport:reselect-view", onReselect);
  }, []);

  // ── Detail-Ansicht ────────────────────────────────────────────
  if (detail) {
    return <ProtokollDetail
      key={detail.id}
      protokoll={detail}
      data={data}
      onBack={() => {
        // Unberührtes neues Protokoll (kein Titel, keine Teilnehmer, keine Einträge) beim Verlassen wieder entfernen —
        // sonst blieb nach jedem Klick auf «Protokoll» eine leere Leiche zurück (E2E 25.11.2026); Geändertes speichern
        leaveDetail();
        setDetailId(null);
      }}
      onDraft={(p, dirty) => { draftRef.current = { p, dirty }; }}
      onSave={p => { saveAll({ ...data, protocols: protokolle.map(x => x.id === p.id ? p : x) }); }}
      onDelete={id => { saveAll({ ...data, protocols: protokolle.filter(x => x.id !== id) }); setDetailId(null); }}
      onOpen={setDetailId}
      setPrintContent={setPrintContent}
      saveAll={saveAll}
    />;
  }

  // ── Listenansicht ─────────────────────────────────────────────

  const filtered = protokolle.filter(p => {
    if (filter.type && p.type !== filter.type) return false;
    if (filter.projectId && p.projectId !== filter.projectId) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const proj = data.projects.find(x => x.id === p.projectId);
      if (![p.title, p.nummer, p.type, proj?.name, p.location].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const sorted = [...filtered].sort((a, b) => {
    const va = sort.col === "date" ? (a.date || "") : sort.col === "type" ? (a.type || "") : sort.col === "nummer" ? (a.nummer || "") : (a.title || "");
    const vb = sort.col === "date" ? (b.date || "") : sort.col === "type" ? (b.type || "") : sort.col === "nummer" ? (b.nummer || "") : (b.title || "");
    return va.localeCompare(vb) * sort.dir;
  });

  // Offene Aufgaben über alle Protokolle (je Stelle nur die neueste Kopie, wie in «Heute» und im Projekt)
  const alleTasks = openTasks(protokolle, data.employees || [], today);
  const taskDone = (t: OpenTask) => changeWithUndo("Aufgabe erledigt", prev => ({
    ...prev, protocols: setLinkedStatus(prev.protocols || [], t.projectId, { protocolId: t.protocolId, entryId: t.entryId, kind: "aufgabe", text: t.textKey }, true),
  }));
  // Pendenzen aus Protokollen ohne Projekt tragen «~Freitext» (protocolScope)
  const projName = (id: string) => data.projects.find(p => p.id === id)?.name || (id.startsWith("~") ? id.slice(1) : "");

  return (
    <div>
      <Header title="Protokolle" action={
        <button className="btn btn-primary" onClick={() => newProtokoll()}>+ Neues Protokoll</button>
      } />

      {/* Offene Aufgaben (Pendenzen) */}
      {alleTasks.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="today-k">Offene Aufgaben <span>{alleTasks.length}</span></div>
          <div className="task-cols">
            {(showAllTasks ? alleTasks : alleTasks.slice(0, 6)).map(t => (
              <div key={t.key} className="task-row">
                <button className={`chk${t.overdue ? " late" : ""}`} onClick={() => taskDone(t)} title="Erledigt" aria-label={`«${t.label}» erledigt`} />
                <button className="task-text" onClick={() => setDetailId(t.protocolId)}>
                  {t.label}<span className="today-meta">{[t.responsible, t.protocolLabel, projName(t.projectId)].filter(Boolean).join(" · ")}</span>
                </button>
                {t.due && <span className={`today-pill${t.overdue ? " late" : ""}`}>{t.overdue ? "überfällig" : `${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.`}</span>}
              </div>
            ))}
          </div>
          {alleTasks.length > 6 && <button className="btn btn-quiet btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAllTasks(v => !v)}>{showAllTasks ? "Weniger anzeigen" : `Alle ${alleTasks.length} anzeigen`}</button>}
        </section>
      )}

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Titel, Nr., Ort…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        <select className="pill" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
          <option value="">Alle Typen</option>
          {PROTOKOLL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="pill" value={filter.projectId} onChange={e => setFilter({ ...filter, projectId: e.target.value })}>
          <option value="">Alle Projekte</option>
          {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {(filter.search || filter.type || filter.projectId) && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilter({ search: "", type: "", projectId: "" })}>Zurücksetzen</button>
        )}
      </div>

      {protokolle.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="description" title="Noch keine Protokolle" text="Halte Sitzungen und Besprechungen mit Teilnehmern, Beschlüssen und Aufgaben fest – offene Aufgaben erscheinen hier gesammelt."
            action={<button className="btn btn-primary" onClick={() => newProtokoll()}>+ Neues Protokoll</button>} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="filter_alt_off" title="Keine Treffer" text="Kein Protokoll passt zu den Filtern." />
        </div>
      ) : (<>
        <TableToolbar detached summary={<><b className="num">{filtered.length}</b> {filtered.length === 1 ? "Protokoll" : "Protokolle"}</>} />
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="nummer" style={{ width: 110 }}>Nr.</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 100 }}>Datum</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="type" style={{ width: 160 }}>Typ</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="title">Titel</SortTh>
                <th style={{ width: 160 }}>Projekt</th>
                <th style={{ width: 50, textAlign: "center" }}>TN</th>
                <th style={{ width: 50, textAlign: "center" }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle" }}>push_pin</span></th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const proj = data.projects.find(x => x.id === p.projectId);
                const anwesend = (p.participants || []).filter(x => x.status === "anwesend").length;
                const total = (p.participants || []).length;
                const offeneTasks = (p.traktanden || []).flatMap(t => (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt")).length;
                return (
                  <tr key={p.id} className="row-link" onClick={() => setDetailId(p.id)}>
                    <td style={{ whiteSpace: "nowrap" }}><strong style={{ color: "var(--accent)" }}>{p.nummer}</strong></td>
                    <td>{formatDate(p.date)}</td>
                    <td><span style={{ fontSize: 11, color: "var(--text3)" }}>{p.type}</span></td>
                    <td><strong>{p.title || <span style={{ color: "var(--text5)", fontWeight: 400 }}>Kein Titel</span>}</strong></td>
                    <td style={{ color: "var(--text4)", fontSize: 12 }}>{proj?.name || p.projectManual || "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 12, color: "var(--text4)" }}>{total > 0 ? `${anwesend}/${total}` : "—"}</td>
                    <td style={{ textAlign: "center" }}>
                      {offeneTasks > 0 && <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>{offeneTasks}</span>}
                    </td>
                    <td className="row-actions" onClick={e => e.stopPropagation()}>
                      <RowMenu items={[
                        { label: "Bearbeiten", icon: "edit", onClick: () => setDetailId(p.id) },
                        { label: "PDF", icon: "picture_as_pdf", onClick: () => setPrintContent({ type: "protokoll", protokoll: p, data, settings: data.settings }) },
                        { label: "Löschen", icon: "delete", danger: true, onClick: () => deleteProtokoll(p.id) },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
      )}
    </div>
  );
}


export
function ItemEditor({ item, pos, handle, today, whoListId, onUpdate, onRemove }: {
  tId?: string; item: ProtocolEntry; pos: string; handle: React.ReactNode; today: string;
  /** id der <datalist> mit den Teilnehmer-Kürzeln für das Feld «Wer» */
  whoListId?: string;
  onUpdate: (changes: Partial<ProtocolEntry>) => void; onRemove: () => void;
}) {
  // Art der Position als Buchstabe (wie im gedruckten Protokoll): I = Information, B = Beschluss, A = Aufgabe.
  const kinds = [["info", "I", "Information"], ["beschluss", "B", "Beschluss"], ["aufgabe", "A", "Aufgabe"]] as const;
  const year = new Date().getFullYear();
  const changeKind = (type: string) => {
    if (type === item.type) return;
    // Felder der neuen Art vorbelegen, vorhandene Werte (z.B. beim Zurückwechseln) bleiben erhalten
    if (type === "aufgabe") onUpdate({ type, responsible: item.responsible || "", dueDateType: item.dueDateType || "kw", dueKW: item.dueKW ?? "", dueYear: item.dueYear || year, dueDate: item.dueDate || "", status: item.status || "offen" });
    else if (type === "beschluss") onUpdate({ type, date: item.date || today });
    else onUpdate({ type });
  };
  const small: React.CSSProperties = { height: 28, fontSize: 11 };
  const label: React.CSSProperties = { fontSize: 11, color: "var(--text4)" };

  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border2)", alignItems: "flex-start" }}>
      {handle}
      <div style={{ width: 34, flexShrink: 0, paddingTop: 7, fontSize: 12, color: "var(--text4)", fontVariantNumeric: "tabular-nums" }}>{pos}</div>
      <div style={{ display: "flex", gap: 3, flexShrink: 0, paddingTop: 4 }}>
        {kinds.map(([id, letter, title]) => (
          <button key={id} title={title} onClick={() => changeKind(id)} style={{
            width: 22, height: 22, padding: 0, fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
            border: "1px solid " + (item.type === id ? "var(--text)" : "var(--border)"),
            background: item.type === id ? "var(--text)" : "transparent",
            color: item.type === id ? "var(--bg)" : "var(--text4)",
          }}>{letter}</button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <RichEditor value={item.text || ""} onChange={html => onUpdate({ text: html })} minHeight={44} compact />
        {item.type === "beschluss" && (
          <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
            <span style={label}>Beschluss vom</span>
            <DateInput value={item.date || today} onChange={e => onUpdate({ date: e.target.value })} style={{ ...small, width: 140 }} />
          </div>
        )}
        {item.type === "aufgabe" && (
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={label}>Wer</span>
            <input value={item.responsible || ""} onChange={e => onUpdate({ responsible: e.target.value })}
              list={whoListId} placeholder="Kürzel oder Name" style={{ ...small, flex: "1 1 140px", maxWidth: 200 }} />
            <span style={label}>Termin</span>
            <select value={item.dueDateType || "kw"} onChange={e => onUpdate({ dueDateType: e.target.value })} style={{ ...small, width: 70 }}>
              <option value="kw">KW</option>
              <option value="datum">Datum</option>
            </select>
            {(item.dueDateType || "kw") === "kw" ? (
              <>
                <input type="number" min={1} max={53} value={item.dueKW || ""} onChange={e => onUpdate({ dueKW: e.target.value === "" ? "" : String(Math.max(1, Math.min(53, Math.round(+e.target.value) || 1))) })} placeholder="KW" style={{ ...small, width: 60 }} />
                <input type="number" min={2024} max={2035} value={item.dueYear || year} onChange={e => onUpdate({ dueYear: +e.target.value })} style={{ ...small, width: 72 }} />
              </>
            ) : (
              <DateInput value={item.dueDate || ""} onChange={e => onUpdate({ dueDate: e.target.value })} style={{ ...small, width: 140 }} />
            )}
            <select value={item.status || "offen"} onChange={e => onUpdate({ status: e.target.value })}
              style={{ ...small, width: 100, fontWeight: item.status === "erledigt" ? 400 : 600, color: item.status === "erledigt" ? "var(--text4)" : "var(--text)" }}>
              <option value="offen">Offen</option>
              <option value="in Arbeit">In Arbeit</option>
              <option value="erledigt">Erledigt</option>
            </select>
          </div>
        )}
      </div>
      <button onClick={onRemove} title="Position löschen"
        style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", padding: 0, marginTop: 6, flexShrink: 0 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
    </div>
  );
}

export
function ProtokollDetail({ protokoll, data, onBack, onSave, onDelete, onOpen, setPrintContent, saveAll, onDraft }: {
  protokoll: Protocol; data: AppData; onBack: () => void; onSave: (p: Protocol) => void; onDelete: (id: string) => void;
  /** meldet den aktuellen Entwurf (für Speichern beim Verlassen) */
  onDraft?: (p: Protocol, dirty: boolean) => void;
  /** anderes Protokoll öffnen (z.B. die eben erstellte Folgesitzung) */
  onOpen: (id: string) => void;
  setPrintContent: ViewProps["setPrintContent"]; saveAll: ViewProps["saveAll"];
}) {
  const [p, setP] = useState<Protocol>(() => JSON.parse(JSON.stringify(protokoll)));
  const isDirty = JSON.stringify(p) !== JSON.stringify(protokoll);
  useEffect(() => { onDraft?.(p, isDirty); });
  const today = localISODate();
  const [showFolge, setShowFolge] = useState(false);
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [folgeSelection, setFolgeSelection] = useState<FolgeSelection[] | null>(null); // built on open

  const save = () => onSave(p);
  // ⌘S / Ctrl+S speichert bei ungespeicherten Änderungen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && isDirty) { e.preventDefault(); onSave(p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDirty, p, onSave]);
  const setField = <K extends keyof Protocol>(k: K, v: Protocol[K]) => setP(prev => {
    const updated = { ...prev, [k]: v };
    if (k === "projectId" || k === "date" || k === "type") {
      const abbr = data.settings.protokollTypeAbbreviations || {};
      const fmt = data.settings.protokollNumberFormat || "YYYY-TT-NN";
      const ctxOf = (x: Protocol) => ({ date: x.date, projectNumber: data.projects.find(pr => pr.id === x.projectId)?.number || "", typKuerzel: abbr[x.type] || "SO" });
      const ctx = ctxOf(updated);
      // Gleicher Kreis (Projekt/Jahr/Typ, soweit im Format): laufende Nummer behalten; sonst die nächste im neuen Kreis
      if (protoScopeKey(fmt, ctxOf(prev)) === protoScopeKey(fmt, ctx)) {
        const seq = protoSeqOf(prev.nummer, fmt) ?? 1;
        updated.nummer = applyProtoNumberFormat(fmt, { ...ctx, seq });
      } else {
        updated.nummer = nextProtoNumber(data.protocols || [], fmt, ctx, prev.id).nummer;
      }
    }
    return updated;
  });

  // ── Teilnehmer ────────────────────────────────────────────────
  const proj = data.projects.find(x => x.id === p.projectId);
  const projectContactPersons = proj ? (proj.projectContacts || []).flatMap(pc => {
    const firm = (data.persons || []).find(c => c.id === pc.contactId);
    if (!firm) return [];
    const firmPersons = firm.contacts || [];
    if (pc.personIds && pc.personIds.length > 0) {
      return firmPersons.filter(fp => pc.personIds!.includes(fp.id)).map(fp => ({
        id: `pc-${fp.id}`,
        name: fp.name,
        role: [fp.position, firm.name].filter(Boolean).join(" · "),
        source: "extern",
      }));
    }
    // No specific persons selected — show firm entry (if it has no contacts) or all persons
    if (firmPersons.length === 0) {
      return [{ id: `pcf-${firm.id}`, name: firm.name, role: firm.type || "Beteiligter", source: "extern" }];
    }
    return firmPersons.map(fp => ({
      id: `pc-${fp.id}`,
      name: fp.name,
      role: [fp.position, firm.name].filter(Boolean).join(" · "),
      source: "extern",
    }));
  }) : [];

  const projectMembers = proj?.internalMembers?.length
    ? (data.employees || []).filter(e => proj.internalMembers!.includes(e.id))
    : (data.employees || []);

  const allPersons: ProtocolParticipant[] = [
    ...projectMembers.map(e => ({ id: `emp-${e.id}`, name: e.name, role: e.role || "Mitarbeiter", source: "intern" })),
    ...projectContactPersons,
    ...(data.persons || []).flatMap(c => {
      if (c.contacts && c.contacts.length > 0) {
        return c.contacts.map(ct => ({
          id: `cnt-${ct.id}`,
          name: ct.name,
          role: [ct.position, c.name].filter(Boolean).join(" · "),
          source: "extern",
        }));
      }
      return [{ id: `cli-${c.id}`, name: c.name, role: "Auftraggeber", source: "extern" }];
    }),
  ];

  const addParticipant = (personId: string) => {
    if (!personId || p.participants.some(x => x.id === personId)) return;
    const person = allPersons.find(x => x.id === personId);
    if (!person) return;
    setP(prev => ({ ...prev, participants: [...prev.participants, { ...person, status: "anwesend", kuerzel: initialsOf(person.name) }] }));
  };

  // Eigener Dialog statt window.prompt (im Tauri-WKWebView stumm, der Knopf tat dort nichts)
  const [manual, setManual] = useState<{ name: string; role: string } | null>(null);
  const addManualParticipant = () => {
    const name = manual?.name.trim();
    if (!name) return;
    setP(prev => ({ ...prev, participants: [...prev.participants, { id: generateId(), name, role: manual!.role.trim(), source: "manuell", status: "anwesend", kuerzel: initialsOf(name) }] }));
    setManual(null);
  };

  const setParticipantStatus = (id: string, status: string) =>
    setP(prev => ({ ...prev, participants: prev.participants.map(x => x.id === id ? { ...x, status } : x) }));

  const setParticipantKuerzel = (id: string, kuerzel: string) =>
    setP(prev => ({ ...prev, participants: prev.participants.map(x => x.id === id ? { ...x, kuerzel } : x) }));

  const removeParticipant = (id: string) =>
    setP(prev => ({ ...prev, participants: prev.participants.filter(x => x.id !== id) }));

  // ── Traktanden ────────────────────────────────────────────────
  const addTraktandum = () => {
    const maxNr = Math.max(0, ...(p.traktanden || []).map(t => parseInt(t.nr) || 0));
    setP(prev => ({ ...prev, traktanden: [...(prev.traktanden || []), { id: generateId(), nr: String(maxNr + 1), title: "", items: [] }] }));
  };

  /**
   * Terminprogramm des Projekts als Traktandum «Terminprogramm»: Termine der nächsten 4 Wochen ab Sitzungsdatum
   * und, falls ein Stand eingefroren ist, die Verschiebungen dagegen (schedule.ts).
   */
  const projectSchedule = scheduleOf((data.projects || []).find(x => x.id === p.projectId));
  const insertSchedule = () => {
    const from = p.date || localISODate();
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
    const entries: ProtocolEntry[] = upcomingItems(projectSchedule.items, from, 28).map(it => ({
      id: generateId(), type: "info",
      text: esc(`${glyphOf(it) || "▬"} ${it.kind === "milestone" ? fmt(it.start) : `${fmt(it.start)} – ${fmt(it.end)}`} ${it.label}${projectSchedule.items.some(o => o.track !== it.track) ? ` (${it.track === "bau" ? "Bau" : "Planung"})` : ""}`),
    }));
    if (!entries.length) entries.push({ id: generateId(), type: "info", text: "Keine Termine in den nächsten 4 Wochen." });
    for (const t of ["planung", "bau"] as const) {
      const base = projectSchedule.baselines?.[t];
      const ch = baselineChanges(trackItems(projectSchedule, t), base).slice(0, 8);
      if (base && ch.length) entries.push({
        id: generateId(), type: "info",
        text: esc(`${TRACK_LABELS[t]}: Verschiebungen gegenüber Stand vom ${formatDate(base.savedAt.slice(0, 10))}: ${ch.map(c => `${c.item.label} ${c.days > 0 ? "+" : ""}${c.days} T`).join(", ")}`),
      });
    }
    const maxNr = Math.max(0, ...(p.traktanden || []).map(t => parseInt(t.nr) || 0));
    setP(prev => ({ ...prev, traktanden: [...(prev.traktanden || []), { id: generateId(), nr: String(maxNr + 1), title: "Terminprogramm", items: entries }] }));
  };

  const setTraktandum = (id: string, changes: Partial<ProtocolTraktandum>) =>
    setP(prev => ({ ...prev, traktanden: (prev.traktanden || []).map(t => t.id === id ? { ...t, ...changes } : t) }));

  const removeTraktandum = (id: string) =>
    setP(prev => ({ ...prev, traktanden: (prev.traktanden || []).filter(t => t.id !== id) }));

  const addItem = (tId: string, type: string) => {
    const item: ProtocolEntry = type === "aufgabe"
      ? { id: generateId(), type, text: "", responsible: "", dueDateType: "kw", dueKW: "", dueYear: new Date().getFullYear(), dueDate: "", status: "offen" }
      : type === "beschluss"
      ? { id: generateId(), type, text: "", date: today }
      : { id: generateId(), type: "info", text: "" };
    setP(prev => ({ ...prev, traktanden: (prev.traktanden || []).map(t => t.id === tId ? { ...t, items: [...(t.items || []), item] } : t) }));
  };

  const setItem = (tId: string, iId: string, changes: Partial<ProtocolEntry>) =>
    setP(prev => ({ ...prev, traktanden: (prev.traktanden || []).map(t => t.id === tId ? { ...t, items: (t.items || []).map(it => it.id === iId ? { ...it, ...changes } : it) } : t) }));

  const removeItem = (tId: string, iId: string) =>
    setP(prev => ({ ...prev, traktanden: (prev.traktanden || []).map(t => t.id === tId ? { ...t, items: (t.items || []).filter(it => it.id !== iId) } : t) }));

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    anwesend: { label: "Anwesend", color: "var(--positive)", bg: "var(--positive-bg)" },
    entschuldigt: { label: "Entschuldigt", color: "var(--warning)", bg: "var(--warning-bg)" },
    abwesend: { label: "Abwesend", color: "var(--negative)", bg: "var(--negative-bg)" },
    eingeladen: { label: "Eingeladen", color: "var(--info)", bg: "var(--info-bg)" },
  };

  const unaddedPersons = allPersons.filter(x => !p.participants.some(pt => pt.id === x.id));

  // ── Drag & Drop ───────────────────────────────────────────────
  // Pointer-based drag (reliable in Tauri/WKWebView — HTML5 drag API is not)
  const dragItem = React.useRef<{ kind: "traktandum" | "item"; idx: number; tId?: string } | null>(null);
  const dragOver = React.useRef<{ idx: number } | null>(null);
  const [dragOverTraktandum, setDragOverTraktandum] = React.useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = React.useState<{ tId: string; idx: number } | null>(null);
  const [draggingTraktandum, setDraggingTraktandum] = React.useState<number | null>(null);
  const [draggingItem, setDraggingItem] = React.useState<{ tId: string; idx: number } | null>(null);

  const commitDrag = () => {
    const { kind, idx: from, tId } = dragItem.current || ({} as Partial<NonNullable<typeof dragItem.current>>);
    const to = dragOver.current?.idx;
    dragItem.current = null;
    dragOver.current = null;
    setDragOverTraktandum(null);
    setDragOverItem(null);
    setDraggingTraktandum(null);
    setDraggingItem(null);
    if (from == null || to == null || from === to) return;
    if (kind === "traktandum") {
      setP(prev => {
        const arr = [...(prev.traktanden || [])];
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        return { ...prev, traktanden: arr };
      });
    } else if (kind === "item") {
      setP(prev => ({
        ...prev,
        traktanden: (prev.traktanden || []).map(t => {
          if (t.id !== tId) return t;
          const arr = [...(t.items || [])];
          const [moved] = arr.splice(from, 1);
          arr.splice(to, 0, moved);
          return { ...t, items: arr };
        }),
      }));
    }
  };

  React.useEffect(() => {
    const up = () => { if (dragItem.current) commitDrag(); };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  const startDragTraktandum = (idx: number) => {
    dragItem.current = { kind: "traktandum", idx };
    dragOver.current = { idx };
    setDraggingTraktandum(idx);
  };
  const enterTraktandum = (idx: number) => {
    if (dragItem.current?.kind !== "traktandum") return;
    dragOver.current = { idx };
    setDragOverTraktandum(idx);
  };
  const startDragItem = (tId: string, idx: number) => {
    dragItem.current = { kind: "item", idx, tId };
    dragOver.current = { idx };
    setDraggingItem({ tId, idx });
  };
  const enterItem = (tId: string, idx: number) => {
    if (dragItem.current?.kind !== "item" || dragItem.current?.tId !== tId) return;
    dragOver.current = { idx };
    setDragOverItem({ tId, idx });
  };

  return (
    <div>
      {ConfirmModalEl}
      {/* Vorschläge für «Wer»: Kürzel der Teilnehmer */}
      <datalist id={`wer-${p.id}`}>
        {p.participants.map(tn => <option key={tn.id} value={participantKuerzel(tn)}>{tn.name}</option>)}
      </datalist>
      {/* Kopf als Band wie bei den Projekten; der Titel ist direkt editierbar */}
      <header className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <button className="btn btn-quiet btn-sm" onClick={onBack} style={{ marginLeft: -10 }}><span className="msr" style={{ fontSize: 16 }}>arrow_back</span>Protokolle</button>
          {isDirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>● Ungespeichert</span>}
        </div>
      <div className="page-head-row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <input
            className="title-input"
            value={p.title}
            onChange={e => setField("title", e.target.value)}
            placeholder="Protokolltitel…"
          />
          <div className="page-crumb" style={{ marginTop: 4, marginBottom: 0 }}>
            {p.nummer}
            {p.type && <span> · {p.type}</span>}
            {(() => { const proj = data.projects.find(x => x.id === p.projectId); return proj?.number ? <span style={{ color: "var(--accent)", marginLeft: 8, fontWeight: 600 }}>{proj.number}</span> : null; })()}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={async () => { if (await askConfirm("Protokoll löschen?")) onDelete(p.id); }}>Löschen</button>
          <button className="btn btn-ghost" onClick={() => setShowFolge(true)} title="Neue Sitzung auf Basis dieses Protokolls erstellen">↪ Folgesitzung</button>
          <ShareButton options={[{ label: "PDF", onClick: () => setPrintContent({ type: "protokoll", protokoll: p, data, settings: data.settings }) }]} />
          {isDirty
            ? <button className="btn btn-primary" onClick={save} title="Speichern (⌘S)">Speichern</button>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, fontSize: 13, color: "var(--text4)" }}>
                <span className="msr" style={{ fontSize: 17 }}>check_circle</span>Gespeichert
              </span>}
        </div>
      </div>
      </header>

      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>

        {/* ── LINKE SPALTE: Metadaten + Traktanden ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Kopfdaten */}
          <div className="card">
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>SITZUNGSDETAILS</div>
            {/* Typ breiter als Datum/Zeiten: «Planungssitzung» soll nicht abgeschnitten werden (.form-row-wide-first) */}
            <div className="form-row form-row-wide-first">
              <FormField label="Typ">
                <select value={p.type} onChange={e => setField("type", e.target.value)}>
                  {PROTOKOLL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Datum">
                <DateInput value={p.date} onChange={e => setField("date", e.target.value)} />
              </FormField>
              <FormField label="Von">
                <input type="time" value={p.time || ""} onChange={e => setField("time", e.target.value)} />
              </FormField>
              <FormField label="Bis">
                <input type="time" value={p.endTime || ""} onChange={e => setField("endTime", e.target.value)} />
              </FormField>
            </div>
            <div className="form-row">
              <FormField label="Ort / Raum">
                <input value={p.location || ""} onChange={e => setField("location", e.target.value)} placeholder="z.B. Büro Studio, Baustelle…" />
              </FormField>
              <FormField label="Projekt">
                <select value={p.projectId || ""} onChange={e => setField("projectId", e.target.value)}>
                  <option value="">— kein Projekt —</option>
                  {data.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </FormField>
            </div>
            {!p.projectId && (
              <FormField label="Projekt (manuell)">
                <input value={p.projectManual || ""} onChange={e => setField("projectManual", e.target.value)} placeholder="Projektbezeichnung" />
              </FormField>
            )}
            <div className="form-row">
              <FormField label="Nächste Sitzung">
                <DateInput value={p.nextDate || ""} onChange={e => setField("nextDate", e.target.value)} />
              </FormField>
              <FormField label="Verteiler">
                <input value={p.verteiler || ""} onChange={e => setField("verteiler", e.target.value)} placeholder="z.B. alle TN, Archiv…" />
              </FormField>
            </div>
            {(() => {
              const office = protocolApproval({}, data.settings);
              const eff = protocolApproval(p, data.settings);
              const labels: Record<ProtocolApproval, string> = { unterschrift: "Unterschriftenfelder", stillschweigend: "Stillschweigend nach Frist", keine: "Kein Vermerk" };
              return (
                <div className="form-row">
                  <FormField label="Genehmigung">
                    <select value={p.approval || ""} onChange={e => setField("approval", (e.target.value || undefined) as ProtocolApproval | undefined)}>
                      <option value="">Büro-Vorgabe ({labels[office.mode]})</option>
                      {(Object.keys(labels) as ProtocolApproval[]).map(k => <option key={k} value={k}>{labels[k]}</option>)}
                    </select>
                  </FormField>
                  {eff.mode === "stillschweigend" ? (
                    <FormField label="Frist (Stunden)">
                      <input type="number" min={1} value={p.approvalHours ?? ""} placeholder={String(office.hours)}
                        onChange={e => setField("approvalHours", e.target.value === "" ? undefined : Math.max(1, +e.target.value))} />
                    </FormField>
                  ) : <div style={{ flex: 1 }} />}
                </div>
              );
            })()}
          </div>

          {/* Positionen: Traktanden mit nummerierten Einträgen (I = Information, B = Beschluss, A = Aufgabe) – per Drag & Drop sortierbar */}
          <div className="card">
            {(p.traktanden || []).map((t, ti) => {
              const isDragTarget = dragOverTraktandum === ti;
              return (
                <div
                  key={t.id}
                  onMouseEnter={() => enterTraktandum(ti)}
                  style={{
                    marginBottom: 28,
                    outline: isDragTarget ? "2px dashed var(--text4)" : "none", outlineOffset: 6, borderRadius: 4,
                    opacity: draggingTraktandum === ti ? 0.5 : 1, transition: "outline 0.1s",
                  }}
                >
                  {/* Traktandum-Kopf */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", paddingBottom: 6, borderBottom: "2px solid var(--text)" }}>
                    <div title="Verschieben" style={{ cursor: "grab", color: "var(--text4)", fontSize: 14, flexShrink: 0, userSelect: "none" }}
                      onMouseDown={e => { e.preventDefault(); startDragTraktandum(ti); }}>⠿</div>
                    <input value={t.nr} onChange={e => setTraktandum(t.id, { nr: e.target.value })} title="Nummer"
                      style={{ width: 40, height: 30, padding: "0 4px", fontSize: 15, fontWeight: 700, background: "none", border: "none", borderRadius: 0, color: "var(--text)" }} />
                    <input value={t.title} onChange={e => setTraktandum(t.id, { title: e.target.value })} placeholder="Traktandentitel…"
                      style={{ flex: 1, height: 30, padding: "0 4px", fontSize: 15, fontWeight: 600, background: "none", border: "none", borderRadius: 0, color: "var(--text)" }} />
                    {(p.traktanden || []).length > 1 && (
                      <button onClick={() => removeTraktandum(t.id)} title="Traktandum löschen"
                        style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", padding: 0 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    )}
                  </div>

                  {/* Positionen */}
                  {(t.items || []).map((item, ii) => {
                    const isItemTarget = dragOverItem?.tId === t.id && dragOverItem?.idx === ii;
                    return (
                      <div key={item.id} onMouseEnter={() => enterItem(t.id, ii)}
                        style={{ outline: isItemTarget ? "2px dashed var(--text4)" : "none", outlineOffset: 1, borderRadius: 4, opacity: draggingItem?.tId === t.id && draggingItem?.idx === ii ? 0.4 : 1, transition: "outline 0.1s" }}>
                        <ItemEditor
                          tId={t.id}
                          item={item}
                          pos={`${t.nr}.${ii + 1}`}
                          handle={
                            <div title="Verschieben" style={{ cursor: "grab", color: "var(--text4)", fontSize: 12, flexShrink: 0, marginTop: 7, userSelect: "none" }}
                              onMouseDown={e => { e.preventDefault(); startDragItem(t.id, ii); }}>⠿</div>
                          }
                          today={today}
                          whoListId={`wer-${p.id}`}
                          onUpdate={changes => setItem(t.id, item.id, changes)}
                          onRemove={() => removeItem(t.id, item.id)}
                        />
                      </div>
                    );
                  })}

                  {/* Position hinzufügen */}
                  <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text4)" }}>Position hinzufügen:</span>
                    {[["info", "Information"], ["beschluss", "Beschluss"], ["aufgabe", "Aufgabe"]].map(([type, label]) => (
                      <button key={type} className="btn btn-ghost btn-sm" onClick={() => addItem(t.id, type)}>{label}</button>
                    ))}
                  </div>
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={addTraktandum}>+ Traktandum hinzufügen</button>
              {projectSchedule.items.length > 0 && (
                <button className="btn btn-ghost" onClick={insertSchedule}
                  title="Termine der nächsten 4 Wochen ab Sitzungsdatum aus dem Terminprogramm, dazu Verschiebungen gegenüber dem eingefrorenen Stand">
                  + Termine aus Terminprogramm
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── RECHTE SPALTE: Teilnehmer + Aufgaben-Zusammenfassung ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Teilnehmer */}
          <div className="card">
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>TEILNEHMER ({p.participants.length})</div>

            {/* Hinzufügen */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <select defaultValue="" onChange={e => { addParticipant(e.target.value); e.target.value = ""; }}
                style={{ flex: 1, height: 32, fontSize: 12 }}>
                <option value="">+ Person hinzufügen…</option>
                {unaddedPersons.length > 0 && <optgroup label="Intern">
                  {unaddedPersons.filter(x => x.source === "intern").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>}
                {unaddedPersons.filter(x => x.source === "extern").length > 0 && <optgroup label="Kunden">
                  {unaddedPersons.filter(x => x.source === "extern").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>}
              </select>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "0 10px", whiteSpace: "nowrap", height: 32 }} onClick={() => setManual({ name: "", role: "" })}>+ Manuell</button>
            </div>

            {/* Teilnehmerliste */}
            {p.participants.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text4)", padding: "8px 0" }}>Noch keine Teilnehmer</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {p.participants.map(tn => {
                  const sc = statusConfig[tn.status as string] || statusConfig.anwesend;
                  return (
                    <div key={tn.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border2)" }}>
                      <input value={tn.kuerzel ?? ""} placeholder={initialsOf(tn.name)} title="Kürzel (erscheint im Protokoll bei «Wer»)"
                        onChange={e => setParticipantKuerzel(tn.id, e.target.value.toUpperCase().slice(0, 4))}
                        style={{ width: 46, height: 26, padding: "0 4px", fontSize: 11, fontWeight: 700, textAlign: "center", borderRadius: 4, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tn.name}</div>
                        {tn.role && <div style={{ fontSize: 10, color: "var(--text4)" }}>{tn.role}</div>}
                      </div>
                      <select value={tn.status} onChange={e => setParticipantStatus(tn.id, e.target.value)}
                        style={{ height: 26, fontSize: 10, fontWeight: 600, color: sc.color, background: "transparent", border: `1px solid color-mix(in srgb, ${sc.color} 25%, transparent)`, borderRadius: 3, padding: "0 4px", maxWidth: 110 }}>
                        {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <button onClick={() => removeParticipant(tn.id)}
                        style={{ background: "none", border: "none", color: "var(--text4)", cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Anwesenheits-Statistik */}
            {p.participants.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border2)", display: "flex", gap: 12, fontSize: 11 }}>
                {Object.entries(statusConfig).map(([k, v]) => {
                  const count = p.participants.filter(x => x.status === k).length;
                  return count > 0 ? (
                    <div key={k} style={{ color: v.color, fontWeight: 600 }}>{count} {v.label}</div>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Offene Pendenzen: nur was noch zu tun ist; Beschlüsse und erledigte Aufgaben stehen in den Positionen */}
          {(() => {
            const offen = (p.traktanden || []).flatMap(t => (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt").map(it => ({ it, pos: `${t.nr}.${(t.items || []).indexOf(it) + 1}` })));
            if (offen.length === 0) return null;
            return (
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 12 }}>OFFENE PENDENZEN ({offen.length})</div>
                {offen.map(({ it, pos }) => {
                  const due = it.dueDateType === "kw" ? (it.dueKW ? `KW ${it.dueKW}/${it.dueYear || new Date().getFullYear()}` : "") : it.dueDate ? formatDate(it.dueDate) : "";
                  // überfällig auch bei Frist als KW (Freitag der Woche), gleiche Regel wie in den Pendenzen (entryDue)
                  const dueDay = entryDue(it, new Date().getFullYear());
                  const isLate = !!dueDay && dueDay < today;
                  return (
                    <div key={it.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border2)", fontSize: 12 }}>
                      <span style={{ color: "var(--text4)", flexShrink: 0, width: 28 }}>{pos}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: isLate ? "var(--negative)" : "var(--text)" }}>{htmlToText(it.text) || "—"}</div>
                        <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 2 }}>{[responsibleLabel(it.responsible, p.participants), due].filter(Boolean).join(" · ")}{isLate ? " · überfällig" : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {manual && (
        <Modal title="Teilnehmer manuell erfassen" onClose={() => setManual(null)} onSave={addManualParticipant} saveLabel="Hinzufügen">
          <FormField label="Name *">
            <input value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} autoFocus
              onKeyDown={e => { if (e.key === "Enter") addManualParticipant(); }} />
          </FormField>
          <FormField label="Funktion / Firma">
            <input value={manual.role} onChange={e => setManual({ ...manual, role: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") addManualParticipant(); }} />
          </FormField>
        </Modal>
      )}

      {/* ── Folgesitzung-Dialog ── */}
      {showFolge && (() => {
        // Initialisiere Auswahl beim ersten Öffnen
        if (!folgeSelection) {
          const sel = (p.traktanden || []).map(t => ({
            tId: t.id,
            tTitle: t.title,
            tNr: t.nr,
            include: true,
            items: (t.items || []).map(it => ({
              id: it.id,
              type: it.type,
              text: it.text,
              // Aufgaben: offen/in Arbeit → automatisch übernommen; erledigt → nicht
              include: it.type !== "aufgabe" ? false : (it.status || "offen") !== "erledigt",
              isErledigt: it.type === "aufgabe" && (it.status || "offen") === "erledigt",
              original: it,
            })),
          }));
          setFolgeSelection(sel);
          return null;
        }

        const toggleTraktandum = (tId: string) => setFolgeSelection(prev => prev!.map(t => t.tId === tId ? { ...t, include: !t.include } : t));
        const toggleItem = (tId: string, iId: string) => setFolgeSelection(prev => prev!.map(t => t.tId === tId ? { ...t, items: t.items.map(it => it.id === iId ? { ...it, include: !it.include } : it) } : t));

        const createFolge = () => {
          const allProts = data.protocols || [];
          const abbr = data.settings.protokollTypeAbbreviations || {};
          const typKuerzel = abbr[p.type] || "SO";
          const folgeDate = p.nextDate || localISODate();
          const proj = data.projects.find(x => x.id === p.projectId);
          const { nummer: newNummer } = nextProtoNumber(allProts, data.settings.protokollNumberFormat || "YYYY-TT-NN", {
            date: folgeDate, projectNumber: proj?.number || "", typKuerzel,
          });

          const newTraktanden = folgeSelection
            .filter(t => t.include)
            .map(t => ({
              id: generateId(),
              nr: t.tNr,
              title: t.tTitle,
              items: t.items
                .filter(it => it.include)
                .map(it => ({ ...it.original, id: generateId(), status: it.original.type === "aufgabe" ? (it.original.status === "erledigt" ? "erledigt" : it.original.status) : it.original.status })),
            }));

          if (newTraktanden.length === 0) newTraktanden.push({ id: generateId(), nr: "1", title: "", items: [] });

          const folge = {
            id: generateId(),
            title: "",
            type: p.type,
            date: p.nextDate || localISODate(),
            time: p.time || "10:00",
            endTime: p.endTime || "",
            location: p.location || "",
            projectId: p.projectId,
            projectManual: p.projectManual || "",
            nummer: newNummer,
            participants: (p.participants || []).map(pt => ({ ...pt, status: "eingeladen" })),
            traktanden: newTraktanden,
            vorgaenger: p.id,
            nextDate: "",
            verteiler: p.verteiler || "",
            createdAt: new Date().toISOString(),
          };
          // Aktuelles Protokoll und Folgesitzung in einem Schritt speichern: zwei getrennte saveAll-Aufrufe
          // mit dem Stand dieses Renders überschrieben sich gegenseitig (die Folgesitzung ging verloren).
          saveAll(prev => ({ ...prev, protocols: [...(prev.protocols || []).map(x => x.id === p.id ? p : x), folge] }));
          setShowFolge(false);
          setFolgeSelection(null);
          onOpen(folge.id);
        };

        // Art als Buchstabe wie in Bearbeitung und Druck (I = Information, B = Beschluss, A = Aufgabe)
        const typeMarks: Record<string, string> = { info: "I", beschluss: "B", aufgabe: "A" };

        return (
          <Modal title="Folgesitzung erstellen" onClose={() => { setShowFolge(false); setFolgeSelection(null); }} onSave={createFolge} saveLabel="Folgesitzung erstellen" wide>
            <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
              Wähle welche Traktanden und Punkte übernommen werden sollen.
              <span style={{ color: "var(--text4)", marginLeft: 8, fontSize: 12 }}>Offene Aufgaben sind vorausgewählt.</span>
            </div>

            {folgeSelection.map(t => (
              <div key={t.tId} style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", opacity: t.include ? 1 : 0.5 }}>
                {/* Traktandum-Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface2)", borderBottom: t.items.length > 0 ? "1px solid var(--border2)" : "none", cursor: "pointer" }}
                  onClick={() => toggleTraktandum(t.tId)}>
                  <input type="checkbox" checked={t.include} onChange={() => toggleTraktandum(t.tId)} onClick={e => e.stopPropagation()} style={{ width: "auto", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, marginRight: 4 }}>{t.tNr}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{t.tTitle || <span style={{ color: "var(--text4)", fontStyle: "italic" }}>Kein Titel</span>}</span>
                  <span style={{ fontSize: 11, color: "var(--text4)", marginLeft: "auto" }}>{t.items.length} Punkte</span>
                </div>

                {/* Items */}
                {t.items.map(it => (
                  <div key={it.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 14px 8px 28px",
                    borderBottom: "1px solid var(--border2)",
                    background: "transparent",
                    opacity: (!t.include || !it.include) ? 0.45 : 1,
                  }}>
                    <input type="checkbox" checked={it.include && t.include} disabled={!t.include}
                      onChange={() => toggleItem(t.tId, it.id)} style={{ width: "auto", flexShrink: 0, marginTop: 3 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, marginTop: 1, flexShrink: 0, width: 12, color: "var(--text3)" }} title={it.type}>{typeMarks[it.type] || ""}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12 }}>{htmlToText(it.text) || <span style={{ color: "var(--text4)", fontStyle: "italic" }}>Leer</span>}</span>
                      {it.isErledigt && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 8 }}>erledigt</span>}
                      {it.original?.responsible && <span style={{ fontSize: 10, color: "var(--text4)", marginLeft: 8 }}>→ {it.original.responsible}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--surface2)", borderRadius: 6, fontSize: 12, color: "var(--text4)" }}>
              Alle Teilnehmer werden übernommen mit Status «Eingeladen». Datum wird auf «Nächste Sitzung» ({p.nextDate ? formatDate(p.nextDate) : "nicht gesetzt"}) gesetzt.
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── LIEFERSCHEINE ──────────────────────────────────────────────────
