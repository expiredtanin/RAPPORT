// Zeiterfassung: Spesen des gewählten Tages (anlegen, ändern, löschen) samt Beleg-Upload und Beleg-Ansicht.

import React, { useState, useRef, useEffect } from "react";
import { showToast } from "../../toast";
import { EXPENSE_CATEGORIES } from "../../constants";
import { generateId, receiptToDataUrl, checkLocalBudget } from "../../utils";
import { removeWithUndo } from "../../undo";
import { isLocalBackend } from "../../storage/adapter";
import type { AppData, Expense, UpdateFn } from "../../types";

/**
 * Gesperrt: über eine Lohnabrechnung ausbezahlt (ändern nur nach Storno der Abrechnung, sonst stimmen Lohn und
 * Buchhaltung nicht mehr) oder — bei `lockApproved` (eigene Spesen ohne Admin) — nicht mehr «offen».
 */
export function expenseLock(e: Expense, lockApproved: boolean): string | null {
  if (e.lohnEntryId) return "Diese Spese ist über eine Lohnabrechnung ausbezahlt. Zuerst die Lohnabrechnung stornieren.";
  if (lockApproved && (e.status || "offen") !== "offen") return "Eigene genehmigte oder ausbezahlte Spesen ändert nur die Buchhaltung.";
  return null;
}

/** Spesen-Zustand und -Aktionen für den Tag `currentDate` (und den Mitarbeiter `selectedEmpId`, falls gesetzt). */
export function useExpenses(data: AppData, update: UpdateFn, currentDate: string, selectedEmpId: string, lockApproved = false) {
  // Tages-Spesen — inline editing
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const dayExpenses = (data.expenses || []).filter(e => {
    if (e.date !== currentDate) return false;
    if (selectedEmpId) return e.employeeId === selectedEmpId;
    return true;
  });

  // Hier angelegte, leer gebliebene Spesen (Betrag 0, ohne Beschreibung/Beleg) beim Tages-/Personenwechsel und beim
  // Verlassen wieder entfernen — sie standen sonst als «1 Spese genehmigen, CHF 0.00» in der Buchhaltung (Runde 33)
  const createdRef = useRef(new Set<string>());
  useEffect(() => () => {
    const created = createdRef.current;
    if (!created.size) return;
    const ids = new Set(created);
    created.clear();
    update("expenses", prev => (prev || []).filter(e => !(ids.has(e.id) && !Number(e.amount) && !(e.description || "").trim() && !e.receiptData)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Wechsel von Tag/Person bzw. Verlassen
  }, [currentDate, selectedEmpId]);

  const addExp = () => {
    const id = generateId();
    createdRef.current.add(id);
    update("expenses", prev => [...(prev || []), { id, date: currentDate, category: (data.settings.expenseCategories || EXPENSE_CATEGORIES)[0], projectId: "", description: "", amount: 0, mwstRate, inclMwst: true, employeeId: selectedEmpId || "" } as Expense]);
  };
  const locked = (id: string) => {
    const e = (data.expenses || []).find(x => x.id === id);
    const msg = e ? expenseLock(e, lockApproved) : null;
    if (msg) showToast(msg);
    return !!msg;
  };
  const updateExp = (id: string, changes: Partial<Expense>) => { if (locked(id)) return; update("expenses", prev => (prev || []).map(e => e.id === id ? { ...e, ...changes } : e)); };
  // Löschen mit «Rückgängig» wie in Buchhaltung → Spesen
  const delExp = (id: string) => {
    if (locked(id)) return;
    const e = (data.expenses || []).find(x => x.id === id);
    removeWithUndo(`Spese${e?.description ? " «" + e.description + "»" : ""} gelöscht`, "expenses", x => x.id === id);
  };
  const isExpLocked = (e: Expense) => !!expenseLock(e, lockApproved);

  const [receiptView, setReceiptView] = useState<Expense | null>(null);
  const [uploadingExpId, setUploadingExpId] = useState<string | null>(null);
  const expReceiptInputRef = useRef<HTMLInputElement>(null);
  const handleExpReceiptUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    const expId = uploadingExpId;
    if (!file || !expId) return;
    try {
      const receiptData = await receiptToDataUrl(file);
      const old = (data.expenses || []).find(e => e.id === expId)?.receiptData;
      const problem = isLocalBackend ? checkLocalBudget(data, receiptData.length, old?.length || 0) : null;
      if (problem) { showToast(problem); return; }
      updateExp(expId, { receiptData, receiptName: file.name });
    } catch (err) {
      showToast((err as Error).message || "Der Beleg konnte nicht gelesen werden.");
    }
  };
  return { dayExpenses, addExp, updateExp, delExp, isExpLocked, receiptView, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload };
}
