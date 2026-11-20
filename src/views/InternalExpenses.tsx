// Interne Ausgaben (Büro, Software, Miete, …): Liste mit Jahr-/Kategorie-Filter, Gruppierung,
// Sortierung, Erfassungsdialog mit Belegerkennung. Optional wiederkehrend (monatlich/quartalsweise);
// die Hochrechnung aufs Jahr macht StudioBudget.tsx. Gleich aufgebaut wie die Spesen (Expenses.tsx).

import React, { useState, useRef } from "react";
import { INTERNAL_EXPENSE_CATEGORIES } from "../constants";
import { generateId, formatCHF, formatDate, receiptToDataUrl, checkLocalBudget, localISODate } from "../utils";
import { isLocalBackend } from "../storage/adapter";
import { ExpenseFigures } from "../components/ExpenseFigures";
import { TableToolbar, Header, Modal, FormField, DateInput, SortTh, RowMenu, EmptyState } from "../components/UI";
import { removeWithUndo } from "../undo";
import { expandInternalExpenses } from "../accounting";
import { showToast } from "../toast";
import { extractReceiptText, parseReceiptFields } from "../ocr";
import type { Expense, InternalExpense, ViewProps } from "../types";
import { ReceiptViewer, type ReceiptTarget } from "../components/ReceiptViewer";

type InternalForm = Omit<InternalExpense, "id"> & { id?: string };

export default
function InternalExpenses({ data, update }: Pick<ViewProps, "data" | "update" | "setView">) {
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const intCats = data.settings.internalExpenseCategories || INTERNAL_EXPENSE_CATEGORIES;
  const currentYear = new Date().getFullYear().toString();
  const emptyItem: InternalForm = { date: localISODate(), category: intCats[0], description: "", amount: 0, mwstRate: mwstRate, inclMwst: true, recurring: false, recurringInterval: "monatlich", receiptData: null, receiptName: null };
  const [modal, setModal] = useState<string | null>(null);
  const [form, setForm] = useState<InternalForm>(emptyItem);
  const [catModal, setCatModal] = useState(false);
  const [catEdit, setCatEdit] = useState("");
  const [catEditIdx, setCatEditIdx] = useState<number | null>(null);
  const [newCat, setNewCat] = useState("");
  const [filter, setFilter] = useState({ year: currentYear, category: "", search: "" });
  const [sort, setSort] = useState({ col: "date", dir: -1 });
  const [groupBy, setGroupBy] = useState<"date" | "category">("date");
  const [receiptView, setReceiptView] = useState<ReceiptTarget | null>(null);
  const [scanning, setScanning] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const items = data.internalExpenses || [];
  // Wiederkehrende als einzelne Buchungen bis heute (wie die Buchhaltung, accounting.ts)
  const bookings = expandInternalExpenses(items, localISODate());
  const years = Array.from(new Set(bookings.map(e => (e.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();

  const openNew = () => { setForm(emptyItem); setModal("new"); };
  const openEdit = (e: InternalExpense & { occurrenceOf?: string }) => {
    const src = e.occurrenceOf ? items.find(x => x.id === e.occurrenceOf) : e;
    if (!src) return;
    setForm({ ...src }); setModal(src.id);
  };
  const closeModal = () => { setModal(null); setForm(emptyItem); };
  const save = () => {
    if (!form.amount) { showToast("Bitte einen Betrag eingeben."); return; }
    const isNew = modal === "new";
    const updated = isNew
      ? [...items, { ...form, id: generateId() }]
      : items.map(e => e.id === modal ? { ...form, id: modal } : e);
    update("internalExpenses", updated);
    closeModal();
  };
  const del = (rawId: string) => { const id = rawId.split("@")[0]; const e = items.find(x => x.id === id); removeWithUndo(`Ausgabe${e?.description ? " «" + e.description + "»" : ""} gelöscht`, "internalExpenses", x => x.id === id); };

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

  const getNet = (e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">) => e.inclMwst ? e.amount / (1 + (e.mwstRate || 0) / 100) : e.amount;
  const getTax = (e: Pick<Expense, "amount" | "inclMwst" | "mwstRate">) => e.amount - getNet(e);

  const allFiltered = bookings.filter(e => {
    if (filter.year && !(e.date || "").startsWith(filter.year)) return false;
    if (filter.category && e.category !== filter.category) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (![e.description, e.category].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const toggleSort = (col: string) => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }));

  const sorted = [...allFiltered].sort((a, b) => {
    let va: string | number, vb: string | number;
    if (sort.col === "date") { va = a.date || ""; vb = b.date || ""; }
    else if (sort.col === "amount") { va = a.amount || 0; vb = b.amount || 0; }
    else if (sort.col === "category") { va = a.category || ""; vb = b.category || ""; }
    else { va = ""; vb = ""; }
    return typeof va === "number" ? (va - (vb as number)) * sort.dir : va.localeCompare(vb as string) * sort.dir;
  });

  const groupedData = (() => {
    if (groupBy === "date") {
      const months: Record<string, InternalExpense[]> = {};
      sorted.forEach(e => {
        const key = (e.date || "").slice(0, 7);
        if (!months[key]) months[key] = [];
        months[key].push(e);
      });
      return Object.entries(months).sort((a, b) => (sort.col === "date" ? -sort.dir : 1) * b[0].localeCompare(a[0])).map(([key, its]) => ({
        key, label: key ? new Date(key + "-01").toLocaleDateString("de-CH", { month: "long", year: "numeric" }) : "Ohne Datum", items: its,
      }));
    }
    if (groupBy === "category") {
      const cats: Record<string, InternalExpense[]> = {};
      sorted.forEach(e => { const k = e.category || "Sonstiges"; if (!cats[k]) cats[k] = []; cats[k].push(e); });
      return Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0])).map(([key, its]) => ({ key, label: key, items: its }));
    }
    return [{ key: "all", label: "", items: sorted }];
  })();

  const totalNet = allFiltered.reduce((s, e) => s + getNet(e), 0);
  const totalTax = allFiltered.reduce((s, e) => s + getTax(e), 0);
  const totalBrutto = allFiltered.reduce((s, e) => s + (e.amount || 0), 0);

  const categoryTotals = intCats.map(cat => ({
    cat, amount: allFiltered.filter(e => e.category === cat).reduce((s, e) => s + (e.amount || 0), 0),
  })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 4);

  const hasFilters = filter.category || filter.search;

  return (
    <div>
      <ReceiptViewer expense={receiptView} onClose={() => setReceiptView(null)} />
      <Header title="Ausgaben" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { setCatEdit(""); setCatEditIdx(null); setCatModal(true); }}>Kategorien verwalten</button>
          <button className="btn btn-primary" onClick={openNew}>+ Ausgabe erfassen</button>
        </div>
      } />

      {catModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 18, fontFamily: "var(--font-ui)", fontWeight: 400, marginBottom: 20 }}>Kategorien verwalten</div>
            <div style={{ marginBottom: 16 }}>
              {intCats.map((cat, idx) => {
                const inUse = items.some(e => e.category === cat);
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    {catEditIdx === idx ? (
                      <input autoFocus value={catEdit} onChange={e => setCatEdit(e.target.value)}
                        onBlur={() => {
                          if (catEdit.trim()) {
                            const updated = intCats.map((c, i) => i === idx ? catEdit.trim() : c);
                            update("settings", { ...data.settings, internalExpenseCategories: updated });
                          }
                          setCatEditIdx(null);
                        }}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setCatEditIdx(null); }}
                        style={{ flex: 1, height: 30, fontSize: 12 }} />
                    ) : (
                      <div style={{ flex: 1, fontSize: 13, padding: "4px 0" }}>{cat}</div>
                    )}
                    <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setCatEdit(cat); setCatEditIdx(idx); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 11, opacity: inUse ? 0.35 : 1 }}
                      onClick={() => {
                        if (inUse) return;
                        update("settings", { ...data.settings, internalExpenseCategories: intCats.filter((_, i) => i !== idx) });
                      }} title={inUse ? "In Verwendung" : "Löschen"}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <input value={newCat} placeholder="Neue Kategorie…"
                onChange={e => setNewCat(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { update("settings", { ...data.settings, internalExpenseCategories: [...intCats, newCat.trim()] }); setNewCat(""); } }}
                style={{ flex: 1, height: 32, fontSize: 12 }} />
              <button className="btn btn-ghost" style={{ whiteSpace: "nowrap" }}
                onClick={() => { if (newCat.trim()) { update("settings", { ...data.settings, internalExpenseCategories: [...intCats, newCat.trim()] }); setNewCat(""); } }}>+ Hinzufügen</button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setCatModal(false)}>Schliessen</button>
            </div>
          </div>
        </div>
      )}

      {allFiltered.length > 0 && (
        <ExpenseFigures count={allFiltered.length} brutto={totalBrutto} netto={totalNet} vorsteuer={totalTax} totalSub={undefined} categories={categoryTotals} />
      )}

      <div className="filter-bar">
        <input className="pill" placeholder="Suchen …" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        <select className="pill" value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}>
          <option value="">Alle Jahre</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="pill" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}>
          <option value="">Alle Kategorien</option>
          {intCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setFilter({ year: filter.year, category: "", search: "" })}>Zurücksetzen</button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="receipt_long" title="Noch keine internen Ausgaben" text="Erfasse Büroausgaben wie Miete, Software oder Versicherungen – auch wiederkehrende – für die Übersicht der Bürokosten."
            action={<button className="btn btn-primary" onClick={openNew}>+ Ausgabe erfassen</button>} />
        </div>
      ) : allFiltered.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState icon="filter_alt_off" title="Keine Treffer" text="Kein Eintrag passt zu den Filtern." />
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <TableToolbar summary={<><b className="num">{allFiltered.length}</b> {allFiltered.length === 1 ? "Eintrag" : "Einträge"} · <span className="num">{formatCHF(totalBrutto)}</span></>}
            groups={[{ id: "date", label: "Monat" }, { id: "category", label: "Kategorie" }] as { id: typeof groupBy; label: string }[]} value={groupBy} onChange={setGroupBy} />
          <table>
            <thead>
              <tr>
                <SortTh sort={sort} onSort={toggleSort} col="date" style={{ width: 96 }}>Datum</SortTh>
                <SortTh sort={sort} onSort={toggleSort} col="category">Beschreibung · Kategorie</SortTh>
                <th className="hide-narrow" style={{ width: 110 }}>Wiederkehrend</th>
                <th className="hide-narrow" style={{ textAlign: "right", width: 110 }}>Netto</th>
                <th className="hide-narrow" style={{ textAlign: "right", width: 100 }}>Vorsteuer</th>
                <SortTh sort={sort} onSort={toggleSort} col="amount" style={{ textAlign: "right", width: 120 }}>Brutto</SortTh>
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
                    {groupedData.length > 1 && (
                      <tr>
                        <td colSpan={7} className="group-row">
                          {group.label}
                          <span className="group-sum">{group.items.length} {group.items.length === 1 ? "Eintrag" : "Einträge"} · {formatCHF(gBrutto)}</span>
                        </td>
                      </tr>
                    )}
                    {group.items.map(e => {
                      const net = getNet(e);
                      const tax = getTax(e);
                      return (
                        <tr key={e.id} className="row-link" onClick={() => openEdit(e)}>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                          <td>
                            <div style={{ color: "var(--text)" }}>{e.description || e.category || "—"}</div>
                            {groupBy !== "category" && e.description && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 1 }}>{e.category}</div>}
                          </td>
                          <td className="hide-narrow" style={{ fontSize: 12.5, color: e.recurring ? "var(--text2)" : "var(--text5)", whiteSpace: "nowrap" }}>
                            {e.recurring ? <><span className="msr" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4, color: "var(--text4)" }}>autorenew</span>{e.recurringInterval || "monatlich"}{e.recurringUntil ? ` bis ${e.recurringUntil.slice(5, 7)}.${e.recurringUntil.slice(0, 4)}` : ""}</> : "—"}
                          </td>
                          <td className="hide-narrow num" style={{ textAlign: "right" }}>{formatCHF(net)}</td>
                          <td className="hide-narrow num" style={{ textAlign: "right", color: "var(--text4)" }}>{tax > 0 ? formatCHF(tax) : "—"}</td>
                          <td style={{ textAlign: "right" }}><strong>{formatCHF(e.amount)}</strong></td>
                          <td className="row-actions" onClick={ev => ev.stopPropagation()}>
                            {e.receiptData && (
                              <button className="btn btn-ghost btn-sm" title="Beleg anzeigen" style={{ marginRight: 2 }} onClick={() => setReceiptView(e)}>
                                <span className="msr" style={{ fontSize: 15 }}>receipt_long</span>
                              </button>
                            )}
                            <RowMenu items={[
                              { label: "Bearbeiten", icon: "edit", onClick: () => openEdit(e) },
                              { label: e.recurring ? "Ganze Serie löschen" : "Löschen", icon: "delete", danger: true, onClick: () => del(e.id) },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                    {groupedData.length > 1 && group.items.length > 1 && (
                      <tr style={{ background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
                        <td colSpan={2} style={{ padding: "5px 12px", fontSize: 11, color: "var(--text4)" }}>Total {group.label}</td>
                        <td className="hide-narrow" />
                        <td className="hide-narrow" style={{ textAlign: "right", padding: "5px 12px", fontWeight: 600, fontSize: 11 }}>{formatCHF(gNet)}</td>
                        <td className="hide-narrow" style={{ textAlign: "right", padding: "5px 12px", fontWeight: 600, fontSize: 11, color: "var(--text4)" }}>{formatCHF(gTax)}</td>
                        <td style={{ textAlign: "right", padding: "5px 12px", fontWeight: 700, fontSize: 11 }}>{formatCHF(gBrutto)}</td>
                        <td></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--text)" }}>
                <td colSpan={2} style={{ color: "var(--text4)", fontSize: 12 }}>
                  {allFiltered.length} {allFiltered.length === 1 ? "Eintrag" : "Einträge"} {filter.year || ""}
                </td>
                <td className="hide-narrow" />
                <td className="hide-narrow" style={{ textAlign: "right", fontWeight: 600 }}>{formatCHF(totalNet)}</td>
                <td className="hide-narrow" style={{ textAlign: "right", fontWeight: 600, color: "var(--text4)" }}>{formatCHF(totalTax)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCHF(totalBrutto)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modal && (
        <Modal drawer title={modal === "new" ? "Ausgabe erfassen" : "Ausgabe bearbeiten"} onClose={closeModal} onSave={save}>
          <div className="form-row">
            <FormField label="Datum"><DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormField>
            <FormField label="Kategorie">
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {intCats.map(c => <option key={c}>{c}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Beschreibung"><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="z.B. Jahresmiete Büro, Adobe CC Lizenz…" autoFocus /></FormField>
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
            <div style={{ fontSize: 11, color: "var(--text4)", padding: "8px 12px", background: "var(--surface2)", borderRadius: 4, marginBottom: 12 }}>
              {form.inclMwst
                ? `Netto: ${formatCHF(form.amount / (1 + (form.mwstRate || 0) / 100))} · MWST: ${formatCHF(form.amount - form.amount / (1 + (form.mwstRate || 0) / 100))}`
                : `Ohne MWST-Abzug — ${formatCHF(form.amount)} wird 1:1 als Netto gebucht`}
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 12, marginTop: 4 }}>
            <label style={{ fontSize: 10, color: "var(--text4)", letterSpacing: "0.08em", display: "block", marginBottom: 8 }}>BELEG / RECHNUNG</label>
            {scanning && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--accent)", marginBottom: 8 }}>
                <span className="msr" style={{ fontSize: 15 }}>autorenew</span>
                Beleg wird gelesen — Betrag/Datum werden automatisch erkannt (bitte nachher prüfen) …
              </div>
            )}
            {form.receiptData ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", padding: "8px 12px", borderRadius: 4, marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: "var(--text3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="msr" style={{ fontSize: 15 }}>receipt_long</span>
                  {form.receiptName || "Beleg hochgeladen"}
                </span>
                <button className="btn btn-ghost" type="button" style={{ fontSize: 12 }} onClick={() => setReceiptView({ ...form })}>Anzeigen</button>
                <button className="btn btn-danger" type="button" style={{ fontSize: 12 }} onClick={() => setForm(f => ({ ...f, receiptData: null, receiptName: null }))}>Entfernen</button>
              </div>
            ) : (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--accent)", border: "1px dashed var(--accent)", borderRadius: 4, padding: "6px 14px", marginBottom: 12 }}>
                <span className="msr" style={{ fontSize: 15 }}>upload_file</span>
                Rechnung hochladen (Bild oder PDF)
                <input ref={receiptInputRef} type="file" accept="image/*,application/pdf" onChange={handleReceiptUpload} style={{ display: "none" }} />
              </label>
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 12, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" checked={!!form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked })} style={{ width: "auto" }} />
              Wiederkehrende Ausgabe
            </label>
            {form.recurring && (
              <FormField label="Intervall">
                <select value={form.recurringInterval || "monatlich"} onChange={e => setForm({ ...form, recurringInterval: e.target.value })}>
                  <option value="monatlich">Monatlich</option>
                  <option value="quartalsweise">Quartalsweise</option>
                  <option value="jährlich">Jährlich</option>
                </select>
              </FormField>
            )}
            {form.recurring && (
              <FormField label="Läuft bis (letzter Monat)">
                <input type="month" value={(form.recurringUntil || "").slice(0, 7)} onChange={e => setForm({ ...form, recurringUntil: e.target.value ? `${e.target.value}-01` : null })} />
                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Die Buchhaltung bucht die Ausgabe ab dem Datum oben in jedem Intervall bis heute (bzw. bis zu diesem Monat). Nicht zusätzlich jeden Monat einzeln erfassen.</div>
              </FormField>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
