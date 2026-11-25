// Reiter «Mitarbeiter»: Stammdaten-Liste mit Anlegen, Bearbeiten und Löschen.

import React from "react";
import { arbeitszeitAm, formatDate, localISODate } from "../../utils";
import { defaultAppRoleId } from "../../auth";
import type { Employee, ViewProps } from "../../types";
import { RowMenu } from "../../components/UI";
import type { EmpForm, ModalKind } from "./types";

interface StaffListTabProps {
  data: ViewProps["data"];
  employees: Employee[];
  nextPersonalNr: () => string;
  setEmpForm: React.Dispatch<React.SetStateAction<EmpForm>>;
  setModal: React.Dispatch<React.SetStateAction<ModalKind>>;
  delEmp: (id: string) => void;
}

/** Reiter «Mitarbeiter» (Stammdaten-Liste) der Mitarbeiter-Ansicht. */
export default function StaffListTab({ data, employees, nextPersonalNr, setEmpForm, setModal, delEmp }: StaffListTabProps) {
  /** Öffnet den Bearbeiten-Dialog samt Daten des verknüpften App-Zugangs. */
  const openEmp = (emp: Employee) => {
    const linked = (data.users || []).find(u => u.id === emp.appUserId);
    setEmpForm({ ...emp, _appAccess: !!linked, _appUsername: linked?.username || "", _appPassword: "", _appRoleId: linked?.appRoleId || defaultAppRoleId(data.appRoles), _appUserId: linked?.id });
    setModal("emp");
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => { setEmpForm({ pensum: 100, wochenstunden: data.settings.defaultWochenstunden || 35, ferienWochen: data.settings.defaultFerienWochen || 5, pkAGSatz: data.settings.defaultPkAGSatz ?? 8.0, ferienUebertragVorjahr: {}, personalNr: nextPersonalNr(), _appAccess: false, _appUsername: "", _appPassword: "", _appRoleId: defaultAppRoleId(data.appRoles), _appUserId: undefined }); setModal("emp"); }}>+ Mitarbeiter</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Pensum</th><th>Wochenstunden</th><th>Ferien (Wo)</th><th>Eintritt</th><th></th></tr></thead>
          <tbody>
            {employees.length === 0 && <tr><td colSpan={6} className="empty-state">Noch keine Mitarbeiter erfasst</td></tr>}
            {employees.map(emp => { const az = arbeitszeitAm(emp, localISODate()); return (
              <tr key={emp.id} className="row-link" onClick={() => openEmp(emp)}>
                <td><strong>{emp.name}</strong>{emp.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{emp.role}</div>}</td>
                <td>{az.pensum}%{(emp.pensumVerlauf || []).length > 0 && <span className="msr" title="Pensum mit Wechseln — Wert von heute" style={{ fontSize: 13, color: "var(--text5)", marginLeft: 4, verticalAlign: "middle" }}>history</span>}</td>
                <td>{(az.wochenstunden * az.pensum / 100).toFixed(1)}h <span style={{ fontSize: 11, color: "var(--text4)" }}>({az.wochenstunden}h @ 100%)</span></td>
                <td>{emp.ferienWochen || 4} Wo</td>
                <td style={{ color: "var(--text4)" }}>{emp.eintrittsdatum ? formatDate(emp.eintrittsdatum) : "—"}</td>
                <td className="row-actions" onClick={e => e.stopPropagation()}>
                  <RowMenu items={[
                    { label: "Bearbeiten", icon: "edit", onClick: () => openEmp(emp) },
                    { label: "Löschen …", icon: "delete", danger: true, onClick: () => delEmp(emp.id) },
                  ]} />
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
