// Zeiterfassung: Ferien-Übersicht und Ferienantrag (Zustand der beiden Dialoge und ihre Aktionen).

import { useState } from "react";
import { generateId } from "../../utils";
import type { AppData, Employee, FerienEntry, UpdateFn } from "../../types";

/** Zustand und Aktionen für «Ferien beantragen» und die Ferien-Übersicht des gewählten Mitarbeiters. */
export function useFerienAntrag(data: AppData, update: UpdateFn, employees: Employee[], selectedEmpId: string, currentDate: string) {
  // Ferien-Antrag Modal
  const [antragModal, setAntragModal] = useState<"ferien" | null>(null);
  const [antragForm, setAntragForm] = useState<Partial<FerienEntry>>({});

  const openFerienAntrag = () => {
    setAntragForm({ employeeId: selectedEmpId || (employees[0]?.id || ""), dateFrom: currentDate, dateTo: currentDate, note: "" });
    setAntragModal("ferien");
  };
  const saveAntrag = () => {
    if (!antragForm.employeeId || !antragForm.dateFrom || !antragForm.dateTo) return;
    if (antragForm.id) {
      const existing = (data.ferienEntries || []).find(f => f.id === antragForm.id);
      let entry: FerienEntry;
      if (existing?.status === "approved" || !existing?.status) {
        entry = {
          ...antragForm,
          status: "pending",
          originalData: existing?.originalData || { dateFrom: existing!.dateFrom, dateTo: existing!.dateTo, note: existing!.note || "" },
        } as FerienEntry;
      } else {
        entry = { ...antragForm, status: "pending" } as FerienEntry;
      }
      update("ferienEntries", (data.ferienEntries || []).map(f => f.id === entry.id ? entry : f));
    } else {
      const entry = { ...antragForm, id: generateId(), status: "pending", createdAt: new Date().toISOString() } as FerienEntry;
      update("ferienEntries", [...(data.ferienEntries || []), entry]);
    }
    setAntragModal(null);
  };
  const deleteFerien = (id: string) => update("ferienEntries", (data.ferienEntries || []).filter(f => f.id !== id));
  const cancelFerienEdit = (id: string) => update("ferienEntries", (data.ferienEntries || []).map(f => {
    if (f.id !== id || !f.originalData) return f;
    const { originalData, ...rest } = f;
    return { ...rest, dateFrom: originalData.dateFrom, dateTo: originalData.dateTo, note: originalData.note, status: "approved" } as FerienEntry;
  }));
  const editFerien = (f: FerienEntry) => { setAntragForm({ ...f }); setAntragModal("ferien"); };

  const [ferienUebersicht, setFerienUebersicht] = useState(false);
  return { antragModal, setAntragModal, antragForm, setAntragForm, openFerienAntrag, saveAntrag, deleteFerien, cancelFerienEdit, editFerien, ferienUebersicht, setFerienUebersicht };
}
