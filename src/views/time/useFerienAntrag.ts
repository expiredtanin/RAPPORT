// Zeiterfassung: Ferien-Übersicht und Ferienantrag (Zustand der beiden Dialoge und ihre Aktionen).

import { useState } from "react";
import { closedMonthMsg, ferienOverlap, generateId } from "../../utils";
import { showToast } from "../../toast";
import { removeWithUndo } from "../../undo";
import type { AppData, Employee, FerienEntry, UpdateFn } from "../../types";

/** Zustand und Aktionen für «Ferien beantragen» und die Ferien-Übersicht des gewählten Mitarbeiters. */
export function useFerienAntrag(data: AppData, update: UpdateFn, employees: Employee[], selectedEmpId: string, currentDate: string, ownOnlyEmpId = "") {
  // Ferien-Antrag Modal
  const [antragModal, setAntragModal] = useState<"ferien" | null>(null);
  const [antragForm, setAntragForm] = useState<Partial<FerienEntry>>({});

  const openFerienAntrag = () => {
    setAntragForm({ employeeId: ownOnlyEmpId || selectedEmpId || (employees[0]?.id || ""), dateFrom: currentDate, dateTo: currentDate, note: "" });
    setAntragModal("ferien");
  };
  const saveAntrag = () => {
    // ohne Personalrecht nur für sich selbst (vorher Anträge für beliebige Kollegen — blockierten deren eigene, Runde 38)
    if (ownOnlyEmpId && antragForm.employeeId !== ownOnlyEmpId) { showToast("Ferien beantragen kannst du nur für dich selbst."); return; }
    if (!antragForm.employeeId || !antragForm.dateFrom || !antragForm.dateTo) return;
    // Von/Bis vertauscht → tauschen (sonst zählte der Antrag 0 Tage und blieb trotzdem stehen)
    const form = antragForm.dateTo < antragForm.dateFrom ? { ...antragForm, dateFrom: antragForm.dateTo, dateTo: antragForm.dateFrom } : antragForm;
    const prev = form.id ? (data.ferienEntries || []).find(f => f.id === form.id) : undefined;
    const closed = closedMonthMsg(data.settings?.closedMonths, [form.dateFrom, form.dateTo], [prev?.dateFrom, prev?.dateTo]);
    if (closed) { showToast(closed); return; }
    if (ferienOverlap(data.ferienEntries, form)) { showToast("Für diesen Zeitraum gibt es schon Ferien oder einen Antrag."); return; }
    if (form.id) {
      const existing = (data.ferienEntries || []).find(f => f.id === form.id);
      let entry: FerienEntry;
      if (existing?.status === "approved" || !existing?.status) {
        // Bisher genehmigte Daten sind die des Eintrags selbst (ein altes `originalData` wäre überholt)
        entry = {
          ...form,
          status: "pending",
          originalData: existing ? { dateFrom: existing.dateFrom, dateTo: existing.dateTo, note: existing.note || "" } : null,
        } as FerienEntry;
      } else {
        entry = { ...form, status: "pending" } as FerienEntry;
      }
      update("ferienEntries", (data.ferienEntries || []).map(f => f.id === entry.id ? entry : f));
    } else {
      const entry = { ...form, id: generateId(), status: "pending", createdAt: new Date().toISOString() } as FerienEntry;
      update("ferienEntries", [...(data.ferienEntries || []), entry]);
    }
    setAntragModal(null);
  };
  const deleteFerien = (id: string) => {
    const f = (data.ferienEntries || []).find(x => x.id === id);
    const closed = closedMonthMsg(data.settings?.closedMonths, [f?.dateFrom, f?.dateTo]);
    if (closed) { showToast(closed); return; }
    removeWithUndo("Ferien gelöscht", "ferienEntries", x => x.id === id);
  };
  const cancelFerienEdit = (id: string) => {
    const f0 = (data.ferienEntries || []).find(x => x.id === id);
    const closed = closedMonthMsg(data.settings?.closedMonths, [f0?.dateFrom, f0?.dateTo], [f0?.originalData?.dateFrom, f0?.originalData?.dateTo]);
    if (closed) { showToast(closed); return; }
    if (f0?.originalData && ferienOverlap(data.ferienEntries, { id, employeeId: f0.employeeId, dateFrom: f0.originalData.dateFrom, dateTo: f0.originalData.dateTo })) {
      showToast("Die bisher genehmigten Daten überschneiden sich inzwischen mit anderen Ferien — bitte zuerst diese anpassen."); return;
    }
    update("ferienEntries", (data.ferienEntries || []).map(f => {
    if (f.id !== id || !f.originalData) return f;
    const { originalData, ...rest } = f;
    return { ...rest, dateFrom: originalData.dateFrom, dateTo: originalData.dateTo, note: originalData.note, status: "approved" } as FerienEntry;
    }));
  };
  const editFerien = (f: FerienEntry) => { setAntragForm({ ...f }); setAntragModal("ferien"); };

  const [ferienUebersicht, setFerienUebersicht] = useState(false);
  return { antragModal, setAntragModal, antragForm, setAntragForm, openFerienAntrag, saveAntrag, deleteFerien, cancelFerienEdit, editFerien, ferienUebersicht, setFerienUebersicht };
}
