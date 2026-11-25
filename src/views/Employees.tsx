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

import React, { useState, useEffect, useRef } from "react";
import { applyEdit } from "../storage/merge";
import { closedMonthMsg, ferienOverlap, generateId, getAbsenzTypes, hashPassword, localISODate, withDefaultRates } from "../utils";
import { defaultAppRoleId } from "../auth";
import { isCloudBackend } from "../storage/adapter";
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
function Employees({ data, update, saveAll, setPrintContent, userPermissions, currentEmployeeId = null }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent"> & {
  /** Rechte der Rolle (null = Vollzugriff); Lohnfelder nur mit «loehne» */
  userPermissions?: string[] | null;
  /** Mitarbeiter-Datensatz der angemeldeten Person (eigene Anträge nicht selbst genehmigen) */
  currentEmployeeId?: string | null;
}) {
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
    // Überstunden-Abschlüsse nur mit Recht «Löhne» (wie der Server)
    if (userPermissions && !userPermissions.includes("loehne")) { showToast("Überstunden abschliessen braucht das Recht Löhne."); return; }
    // Stundenlohn per Ende des Abschlussjahrs (bzw. heute, solange es läuft), wie im Formular angezeigt
    const stundenlohn = overtimeHourlyRate(emp, [`${abschlussYear}-12-31`, localISODate()].sort()[0]);
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
      imLohn: true,
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

  // Stand des Mitarbeiters beim Öffnen des Dialogs (Basis für applyEdit)
  const empBaseRef = useRef<Employee | undefined>(undefined);
  useEffect(() => {
    if (modal === "emp") empBaseRef.current = empForm.id ? employees.find(e => e.id === empForm.id) : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Öffnen merken
  }, [modal]);
  const saveEmp = async () => {
    if (!empForm.name?.trim()) { showToast("Bitte einen Namen eingeben."); return; }
    if (!empForm.eintrittsdatum) { showToast("Bitte ein Eintrittsdatum angeben."); return; }
    if (empForm._appAccess && !empForm._appUsername?.trim()) { showToast("Bitte einen Benutzernamen eingeben."); return; }
    if (empForm._appAccess && !isCloudBackend) {
      const uname = (empForm._appUsername || "").trim().toLowerCase();
      const prevName = ((data.users || []).find(u => u.id === empForm._appUserId)?.username || "").trim().toLowerCase();
      if (uname !== prevName && (data.users || []).some(u => u.id !== empForm._appUserId && (u.username || "").trim().toLowerCase() === uname)) { showToast(`Den Benutzernamen «${empForm._appUsername?.trim()}» gibt es schon.`); return; }
      const ownUser = (data.users || []).find(u => u.id === empForm._appUserId);
      if (!empForm._appRoleId && ownUser?.role !== "admin") { showToast("Bitte eine Rolle für den App-Zugang wählen."); return; }
    }
    // Bereiche (sonst rechnete der Saldo mit «-25 h/Woche» oder 500 % Pensum weiter)
    const pens = [empForm.pensum, ...(empForm.pensumVerlauf || []).map(v => v.pensum)].filter(v => v !== undefined && v !== null && String(v) !== "");
    if (pens.some(v => !(Number(v) >= 0 && Number(v) <= 100))) { showToast("Das Pensum liegt zwischen 0 und 100 %."); return; }
    if (empForm.wochenstunden != null && !(Number(empForm.wochenstunden) >= 0 && Number(empForm.wochenstunden) <= 80)) { showToast("Wochenstunden zwischen 0 und 80."); return; }
    if (empForm.ferienWochen != null && !(Number(empForm.ferienWochen) >= 0 && Number(empForm.ferienWochen) <= 20)) { showToast("Ferienwochen zwischen 0 und 20."); return; }
    const isNew = !empForm.id;
    const { _appAccess, _appUsername, _appPassword, _appRoleId, _appUserId, ...empData } = empForm;
    const empId = empData.id || generateId();
    // Pensumwechsel ohne Datum/Pensum verwerfen und nach Datum ordnen; Übertrag nur mit Stichtag
    const pensumVerlauf = (empData.pensumVerlauf || []).filter(v => v.ab && v.pensum != null && String(v.pensum) !== "" && Number(v.pensum) >= 0).sort((a, b) => a.ab.localeCompare(b.ab));
    if ((empData.pensumVerlauf || []).length !== pensumVerlauf.length) showToast("Pensumwechsel ohne Datum oder Pensum wurden nicht übernommen.");
    if (empData.saldoStichtag && empData.eintrittsdatum && empData.saldoStichtag < empData.eintrittsdatum) { showToast("Der Saldo-Stichtag liegt vor dem Eintritt."); return; }
    const lohnVerlauf = (empData.lohnVerlauf || []).filter(v => v.ab && Number(v.monatslohn) > 0).sort((a, b) => a.ab.localeCompare(b.ab));
    if ((empData.lohnVerlauf || []).length !== lohnVerlauf.length) showToast("Lohnänderungen ohne Datum oder Betrag wurden nicht übernommen.");
    // angezeigte Standardsätze ausdrücklich speichern (sonst «leer» → in der Cloud 0 % → Lohn ohne Sozialabzüge)
    const emp = { ...withDefaultRates(empData, data.settings.defaultPkAGSatz), id: empId, pensumVerlauf, lohnVerlauf, ...(empData.saldoStichtag ? {} : { saldoUebertragStunden: 0 })   /* 0 wie der Server speichert: sonst bei jedem Speichern eine «Änderung» */ } as Employee;

    // Cloud: Konten, Passwörter und Rollen verwaltet der Server (Einladen/Rolle unter Einstellungen → Team);
    // hier nur die Mitarbeiter-Felder speichern und die Verknüpfung appUserId unverändert lassen. Vorher verlangte
    // der Dialog ein Passwort für verknüpfte Personen, und ohne Haken trennte er das Konto still ab (E2E 25.11.2026).
    // Bearbeiten: nur die eigenen Änderungen gegen den Stand beim Öffnen auf den aktuellen Stand (applyEdit) — vorher
    // schrieb der Dialog das ganze Objekt zurück und verwarf z.B. einen inzwischen bestätigten Ferienübertrag (Audit R22)
    // Basis gleich normalisieren wie das Formular (leere Verläufe, Standardsätze, Übertrag 0): sonst galten diese
    // Ergänzungen als «eigene Änderung» und überschrieben z.B. eine gleichzeitig erfasste Lohnänderung (Review R23)
    const rawBase = empBaseRef.current?.id === emp.id ? empBaseRef.current : undefined;
    const base = rawBase && ({ ...withDefaultRates(rawBase, data.settings.defaultPkAGSatz), pensumVerlauf: rawBase.pensumVerlauf || [], lohnVerlauf: rawBase.lohnVerlauf || [],
      ...(rawBase.saldoStichtag ? {} : { saldoUebertragStunden: 0 }) } as Employee);
    const mergeEmp = (list: Employee[], next: Employee) => isNew ? [...list, next] : list.map(e => e.id === next.id ? (base ? applyEdit(base, next, e) : next) : e);
    if (isCloudBackend) {
      const kept = isNew ? emp : { ...emp, appUserId: employees.find(e => e.id === emp.id)?.appUserId };
      saveAll(prev => ({ ...prev, employees: mergeEmp(prev.employees || [], kept) }));
      if (isNew) setSelectedEmpId(empId);
      setModal(null);
      return;
    }
    const existingUserId = _appUserId;
    // Konto-Änderung als Funktion auf die (nach dem Passwort-Hashen) aktuelle Benutzerliste
    let applyUsers: (users: User[]) => User[] = u => u;
    const updatedUsers = data.users || [];
    if (_appAccess) {
      const userId = existingUserId || generateId();
      const existing = updatedUsers.find(u => u.id === userId);
      const newPwTrimmed = _appPassword?.trim();
      const hasExistingCreds = !!(existing?.passwordHash || existing?.password);
      if (!newPwTrimmed && !hasExistingCreds) { showToast("Bitte ein Passwort vergeben."); return; }
      // gleiche Mindestlänge wie Ersteinrichtung und «Mein Profil»
      if (newPwTrimmed && newPwTrimmed.length < 8) { showToast("Das Passwort braucht mindestens 8 Zeichen."); return; }

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

      // Rolle aus der gewählten App-Rolle ableiten (wie Einstellungen → Team): sonst zeigte der Dialog «Mitarbeiter»,
      // das Konto behielt aber Vollzugriff — bzw. «Administrator» ohne Team/Studio-Einstellungen (Runde 27)
      const role: User["role"] = _appRoleId === "r-admin" ? "admin" : existing?.role && existing.role !== "admin" ? existing.role : "mitarbeiter";
      if (existing?.role === "admin" && role !== "admin" && !updatedUsers.some(u => u.id !== userId && u.role === "admin")) {
        showToast("Mindestens ein Administrator muss bestehen bleiben."); return;
      }
      const userEntry: User = {
        id: userId,
        username: (_appUsername as string).trim(),
        ...credFields,
        role,
        displayName: emp.name,
        employeeId: empId,
        appRoleId: _appRoleId || "",
      };
      applyUsers = users => users.some(u => u.id === userId) ? users.map(u => u.id === userId ? userEntry : u) : [...users, userEntry];
      emp.appUserId = userId;
    } else if (existingUserId) {
      const targetUser = (data.users || []).find(u => u.id === existingUserId);
      const isLastAdmin = (data.users || []).filter(u => u.role === "admin").length <= 1
        && targetUser?.role === "admin";
      if (isLastAdmin) { showToast("Mindestens ein Administrator muss bestehen bleiben."); return; }
      applyUsers = users => users.filter(u => u.id !== existingUserId);
      delete emp.appUserId;
    }

    // nach `await hashPassword` auf den aktuellen Stand (sonst gingen Änderungen anderer in dieser Zeit verloren)
    saveAll(prev => ({ ...prev, employees: mergeEmp(prev.employees || [], emp), users: applyUsers(prev.users || []) }));
    if (isNew) setSelectedEmpId(empId);
    setModal(null);
  };
  // Mit dem Mitarbeiter auch sein Konto entfernen (lokal/Datenordner) — sonst meldete sich ein Ehemaliger weiter an.
  // Cloud: Konten sind Mitgliedschaften (Einstellungen → Team), dort hier nur der Hinweis.
  const delEmp = async (id: string) => {
    const emp = employees.find(e => e.id === id);
    const linked = isCloudBackend ? [] : (data.users || []).filter(u => u.employeeId === id || (!!emp?.appUserId && u.id === emp.appUserId));
    if (id === currentEmployeeId) { showToast("Den eigenen Mitarbeiter-Eintrag kannst du nicht löschen."); return; }
    // Lohnabrechnungen und Überstunden-Abschlüsse sind aufzubewahren (der Server löscht sie sonst mit) → Austrittsdatum setzen
    if ((data.lohnEntries || []).some(l => l.employeeId === id) || (data.uberstundenAbschluss || []).some(a => a.empId === id)
      || (data.ferienEntries || []).some(f => f.employeeId === id) || (data.absences || []).some(a => a.employeeId === id)
      || (data.timeEntries || []).some(t => t.employeeId === id) || (data.expenses || []).some(x => x.employeeId === id)) {
      showToast("Für diese Person gibt es Stunden, Spesen, Lohnabrechnungen, Überstunden, Ferien oder Absenzen — bitte ein Austrittsdatum setzen statt löschen."); return;
    }
    if (isCloudBackend && userPermissions !== null) { showToast("Mitarbeitende löscht ein Admin."); return; }
    const admins = (data.users || []).filter(u => u.role === "admin");
    if (linked.some(u => u.role === "admin") && admins.every(a => linked.some(u => u.id === a.id))) { showToast("Mindestens ein Administrator muss bestehen bleiben."); return; }
    const msg = linked.length
      ? `Mitarbeiter löschen? Das Konto «${linked.map(u => u.username).join("», «")}» wird ebenfalls entfernt.`
      : isCloudBackend && emp?.appUserId ? "Mitarbeiter löschen? Das Cloud-Konto bleibt bestehen — Zugang unter Einstellungen → Team entfernen." : "Mitarbeiter löschen?";
    if (!await askConfirm(msg)) return;
    saveAll(prev => ({ ...prev, employees: (prev.employees || []).filter(e => e.id !== id), users: (prev.users || []).filter(u => !linked.some(l => l.id === u.id)) }));
    if (selectedEmpId === id) setSelectedEmpId(null);
  };

  const saveAbs = () => {
    if (!absForm.employeeId || !absForm.type || !absForm.dateFrom) { showToast("Bitte Mitarbeiter, Absenztyp und Datum angeben."); return; }
    const isNew = !absForm.id;
    const [from, to] = [absForm.dateFrom, absForm.dateTo || absForm.dateFrom].sort();
    const a = { ...absForm, dateFrom: from, dateTo: to, id: absForm.id || generateId() } as Absence;
    const prevA = absences.find(x => x.id === a.id);
    const closed = closedMonthMsg(data.settings.closedMonths, [from, to], [prevA?.dateFrom || prevA?.date, prevA?.dateTo || prevA?.date]);
    if (closed) { showToast(closed); return; }
    update("absences", isNew ? [...absences, a] : absences.map(x => x.id === a.id ? a : x));
    setModal(null);
  };
  // eigene genehmigte Einträge ohne Vollzugriff nimmt nur zurück, wer genehmigt (Server lehnt sonst ab → Banner)
  const ownApprovedLocked = (employeeId?: string, status?: string) => {
    if (!userPermissions || !currentEmployeeId || employeeId !== currentEmployeeId || status === "pending") return false;
    showToast("Eigene genehmigte oder abgelehnte Einträge nimmt nur ein Admin zurück.");
    return true;
  };
  const delAbs = (id: string) => { const a = (data.absences || []).find(x => x.id === id); const closed = closedMonthMsg(data.settings.closedMonths, [a?.dateFrom || a?.date, a?.dateTo || a?.date]); if (closed) { showToast(closed); return; } if (ownApprovedLocked(a?.employeeId, a?.status || "approved")) return; removeWithUndo("Absenz gelöscht", "absences", a => a.id === id); };

  const saveFerien = () => {
    if (!ferienForm.employeeId || !ferienForm.dateFrom) { showToast("Bitte Mitarbeiter und Datum angeben."); return; }
    const isNew = !ferienForm.id;
    // Von/Bis vertauscht → tauschen; vom Büro eingetragene oder bearbeitete Ferien gelten als genehmigt
    const [from, to] = [ferienForm.dateFrom, ferienForm.dateTo || ferienForm.dateFrom].sort();
    const { originalData: _orig, ...rest } = ferienForm;
    // eigene Ferien ohne Vollzugriff nur als Antrag (der Server lehnt «approved» ab, pb_hooks/integrity.pb.js)
    const ownWithoutFull = !!userPermissions && !!currentEmployeeId && ferienForm.employeeId === currentEmployeeId;
    // eigener bestehender Eintrag: genehmigter wird zum Änderungsantrag (bisherige Daten = gespeicherter Stand), ein
    // laufender Antrag behält seine bisherigen Daten — sonst lehnte der Server ab (Cloud-Test 25.11.2026)
    const stored = ferienForm.id ? ferienEntries.find(x => x.id === ferienForm.id) : undefined;
    const originalData = !ownWithoutFull || !stored ? undefined
      : stored.status === "approved" || !stored.status ? { dateFrom: stored.dateFrom, dateTo: stored.dateTo, note: stored.note || "" }
      : stored.status === "pending" ? stored.originalData : undefined;
    const closedF = closedMonthMsg(data.settings.closedMonths, [from, to], [stored?.dateFrom, stored?.dateTo]);
    if (closedF) { showToast(closedF); return; }
    if (ferienOverlap(ferienEntries, { id: ferienForm.id, employeeId: ferienForm.employeeId, dateFrom: from, dateTo: to })) { showToast("Für diesen Zeitraum gibt es schon Ferien oder einen Antrag."); return; }
    const f = { ...rest, ...(originalData ? { originalData } : {}), dateFrom: from, dateTo: to, status: ownWithoutFull ? "pending" : "approved", id: ferienForm.id || generateId() } as FerienEntry;
    if (ownWithoutFull) showToast("Eigene Ferien werden als Antrag gespeichert — genehmigt wird von einer anderen Person.");
    update("ferienEntries", isNew ? [...ferienEntries, f] : ferienEntries.map(x => x.id === f.id ? f : x));
    setModal(null);
  };
  const delFerien = (id: string) => { const f = ferienEntries.find(x => x.id === id); const closed = closedMonthMsg(data.settings.closedMonths, [f?.dateFrom, f?.dateTo]); if (closed) { showToast(closed); return; } if (ownApprovedLocked(f?.employeeId, f?.status || "approved")) return; removeWithUndo("Ferien gelöscht", "ferienEntries", f => f.id === id); };


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
      <Header title="Personal" action={
        <div style={{ display: "flex", gap: 8 }}>
          <ShareButton options={[{ label: "PDF Übersicht", onClick: () => setPrintContent({ type: "mitarbeiterOverview", employees, settings: data.settings }) }]} />
          <button className="btn btn-primary" onClick={() => { setEmpForm({ pensum: 100, wochenstunden: data.settings.defaultWochenstunden || 35, ferienWochen: data.settings.defaultFerienWochen || 5, pkAGSatz: data.settings.defaultPkAGSatz ?? 8.0, ferienUebertragVorjahr: {}, personalNr: nextPersonalNr(), _appAccess: false, _appUsername: "", _appPassword: "", _appRoleId: defaultAppRoleId(data.appRoles), _appUserId: undefined }); setModal("emp"); }}>+ Mitarbeiter</button>
        </div>
      } tabs={<PageTabs tabs={TABS} value={tab} onChange={setTab} />} />


      {/* ── ÜBERSICHT ── */}
      {tab === "übersicht" && (
        <OverviewTab data={data} employees={employees} absences={absences} absenzTypes={absenzTypes} closedMonths={closedMonths} viewYear={viewYear} viewMonth={viewMonth} setViewYear={setViewYear} setViewMonth={setViewMonth} calc={calc} />
      )}

      {/* ── FERIEN ── */}
      {tab === "ferien" && (
        <FerienTab ownEmployeeId={userPermissions ? currentEmployeeId : null} data={data} update={update} askConfirm={askConfirm} employees={employees} absences={absences} ferienEntries={ferienEntries} absenzTypes={absenzTypes} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId} setFerienForm={setFerienForm} setModal={setModal} delFerien={delFerien} delAbs={delAbs} viewYear={viewYear} setViewYear={setViewYear} calc={calc} />
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
        <EmployeeModal data={data} empForm={empForm} setEmpForm={setEmpForm} nextPersonalNr={nextPersonalNr} onClose={() => setModal(null)} onSave={saveEmp} canEditLohn={!userPermissions || userPermissions.includes("loehne")} />
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
