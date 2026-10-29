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

import React, { useState } from "react";
import { PROTOKOLL_TYPES } from "../constants";
import { generateId, formatDate, htmlToText, initialsOf, participantKuerzel, responsibleLabel, protocolApproval, nextProtoSeq, applyProtoNumberFormat, localISODate } from "../utils";
import { Header, Modal, FormField, RichEditor, DateInput, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
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

export default
function Protokolle({ data, saveAll, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent">) {
  const today = localISODate();
  const protokolle = data.protocols || [];

  const [detailId, setDetailId] = useState<string | null>(() => {
    const id = window.__openProtokoll || null;
    window.__openProtokoll = null;
    return id;
  });
  const [filter, setFilter] = useState({ search: "", type: "", projectId: "" });
  const [sort, setSort] = useState({ col: "date", dir: -1 });

  const detail = detailId ? protokolle.find(p => p.id === detailId) : null;

  // hooks must be called before any early return
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const deleteProtokoll = async (id: string) => {
    if (await askConfirm("Protokoll löschen?")) {
      saveAll({ ...data, protocols: protokolle.filter(x => x.id !== id) });
    }
  };

  // ── Detail-Ansicht ────────────────────────────────────────────
  if (detail) {
    return <ProtokollDetail
      protokoll={detail}
      data={data}
      onBack={() => setDetailId(null)}
      onSave={p => { saveAll({ ...data, protocols: protokolle.map(x => x.id === p.id ? p : x) }); }}
      onDelete={id => { saveAll({ ...data, protocols: protokolle.filter(x => x.id !== id) }); setDetailId(null); }}
      setPrintContent={setPrintContent}
      saveAll={saveAll}
    />;
  }

  // ── Listenansicht ─────────────────────────────────────────────

  const newProtokoll = () => {
    const defaultType = PROTOKOLL_TYPES[0];
    const abbr = data.settings.protokollTypeAbbreviations || {};
    const typKuerzel = abbr[defaultType] || "SO";
    const seq = nextProtoSeq(protokolle);
    const nummer = applyProtoNumberFormat(data.settings.protokollNumberFormat || "YYYY-TT-NN", {
      date: today, projectNumber: "", seq, typKuerzel,
    });
    const p: Protocol = {
      id: generateId(),
      title: "",
      type: defaultType,
      date: today,
      time: "10:00",
      endTime: "",
      location: "",
      projectId: "",
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

  // Offene Aufgaben über alle Protokolle
  const alleTasks = protokolle.flatMap(p =>
    (p.traktanden || []).flatMap(t =>
      (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt")
        .map(it => ({ ...it, protokollId: p.id, protokollNr: p.nummer, protokollTitle: p.title, protokollDate: p.date }))
    )
  );

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Protokolle" action={
        <button className="btn btn-primary" onClick={newProtokoll}>+ Neues Protokoll</button>
      } />

      {/* Offene Aufgaben-Banner */}
      {alleTasks.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--warning)", padding: "12px 20px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--warning)", marginBottom: 10, fontWeight: 600 }}>
            → OFFENE AUFGABEN ({alleTasks.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {alleTasks.slice(0, 6).map(t => {
              const due = t.dueDateType === "kw" ? `KW ${t.dueKW}/${t.dueYear || new Date().getFullYear()}` : t.dueDate ? formatDate(t.dueDate) : "—";
              const isLate = t.dueDate && t.dueDateType === "datum" && t.dueDate < today;
              return (
                <div key={t.id} onClick={() => setDetailId(t.protokollId)}
                  style={{ fontSize: 12, padding: "5px 10px", background: isLate ? "var(--negative-bg)" : "var(--surface2)", border: `1px solid ${isLate ? "#e8b0b0" : "var(--border)"}`, borderRadius: 20, cursor: "pointer" }}>
                  <span style={{ color: "var(--text4)", fontSize: 10, marginRight: 6 }}>{t.protokollNr}</span>
                  <strong>{htmlToText(t.text)}</strong>
                  {t.responsible && <span style={{ color: "var(--text4)", marginLeft: 6 }}>→ {t.responsible}</span>}
                  <span style={{ color: isLate ? "var(--negative)" : "var(--text4)", marginLeft: 6, fontSize: 10 }}>{due}</span>
                </div>
              );
            })}
            {alleTasks.length > 6 && <div style={{ fontSize: 12, color: "var(--text4)", padding: "5px 10px" }}>+{alleTasks.length - 6} weitere</div>}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Titel, Nr., Ort…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 200 }} />
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
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>
          <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> Protokolle
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th style={{ width: 130 }}>Nr.</th><th style={{ width: 100 }}>Datum</th><th style={{ width: 160 }}>Typ</th><th>Titel</th><th style={{ width: 160 }}>Projekt</th><th style={{ width: 50 }}>TN</th><th style={{ width: 50 }}>📌</th><th style={{ width: 130 }}></th></tr></thead>
            <tbody><tr><td colSpan={8} className="empty-state">{protokolle.length === 0 ? "Noch keine Protokolle" : "Keine Treffer"}</td></tr></tbody>
          </table>
        </div>
      ) : (
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
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const proj = data.projects.find(x => x.id === p.projectId);
                const anwesend = (p.participants || []).filter(x => x.status === "anwesend").length;
                const total = (p.participants || []).length;
                const offeneTasks = (p.traktanden || []).flatMap(t => (t.items || []).filter(it => it.type === "aufgabe" && it.status !== "erledigt")).length;
                return (
                  <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: "pointer" }}>
                    <td style={{ whiteSpace: "nowrap" }}><strong style={{ color: "#b07848" }}>{p.nummer}</strong></td>
                    <td>{formatDate(p.date)}</td>
                    <td><span style={{ fontSize: 11, color: "var(--text3)" }}>{p.type}</span></td>
                    <td><strong>{p.title || <span style={{ color: "var(--text5)", fontWeight: 400 }}>Kein Titel</span>}</strong></td>
                    <td style={{ color: "var(--text4)", fontSize: 12 }}>{proj?.name || p.projectManual || "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 12, color: "var(--text4)" }}>{total > 0 ? `${anwesend}/${total}` : "—"}</td>
                    <td style={{ textAlign: "center" }}>
                      {offeneTasks > 0 && <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>{offeneTasks}</span>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <ShareButton style={{ fontSize: 12, padding: "5px 10px", marginRight: 4 }}
                        options={[{ label: "PDF", onClick: e => { e.stopPropagation(); setPrintContent({ type: "protokoll", protokoll: p, data, settings: data.settings }); } }]} />
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px", marginRight: 4 }}
                        onClick={e => { e.stopPropagation(); setDetailId(p.id); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                      <button className="btn btn-danger" style={{ fontSize: 12, padding: "5px 10px" }}
                        onClick={e => { e.stopPropagation(); deleteProtokoll(p.id); }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                <input type="number" min={1} max={53} value={item.dueKW || ""} onChange={e => onUpdate({ dueKW: e.target.value })} placeholder="KW" style={{ ...small, width: 60 }} />
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
function ProtokollDetail({ protokoll, data, onBack, onSave, onDelete, setPrintContent, saveAll }: {
  protokoll: Protocol; data: AppData; onBack: () => void; onSave: (p: Protocol) => void; onDelete: (id: string) => void;
  setPrintContent: ViewProps["setPrintContent"]; saveAll: ViewProps["saveAll"];
}) {
  const [p, setP] = useState<Protocol>(() => JSON.parse(JSON.stringify(protokoll)));
  const isDirty = JSON.stringify(p) !== JSON.stringify(protokoll);
  const today = localISODate();
  const [showFolge, setShowFolge] = useState(false);
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [folgeSelection, setFolgeSelection] = useState<FolgeSelection[] | null>(null); // built on open

  const save = () => onSave(p);
  const setField = <K extends keyof Protocol>(k: K, v: Protocol[K]) => setP(prev => {
    const updated = { ...prev, [k]: v };
    if (k === "projectId" || k === "date" || k === "type") {
      const abbr = data.settings.protokollTypeAbbreviations || {};
      const proj = data.projects.find(x => x.id === updated.projectId);
      const typKuerzel = abbr[updated.type] || "SO";
      const groups = (prev.nummer || "").match(/\d+/g) || [];
      const seq = (() => {
        for (let i = groups.length - 1; i >= 0; i--) {
          const n = parseInt(groups[i]);
          if (!(groups[i].length === 4 && n >= 2000 && n <= 2099)) return n;
        }
        return 1;
      })();
      updated.nummer = applyProtoNumberFormat(data.settings.protokollNumberFormat || "YYYY-TT-NN", {
        date: updated.date, projectNumber: proj?.number || "", seq, typKuerzel,
      });
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

  const addManualParticipant = () => {
    const name = prompt("Name der Person:");
    if (!name?.trim()) return;
    const role = prompt("Funktion / Firma (optional):") || "";
    setP(prev => ({ ...prev, participants: [...prev.participants, { id: generateId(), name: name.trim(), role, source: "manuell", status: "anwesend", kuerzel: initialsOf(name.trim()) }] }));
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 12, color: "var(--text4)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>← Protokolle</button>
        {isDirty && <span style={{ fontSize: 11, color: "var(--warning)" }}>● Ungespeichert</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div style={{ flex: 1, marginRight: 20 }}>
          <input
            value={p.title}
            onChange={e => setField("title", e.target.value)}
            placeholder="Protokolltitel…"
            style={{ fontSize: 28, fontFamily: "'Inter', sans-serif", fontWeight: 400, background: "none", border: "none", borderBottom: "2px solid var(--border)", borderRadius: 0, padding: "4px 0", width: "100%", outline: "none", color: "var(--text)" }}
          />
          <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 6 }}>
            {p.nummer}
            {p.type && <span> · {p.type}</span>}
            {(() => { const proj = data.projects.find(x => x.id === p.projectId); return proj?.number ? <span style={{ color: "#b07848", marginLeft: 8, fontWeight: 600 }}>{proj.number}</span> : null; })()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={async () => { if (await askConfirm("Protokoll löschen?")) onDelete(p.id); }}>Löschen</button>
          <button className="btn btn-ghost" onClick={() => setShowFolge(true)} title="Neue Sitzung auf Basis dieses Protokolls erstellen">↪ Folgesitzung</button>
          <ShareButton options={[{ label: "PDF", onClick: () => setPrintContent({ type: "protokoll", protokoll: p, data, settings: data.settings }) }]} />
          <button className="btn btn-primary" onClick={save} style={isDirty ? { background: "var(--positive)" } : {}}>
            {isDirty ? "Speichern ●" : "Gespeichert"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>

        {/* ── LINKE SPALTE: Metadaten + Traktanden ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Kopfdaten */}
          <div className="card">
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", marginBottom: 14 }}>SITZUNGSDETAILS</div>
            <div className="form-row">
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

            <button className="btn btn-ghost" onClick={addTraktandum}>+ Traktandum hinzufügen</button>
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
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "0 10px", whiteSpace: "nowrap", height: 32 }} onClick={addManualParticipant}>+ Manuell</button>
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
                  const isLate = !!it.dueDate && it.dueDateType === "datum" && it.dueDate < today;
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
          const seq = nextProtoSeq(allProts);
          const newNummer = applyProtoNumberFormat(data.settings.protokollNumberFormat || "YYYY-TT-NN", {
            date: folgeDate, projectNumber: proj?.number || "", seq, typKuerzel,
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
          const updated = { ...data, protocols: [...allProts, folge] };
          // Save and navigate to new protokoll
          if (typeof saveAll === "function") saveAll(updated);
          setShowFolge(false);
          setFolgeSelection(null);
          onSave(p); // save current first
          setTimeout(() => {
            window.__openProtokoll = folge.id;
            window.dispatchEvent(new CustomEvent("openProtokoll", { detail: { id: folge.id } }));
          }, 100);
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
