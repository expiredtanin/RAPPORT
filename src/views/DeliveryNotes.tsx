// Lieferscheine: Liste mit Suche/Filter/Sortierung, Erfassen und Bearbeiten
// (Positionen mit Menge und Einheit), PDF-Druck. Kunde und Projekt sind entweder
// verknüpft (Auswahl aus den Stammdaten) oder frei eingetippt (`clientManual`,
// `projectManual`) — z.B. für Lieferungen ausserhalb eines erfassten Projekts.
// Nummern: «LS-<Jahr>-NNN», laufend pro Jahr aus den bestehenden Lieferscheinen
// (`nextNumber`), ohne konfigurierbares Format.

import React, { useState } from "react";
import { generateId, formatDate, linkedClientForNote, localISODate } from "../utils";
import { Header, Modal, FormField, DateInput, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { DeliveryNote, ViewProps } from "../types";

/** Formularstand: wie `DeliveryNote`, aber die Id wird erst beim Speichern vergeben. */
type NoteForm = Omit<DeliveryNote, "id"> & { id?: string };

export default
function DeliveryNotes({ data, saveAll, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent">) {
  const today = localISODate();

  const emptyForm: NoteForm = {
    date: today,
    number: "",
    projectId: "",
    clientId: "",
    clientManual: "",
    projectManual: "",
    deliveryAddress: "",
    notes: "",
    items: [{ id: generateId(), desc: "", qty: 1, unit: "Stk.", note: "" }],
  };

  const [modal, setModal] = useState<string | null>(null); // null | "new" | id
  const [form, setForm] = useState<NoteForm>(emptyForm);
  const [filter, setFilter] = useState({ search: "", projectId: "", clientId: "" });
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const notes = data.deliveryNotes || [];

  // Nummernvergabe
  const nextNumber = () => {
    const year = new Date().getFullYear();
    const rx = new RegExp(`^LS-?${year}-(\\d+)$`, "i");
    const existing = notes.map(n => {
      const m = (n.number || "").match(rx);
      return m ? parseInt(m[1]) : 0;
    });
    const max = existing.length ? Math.max(...existing) : 0;
    return `LS-${year}-${String(max + 1).padStart(3, "0")}`;
  };

  const openNew = () => {
    setForm({ ...emptyForm, number: nextNumber() });
    setModal("new");
  };
  const openEdit = (n: DeliveryNote) => { setForm({ ...n }); setModal(n.id); };
  const closeModal = () => { setModal(null); setForm(emptyForm); };

  const save = () => {
    const isNew = modal === "new";
    const entry: DeliveryNote = { ...form, id: isNew ? generateId() : (modal as string) };
    const updated = isNew
      ? [...notes, { ...entry, createdAt: new Date().toISOString() }]
      : notes.map(n => n.id === modal ? entry : n);
    saveAll({ ...data, deliveryNotes: updated });
    closeModal();
  };

  const del = async (id: string) => {
    if (await askConfirm("Lieferschein löschen?"))
      saveAll({ ...data, deliveryNotes: notes.filter(n => n.id !== id) });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { id: generateId(), desc: "", qty: 1, unit: "Stk.", note: "" }] }));
  const updateItem = (id: string, changes: Partial<DeliveryNote["items"][number]>) => setForm(f => ({ ...f, items: f.items.map(it => it.id === id ? { ...it, ...changes } : it) }));
  const removeItem = (id: string) => setForm(f => ({ ...f, items: f.items.filter(it => it.id !== id) }));

  // Ableitungen für Anzeige
  const getClient = (n: DeliveryNote) => {
    if (n.clientId) return ((data.persons||[])).find(c => c.id === n.clientId)?.name || "—";
    return n.clientManual || "—";
  };
  const getProject = (n: DeliveryNote) => {
    if (n.projectId) return data.projects.find(p => p.id === n.projectId)?.name || "—";
    return n.projectManual || "—";
  };

  // Filter
  const filtered = notes.filter(n => {
    if (filter.projectId && n.projectId !== filter.projectId) return false;
    if (filter.clientId && n.clientId !== filter.clientId) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const text = [n.number, getClient(n), getProject(n), n.notes, ...(n.items || []).map(it => it.desc)].join(" ").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const sorted = [...filtered].sort((a, b) => {
    const va = sort.col === "date" ? (a.date || "") : sort.col === "number" ? (a.number || "") : sort.col === "client" ? getClient(a) : getProject(a);
    const vb = sort.col === "date" ? (b.date || "") : sort.col === "number" ? (b.number || "") : sort.col === "client" ? getClient(b) : getProject(b);
    return va.localeCompare(vb) * sort.dir;
  });

  const UNITS = ["Stk.", "m", "m²", "m³", "kg", "l", "Set", "Blatt", "Rolle", "Palette", "Pkg."];

  // Client-Felder im Modal: verknüpft oder manuell
  const linkedClient = form.clientId ? ((data.persons||[])).find(c => c.id === form.clientId) : null;

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Lieferscheine" action={
        <button className="btn btn-primary" onClick={openNew}>+ Neuer Lieferschein</button>
      } />

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Nr., Kunde, Projekt, Position…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 220 }} />
        <select className="pill" value={filter.clientId} onChange={e => setFilter({ ...filter, clientId: e.target.value })}>
          <option value="">Alle Kunden</option>
          {((data.persons||[])).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="pill" value={filter.projectId} onChange={e => setFilter({ ...filter, projectId: e.target.value })}>
          <option value="">Alle Projekte</option>
          {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {(filter.search || filter.clientId || filter.projectId) && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilter({ search: "", projectId: "", clientId: "" })}>Zurücksetzen</button>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>
          <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> {filtered.length === 1 ? "Lieferschein" : "Lieferscheine"}
        </div>
      </div>

      {/* Tabelle */}
      {sorted.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th style={{ width: 120 }}>Nr.</th><th style={{ width: 100 }}>Datum</th><th style={{ width: 180 }}>Empfänger</th><th>Projekt</th><th style={{ width: 60 }}>Pos.</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody><tr><td colSpan={6} className="empty-state">{notes.length === 0 ? "Noch keine Lieferscheine" : "Keine Treffer"}</td></tr></tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 120 }}>Nr.</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 100 }}>Datum</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="client" style={{ width: 180 }}>Empfänger</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="project">Projekt</SortTh>
                <th style={{ width: 60, textAlign: "center" }}>Pos.</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(n => (
                <tr key={n.id}>
                  <td><strong style={{ color: "#b07848" }}>{n.number || "—"}</strong></td>
                  <td>{formatDate(n.date)}</td>
                  <td>{getClient(n)}</td>
                  <td style={{ color: "var(--text4)" }}>{getProject(n)}</td>
                  <td style={{ textAlign: "center", color: "var(--text4)", fontSize: 12 }}>{(n.items || []).length}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <ShareButton style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }}
                      options={[{ label: "PDF", onClick: () => { const client = linkedClientForNote(n, data); setPrintContent({ type: "lieferschein", note: n, client, settings: data.settings, data }); } }]} />
                    <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }} onClick={() => openEdit(n)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(n.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <Modal title={modal === "new" ? "Neuer Lieferschein" : "Lieferschein bearbeiten"} onClose={closeModal} onSave={save} wide>

          {/* Kopfdaten */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>ALLGEMEIN</div>
          <div className="form-row">
            <FormField label="Nummer">
              <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="LS-2025-001" />
            </FormField>
            <FormField label="Datum">
              <DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </FormField>
          </div>

          {/* Empfänger */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>EMPFÄNGER</div>
          <div className="form-row">
            <FormField label="Kunde (verknüpft)">
              <select value={form.clientId || ""} onChange={e => setForm({ ...form, clientId: e.target.value, clientManual: "", deliveryAddress: "" })}>
                <option value="">— manuell eingeben —</option>
                {((data.persons||[])).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            {!form.clientId && (
              <FormField label="Empfänger (manuell)">
                <input value={form.clientManual} onChange={e => setForm({ ...form, clientManual: e.target.value })} placeholder="Firmen- oder Personenname" />
              </FormField>
            )}
          </div>
          <FormField label="Lieferadresse">
            {form.clientId ? (
              <div style={{ padding: "8px 10px", background: "var(--surface2)", border: "1.5px solid var(--border)", borderRadius: 4, fontSize: 12, color: "var(--text2)", lineHeight: 1.6, minHeight: 60, whiteSpace: "pre-line" }}>
                {linkedClient?.address || <span style={{ color: "var(--text4)", fontStyle: "italic" }}>Keine Adresse beim Kunden hinterlegt</span>}
                <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 6, borderTop: "1px solid var(--border2)", paddingTop: 4 }}>
                  Adresse aus Kundenstamm · unter «Kunden» bearbeitbar
                </div>
              </div>
            ) : (
              <textarea
                value={form.deliveryAddress}
                onChange={e => setForm({ ...form, deliveryAddress: e.target.value })}
                placeholder={"Strasse\nPLZ Ort"}
                style={{ minHeight: 60, resize: "vertical" }}
              />
            )}
          </FormField>

          {/* Projekt */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>PROJEKT</div>
          <div className="form-row">
            <FormField label="Projekt (verknüpft)">
              <select value={form.projectId || ""} onChange={e => setForm({ ...form, projectId: e.target.value, projectManual: "" })}>
                <option value="">— manuell eingeben —</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            {!form.projectId && (
              <FormField label="Projekt (manuell)">
                <input value={form.projectManual} onChange={e => setForm({ ...form, projectManual: e.target.value })} placeholder="Projektbezeichnung" />
              </FormField>
            )}
          </div>

          {/* Positionen */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>POSITIONEN</div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px 6px 0", width: "40%" }}>Beschreibung</th>
                <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "right", padding: "4px 6px", width: 70 }}>Menge</th>
                <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px", width: 80 }}>Einheit</th>
                <th style={{ fontSize: 10, color: "var(--text4)", fontWeight: 500, textAlign: "left", padding: "4px 6px" }}>Bemerkung</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ padding: "4px 6px 4px 0" }}>
                    <input value={it.desc} onChange={e => updateItem(it.id, { desc: e.target.value })} placeholder={`Position ${i + 1}`} style={{ height: 32, fontSize: 12 }} autoFocus={i === form.items.length - 1 && form.items.length > 1} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" min={0} step="0.01" value={it.qty} onChange={e => updateItem(it.id, { qty: +e.target.value })} style={{ height: 32, fontSize: 12, textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <select value={it.unit} onChange={e => updateItem(it.id, { unit: e.target.value })} style={{ height: 32, fontSize: 12 }}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={it.note || ""} onChange={e => updateItem(it.id, { note: e.target.value })} placeholder="optional" style={{ height: 32, fontSize: 12 }} />
                  </td>
                  <td style={{ padding: "4px 0 4px 4px" }}>
                    {form.items.length > 1 && (
                      <button onClick={() => removeItem(it.id)} style={{ background: "none", border: "none", color: "var(--text5)", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost" style={{ fontSize: 12, marginBottom: 14 }} onClick={addItem}>+ Position hinzufügen</button>

          {/* Notizen */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>NOTIZEN / BEMERKUNGEN</div>
          <FormField label="">
            <textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Allgemeine Bemerkungen zum Lieferschein…" style={{ minHeight: 72, resize: "vertical" }} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

// Hilfsfunktion für PDF-Knopf in Tabelle
