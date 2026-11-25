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
import { generateId, formatCHF, formatDate, receiptToDataUrl, checkLocalBudget, localISODate, roundCHF } from "../utils";
import { isLocalBackend } from "../storage/adapter";
import { expenseNet, expenseTax } from "../accounting";
import { ExpenseFigures } from "../components/ExpenseFigures";
import { TableToolbar, Header, Modal, FormField, StatusSelect, DateInput, SortTh, RowMenu, EmptyState } from "../components/UI";
import { removeWithUndo } from "../undo";
import { showToast } from "../toast";
import { extractReceiptText, parseReceiptFields } from "../ocr";
import type { Expense, ViewProps } from "../types";
import { ReceiptViewer, type ReceiptTarget } from "../components/ReceiptViewer";

/** Formularstand einer Spese: wie `Expense`, Id wird beim Speichern vergeben. */
type ExpenseForm = Omit<Expense, "id"> & { id?: string };

export default
function Expenses({ data, update, standalone, currentUser }: Pick<ViewProps, "data" | "update" | "setView" | "currentUser"> & {
  /** true = eigene Ansicht (Menü «Spesen»); sonst eingebettet */
  standalone?: boolean;
}) {
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const expCats = data.settings.expenseCategories || EXPENSE_CATEGORIES;
  const currentYear = new Date().getFullYear().toString();
  const emptyExp: ExpenseForm = { date: localISODate(), category: expCats[0], projectId: "", employeeId: (data.employees || []).some(e => e.id === currentUser?.employeeId) ? currentUser?.employeeId || "" : "", description: "", amount: 0, mwstRate: mwstRate, inclMwst: true, status: "offen" };
  const [modal, setModal] = useState<string | null>(null); // null | "new" | id
  const [form, setForm] = useState<ExpenseForm>(emptyExp);
  const [filter, setFilter] = useState({ year: currentYear, category: "", projectId: "", employeeId: "", search: "", status: "" });
  const [groupBy, setGroupBy] = useState<"date" | "category" | "project">("date");
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
      if (problem) { showToast(problem); return; }
      setForm(f => ({ ...f, receiptData: dataUrl, receiptName: file.name }));
      runReceiptScan(dataUrl);
    } catch (err) {
      showToast((err as Error).message || "Der Beleg konnte nicht gelesen werden.");
    }
  };

  const openNew = () => { setForm(emptyExp); setModal("new"); };
  const openEdit = (e: Expense) => { setForm({ ...e }); setModal(e.id); };
  const closeModal = () => { setModal(null); setForm(emptyExp); };
  const saveExp = () => {
    if (!form.amount) { showToast("Bitte einen Betrag eingeben."); return; }
    if (!(Number(form.amount) > 0 && Number(form.amount) < 1e7)) { showToast("Der Betrag muss positiv sein (unter CHF 10 Mio.)."); return; }
    const isNew = modal === "new";
    // über eine Lohnabrechnung ausbezahlt: Betrag und Person stehen in der Abrechnung → nur nach deren Storno ändern
    const orig = isNew ? null : (data.expenses || []).find(e => e.id === modal);
    if (orig?.lohnEntryId && (roundCHF(Number(form.amount)) !== orig.amount || form.employeeId !== orig.employeeId || form.date !== orig.date)) {
      showToast("Diese Spese ist über eine Lohnabrechnung ausbezahlt. Betrag, Person und Datum erst nach Storno der Lohnabrechnung ändern.");
      return;
    }
    const newId = isNew ? generateId() : (modal as string);
    const expenses = isNew
      ? [...(data.expenses || []), { ...form, amount: roundCHF(Number(form.amount)), id: newId } as Expense]
      : (data.expenses || []).map(e => e.id === modal ? { ...form, amount: roundCHF(Number(form.amount)), id: modal as string } : e);
    update("expenses", expenses as Expense[]);
    closeModal();
  };
  const delExp = (id: string) => { const e = (data.expenses || []).find(x => x.id === id); if (e?.lohnEntryId) { showToast("Diese Spese ist über eine Lohnabrechnung ausbezahlt. Zuerst die Lohnabrechnung stornieren."); return; } removeWithUndo(`Spese${e?.description ? " «" + e.description + "»" : ""} gelöscht`, "expenses", x => x.id === id); };

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
  // Netto/Vorsteuer pro Beleg auf Rappen (accounting.ts) — Zeilen und Summen stimmen überein
  const getNet = expenseNet;
  const getTax = expenseTax;

  const groupedData = (() => {
    if (groupBy === "date") {
      // Nach Monat gruppieren
      const months: Record<string, Expense[]> = Object.create(null);
      sorted.forEach(e => {
        const key = (e.date || "").slice(0, 7);
        if (!months[key]) months[key] = [];
        months[key].push(e);
      });
      return Object.entries(months).sort((a, b) => (sort.col === "date" ? -sort.dir : 1) * b[0].localeCompare(a[0])).map(([key, items]) => ({
        key,
        label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum",
        items,
      }));
    }
    if (groupBy === "category") {
      const cats: Record<string, Expense[]> = Object.create(null);
      sorted.forEach(e => {
        const key = e.category || "Sonstiges";
        if (!cats[key]) cats[key] = [];
        cats[key].push(e);
      });
      return Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, label: key, items }));
    }
    if (groupBy === "project") {
      const projs: Record<string, { label: string; items: Expense[] }> = Object.create(null);
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

  const offen = allFiltered.filter(e => (e.status || "offen") === "offen").length;
  const hasFilters = filter.category || filter.projectId || filter.employeeId || filter.search || filter.status;

  return (
    <div>
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
                <div style={{ fontSize: 18, fontFamily: "var(--font-ui)", fontWeight: 400, marginBottom: 20 }}>Spesenarten verwalten</div>
                <div style={{ marginBottom: 16 }}>
                  {expCats.map((cat, idx) => {
                    const inUse = (data.expenses || []).some(e => e.category === cat);
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        {expCatEditIdx === idx ? (
                          <input autoFocus value={expCatEdit} onChange={e => setExpCatEdit(e.target.value)}
                            onBlur={() => {
                              const nu = expCatEdit.trim();
                              if (nu && nu !== cat && expCats.includes(nu)) showToast(`Die Kategorie «${nu}» gibt es schon.`);
                              else if (nu && nu !== cat) {
                                // umbenennen: auch die vorhandenen Spesen (sonst blieben sie unter dem alten Namen)
                                const updated = expCats.map((c, i) => i === idx ? nu : c);
                                update("settings", prev => ({ ...prev, expenseCategories: updated }));
                                update("expenses", prev => (prev || []).map(e => e.category === cat ? { ...e, category: nu } : e));
                              }
                              setExpCatEditIdx(null);
                            }}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setExpCatEditIdx(null); }}
                            style={{ flex: 1, height: 30, fontSize: 12 }} />
                        ) : (
                          <div style={{ flex: 1, fontSize: 13, padding: "4px 0" }}>{cat}</div>
                        )}
                        <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setExpCatEdit(cat); setExpCatEditIdx(idx); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn-icon danger" aria-label="Entfernen" style={{ opacity: inUse ? 0.35 : 1 }}
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
        <ExpenseFigures count={allFiltered.length} brutto={totalBrutto} netto={totalNet} vorsteuer={totalTax} totalSub={offen ? `${offen} offen` : undefined} categories={categoryTotals} />
      )}

      <div className="filter-bar">
        <input className="pill" placeholder="Suchen …" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
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
      </div>

      {/* Tabelle gruppiert */}
      {(data.expenses || []).length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="payments" title="Noch keine Spesen" text="Erfasse Auslagen mit Beleg, Kategorie und Projekt – sie lassen sich später über den Lohn auszahlen."
            action={<button className="btn btn-primary" onClick={openNew}>+ Spese erfassen</button>} />
        </div>
      ) : allFiltered.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="filter_alt_off" title="Keine Treffer" text="Kein Eintrag passt zu den Filtern." />
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <TableToolbar summary={<><b className="num">{allFiltered.length}</b> {allFiltered.length === 1 ? "Eintrag" : "Einträge"} · <span className="num">{formatCHF(totalBrutto)}</span></>}
            groups={[{ id: "date", label: "Monat" }, { id: "category", label: "Kategorie" }, { id: "project", label: "Projekt" }] as { id: typeof groupBy; label: string }[]} value={groupBy} onChange={setGroupBy} />
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 96 }}>Datum</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="category">Beschreibung · Kategorie</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col={groupBy === "project" ? "employee" : "project"} className="hide-narrow">{groupBy === "project" ? "Mitarbeiter" : "Projekt · Mitarbeiter"}</SortTh>
                <th className="hide-mid" style={{ textAlign: "right", width: 96 }}>Vorsteuer</th>
                <SortTh sort={sort} onSort={toggleSort} col="amount" style={{ textAlign: "right", width: 112 }}>Brutto</SortTh>
                <th style={{ width: 136 }}>Status</th>
                <th style={{ width: 80 }}></th>
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
                      <tr>
                        <td colSpan={7} className="group-row">
                          {group.label}
                          <span className="group-sum">{group.items.length} {group.items.length === 1 ? "Eintrag" : "Einträge"} · {formatCHF(gBrutto)}</span>
                        </td>
                      </tr>
                    )}
                    {group.items.map(e => {
                      const proj = data.projects.find(p => p.id === e.projectId);
                      const emp = (data.employees || []).find(em => em.id === e.employeeId);
                      const net = getNet(e);
                      const tax = getTax(e);
                      const expStatus = e.status || "offen";
                      return (
                        <tr key={e.id} className="row-link" onClick={() => openEdit(e)}>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                          <td style={{ minWidth: 0 }}>
                            <div style={{ color: "var(--text)" }}>{e.description || e.category || "—"}</div>
                            {groupBy !== "category" && e.description && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 1 }}>{e.category}</div>}
                          </td>
                          <td className="hide-narrow" style={{ fontSize: 12.5, color: "var(--text3)", maxWidth: 220 }}>
                            {groupBy !== "project" && <div className="cell-1line" title={proj?.name}>{proj?.name || "—"}</div>}
                            <div style={{ color: "var(--text4)", fontSize: 12 }}>{emp?.name || "—"}</div>
                          </td>
                          <td className="hide-mid num" style={{ textAlign: "right", color: "var(--text4)" }} title={`Netto ${formatCHF(net)}`}>{tax > 0 ? formatCHF(tax) : "—"}</td>
                          <td style={{ textAlign: "right" }}><strong>{formatCHF(e.amount)}</strong></td>
                          <td>
                            {e.lohnEntryId
                              ? <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: "var(--positive)", background: "var(--positive-bg)", border: "1.5px solid color-mix(in srgb, var(--positive) 25%, transparent)", whiteSpace: "nowrap" }}>✓ Via Lohn</span>
                              : <StatusSelect value={expStatus} options={["offen", "genehmigt", "auf nächsten Lohn", "ausbezahlt"]} onChange={v => handleStatusChange(e, v)} />
                            }
                          </td>
                          <td className="row-actions" onClick={ev => ev.stopPropagation()}>
                            {e.receiptData && (
                              <button className="btn btn-ghost btn-sm" title="Beleg anzeigen" style={{ marginRight: 2 }} onClick={() => setReceiptView(e)}>
                                <span className="msr" style={{ fontSize: 15 }}>receipt_long</span>
                              </button>
                            )}
                            <RowMenu items={[
                              { label: "Bearbeiten", icon: "edit", onClick: () => openEdit(e) },
                              { label: "Löschen", icon: "delete", danger: true, onClick: () => delExp(e.id) },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                    {/* Gruppen-Subtotal wenn > 1 Gruppe */}
                    {groupedData.length > 1 && group.items.length > 1 && (
                      <tr style={{ background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
                        <td colSpan={2} style={{ padding: "5px 12px", fontSize: 11, color: "var(--text4)" }}>Total {group.label} · netto {formatCHF(gNet)}</td>
                        <td className="hide-narrow" />
                        <td className="hide-mid" style={{ textAlign: "right", padding: "5px 12px", fontWeight: 600, fontSize: 11, color: "var(--text4)" }}>{formatCHF(gTax)}</td>
                        <td style={{ textAlign: "right", padding: "5px 12px", fontWeight: 700, fontSize: 11 }}>{formatCHF(gBrutto)}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--text)" }}>
                <td colSpan={2} style={{ color: "var(--text4)", fontSize: 12 }}>
                  {allFiltered.length} {allFiltered.length === 1 ? "Eintrag" : "Einträge"} {filter.year ? filter.year : ""} · netto {formatCHF(totalNet)}
                </td>
                <td className="hide-narrow" />
                <td className="hide-mid" style={{ textAlign: "right", fontWeight: 600, color: "var(--text4)" }}>{formatCHF(totalTax)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(totalBrutto)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modal && (
        <Modal drawer title={modal === "new" ? "Spese erfassen" : "Spese bearbeiten"} onClose={closeModal} onSave={saveExp}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--accent)", marginBottom: 8 }}>
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
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--accent)", border: "1px dashed var(--accent)", borderRadius: 4, padding: "6px 14px" }}>
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
