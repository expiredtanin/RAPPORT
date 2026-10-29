// Verträge: Liste mit Filter/Sortierung, Anlegen und Bearbeiten, PDF-Druck.
// Zwei Arten: «Hauptauftrag» (mit Bauherr/Auftraggeber) und «Unterauftrag»
// (mit Fachplaner/Partner); danach richtet sich die Auswahl der Gegenpartei.
//
// Vertragsnummer: konfigurierbares Format (`settings.vertragNumberFormat`,
// Standard «V-YYYY-NNN»), die laufende Nummer wird aus den bestehenden Verträgen
// abgeleitet. Eine Offerte kann in einen Vertrag umgewandelt werden: Quotes.tsx
// ruft `setView("contracts")` + `setModal({ type: "newVertrag", quoteId })` auf,
// dieser View fängt das ab und öffnet das Formular vorbefüllt. Die Vertragssumme
// ist dann die Offertsumme (immer «pauschal»).
// Status: entwurf → unterzeichnet → beendet.

import React, { useState, useEffect } from "react";
import { generateId, formatCHF, formatDate, calcManualHours, localISODate } from "../utils";
import { Header, Modal, FormField, StatusSelect, DateInput, ShareButton, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Contract, ViewProps } from "../types";

/** Formularstand: wie `Contract`, aber ohne Id (wird beim Speichern vergeben). */
type ContractForm = Omit<Contract, "id"> & { id?: string };

const CONTRACT_TYPES = [
  { id: "haupt", label: "Hauptauftrag (Bauherr)" },
  { id: "unterauftrag", label: "Unterauftrag (Fachplaner)" },
];

export default
function Contracts({ data, saveAll, modal, setModal, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "modal" | "setModal" | "setPrintContent" | "setView">) {
  const today = localISODate();
  const contracts = data.contracts || [];

  const emptyForm: ContractForm = {
    number: "", date: today, signedDate: "",
    clientId: "", projectId: "", quoteId: "",
    contractType: "haupt", legalBasis: "",
    billingType: "pauschal", amount: 0, hourlyRate: data.settings.defaultHourlyRate || 120,
    paymentTerms: "", status: "entwurf", notes: "",
  };

  // formModal: eigener lokaler Modal-State (null | "new" | id) — getrennt vom
  // geteilten modal-Prop, der für die Quote→Vertrag-Konvertierung aus
  // Quotes.jsx genutzt wird (analog Invoices.jsx: modal/newInvModal).
  const [formModal, setFormModal] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState({ search: "", status: "", contractType: "" });
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const { askConfirm, ConfirmModalEl } = useConfirm();

  const nextNumber = () => {
    const fmt = data.settings.vertragNumberFormat || "V-YYYY-NNN";
    const now = new Date();
    const yyyy = String(now.getFullYear()); const yy = yyyy.slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const pattern = fmt
      .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
      .replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, "\\d{2}")
      .replace(/N+/, "(\\d+)");
    const rx = new RegExp("^" + pattern + "$");
    const nums = contracts.map(v => { const m = (v.number || "").match(rx); return m ? parseInt(m[1]) : null; }).filter(n => n !== null);
    const nextSeq = nums.length ? Math.max(...nums) + 1 : 1;
    const padLen = (fmt.match(/N+/) || ["NNN"])[0].length;
    return fmt.replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, mm).replace(/N+/, String(nextSeq).padStart(padLen, "0"));
  };

  const openNew = () => {
    setForm({ ...emptyForm, number: nextNumber() });
    setFormModal("new");
  };
  const openEdit = (v: Contract) => { setForm({ ...emptyForm, ...v }); setFormModal(v.id); };
  const closeFormModal = () => { setFormModal(null); setForm(emptyForm); };

  const save = () => {
    const isNew = formModal === "new";
    const entry: Contract = { ...form, id: isNew ? generateId() : (formModal as string) };
    const updated = isNew
      ? [...contracts, { ...entry, createdAt: new Date().toISOString() }]
      : contracts.map(v => v.id === formModal ? entry : v);
    saveAll({ ...data, contracts: updated });
    closeFormModal();
  };

  const del = async (id: string) => {
    if (await askConfirm("Vertrag löschen?"))
      saveAll({ ...data, contracts: contracts.filter(v => v.id !== id) });
  };

  // Konvertierung aus Quotes.jsx abfangen: setView("contracts") + setModal({type:"newVertrag", quoteId})
  useEffect(() => {
    if (modal?.type === "newVertrag" && modal.quoteId) {
      const q = (data.quotes || []).find(x => x.id === modal.quoteId);
      if (q) {
        // Vertragssumme bleibt immer die Offertsumme (amount = q.total) und
        // damit sichtbar/massgeblich — billingType "pauschal" unabhängig vom
        // Offert-Modus. hourlyRate wird trotzdem als Referenzwert mitgegeben
        // (Blend-Satz aus Gesamtbetrag/Gesamtstunden, nicht der Satz der
        // ersten Rolle — sonst weicht er systematisch vom offerierten Betrag
        // ab, siehe Quotes.jsx createProjectFromQuote).
        const qRoles = q.quoteRoles || data.settings.roles || [];
        const manH = q.mode === "manual" ? calcManualHours(q.manualPhases || [], qRoles) : null;
        const hourlyRate = q.mode === "sia" ? (q.sia?.stundenansatz || data.settings.defaultHourlyRate || 120)
          : q.mode === "manual" ? (manH && manH.totalHours > 0 ? Math.round((manH.totalAmount / manH.totalHours) * 100) / 100 : (qRoles[0]?.rate || data.settings.defaultHourlyRate || 120))
          : (data.settings.defaultHourlyRate || 120);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Übergabe aus Offerten (modal), danach wird modal geleert
        setForm({
          ...emptyForm,
          number: nextNumber(),
          clientId: q.clientId || "",
          projectId: q.projectId || "",
          quoteId: q.id,
          contractType: "haupt",
          billingType: "pauschal",
          amount: q.total || 0,
          hourlyRate,
        });
        setFormModal("new");
      }
      setModal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.type, modal?.quoteId]);

  // Seit «Kontakte» ohne Auftraggeber/Partner-Unterscheidung: jeder Kontakt kann Vertragspartner sein.
  const clientsFor = (_contractType?: string) => data.persons || [];
  const getClientName = (v: Contract) => (data.persons || []).find(p => p.id === v.clientId)?.name || "—";
  const getProjectName = (v: Contract) => v.projectId ? (data.projects.find(p => p.id === v.projectId)?.name || "—") : "—";

  const filtered = contracts.filter(v => {
    if (filter.status && v.status !== filter.status) return false;
    if (filter.contractType && v.contractType !== filter.contractType) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const text = [v.number, getClientName(v), getProjectName(v), v.legalBasis, v.notes].join(" ").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));
  const sorted = [...filtered].sort((a, b) => {
    const va = sort.col === "date" ? (a.date || "") : sort.col === "number" ? (a.number || "") : sort.col === "amount" ? a.amount || 0 : getClientName(a);
    const vb = sort.col === "date" ? (b.date || "") : sort.col === "number" ? (b.number || "") : sort.col === "amount" ? b.amount || 0 : getClientName(b);
    if (typeof va === "number") return (va - (vb as number)) * sort.dir;
    return va.localeCompare(vb as string) * sort.dir;
  });

  const linkedQuote = form.quoteId ? (data.quotes || []).find(q => q.id === form.quoteId) : null;

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Verträge" action={
        <button className="btn btn-primary" onClick={openNew}>+ Neuer Vertrag</button>
      } />

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Nr., Partner, Projekt…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 220 }} />
        <select className="pill" value={filter.contractType} onChange={e => setFilter({ ...filter, contractType: e.target.value })}>
          <option value="">Alle Arten</option>
          {CONTRACT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className="pill" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Alle Status</option>
          <option value="entwurf">Entwurf</option>
          <option value="unterzeichnet">Unterzeichnet</option>
          <option value="beendet">Beendet</option>
        </select>
        {(filter.search || filter.status || filter.contractType) && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilter({ search: "", status: "", contractType: "" })}>Zurücksetzen</button>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>
          <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> {filtered.length === 1 ? "Vertrag" : "Verträge"}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th style={{ width: 120 }}>Nr.</th><th style={{ width: 100 }}>Datum</th><th style={{ width: 180 }}>Partner</th><th>Projekt</th><th style={{ width: 130 }}>Art</th><th style={{ width: 110 }}>Summe</th><th style={{ width: 110 }}>Status</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody><tr><td colSpan={8} className="empty-state">{contracts.length === 0 ? "Noch keine Verträge" : "Keine Treffer"}</td></tr></tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="number" style={{ width: 120 }}>Nr.</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 100 }}>Datum</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="client" style={{ width: 180 }}>Partner</SortTh>
                <th>Projekt</th>
                <th style={{ width: 130 }}>Art</th>
                <SortTh sort={sort} onSort={toggleSort} col="amount" style={{ width: 110 }}>Summe</SortTh>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(v => (
                <tr key={v.id}>
                  <td><strong style={{ color: "#b07848" }}>{v.number || "—"}</strong></td>
                  <td>{formatDate(v.date)}</td>
                  <td>{getClientName(v)}</td>
                  <td style={{ color: "var(--text4)" }}>{getProjectName(v)}</td>
                  <td>
                    <span className="tag" style={{ fontSize: 10, background: v.contractType === "unterauftrag" ? "var(--warning-bg)" : "var(--info-bg)", color: v.contractType === "unterauftrag" ? "var(--warning)" : "var(--info)" }}>
                      {v.contractType === "unterauftrag" ? "Unterauftrag" : "Hauptauftrag"}
                    </span>
                  </td>
                  <td>{formatCHF(v.billingType === "stundensatz" ? v.hourlyRate : v.amount)}{v.billingType === "stundensatz" ? "/h" : ""}</td>
                  <td><StatusSelect value={v.status} options={["entwurf", "unterzeichnet", "beendet"]} onChange={st => saveAll({ ...data, contracts: contracts.map(x => x.id === v.id ? { ...x, status: st } : x) })} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <ShareButton style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }}
                      options={[{ label: "PDF", onClick: () => setPrintContent({ type: "vertrag", vertrag: v, client: (data.persons || []).find(p => p.id === v.clientId), project: data.projects.find(p => p.id === v.projectId), settings: data.settings }) }]} />
                    <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }} onClick={() => openEdit(v)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(v.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formModal && (
        <Modal title={formModal === "new" ? "Neuer Vertrag" : "Vertrag bearbeiten"} onClose={closeFormModal} onSave={save} wide>
          {linkedQuote && (
            <div style={{ fontSize: 12, color: "var(--positive)", background: "var(--positive-bg)", border: "1px solid #b8dbc4", borderRadius: 6, padding: "8px 12px", marginBottom: 14 }}>
              Aus Offerte <strong>{linkedQuote.number}</strong> erstellt.
            </div>
          )}

          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>ALLGEMEIN</div>
          <div className="form-row">
            <FormField label="Nummer">
              <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="V-2026-001" />
            </FormField>
            <FormField label="Datum">
              <DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </FormField>
            <FormField label="Unterzeichnet am">
              <DateInput value={form.signedDate} onChange={e => setForm({ ...form, signedDate: e.target.value })} />
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Vertragsart">
              <select value={form.contractType} onChange={e => setForm({ ...form, contractType: e.target.value, clientId: "" })}>
                {CONTRACT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </FormField>
            <FormField label="Rechtsgrundlage">
              <input value={form.legalBasis} onChange={e => setForm({ ...form, legalBasis: e.target.value })} placeholder="z.B. SIA 102, Ausgabe 2020" />
            </FormField>
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>VERTRAGSPARTNER</div>
          <div className="form-row">
            <FormField label={form.contractType === "unterauftrag" ? "Fachplaner" : "Auftraggeber"}>
              <select value={form.clientId || ""} onChange={e => setForm({ ...form, clientId: e.target.value })}>
                <option value="">— auswählen —</option>
                {clientsFor(form.contractType).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Projekt (optional)">
              <select value={form.projectId || ""} onChange={e => setForm({ ...form, projectId: e.target.value })}>
                <option value="">— keins —</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>VERGÜTUNG</div>
          <div className="form-row">
            <FormField label="Abrechnungsart">
              <select value={form.billingType} onChange={e => setForm({ ...form, billingType: e.target.value })}>
                <option value="pauschal">Pauschal</option>
                <option value="stundensatz">Nach Stundensatz</option>
              </select>
            </FormField>
            {form.billingType === "pauschal" ? (
              <FormField label="Vertragssumme (CHF)">
                <input type="number" min={0} step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: +e.target.value })} />
              </FormField>
            ) : (
              <FormField label="Stundenansatz (CHF)">
                <input type="number" min={0} step="0.01" value={form.hourlyRate} onChange={e => setForm({ ...form, hourlyRate: +e.target.value })} />
              </FormField>
            )}
          </div>
          <FormField label="Zahlungsbedingungen">
            <textarea value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} placeholder="z.B. Zahlbar in 5 Teilzahlungen gemäss Baufortschritt, netto 30 Tage." style={{ minHeight: 60, resize: "vertical" }} />
          </FormField>

          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>NOTIZEN</div>
          <FormField label="">
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Laufzeit, Kündigungsfrist, Sonstiges…" style={{ minHeight: 72, resize: "vertical" }} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}
