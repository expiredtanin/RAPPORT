// Zeiterfassung: Spesen des gewählten Tages (anlegen, ändern, löschen) samt Beleg-Upload und Beleg-Ansicht.

import React, { useState, useRef } from "react";
import { EXPENSE_CATEGORIES } from "../../constants";
import { generateId, receiptToDataUrl, checkLocalBudget } from "../../utils";
import { isLocalBackend } from "../../storage/adapter";
import type { AppData, Expense, UpdateFn } from "../../types";

/** Spesen-Zustand und -Aktionen für den Tag `currentDate` (und den Mitarbeiter `selectedEmpId`, falls gesetzt). */
export function useExpenses(data: AppData, update: UpdateFn, currentDate: string, selectedEmpId: string) {
  // Tages-Spesen — inline editing
  const mwstRate = data.settings.mwstRate ?? 8.1;
  const dayExpenses = (data.expenses || []).filter(e => {
    if (e.date !== currentDate) return false;
    if (selectedEmpId) return e.employeeId === selectedEmpId;
    return true;
  });

  const addExp = () => {
    update("expenses", [...(data.expenses || []), { id: generateId(), date: currentDate, category: (data.settings.expenseCategories || EXPENSE_CATEGORIES)[0], projectId: "", description: "", amount: 0, mwstRate, inclMwst: true, employeeId: selectedEmpId || "" } as Expense]);
  };
  const updateExp = (id: string, changes: Partial<Expense>) => update("expenses", prev => (prev || []).map(e => e.id === id ? { ...e, ...changes } : e));
  const delExp = (id: string) => update("expenses", (data.expenses || []).filter(e => e.id !== id));

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
      if (problem) { alert(problem); return; }
      updateExp(expId, { receiptData, receiptName: file.name });
    } catch (err) {
      alert((err as Error).message || "Der Beleg konnte nicht gelesen werden.");
    }
  };
  return { dayExpenses, addExp, updateExp, delExp, receiptView, setReceiptView, setUploadingExpId, expReceiptInputRef, handleExpReceiptUpload };
}
