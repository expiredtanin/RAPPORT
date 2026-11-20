// Mitarbeiter: Stammdaten, Arbeitszeit-Saldo, Ferien, Absenzen und Abschlüsse.
// Reiter:
//   Übersicht        – Kennzahlen pro Mitarbeiter (Soll/Ist/Saldo, Ferienstand)
//   Ferien & Absenzen – Kalender, Ferien- und Absenzeinträge (Genehmigung)
//   Mitarbeiter      – Stammdaten (Lohn, Sozialversicherungssätze, Pensum, Eintritt),
//                      optional App-Zugang (legt einen `user` mit Rolle an/ändert ihn)
//   Monatsabschluss  – Monate sperren (`settings.closedMonths`: dann keine Zeiteinträge mehr)
//   Jahresabschluss  – Ferienübertrag ins Folgejahr, Überstunden auszahlen
//
// Rechenregeln: worktime.ts (gemeinsam mit Zeiterfassung, «Heute» und Übersicht), hier über `calcEmpMonth` & Co.:
//   Soll = Werktage zwischen Ein- und Austritt bis heute × Tagessoll (Wochenstunden × Pensum ÷ 5); ganze
//          Feiertage frei, Halbtage/Vortage anteilig nach Pensum.
//   Saldo = Ist + Absenzen (Teilabsenzen mit ihrer Dauer) + Ferien − Soll.
// Überstundensaldo = Saldo seit Eintritt − ausbezahlte Stunden (`uberstundenAbschluss`, Typ «payout»;
// Stundenlohn inkl. 13. Monatslohn). Ferienanspruch = Wochen (mind. 4, bis 20 J. 5) × Wochenstunden × Pensum,
// anteilig bei Ein-/Austritt; Übertrag aus dem Vorjahr in `ferienUebertragVorjahr`. Pensumwechsel
// (`pensumVerlauf`) und Saldo-Übertrag per Stichtag (`saldoStichtag`) rechnet worktime.ts.
// Passwörter werden beim Speichern gehasht (`hashPassword`), nie im Klartext abgelegt.

import React, { useState } from "react";
import { generateId, getAbsenzTypes, hashPassword, localISODate } from "../utils";
import { overtimeHourlyRate } from "../worktime";
import { showToast } from "../toast";
import { removeWithUndo } from "../undo";
import { Header, PageTabs, ShareButton } from "../components/UI";
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
    const stundenlohn = overtimeHourlyRate(emp, localISODate());
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
    if (!empForm.name?.trim()) { showToast("Bitte einen Namen eingeben."); return; }
    if (!empForm.eintrittsdatum) { showToast("Bitte ein Eintrittsdatum angeben."); return; }
    if (empForm._appAccess && !empForm._appUsername?.trim()) { showToast("Bitte einen Benutzernamen eingeben."); return; }
    const isNew = !empForm.id;
    const { _appAccess, _appUsername, _appPassword, _appRoleId, _appUserId, ...empData } = empForm;
    const empId = empData.id || generateId();
    // Pensumwechsel ohne Datum/Pensum verwerfen und nach Datum ordnen; Übertrag nur mit Stichtag
    const pensumVerlauf = (empData.pensumVerlauf || []).filter(v => v.ab && Number(v.pensum) > 0).sort((a, b) => a.ab.localeCompare(b.ab));
    if ((empData.pensumVerlauf || []).length !== pensumVerlauf.length) showToast("Pensumwechsel ohne Datum oder Pensum wurden nicht übernommen.");
    if (empData.saldoStichtag && empData.eintrittsdatum && empData.saldoStichtag < empData.eintrittsdatum) { showToast("Der Saldo-Stichtag liegt vor dem Eintritt."); return; }
    const lohnVerlauf = (empData.lohnVerlauf || []).filter(v => v.ab && Number(v.monatslohn) > 0).sort((a, b) => a.ab.localeCompare(b.ab));
    if ((empData.lohnVerlauf || []).length !== lohnVerlauf.length) showToast("Lohnänderungen ohne Datum oder Betrag wurden nicht übernommen.");
    const emp = { ...empData, id: empId, pensumVerlauf, lohnVerlauf, ...(empData.saldoStichtag ? {} : { saldoUebertragStunden: null }) } as Employee;

    const existingUserId = _appUserId;
    let updatedUsers = data.users || [];
    if (_appAccess) {
      const userId = existingUserId || generateId();
      const existing = updatedUsers.find(u => u.id === userId);
      const newPwTrimmed = _appPassword?.trim();
      const hasExistingCreds = !!(existing?.passwordHash || existing?.password);
      if (!newPwTrimmed && !hasExistingCreds) { showToast("Bitte ein Passwort vergeben."); return; }

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
      if (isLastAdmin) { showToast("Mindestens ein Administrator muss bestehen bleiben."); return; }
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
    if (!absForm.employeeId || !absForm.type || !absForm.dateFrom) { showToast("Bitte Mitarbeiter, Absenztyp und Datum angeben."); return; }
    const isNew = !absForm.id;
    const [from, to] = [absForm.dateFrom, absForm.dateTo || absForm.dateFrom].sort();
    const a = { ...absForm, dateFrom: from, dateTo: to, id: absForm.id || generateId() } as Absence;
    update("absences", isNew ? [...absences, a] : absences.map(x => x.id === a.id ? a : x));
    setModal(null);
  };
  const delAbs = (id: string) => removeWithUndo("Absenz gelöscht", "absences", a => a.id === id);

  const saveFerien = () => {
    if (!ferienForm.employeeId || !ferienForm.dateFrom) { showToast("Bitte Mitarbeiter und Datum angeben."); return; }
    const isNew = !ferienForm.id;
    // Von/Bis vertauscht → tauschen; vom Büro eingetragene oder bearbeitete Ferien gelten als genehmigt
    const [from, to] = [ferienForm.dateFrom, ferienForm.dateTo || ferienForm.dateFrom].sort();
    const { originalData: _orig, ...rest } = ferienForm;
    const f = { ...rest, dateFrom: from, dateTo: to, status: "approved", id: ferienForm.id || generateId() } as FerienEntry;
    update("ferienEntries", isNew ? [...ferienEntries, f] : ferienEntries.map(x => x.id === f.id ? f : x));
    setModal(null);
  };
  const delFerien = (id: string) => removeWithUndo("Ferien gelöscht", "ferienEntries", f => f.id === id);


  const closedMonths = data.settings.closedMonths || [];
  const toggleMonth = (monthStr: string) => {
    const updated = closedMonths.includes(monthStr)
      ? closedMonths.filter(m => m !== monthStr)
      : [...closedMonths, monthStr];
    update("settings", { ...data.settings, closedMonths: updated });
  };

  const TABS = [
    { id: "übersicht", label: "Übersicht" },
    { id: "ferien", label: "Ferien & Absenzen" },
    { id: "mitarbeiter", label: "Personen" },
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
      } tabs={<PageTabs tabs={TABS} value={tab} onChange={setTab} />} />


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
