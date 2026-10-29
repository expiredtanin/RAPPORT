// Mitarbeiter: Stammdaten, Arbeitszeit-Saldo, Ferien, Absenzen und Abschlüsse.
// Reiter:
//   Übersicht        – Kennzahlen pro Mitarbeiter (Soll/Ist/Saldo, Ferienstand)
//   Ferien & Absenzen – Kalender, Ferien- und Absenzeinträge (Genehmigung)
//   Mitarbeiter      – Stammdaten (Lohn, Sozialversicherungssätze, Pensum, Eintritt),
//                      optional App-Zugang (legt einen `user` mit Rolle an/ändert ihn)
//   Monatsabschluss  – Monate sperren (`settings.closedMonths`: dann keine Zeiteinträge mehr)
//   Jahresabschluss  – Ferienübertrag ins Folgejahr, Überstunden auszahlen
//
// Rechenregeln (`calcEmpMonth`):
//   Soll = Σ Werktage ab Eintrittsdatum bis heute × Tagessoll (Wochenstunden × Pensum ÷ 5);
//          Feiertage zählen nicht (Halbtage mit `stundenDelta` reduzieren das Soll).
//   Ist  = erfasste Zeit des Monats; Absenzen und Ferien (genehmigte) zählen als Ist.
//   Saldo = Ist + Absenz + Ferien − Soll.
// Überstundensaldo = Summe aller Monatssaldi seit Eintritt − bereits ausbezahlte Stunden
// (`uberstundenAbschluss`, Typ «payout»). Ferienanspruch = Wochen × Wochenstunden × Pensum,
// im Eintrittsjahr anteilig pro Monat; Übertrag aus dem Vorjahr in `ferienUebertragVorjahr`.
// Passwörter werden beim Speichern gehasht (`hashPassword`), nie im Klartext abgelegt.

import React, { useState } from "react";
import { generateId, getAbsenzTypes, hashPassword, localISODate } from "../utils";
import { Header, ShareButton } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Absence, Employee, FerienEntry, OvertimeClosing, User, ViewProps } from "../types";
import { createEmployeeCalc } from "./employees/calc";
import type { AbschlussForm, EmpForm, ModalKind } from "./employees/types";
import OverviewTab from "./employees/OverviewTab";
import FerienTab from "./employees/FerienTab";
import MonthCloseTab from "./employees/MonthCloseTab";
import StaffListTab from "./employees/StaffListTab";
import YearCloseTab from "./employees/YearCloseTab";
import EmployeeModal from "./employees/EmployeeModal";
import { AbsenceModal, FerienModal } from "./employees/SimpleModals";


export default
function Employees({ data, update, saveAll, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent">) {
  const employees = data.employees || [];
  const absenzTypes = getAbsenzTypes(data);
  const absences = data.absences || [];
  const ferienEntries = data.ferienEntries || [];

  const [tab, setTab] = useState(employees.length === 0 ? "mitarbeiter" : "übersicht"); // "übersicht" | "mitarbeiter" | "feiertage" | "absenztypen"
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [empForm, setEmpForm] = useState<EmpForm>({});
  const [absForm, setAbsForm] = useState<Partial<Absence>>({ employeeId: "", type: "", dateFrom: "", dateTo: "", note: "" });
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [ferienForm, setFerienForm] = useState<Partial<FerienEntry>>({ employeeId: "", dateFrom: "", dateTo: "", note: "" });
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [abschlussYear, setAbschlussYear] = useState(new Date().getFullYear() - 1);
  const [abschlussForm, setAbschlussForm] = useState<Record<string, AbschlussForm>>({});


  const calc = createEmployeeCalc(data);

  const saveFerienUebertrag = (emp: Employee, hours: number | string) => {
    const updated = employees.map(e => e.id === emp.id ? {
      ...e,
      ferienUebertragVorjahr: { ...(e.ferienUebertragVorjahr || {}), [abschlussYear + 1]: +hours }
    } : e);
    update("employees", updated);
  };

  const saveUbAbschluss = (emp: Employee, form: AbschlussForm) => {
    const stundenlohn = emp.monatslohn
      ? Math.round((emp.monatslohn * 12 / ((emp.wochenstunden || 35) * 52)) * 100) / 100
      : 0;
    if (!stundenlohn || !(form.ubHours > 0)) return;
    const auszahlungBetrag = Math.round(form.ubHours * stundenlohn * (1 + form.ubZuschlag / 100) * 100) / 100;
    const entry: OvertimeClosing = {
      id: generateId(),
      empId: emp.id,
      year: abschlussYear,
      date: localISODate(),
      type: "payout",
      hoursSettled: form.ubHours,
      zuschlagPercent: form.ubZuschlag,
      stundenlohn,
      auszahlungBetrag,
    };
    update("uberstundenAbschluss", [...(data.uberstundenAbschluss || []), entry]);
    setAbschlussForm(prev => ({ ...prev, [emp.id]: { ...form, ubHours: 0 } }));
  };

  // ── Handlers ──
  const nextPersonalNr = () => {
    const nums = employees
      .map(e => e.personalNr)
      .filter(n => n && /^\d+$/.test(String(n)))
      .map(n => parseInt(n as string));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return String(next).padStart(3, "0");
  };

  const saveEmp = async () => {
    if (!empForm.name?.trim()) { alert("Bitte einen Namen eingeben."); return; }
    if (!empForm.eintrittsdatum) { alert("Bitte ein Eintrittsdatum angeben."); return; }
    if (empForm._appAccess && !empForm._appUsername?.trim()) { alert("Bitte einen Benutzernamen eingeben."); return; }
    const isNew = !empForm.id;
    const { _appAccess, _appUsername, _appPassword, _appRoleId, _appUserId, ...empData } = empForm;
    const empId = empData.id || generateId();
    const emp = { ...empData, id: empId } as Employee;

    const existingUserId = _appUserId;
    let updatedUsers = data.users || [];
    if (_appAccess) {
      const userId = existingUserId || generateId();
      const existing = updatedUsers.find(u => u.id === userId);
      const newPwTrimmed = _appPassword?.trim();
      const hasExistingCreds = !!(existing?.passwordHash || existing?.password);
      if (!newPwTrimmed && !hasExistingCreds) { alert("Bitte ein Passwort vergeben."); return; }

      let credFields: Partial<User>;
      if (newPwTrimmed) {
        const { hash, salt } = await hashPassword(newPwTrimmed);
        credFields = { passwordHash: hash, passwordSalt: salt };
      } else if (existing?.passwordHash) {
        credFields = { passwordHash: existing.passwordHash, passwordSalt: existing.passwordSalt };
      } else {
        // Existing legacy plaintext — keep until first login transparently upgrades it.
        credFields = { password: existing!.password };
      }

      const userEntry: User = {
        id: userId,
        username: (_appUsername as string).trim(),
        ...credFields,
        role: existing?.role || "mitarbeiter",
        displayName: emp.name,
        employeeId: empId,
        appRoleId: _appRoleId || "",
      };
      updatedUsers = existing ? updatedUsers.map(u => u.id === userId ? userEntry : u) : [...updatedUsers, userEntry];
      emp.appUserId = userId;
    } else if (existingUserId) {
      const targetUser = (data.users || []).find(u => u.id === existingUserId);
      const isLastAdmin = (data.users || []).filter(u => u.role === "admin").length <= 1
        && targetUser?.role === "admin";
      if (isLastAdmin) { alert("Mindestens ein Administrator muss bestehen bleiben."); return; }
      updatedUsers = updatedUsers.filter(u => u.id !== existingUserId);
      delete emp.appUserId;
    }

    const updatedEmployees = isNew ? [...employees, emp] : employees.map(e => e.id === emp.id ? emp : e);
    saveAll({ ...data, employees: updatedEmployees, users: updatedUsers });
    if (isNew) setSelectedEmpId(empId);
    setModal(null);
  };
  const delEmp = async (id: string) => { if (await askConfirm("Mitarbeiter löschen?")) { update("employees", employees.filter(e => e.id !== id)); if (selectedEmpId === id) setSelectedEmpId(null); } };

  const saveAbs = () => {
    const isNew = !absForm.id;
    const a = { ...absForm, id: absForm.id || generateId() } as Absence;
    update("absences", isNew ? [...absences, a] : absences.map(x => x.id === a.id ? a : x));
    setModal(null);
  };
  const delAbs = (id: string) => update("absences", absences.filter(a => a.id !== id));

  const saveFerien = () => {
    const isNew = !ferienForm.id;
    const f = { ...ferienForm, id: ferienForm.id || generateId() } as FerienEntry;
    update("ferienEntries", isNew ? [...ferienEntries, f] : ferienEntries.map(x => x.id === f.id ? f : x));
    setModal(null);
  };
  const delFerien = (id: string) => update("ferienEntries", ferienEntries.filter(f => f.id !== id));


  const closedMonths = data.settings.closedMonths || [];
  const toggleMonth = (monthStr: string) => {
    const updated = closedMonths.includes(monthStr)
      ? closedMonths.filter(m => m !== monthStr)
      : [...closedMonths, monthStr];
    update("settings", { ...data.settings, closedMonths: updated });
  };

  const TABS = [
    { id: "übersicht", label: "Übersicht" },
    { id: "ferien", label: "Ferien & Intern / Absenzen" },
    { id: "mitarbeiter", label: "Mitarbeiter" },
    { id: "monatsabschluss", label: "Monatsabschluss" },
    { id: "jahresabschluss", label: "Jahresabschluss" },
  ];

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Mitarbeiter" action={
        <div style={{ display: "flex", gap: 8 }}>
          <ShareButton options={[{ label: "PDF Übersicht", onClick: () => setPrintContent({ type: "mitarbeiterOverview", employees, settings: data.settings }) }]} />
          <button className="btn btn-primary" onClick={() => { setEmpForm({ pensum: 100, wochenstunden: data.settings.defaultWochenstunden || 35, ferienWochen: data.settings.defaultFerienWochen || 5, pkAGSatz: data.settings.defaultPkAGSatz ?? 8.0, ferienUebertragVorjahr: {}, personalNr: nextPersonalNr(), _appAccess: false, _appUsername: "", _appPassword: "", _appRoleId: (data.appRoles || []).find(r => r.id !== "r-admin")?.id || "", _appUserId: undefined }); setModal("emp"); }}>+ Mitarbeiter</button>
        </div>
      } />


      <div className="filter-bar">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`pill${tab === t.id ? " active" : ""}`}>{t.label}</button>
        ))}
      </div>


      {/* ── ÜBERSICHT ── */}
      {tab === "übersicht" && (
        <OverviewTab data={data} employees={employees} absences={absences} absenzTypes={absenzTypes} closedMonths={closedMonths} viewYear={viewYear} viewMonth={viewMonth} setViewYear={setViewYear} setViewMonth={setViewMonth} calc={calc} />
      )}

      {/* ── FERIEN ── */}
      {tab === "ferien" && (
        <FerienTab data={data} update={update} askConfirm={askConfirm} employees={employees} absences={absences} ferienEntries={ferienEntries} absenzTypes={absenzTypes} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId} setFerienForm={setFerienForm} setModal={setModal} delFerien={delFerien} delAbs={delAbs} viewYear={viewYear} setViewYear={setViewYear} calc={calc} />
      )}

      {/* ── MONATSABSCHLUSS ── */}
      {tab === "monatsabschluss" && (
        <MonthCloseTab data={data} closedMonths={closedMonths} toggleMonth={toggleMonth} viewYear={viewYear} setViewYear={setViewYear} />
      )}

      {/* ── MITARBEITER ── */}
      {tab === "mitarbeiter" && (
        <StaffListTab data={data} employees={employees} nextPersonalNr={nextPersonalNr} setEmpForm={setEmpForm} setModal={setModal} delEmp={delEmp} />
      )}

      {/* ── JAHRESABSCHLUSS ── */}
      {tab === "jahresabschluss" && (
        <YearCloseTab data={data} employees={employees} abschlussYear={abschlussYear} setAbschlussYear={setAbschlussYear} abschlussForm={abschlussForm} setAbschlussForm={setAbschlussForm} saveFerienUebertrag={saveFerienUebertrag} saveUbAbschluss={saveUbAbschluss} calc={calc} />
      )}

      {/* ── MODALS ── */}
      {modal === "emp" && (
        <EmployeeModal data={data} empForm={empForm} setEmpForm={setEmpForm} nextPersonalNr={nextPersonalNr} onClose={() => setModal(null)} onSave={saveEmp} />
      )}

      {modal === "abs" && (
        <AbsenceModal absForm={absForm} setAbsForm={setAbsForm} employees={employees} absenzTypes={absenzTypes} onClose={() => setModal(null)} onSave={saveAbs} />
      )}

      {modal === "ferien" && (
        <FerienModal ferienForm={ferienForm} setFerienForm={setFerienForm} employees={employees} onClose={() => setModal(null)} onSave={saveFerien} />
      )}

    </div>
  );
}
