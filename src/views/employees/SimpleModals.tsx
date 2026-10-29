// Kleine Modals der Mitarbeiter-Ansicht: Absenz erfassen und Ferien eintragen.

import React from "react";
import { Modal, FormField, DateInput } from "../../components/UI";
import type { Absence, AbsenzType, Employee, FerienEntry } from "../../types";

interface AbsenceModalProps {
  absForm: Partial<Absence>;
  setAbsForm: React.Dispatch<React.SetStateAction<Partial<Absence>>>;
  employees: Employee[];
  absenzTypes: AbsenzType[];
  onClose: () => void;
  onSave: () => void;
}

/** Modal zum Erfassen/Bearbeiten einer Absenz. */
export function AbsenceModal({ absForm, setAbsForm, employees, absenzTypes, onClose, onSave }: AbsenceModalProps) {
  return (
    <Modal title={absForm.id ? "Absenz bearbeiten" : "Absenz erfassen"} onClose={onClose} onSave={onSave}>
      <div className="form-row">
        <FormField label="Mitarbeiter">
          <select value={absForm.employeeId || ""} onChange={e => setAbsForm({ ...absForm, employeeId: e.target.value })}>
            <option value="">— wählen —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </FormField>
        <FormField label="Absenztyp">
          <select value={absForm.type || ""} onChange={e => setAbsForm({ ...absForm, type: e.target.value })}>
            <option value="">— wählen —</option>
            {absenzTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Von"><DateInput value={absForm.dateFrom || ""} onChange={e => setAbsForm({ ...absForm, dateFrom: e.target.value })} /></FormField>
        <FormField label="Bis"><DateInput value={absForm.dateTo || ""} onChange={e => setAbsForm({ ...absForm, dateTo: e.target.value })} /></FormField>
      </div>
      <FormField label="Notiz (optional)"><input value={absForm.note || ""} onChange={e => setAbsForm({ ...absForm, note: e.target.value })} /></FormField>
    </Modal>
  );
}

interface FerienModalProps {
  ferienForm: Partial<FerienEntry>;
  setFerienForm: React.Dispatch<React.SetStateAction<Partial<FerienEntry>>>;
  employees: Employee[];
  onClose: () => void;
  onSave: () => void;
}

/** Modal zum Eintragen/Bearbeiten von Ferien. */
export function FerienModal({ ferienForm, setFerienForm, employees, onClose, onSave }: FerienModalProps) {
  return (
    <Modal title={ferienForm.id ? "Ferien bearbeiten" : "Ferien eintragen"} onClose={onClose} onSave={onSave}>
      <FormField label="Mitarbeiter">
        <select value={ferienForm.employeeId || ""} onChange={e => setFerienForm({ ...ferienForm, employeeId: e.target.value })}>
          <option value="">— wählen —</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </FormField>
      <div className="form-row">
        <FormField label="Von"><DateInput value={ferienForm.dateFrom || ""} onChange={e => setFerienForm({ ...ferienForm, dateFrom: e.target.value })} /></FormField>
        <FormField label="Bis"><DateInput value={ferienForm.dateTo || ""} onChange={e => setFerienForm({ ...ferienForm, dateTo: e.target.value })} /></FormField>
      </div>
      <FormField label="Notiz (optional)"><input value={ferienForm.note || ""} onChange={e => setFerienForm({ ...ferienForm, note: e.target.value })} /></FormField>
    </Modal>
  );
}
