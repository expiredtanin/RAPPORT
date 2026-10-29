// Spesen (mitarbeiterbezogen): Liste mit Jahr-/Kategorie-/Status-Filter, Gruppierung,
// Sortierung, Erfassungsdialog, Kategorienverwaltung. Die internen Ausgaben (Büro, Software,
// Miete, …) sind gleich aufgebaut und liegen in InternalExpenses.tsx.
//   - `Expenses`: Spesen eines Mitarbeiters, optional einem Projekt zugeordnet.
//     Status: offen → genehmigt → «auf nächsten Lohn» → ausbezahlt (Letzteres setzt
//     die Lohnabrechnung, siehe Payroll.tsx; solche Spesen zählen in der
//     Buchhaltung nicht doppelt).
// Beträge werden brutto erfasst; `inclMwst` sagt, ob der MWST-Anteil darin enthalten
// ist (dann wird er mit `mwstRate` herausgerechnet).
//
// Belege: Foto/PDF wird als Data-URL im Datensatz gespeichert (Bilder auf 1600 px
// verkleinert, JPEG). Beim Hochladen läuft lokal eine Belegerkennung (ocr.ts), die
// nur leere bzw. noch unveränderte Felder (Betrag, Datum, MWST-Satz, Lieferant)
// vorbefüllt. `ReceiptViewer` (components/) zeigt Belege an.

import React, { useState, useRef } from "react";
import { EXPENSE_CATEGORIES } from "../constants";
import { generateId, formatCHF, formatDate, receiptToDataUrl, checkLocalBudget, localISODate } from "../utils";
import { isLocalBackend } from "../storage/adapter";
import { Header, Modal, FormField, StatusSelect, DateInput, KpiCard, SortTh } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import { extractReceiptText, parseReceiptFields } from "../ocr";
import type { Expense, ViewProps } from "../types";
import { ReceiptViewer, type ReceiptTarget } from "../components/ReceiptViewer";

/** Formularstand einer Spese: wie `Expense`, Id wird beim Speichern vergeben. */
type ExpenseForm = Omit<Expense, "id"> & { id?: string };

export default
function Expenses({ data, update, standalone }: Pick<ViewProps, "data" | "update" | "setView"> & {
  /** true = eigene Ansicht (Menü «Spesen»); sonst eingebettet */
  standalone?: boolean;
}) {
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const expCats = data.settings.expenseCategories || EXPENSE_CATEGORIES;
  const currentYear = new Date().getFullYear().toString();
  const emptyExp: ExpenseForm = { date: localISODate(), category: expCats[0], projectId: "", employeeId: "", description: "", amount: 0, mwstRate: mwstRate, inclMwst: true, status: "offen" };
  const [modal, setModal] = useState<string | null>(null); // null | "new" | id
  const [form, setForm] = useState<ExpenseForm>(emptyExp);
  const [filter, setFilter] = useState({ year: currentYear, category: "", projectId: "", employeeId: "", search: "", status: "" });
  const compact = true;
  const [groupBy, setGroupBy] = useState<"date" | "category" | "project">("date");
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const [receiptView, setReceiptView] = useState<ReceiptTarget | null>(null);
  const [scanning, setScanning] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [expCatModal, setExpCatModal] = useState(false);
  const [expCatEdit, setExpCatEdit] = useState("");
  const [expCatEditIdx, setExpCatEditIdx] = useState<number | null>(null);
  const [newExpCat, setNewExpCat] = useState("");

  const years = Array.from(new Set((data.expenses || []).map(e => (e.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();

  // Belegerkennung: liest den Beleg lokal aus (PDF-Textlayer oder OCR-
  // Fallback für Scans, siehe ocr.js) und füllt nur Felder, die noch auf
  // ihrem Leer-/Default-Wert stehen — überschreibt nie eine bewusste
  // Nutzereingabe. Rein heuristisch, deshalb "best effort": der Mensch
  // prüft/korrigiert weiterhin vor dem Speichern.
  const runReceiptScan = async (dataUrl: string) => {
    setScanning(true);
    try {
      const text = await extractReceiptText(dataUrl);
      const fields = parseReceiptFields(text);
      setForm(f => ({
        ...f,
        amount: (!f.amount && fields.amount) ? fields.amount : f.amount,
        date: (f.date === localISODate() && fields.date) ? fields.date : f.date,
        mwstRate: (fields.mwstRate != null && f.mwstRate === mwstRate) ? fields.mwstRate : f.mwstRate,
        description: (!f.description && fields.vendor) ? fields.vendor : f.description,
      }));
    } catch (err) {
      console.warn("Beleg-Scan fehlgeschlagen:", err);
    } finally {
      setScanning(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await receiptToDataUrl(file);
      const problem = isLocalBackend ? checkLocalBudget(data, dataUrl.length, form.receiptData?.length || 0) : null;
      if (problem) { alert(problem); return; }
      setForm(f => ({ ...f, receiptData: dataUrl, receiptName: file.name }));
      runReceiptScan(dataUrl);
    } catch (err) {
      alert((err as Error).message || "Der Beleg konnte nicht gelesen werden.");
    }
  };

  const openNew = () => { setForm(emptyExp); setModal("new"); };
  const openEdit = (e: Expense) => { setForm({ ...e }); setModal(e.id); };
  const closeModal = () => { setModal(null); setForm(emptyExp); };
  const saveExp = () => {
    if (!form.amount) return;
    const isNew = modal === "new";
    const newId = isNew ? generateId() : (modal as string);
    const expenses = isNew
      ? [...(data.expenses || []), { ...form, id: newId } as Expense]
      : (data.expenses || []).map(e => e.id === modal ? { ...form, id: modal as string } : e);
    update("expenses", expenses as Expense[]);
    closeModal();
  };
  const delExp = async (id: string) => { if (await askConfirm("Spese löschen?")) update("expenses", (data.expenses || []).filter(e => e.id !== id)); };

  // Statuswechsel auf "ausbezahlt" erzeugte früher zusätzlich einen
  // internalExpenses-Eintrag ("Barauszahlung Spese: …") — die Spesa selbst
  // zählt aber unabhängig vom Status bereits vollständig in Accounting.jsx
  // (totalExpNet), daher war das ein reiner Doppel-Count derselben Summe
  // (und bei jedem erneuten Statuswechsel-Zyklus ein weiterer).
  const handleStatusChange = (exp: Expense, v: string) => {
    update("expenses", (data.expenses || []).map(x => x.id === exp.id ? { ...x, status: v } : x));
  };

  // Filtern
  const allFiltered = [...(data.expenses || [])].filter(e => {
    if (filter.year && !(e.date || "").startsWith(filter.year)) return false;
    if (filter.category && e.category !== filter.category) return false;
    if (filter.projectId && e.projectId !== filter.projectId) return false;
    if (filter.status && (e.status || "offen") !== filter.status) return false;
    if (filter.employeeId && e.employeeId !== filter.employeeId) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const proj = data.projects.find(p => p.id === e.projectId);
      const emp = (data.employees || []).find(em => em.id === e.employeeId);
      if (![e.description, e.category, proj?.name, emp?.name].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sortieren
  const sorted = [...allFiltered].sort((a, b) => {
    let va: string | number, vb: string | number;
    if (sort.col === "date") { va = a.date || ""; vb = b.date || ""; }
    else if (sort.col === "amount") { va = a.amount || 0; vb = b.amount || 0; }
    else if (sort.col === "category") { va = a.category || ""; vb = b.category || ""; }
    else if (sort.col === "project") {
      va = data.projects.find(p => p.id === a.projectId)?.name || "";
      vb = data.projects.find(p => p.id === b.projectId)?.name || "";
    } else if (sort.col === "employee") {
      va = (data.employees || []).find(e => e.id === a.employeeId)?.name || "";
      vb = (data.employees || []).find(e => e.id === b.employeeId)?.name || "";
    }
    else { va = ""; vb = ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  // Gruppieren
  const getNet = (e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">) => e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount;
  const getTax = (e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">) => e.amount - getNet(e);

  const groupedData = (() => {
    if (groupBy === "date") {
      // Nach Monat gruppieren
      const months: Record<string, Expense[]> = {};
      sorted.forEach(e => {
        const key = (e.date || "").slice(0, 7);
        if (!months[key]) months[key] = [];
        months[key].push(e);
      });
      return Object.entries(months).sort((a, b) => sort.dir * b[0].localeCompare(a[0])).map(([key, items]) => ({
        key,
        label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum",
        items,
      }));
    }
    if (groupBy === "category") {
      const cats: Record<string, Expense[]> = {};
      sorted.forEach(e => {
        const key = e.category || "Sonstiges";
        if (!cats[key]) cats[key] = [];
        cats[key].push(e);
      });
      return Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key, items }));
    }
    if (groupBy === "project") {
      const projs: Record<string, { label: string; items: Expense[] }> = {};
      sorted.forEach(e => {
        const proj = data.projects.find(p => p.id === e.projectId);
        const key = e.projectId || "__none__";
        const label = proj?.name || "Kein Projekt";
        if (!projs[key]) projs[key] = { label, items: [] };
        projs[key].items.push(e);
      });
      return Object.entries(projs).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, val]) => ({ key, label: val.label, items: val.items }));
    }
    return [{ key: "all", label: "", items: sorted }];
  })();

  // Totals
  const totalNet = allFiltered.reduce((s, e) => s + getNet(e), 0);
  const totalTax = allFiltered.reduce((s, e) => s + getTax(e), 0);
  const totalBrutto = allFiltered.reduce((s, e) => s + (e.amount || 0), 0);

  // KPI nach Kategorie für Mini-Balken
  const categoryTotals = expCats.map(cat => ({
    cat,
    amount: allFiltered.filter(e => e.category === cat).reduce((s, e) => s + (e.amount || 0), 0),
  })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 4);

  const hasFilters = filter.category || filter.projectId || filter.employeeId || filter.search || filter.status;

  return (
    <div>
      {ConfirmModalEl}
      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />
      {standalone && (
        <>
          <Header title="Spesen" action={
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => { setExpCatEdit(""); setExpCatEditIdx(null); setExpCatModal(true); }}>Kategorien verwalten</button>
              <button className="btn btn-primary" onClick={openNew}>+ Spese erfassen</button>
            </div>
          } />

          {expCatModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <div className="modal" style={{ maxWidth: 420 }}>
                <div style={{ fontSize: 18, fontFamily: "'Inter', sans-serif", fontWeight: 400, marginBottom: 20 }}>Spesenarten verwalten</div>
                <div style={{ marginBottom: 16 }}>
                  {expCats.map((cat, idx) => {
                    const inUse = (data.expenses || []).some(e => e.category === cat);
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        {expCatEditIdx === idx ? (
                          <input autoFocus value={expCatEdit} onChange={e => setExpCatEdit(e.target.value)}
                            onBlur={() => {
                              if (expCatEdit.trim()) {
                                const updated = expCats.map((c, i) => i === idx ? expCatEdit.trim() : c);
                                update("settings", { ...data.settings, expenseCategories: updated });
                              }
                              setExpCatEditIdx(null);
                            }}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setExpCatEditIdx(null); }}
                            style={{ flex: 1, height: 30, fontSize: 12 }} />
                        ) : (
                          <div style={{ flex: 1, fontSize: 13, padding: "4px 0" }}>{cat}</div>
                        )}
                        <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setExpCatEdit(cat); setExpCatEditIdx(idx); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 11, opacity: inUse ? 0.35 : 1 }}
                          onClick={() => { if (!inUse) update("settings", { ...data.settings, expenseCategories: expCats.filter((_, i) => i !== idx) }); }}
                          title={inUse ? "In Verwendung" : "Löschen"}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  <input value={newExpCat} placeholder="Neue Kategorie…"
                    onChange={e => setNewExpCat(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && newExpCat.trim()) { update("settings", { ...data.settings, expenseCategories: [...expCats, newExpCat.trim()] }); setNewExpCat(""); } }}
                    style={{ flex: 1, height: 32, fontSize: 12 }} />
                  <button className="btn btn-ghost" style={{ whiteSpace: "nowrap" }}
                    onClick={() => { if (newExpCat.trim()) { update("settings", { ...data.settings, expenseCategories: [...expCats, newExpCat.trim()] }); setNewExpCat(""); } }}>+ Hinzufügen</button>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-primary" onClick={() => setExpCatModal(false)}>Schliessen</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* KPI-Streifen */}
      {allFiltered.length > 0 && (
        <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
          <KpiCard label="TOTAL BRUTTO" value={formatCHF(totalBrutto)} color="#555" sub={`${allFiltered.length} Einträge`} />
          <KpiCard label="NETTO" value={formatCHF(totalNet)} color="#888" sub="abzgl. Vorsteuer" />
          <KpiCard label="VORSTEUER" value={formatCHF(totalTax)} color="var(--warning)" sub="rückforderbar" />
          <div className="card" style={{ borderTop: "3px solid var(--positive)", height: "100%", boxSizing: "border-box" }}>
            <div style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.12em", marginBottom: 8 }}>TOP KATEGORIE</div>
            {categoryTotals[0] ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{categoryTotals[0].cat}</div>
                {categoryTotals.map(c => (
                  <div key={c.cat} style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text4)", marginBottom: 2 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>{c.cat}</span>
                      <span>{formatCHF(c.amount)}</span>
                    </div>
                    <div style={{ height: 3, background: "var(--border2)", borderRadius: 2 }}>
                      <div style={{ width: `${(c.amount / categoryTotals[0].amount) * 100}%`, height: "100%", background: "#b07848", borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </>
            ) : <div style={{ fontSize: 12, color: "var(--text5)" }}>—</div>}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Beschreibung, Kategorie, Projekt…)" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} style={{ minWidth: 220 }} />
        <select className="pill" value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}>
          <option value="">Alle Jahre</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="pill" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}>
          <option value="">Alle Kategorien</option>
          {expCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="pill" value={filter.projectId} onChange={e => setFilter({ ...filter, projectId: e.target.value })}>
          <option value="">Alle Projekte</option>
          {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="pill" value={filter.employeeId} onChange={e => setFilter({ ...filter, employeeId: e.target.value })}>
          <option value="">Alle Mitarbeiter</option>
          {(data.employees || []).map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
        </select>
        <select className="pill" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Alle Status</option>
          <option value="offen">Offen</option>
          <option value="genehmigt">Genehmigt</option>
          <option value="auf nächsten Lohn">Auf nächsten Lohn</option>
          <option value="ausbezahlt">Ausbezahlt</option>
        </select>
        {hasFilters && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilter({ year: filter.year, category: "", projectId: "", employeeId: "", search: "", status: "" })}>Zurücksetzen</button>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text4)" }}>
          <strong style={{ color: "var(--text)" }}>{allFiltered.length}</strong> {allFiltered.length === 1 ? "Eintrag" : "Einträge"} · {formatCHF(totalBrutto)}
        </div>
      </div>

      <div className="filter-bar">
        <span className="filter-label">GRUPPIEREN:</span>
        {[{ id: "date", label: "Monat" }, { id: "category", label: "Kategorie" }, { id: "project", label: "Projekt" }].map(g => (
          <button key={g.id} className={`pill${groupBy === g.id ? " active" : ""}`} onClick={() => setGroupBy(g.id as typeof groupBy)}>{g.label}</button>
        ))}
      </div>

      {/* Tabelle gruppiert */}
      {allFiltered.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th style={{ width: 100 }}>Datum</th><th style={{ width: 170 }}>Kategorie</th><th style={{ width: 140 }}>Projekt</th><th style={{ width: 130 }}>Mitarbeiter</th><th>Beschreibung</th><th style={{ textAlign: "right", width: 110 }}>Netto</th><th style={{ textAlign: "right", width: 100 }}>Vorsteuer</th><th style={{ textAlign: "right", width: 120 }}>Brutto</th><th style={{ width: 130 }}>Status</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody><tr><td colSpan={10} className="empty-state">{(data.expenses || []).length === 0 ? "Noch keine Spesen" : "Keine Treffer"}</td></tr></tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 100 }}>Datum</SortTh>
                {groupBy !== "category" && <SortTh sort={sort} onSort={toggleSort} col="category" style={{ width: 170 }}>Kategorie</SortTh>}
                {groupBy !== "project" && <SortTh sort={sort} onSort={toggleSort} col="project" style={{ width: 140 }}>Projekt</SortTh>}
                <SortTh sort={sort} onSort={toggleSort} col="employee" style={{ width: 130 }}>Mitarbeiter</SortTh>
                <th>Beschreibung</th>
                <SortTh sort={sort} onSort={toggleSort} col="amount" style={{ textAlign: "right", width: 110 }}>Netto</SortTh>
                <th className={compact ? "hide-compact" : ""} style={{ textAlign: "right", width: 100 }}>Vorsteuer</th>
                <SortTh sort={sort} onSort={toggleSort} col="amount" style={{ textAlign: "right", width: 120 }}>Brutto</SortTh>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {groupedData.map(group => {
                const gNet = group.items.reduce((s, e) => s + getNet(e), 0);
                const gTax = group.items.reduce((s, e) => s + getTax(e), 0);
                const gBrutto = group.items.reduce((s, e) => s + (e.amount || 0), 0);
                return (
                  <React.Fragment key={group.key}>
                    {/* Gruppen-Header (nur wenn > 1 Gruppe) */}
                    {groupedData.length > 1 && (
                      <tr style={{ background: "var(--surface3)" }}>
                        <td colSpan={groupBy === "date" ? 8 : 7} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "var(--text3)" }}>
                          {group.label}
                          <span style={{ marginLeft: 10, fontWeight: 400, color: "var(--text4)", fontSize: 10 }}>{group.items.length} Einträge</span>
                        </td>
                        <td colSpan={2} style={{ padding: "6px 12px", textAlign: "right", fontSize: 11, fontWeight: 600 }}>{formatCHF(gBrutto)}</td>
                      </tr>
                    )}
                    {group.items.map(e => {
                      const proj = data.projects.find(p => p.id === e.projectId);
                      const emp = (data.employees || []).find(em => em.id === e.employeeId);
                      const net = getNet(e);
                      const tax = getTax(e);
                      const expStatus = e.status || "offen";
                      return (
                        <tr key={e.id}>
                          <td>{formatDate(e.date)}</td>
                          {groupBy !== "category" && <td>{e.category}</td>}
                          {groupBy !== "project" && <td style={{ color: "var(--text4)" }}>{proj?.name || "—"}</td>}
                          <td style={{ color: "var(--text4)", fontSize: 12 }}>{emp?.name || "—"}</td>
                          <td style={{ color: "var(--text3)" }}>{e.description || "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatCHF(net)}</td>
                          <td className={compact ? "hide-compact" : ""} style={{ textAlign: "right", color: "var(--text4)" }}>{e.mwstRate > 0 ? formatCHF(tax) : "—"}</td>
                          <td style={{ textAlign: "right" }}><strong>{formatCHF(e.amount)}</strong></td>
                          <td>
                            {e.lohnEntryId
                              ? <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: "var(--positive)", background: "var(--positive-bg)", border: "1.5px solid #2d6a4f40", whiteSpace: "nowrap" }}>✓ Via Lohn</span>
                              : <StatusSelect value={expStatus} options={["offen", "genehmigt", "auf nächsten Lohn", "ausbezahlt"]} onChange={v => handleStatusChange(e, v)} />
                            }
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {e.receiptData && (
                              <button className="btn btn-ghost" title="Beleg anzeigen" style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }} onClick={() => setReceiptView(e)}>
                                <span className="msr" style={{ fontSize: 14, verticalAlign: "middle" }}>receipt_long</span>
                              </button>
                            )}
                            <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 4 }} onClick={() => openEdit(e)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                            <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => delExp(e.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Gruppen-Subtotal wenn > 1 Gruppe */}
                    {groupedData.length > 1 && (
                      <tr style={{ background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
                        <td colSpan={groupBy === "date" ? 5 : 4} style={{ padding: "5px 12px", fontSize: 11, color: "var(--text4)", fontStyle: "italic" }}>Total {group.label}</td>
                        <td style={{ textAlign: "right", padding: "5px 12px", fontWeight: 600, fontSize: 11 }}>{formatCHF(gNet)}</td>
                        <td className={compact ? "hide-compact" : ""} style={{ textAlign: "right", padding: "5px 12px", fontWeight: 600, fontSize: 11, color: "var(--text4)" }}>{formatCHF(gTax)}</td>
                        <td colSpan={3} style={{ textAlign: "right", padding: "5px 12px", fontWeight: 700, fontSize: 11 }}>{formatCHF(gBrutto)}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--text)" }}>
                <td colSpan={groupBy === "date" ? 5 : 4} style={{ color: "var(--text4)", fontSize: 12 }}>
                  {allFiltered.length} {allFiltered.length === 1 ? "Eintrag" : "Einträge"} {filter.year ? filter.year : ""}
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCHF(totalNet)}</td>
                <td className={compact ? "hide-compact" : ""} style={{ textAlign: "right", fontWeight: 600, color: "var(--text4)" }}>{formatCHF(totalTax)}</td>
                <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(totalBrutto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === "new" ? "Spese erfassen" : "Spese bearbeiten"} onClose={closeModal} onSave={saveExp}>
          <div className="form-row">
            <FormField label="Datum"><DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormField>
            <FormField label="Kategorie">
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {expCats.map(c => <option key={c}>{c}</option>)}
              </select>
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Mitarbeiter">
              <select value={form.employeeId || ""} onChange={e => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— kein Mitarbeiter —</option>
                {(data.employees || []).map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
              </select>
            </FormField>
            <FormField label="Projekt (optional)">
              <select value={form.projectId || ""} onChange={e => setForm({ ...form, projectId: e.target.value })}>
                <option value="">— kein Projekt —</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Status">
              <select value={form.status || "offen"} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="offen">Offen</option>
                <option value="genehmigt">Genehmigt</option>
                <option value="auf nächsten Lohn">Auf nächsten Lohn</option>
                <option value="ausbezahlt">Ausbezahlt</option>
              </select>
            </FormField>
          </div>
          <FormField label="Beschreibung"><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="z.B. Zug Zürich–Bern, Plotkosten…" autoFocus /></FormField>
          <div className="form-row">
            <FormField label="Betrag CHF"><input type="number" step="0.05" value={form.amount} onChange={e => setForm({ ...form, amount: +e.target.value })} /></FormField>
            <FormField label="MWST-Satz %"><input type="number" step="0.1" value={form.mwstRate} onChange={e => setForm({ ...form, mwstRate: +e.target.value })} /></FormField>
            <FormField label=" ">
              <label style={{ display: "flex", alignItems: "center", gap: 6, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
                <input type="checkbox" checked={!!form.inclMwst} onChange={e => setForm({ ...form, inclMwst: e.target.checked })} style={{ width: "auto" }} />
                Betrag inkl. MWST
              </label>
            </FormField>
          </div>
          {form.amount > 0 && (
            <div style={{ fontSize: 11, color: "var(--text4)", padding: "8px 12px", background: "var(--surface2)", borderRadius: 4 }}>
              {form.inclMwst
                ? `Netto: ${formatCHF(form.amount / (1 + (form.mwstRate || 0) / 100))} · MWST: ${formatCHF(form.amount - form.amount / (1 + (form.mwstRate || 0) / 100))}`
                : `Ohne MWST-Abzug — ${formatCHF(form.amount)} wird 1:1 als Netto gebucht`}
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 14, marginTop: 14 }}>
            <label style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.08em", display: "block", marginBottom: 8 }}>BELEG / QUITTUNG</label>
            {scanning && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#b07848", marginBottom: 8 }}>
                <span className="msr" style={{ fontSize: 15 }}>autorenew</span>
                Beleg wird gelesen — Betrag/Datum werden automatisch erkannt (bitte nachher prüfen) …
              </div>
            )}
            {form.receiptData ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", padding: "8px 12px", borderRadius: 4 }}>
                <span style={{ fontSize: 12, color: "var(--text3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="msr" style={{ fontSize: 15 }}>receipt_long</span>
                  {form.receiptName || "Beleg hochgeladen"}
                </span>
                <button className="btn btn-ghost" type="button" style={{ fontSize: 12 }} onClick={() => setReceiptView({ ...form })}>Anzeigen</button>
                <button className="btn btn-danger" type="button" style={{ fontSize: 12 }} onClick={() => setForm(f => ({ ...f, receiptData: null, receiptName: null }))}>Entfernen</button>
              </div>
            ) : (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#b07848", border: "1px dashed #b07848", borderRadius: 4, padding: "6px 14px" }}>
                <span className="msr" style={{ fontSize: 15 }}>upload_file</span>
                Quittung hochladen (Bild oder PDF)
                <input ref={receiptInputRef} type="file" accept="image/*,application/pdf" onChange={handleReceiptUpload} style={{ display: "none" }} />
              </label>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
