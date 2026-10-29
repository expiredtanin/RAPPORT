// Reiter «Mitarbeiter»: Stammdaten-Liste mit Anlegen, Bearbeiten und Löschen.

import React from "react";
import { formatDate } from "../../utils";
import type { Employee, ViewProps } from "../../types";
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
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => { setEmpForm({ pensum: 100, wochenstunden: data.settings.defaultWochenstunden || 35, ferienWochen: data.settings.defaultFerienWochen || 5, pkAGSatz: data.settings.defaultPkAGSatz ?? 8.0, ferienUebertragVorjahr: {}, personalNr: nextPersonalNr(), _appAccess: false, _appUsername: "", _appPassword: "", _appRoleId: (data.appRoles || []).find(r => r.id !== "r-admin")?.id || "", _appUserId: undefined }); setModal("emp"); }}>+ Mitarbeiter</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Pensum</th><th>Wochenstunden</th><th>Ferien (Wo)</th><th>Eintritt</th><th></th></tr></thead>
          <tbody>
            {employees.length === 0 && <tr><td colSpan={6} className="empty-state">Noch keine Mitarbeiter erfasst</td></tr>}
            {employees.map(emp => (
              <tr key={emp.id}>
                <td><strong>{emp.name}</strong>{emp.role && <div style={{ fontSize: 11, color: "var(--text4)" }}>{emp.role}</div>}</td>
                <td>{emp.pensum || 100}%</td>
                <td>{((emp.wochenstunden || 35) * (emp.pensum || 100) / 100).toFixed(1)}h <span style={{ fontSize: 11, color: "var(--text4)" }}>({emp.wochenstunden || 35}h @ 100%)</span></td>
                <td>{emp.ferienWochen || 4} Wo</td>
                <td style={{ color: "var(--text4)" }}>{emp.eintrittsdatum ? formatDate(emp.eintrittsdatum) : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }} onClick={() => {
                    const linked = (data.users || []).find(u => u.id === emp.appUserId);
                    setEmpForm({ ...emp, _appAccess: !!linked, _appUsername: linked?.username || "", _appPassword: "", _appRoleId: linked?.appRoleId || (data.appRoles || []).find(r => r.id !== "r-admin")?.id || "", _appUserId: linked?.id });
                    setModal("emp");
                  }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                  <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => delEmp(emp.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
