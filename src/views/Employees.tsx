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
import { generateId, formatDate, formatIban, formatCHF, getFeiertageForYear, getAbsenzTypes, getWorkdaysInMonth, hashPassword, localISODate } from "../utils";
import { Header, Modal, FormField, DateInput, DatePicker, ShareButton } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { Absence, Employee, FerienEntry, OvertimeClosing, User, ViewProps } from "../types";

/** Formular eines Mitarbeiters; die `_app*`-Felder steuern den optionalen App-Zugang und werden nicht am Mitarbeiter gespeichert. */
type EmpForm = Partial<Employee> & {
  _appAccess?: boolean; _appUsername?: string; _appPassword?: string; _appRoleId?: string; _appUserId?: string;
};
/** Eingaben im Jahresabschluss pro Mitarbeiter. */
type AbschlussForm = { ubHours: number; ubZuschlag: number; ferienUebertrag?: number | string; [key: string]: unknown };

export default
function Employees({ data, update, saveAll, setPrintContent }: Pick<ViewProps, "data" | "update" | "saveAll" | "setPrintContent">) {
  const employees = data.employees || [];
  const feiertage = data.feiertage || [];
  const absenzTypes = getAbsenzTypes(data);
  const absences = data.absences || [];
  const ferienEntries = data.ferienEntries || [];

  const [tab, setTab] = useState(employees.length === 0 ? "mitarbeiter" : "übersicht"); // "übersicht" | "mitarbeiter" | "feiertage" | "absenztypen"
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [modal, setModal] = useState<"emp" | "abs" | "ferien" | null>(null);
  const [empForm, setEmpForm] = useState<EmpForm>({});
  const [absForm, setAbsForm] = useState<Partial<Absence>>({ employeeId: "", type: "", dateFrom: "", dateTo: "", note: "" });
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [ferienForm, setFerienForm] = useState<Partial<FerienEntry>>({ employeeId: "", dateFrom: "", dateTo: "", note: "" });
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [abschlussYear, setAbschlussYear] = useState(new Date().getFullYear() - 1);
  const [abschlussForm, setAbschlussForm] = useState<Record<string, AbschlussForm>>({});

  // ── Kalkulationen ──
  const calcEmpMonth = (emp: Employee, year: number, month: number) => {
    const today = localISODate();
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    const entryDate = emp.eintrittsdatum || null;
    const monthLastDay = `${monthStr}-${new Date(year, month + 1, 0).getDate().toString().padStart(2, "0")}`;

    // Monat liegt vollständig vor Anstellung → leer
    if (entryDate && entryDate > monthLastDay) return { sollTotal: 0, istH: 0, absenzH: 0, ferienH: 0, saldo: 0, notStarted: true };

    const pensum = (emp.pensum || 100) / 100;
    const tagessoll = ((emp.wochenstunden || 35) * pensum) / 5;
    const workdays = getWorkdaysInMonth(year, month, getFTYear(year));

    // Soll: nur Arbeitstage ab Eintrittsdatum und bis heute
    const sollTotal = workdays.reduce((s, d) => {
      if (entryDate && d.date < entryDate) return s;
      if (d.date > today) return s;
      const ft = getFTYear(year).find(f => f.date === d.date);
      if (ft && (ft.stundenDelta === 0 || ft.stundenDelta === undefined || ft.stundenDelta === null)) return s;
      return s + tagessoll + (ft?.stundenDelta || 0);
    }, 0);

    const istMins = (data.timeEntries || []).filter(e => e.employeeId === emp.id && (e.date || "").startsWith(monthStr)).reduce((s, e) => s + (e.minutes || 0), 0);

    // Absenzen: unterstützt sowohl date als auch dateFrom/dateTo
    const empAbsences = absences.filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved"));
    const absenzH = empAbsences.reduce((s, a) => {
      const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
      if (!from) return s;
      if (from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
      const days = workdays.filter(d => d.date >= from && d.date <= to && (!entryDate || d.date >= entryDate) && d.date <= today && !(d.feiertag && (d.feiertag.stundenDelta === 0 || d.feiertag.stundenDelta === null || d.feiertag.stundenDelta === undefined)));
      return s + days.length * tagessoll;
    }, 0);

    // Ferien
    const empFerienRaw = ferienEntries.filter(f => f.employeeId === emp.id && (!f.status || f.status === "approved"));
    const ferienH = empFerienRaw.reduce((s, f) => {
      if (!f.dateFrom) return s;
      if (f.dateFrom.slice(0, 7) > monthStr || f.dateTo.slice(0, 7) < monthStr) return s;
      const days = workdays.filter(d => d.date >= f.dateFrom && d.date <= f.dateTo && (!entryDate || d.date >= entryDate) && d.date <= today && !(d.feiertag && (d.feiertag.stundenDelta === 0 || d.feiertag.stundenDelta === null || d.feiertag.stundenDelta === undefined)));
      return s + days.length * tagessoll;
    }, 0);

    const istH = istMins / 60;
    const saldo = istH + absenzH + ferienH - sollTotal;
    return { sollTotal: Math.round(sollTotal * 10) / 10, istH: Math.round(istH * 10) / 10, absenzH: Math.round(absenzH * 10) / 10, ferienH: Math.round(ferienH * 10) / 10, saldo: Math.round(saldo * 10) / 10 };
  };

  const getFTYear = (year: number) => getFeiertageForYear(feiertage, year);

  // Ferien-Kalkulation für ein Jahr
  // Ferien-Kalkulation für ein Jahr
  const calcFerienYear = (emp: Employee, year: number) => {
    const anspruch = emp.ferienWochen || 4;
    const pensum = (emp.pensum || 100) / 100;
    const wochenstunden = emp.wochenstunden || 35;
    const yearStr = String(year);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const eintrittsdatum = emp.eintrittsdatum || null;

    if (eintrittsdatum && eintrittsdatum > yearEnd) {
      return { anspruchH: 0, ubertragH: 0, bezogenH: 0, zukunftH: 0, restH: 0 };
    }
    let proRata = 1;
    if (eintrittsdatum && eintrittsdatum > yearStart) {
      const entryMonth = parseInt(eintrittsdatum.slice(5, 7));
      proRata = (13 - entryMonth) / 12;
    }
    const anspruchH = Math.round(anspruch * wochenstunden * pensum * proRata * 10) / 10;

    const empFerien = ferienEntries.filter(f => f.employeeId === emp.id && (!f.status || f.status === "approved"));
    const vorjahr = emp.ferienUebertragVorjahr || {};
    const ubertragH = vorjahr[year] || 0;

    // Reine UTC-Arithmetik (Date.UTC/getUTCDay/setUTCDate) statt lokaler
    // Date-Methoden gemischt mit toISOString() (UTC) — die Mischung driftete
    // beim Sommerzeit-Wechsel um einen Tag auseinander (siehe getWorkdaysInMonth
    // in utils.js für die gleiche Wurzelursache) und liess Ferien, die den
    // Umstellungstermin überspannen, falsch zählen.
    const todayStrForBezogen = localISODate();
    const bezogenH = empFerien.filter(f => f.dateFrom.startsWith(yearStr) || f.dateTo.startsWith(yearStr)).reduce((s, f) => {
      // count workdays in this entry within the year, nur bis heute — sonst
      // überlappt bezogenH mit zukunftH (Time.jsx calcFerienSaldo trennt
      // beide exklusiv über denselben ds<=today-Filter, hier bisher gefehlt).
      let count = 0;
      const d = new Date(`${f.dateFrom}T00:00:00Z`);
      const end = new Date(`${f.dateTo}T00:00:00Z`);
      const fts = getFTYear(year);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (ds.startsWith(yearStr) && ds <= todayStrForBezogen) {
          const dow = d.getUTCDay();
          if (dow !== 0 && dow !== 6 && !fts.some(ft => ft.date === ds && !ft.stundenDelta)) count++;
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const tagessoll = (wochenstunden * pensum) / 5;
      return s + count * tagessoll;
    }, 0);

    // Kein Vorfilter auf f.dateFrom > today — eine bereits begonnene, aber
    // noch laufende Ferienperiode hat auch künftige Tage, die sonst spurlos
    // aus "Geplant" verschwinden (identisches Muster wie der Time.jsx-
    // calcFerienSaldo-Fix). Der Tages-Filter ds > today übernimmt die
    // eigentliche Vergangenheit/Zukunft-Abgrenzung.
    const todayStr = localISODate();
    const zukunftH = empFerien.filter(f => f.dateTo.startsWith(yearStr) || f.dateFrom.startsWith(yearStr)).reduce((s, f) => {
      let count = 0;
      const d = new Date(`${f.dateFrom}T00:00:00Z`);
      const end = new Date(`${f.dateTo}T00:00:00Z`);
      const fts = getFTYear(year);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        // Fehlte bisher (anders als bei bezogenH) — ohne diese Grenze zählten
        // jahresübergreifende Ferieneinträge auch Tage des Folgejahrs mit.
        if (ds.startsWith(yearStr) && ds > todayStr) {
          const dow = d.getUTCDay();
          if (dow !== 0 && dow !== 6 && !fts.some(ft => ft.date === ds && !ft.stundenDelta)) count++;
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const tagessoll = (wochenstunden * pensum) / 5;
      return s + count * tagessoll;
    }, 0);

    return {
      anspruchH: Math.round(anspruchH * 10) / 10,
      ubertragH: Math.round(ubertragH * 10) / 10,
      bezogenH: Math.round(bezogenH * 10) / 10,
      zukunftH: Math.round(zukunftH * 10) / 10,
      restH: Math.round((anspruchH + ubertragH - bezogenH - zukunftH) * 10) / 10,
    };
  };


  // Überstundensaldo (total von Eintritt bis heute, minus bereits ausbezahlte)
  const calcEffectiveUbSaldo = (emp: Employee) => {
    if (!emp?.eintrittsdatum) return 0;
    const today = localISODate();
    const start = emp.eintrittsdatum;
    if (start > today) return 0;
    const startY = parseInt(start.slice(0, 4));
    const startM = parseInt(start.slice(5, 7)) - 1;
    const endY = new Date().getFullYear();
    const endM = new Date().getMonth();
    let total = 0;
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      total += calcEmpMonth(emp, y, m).saldo;
      m++;
      if (m > 11) { m = 0; y++; }
    }
    const settled = (data.uberstundenAbschluss || [])
      .filter(a => a.empId === emp.id && a.type === "payout")
      .reduce((s, a) => s + (a.hoursSettled || 0), 0);
    return Math.round((total - settled) * 10) / 10;
  };

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

  const months = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];


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
        <div>
          {employees.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text5)", fontSize: 13 }}>
              Noch keine Mitarbeiter erfasst — Tab «Mitarbeiter» verwenden.
            </div>
          ) : (
            <>
              {/* Monats-Navigator */}
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", marginBottom: 20 }}>
                <button className="btn btn-ghost" style={{ padding: "0 12px" }} onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}>←</button>
                <div style={{ flex: 1, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 18 }}>
                  {months[viewMonth]} {viewYear}
                  {closedMonths.includes(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`) && (
                    <span style={{ marginLeft: 10, fontSize: 11, background: "#1a1a18", color: "#f0ede8", padding: "2px 8px", borderRadius: 20, fontFamily: "inherit", fontWeight: 400 }}>geschlossen</span>
                  )}
                </div>
                <button className="btn btn-ghost" style={{ padding: "0 12px" }} onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}>→</button>
                <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
                  {[viewYear - 2, viewYear - 1, viewYear, viewYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {/* Alle Mitarbeiter — Monatstabelle */}
              <div className="card" style={{ padding: 0, marginBottom: 20 }}>
                <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
                  MONATSÜBERSICHT — {months[viewMonth].toUpperCase()} {viewYear}
                </div>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Mitarbeiter</th>
                      <th style={{ textAlign: "right" }}>Soll</th>
                      <th style={{ textAlign: "right" }}>IST</th>
                      <th style={{ textAlign: "right" }}>Ferien</th>
                      <th style={{ textAlign: "right" }}>Intern / Abs.</th>
                      <th style={{ textAlign: "right" }}>Saldo Monat</th>
                      <th style={{ textAlign: "right" }}>Ferien-Rest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => {
                      const s = calcEmpMonth(emp, viewYear, viewMonth);
                      const fs = calcFerienYear(emp, viewYear);
                      const saldoColor = s.saldo > 0.5 ? "var(--positive)" : s.saldo < -0.5 ? "var(--negative)" : "#888";
                      return (
                        <tr key={emp.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{emp.name}</div>
                            <div style={{ fontSize: 10, color: "var(--text5)" }}>{emp.pensum || 100}% · {emp.role || ""}</div>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--text4)" }}>{s.sollTotal}h</td>
                          <td style={{ textAlign: "right", fontWeight: 500 }}>{s.istH}h</td>
                          <td style={{ textAlign: "right", color: "var(--pending)" }}>{s.ferienH > 0 ? `${s.ferienH}h` : "—"}</td>
                          <td style={{ textAlign: "right", color: "var(--text4)" }}>{s.absenzH > 0 ? `${s.absenzH}h` : "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "'Inter', sans-serif", color: saldoColor }}>
                            {s.saldo > 0 ? "+" : ""}{s.saldo}h
                          </td>
                          <td style={{ textAlign: "right", color: fs.restH < 0 ? "var(--negative)" : "var(--positive)", fontWeight: 500 }}>
                            {fs.restH}h
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Jahres-Saldo-Matrix */}
              {(() => {
                const today = new Date();
                const curYear = today.getFullYear();
                const curMonth = today.getMonth();
                return (
                  <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)" }}>
                      ÜBERSTUNDEN-KONTO {viewYear} — MONATSSALDO
                    </div>
                    <table style={{ width: "100%", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                            {months.map((m, i) => {
                              const mStr = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                              const isClosed = closedMonths.includes(mStr);
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              return (
                                <th key={i} style={{ textAlign: "right", minWidth: 52, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>
                                  {m.slice(0, 3)}
                                  {isClosed && <span style={{ display: "block", fontSize: 8, color: "var(--text4)" }}>●</span>}
                                </th>
                              );
                            })}
                            <th style={{ textAlign: "right", minWidth: 60 }}>YTD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map(emp => {
                            let ytd = 0;
                            return (
                              <tr key={emp.id}>
                                <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                                {months.map((_, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  if (isFuture) return <td key={i} style={{ textAlign: "right", color: "#ddd" }}>—</td>;
                                  const s = calcEmpMonth(emp, viewYear, i);
                                  if (s.notStarted) return <td key={i} style={{ textAlign: "right", color: "#ddd" }}>—</td>;
                                  ytd = Math.round((ytd + s.saldo) * 10) / 10;
                                  const color = s.saldo > 0.5 ? "var(--positive)" : s.saldo < -0.5 ? "var(--negative)" : "#888";
                                  return (
                                    <td key={i} style={{ textAlign: "right", fontWeight: 500, color }}>
                                      {s.saldo > 0 ? "+" : ""}{s.saldo}
                                    </td>
                                  );
                                })}
                                <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "'Inter', sans-serif", color: ytd > 0 ? "var(--positive)" : ytd < 0 ? "var(--negative)" : "var(--text4)" }}>
                                  {ytd > 0 ? "+" : ""}{ytd}h
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                  </div>
                );
              })()}

              {/* Absenz-Übersicht mit Vorjahresvergleich */}
              {employees.length > 0 && (() => {
                const prevYear = viewYear - 1;
                const curMonth = new Date().getMonth();
                const curYear = new Date().getFullYear();

                const calcAbsH = (emp: Employee, year: number, monthIdx: number) => {
                  const tagessoll = ((emp.wochenstunden || 35) * (emp.pensum || 100) / 100) / 5;
                  const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
                  const workdays = getWorkdaysInMonth(year, monthIdx, getFTYear(year));
                  return absences.filter(a => a.employeeId === emp.id && (!a.status || a.status === "approved")).reduce((s, a) => {
                    const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
                    if (!from || from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
                    const days = workdays.filter(d => d.date >= from && d.date <= to);
                    return s + days.length * tagessoll;
                  }, 0);
                };

                const calcInternH = (emp: Employee, year: number, monthIdx: number) => {
                  const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
                  return (data.timeEntries || []).filter(e =>
                    e.employeeId === emp.id &&
                    !e.projectId &&
                    (e.date || "").startsWith(monthStr)
                  ).reduce((s, e) => s + (e.minutes || 0), 0) / 60;
                };

                return (
                  <>
                    {/* Absenzen-Matrix */}
                    <div className="card" style={{ padding: 0, marginTop: 20 }}>
                      <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>INTERN / ABSENZEN {viewYear}</span>
                        <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                      </div>
                      <table style={{ width: "100%", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                            {months.map((m, i) => {
                              const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                              return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                            })}
                            <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                            <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                            <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map(emp => {
                            const monthly = months.map((_, i) => Math.round(calcAbsH(emp, viewYear, i) * 10) / 10);
                            const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                            const prevTotal = Math.round(months.reduce((s, _, i) => s + calcAbsH(emp, prevYear, i), 0) * 10) / 10;
                            const delta = Math.round((total - prevTotal) * 10) / 10;
                            return (
                              <tr key={emp.id}>
                                <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                                {monthly.map((h, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--negative)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                })}
                                <td style={{ textAlign: "right", fontWeight: 700, color: total > 0 ? "var(--negative)" : "var(--text4)" }}>{total > 0 ? `${total}h` : "—"}</td>
                                <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                                <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                  {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Absenzen nach Kategorie */}
                    {(() => {
                      const calcAbsHByType = (typeId: string, year: number, monthIdx: number) => {
                        const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
                        const workdays = getWorkdaysInMonth(year, monthIdx, getFTYear(year));
                        return absences.filter(a => a.type === typeId && (!a.status || a.status === "approved")).reduce((s, a) => {
                          const emp = employees.find(e => e.id === a.employeeId);
                          if (!emp) return s;
                          const tagessoll = ((emp.wochenstunden || 35) * (emp.pensum || 100) / 100) / 5;
                          const from = a.dateFrom || a.date; const to = (a.dateTo || a.date) as string;
                          if (!from || from.slice(0, 7) > monthStr || to.slice(0, 7) < monthStr) return s;
                          const days = workdays.filter(d => d.date >= from && d.date <= to);
                          return s + days.length * tagessoll;
                        }, 0);
                      };

                      const usedTypes = absenzTypes.filter(t =>
                        absences.some(a => a.type === t.id)
                      );
                      if (usedTypes.length === 0) return null;

                      return (
                        <div className="card" style={{ padding: 0, marginTop: 20 }}>
                          <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>ABSENZEN NACH KATEGORIE {viewYear}</span>
                            <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                          </div>
                          <table style={{ width: "100%", fontSize: 11 }}>
                            <thead>
                              <tr>
                                <th style={{ minWidth: 140 }}>Kategorie</th>
                                {months.map((m, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                                })}
                                <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                                <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                                <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usedTypes.map(t => {
                                const monthly = months.map((_, i) => Math.round(calcAbsHByType(t.id, viewYear, i) * 10) / 10);
                                const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                                const prevTotal = Math.round(months.reduce((s, _, i) => s + calcAbsHByType(t.id, prevYear, i), 0) * 10) / 10;
                                const delta = Math.round((total - prevTotal) * 10) / 10;
                                return (
                                  <tr key={t.id}>
                                    <td style={{ fontSize: 12 }}>
                                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: t.color || "#888", marginRight: 7, verticalAlign: "middle" }} />
                                      {t.label}
                                    </td>
                                    {monthly.map((h, i) => {
                                      const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                      return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--text2)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                    })}
                                    <td style={{ textAlign: "right", fontWeight: 700 }}>{total > 0 ? `${total}h` : "—"}</td>
                                    <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                                    <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                      {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Totalzeile */}
                              {(() => {
                                const monthlyTotals = months.map((_, i) => Math.round(usedTypes.reduce((s, t) => s + calcAbsHByType(t.id, viewYear, i), 0) * 10) / 10);
                                const grandTotal = Math.round(monthlyTotals.reduce((s, h) => s + h, 0) * 10) / 10;
                                const prevGrand = Math.round(usedTypes.reduce((s, t) => s + months.reduce((s2, _, i) => s2 + calcAbsHByType(t.id, prevYear, i), 0), 0) * 10) / 10;
                                const delta = Math.round((grandTotal - prevGrand) * 10) / 10;
                                return (
                                  <tr style={{ borderTop: "1.5px solid var(--border3)", background: "var(--surface2)", fontWeight: 700 }}>
                                    <td style={{ fontSize: 12 }}>Total</td>
                                    {monthlyTotals.map((h, i) => {
                                      const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                      return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "var(--text)" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                    })}
                                    <td style={{ textAlign: "right" }}>{grandTotal > 0 ? `${grandTotal}h` : "—"}</td>
                                    <td style={{ textAlign: "right", color: "var(--text5)", fontWeight: 400 }}>{prevGrand > 0 ? `${prevGrand}h` : "—"}</td>
                                    <td style={{ textAlign: "right", color: delta > 0 ? "var(--negative)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                      {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                    </td>
                                  </tr>
                                );
                              })()}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* Interne Stunden */}
                    {(() => {
                      const hasIntern = employees.some(emp =>
                        months.some((_, i) => calcInternH(emp, viewYear, i) > 0 || calcInternH(emp, prevYear, i) > 0)
                      );
                      if (!hasIntern) return null;
                      return (
                        <div className="card" style={{ padding: 0, marginTop: 20 }}>
                          <div style={{ padding: "12px 20px", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>INTERNE STUNDEN {viewYear} — ohne Projektzuweisung</span>
                            <span style={{ fontWeight: 400, letterSpacing: 0, color: "var(--text5)" }}>vs. {prevYear}</span>
                          </div>
                          <table style={{ width: "100%", fontSize: 11 }}>
                            <thead>
                              <tr>
                                <th style={{ minWidth: 140 }}>Mitarbeiter</th>
                                {months.map((m, i) => {
                                  const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                  return <th key={i} style={{ textAlign: "right", minWidth: 46, color: isFuture ? "var(--text5)" : "var(--text2)", fontWeight: 500 }}>{m.slice(0, 3)}</th>;
                                })}
                                <th style={{ textAlign: "right", minWidth: 52 }}>Total</th>
                                <th style={{ textAlign: "right", minWidth: 52, color: "var(--text5)" }}>{prevYear}</th>
                                <th style={{ textAlign: "right", minWidth: 46 }}>Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {employees.map(emp => {
                                const monthly = months.map((_, i) => Math.round(calcInternH(emp, viewYear, i) * 10) / 10);
                                const total = Math.round(monthly.reduce((s, h) => s + h, 0) * 10) / 10;
                                const prevTotal = Math.round(months.reduce((s, _, i) => s + calcInternH(emp, prevYear, i), 0) * 10) / 10;
                                const delta = Math.round((total - prevTotal) * 10) / 10;
                                if (total === 0 && prevTotal === 0) return null;
                                return (
                                  <tr key={emp.id}>
                                    <td style={{ fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
                                    {monthly.map((h, i) => {
                                      const isFuture = viewYear > curYear || (viewYear === curYear && i > curMonth);
                                      return <td key={i} style={{ textAlign: "right", color: isFuture ? "#ddd" : h > 0 ? "#2d5a8e" : "#ddd" }}>{h > 0 && !isFuture ? `${h}h` : "—"}</td>;
                                    })}
                                    <td style={{ textAlign: "right", fontWeight: 700, color: total > 0 ? "#2d5a8e" : "var(--text4)" }}>{total > 0 ? `${total}h` : "—"}</td>
                                    <td style={{ textAlign: "right", color: "var(--text5)" }}>{prevTotal > 0 ? `${prevTotal}h` : "—"}</td>
                                    <td style={{ textAlign: "right", fontWeight: 500, color: delta > 0 ? "var(--warning)" : delta < 0 ? "var(--positive)" : "var(--text4)" }}>
                                      {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}h` : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ── FERIEN ── */}
      {tab === "ferien" && (
        <div>
          {/* Pendente Anträge */}
          {(() => {
            const pendingFerien = (data.ferienEntries || []).filter(f => f.status === "pending");
            const pendingAbs = (data.absences || []).filter(a => a.status === "pending");
            const total = pendingFerien.length + pendingAbs.length;
            if (total === 0) return null;
            const approveFerien = (id: string) => update("ferienEntries", (data.ferienEntries || []).map(f => f.id === id ? { ...f, status: "approved" } : f));
            const rejectFerien = async (id: string) => { if (await askConfirm("Ferienantrag ablehnen?", "Ablehnen")) update("ferienEntries", (data.ferienEntries || []).map(f => f.id === id ? { ...f, status: "rejected" } : f)); };
            const approveAbs = (id: string) => update("absences", (data.absences || []).map(a => a.id === id ? { ...a, status: "approved" } : a));
            const rejectAbs = async (id: string) => { if (await askConfirm("Absenzantrag ablehnen?", "Ablehnen")) update("absences", (data.absences || []).map(a => a.id === id ? { ...a, status: "rejected" } : a)); };
            return (
              <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--warning)", padding: "14px 20px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--warning)", marginBottom: 12 }}>
                  ⏳ PENDENTE ANTRÄGE ({total})
                </div>
                <table style={{ fontSize: 12, width: "100%" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border2)" }}>
                      <th style={{ padding: "4px 8px 4px 0", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>MITARBEITER</th>
                      <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>TYP</th>
                      <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>VON</th>
                      <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>BIS</th>
                      <th style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text4)", fontSize: 10 }}>NOTIZ</th>
                      <th style={{ padding: "4px 0", fontWeight: 500, color: "var(--text4)", fontSize: 10, textAlign: "right" }}>AKTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingFerien.map(f => {
                      const emp = employees.find(e => e.id === f.employeeId);
                      return (
                        <tr key={f.id} style={{ borderBottom: "1px solid #f5f2ed" }}>
                          <td style={{ padding: "7px 8px 7px 0", fontWeight: 500 }}>{emp?.name || "—"}</td>
                          <td style={{ padding: "7px 8px" }}><span style={{ background: "var(--st-bg-pausiert)", color: "var(--st-c-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px", fontSize: 10, fontWeight: 600 }}>🌴 Ferien</span></td>
                          <td style={{ padding: "7px 8px" }}>{formatDate(f.dateFrom)}</td>
                          <td style={{ padding: "7px 8px" }}>{formatDate(f.dateTo)}</td>
                          <td style={{ padding: "7px 8px", color: "var(--text4)" }}>{f.note || "—"}</td>
                          <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                            <button className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 11, marginRight: 6, background: "var(--positive)" }} onClick={() => approveFerien(f.id)}>✓ Genehmigen</button>
                            <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => rejectFerien(f.id)}><span className="msr" style={{ fontSize: 16 }}>close</span> Ablehnen</button>
                          </td>
                        </tr>
                      );
                    })}
                    {pendingAbs.map(a => {
                      const emp = employees.find(e => e.id === a.employeeId);
                      const t = absenzTypes.find(x => x.id === a.type);
                      return (
                        <tr key={a.id} style={{ borderBottom: "1px solid #f5f2ed" }}>
                          <td style={{ padding: "7px 8px 7px 0", fontWeight: 500 }}>{emp?.name || "—"}</td>
                          <td style={{ padding: "7px 8px" }}><span className="tag" style={{ background: t?.color || "#888", fontSize: 10 }}>{t?.label || a.type || "Absenz"}</span></td>
                          <td style={{ padding: "7px 8px" }}>{formatDate(a.dateFrom)}</td>
                          <td style={{ padding: "7px 8px" }}>{formatDate(a.dateTo)}</td>
                          <td style={{ padding: "7px 8px", color: "var(--text4)" }}>{a.note || "—"}</td>
                          <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                            <button className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 11, marginRight: 6, background: "var(--positive)" }} onClick={() => approveAbs(a.id)}>✓ Genehmigen</button>
                            <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => rejectAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span> Ablehnen</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 16 }}>
            <select value={selectedEmpId || ""} onChange={e => setSelectedEmpId(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Alle Mitarbeiter</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => { setFerienForm({ employeeId: selectedEmpId || (employees[0]?.id || ""), dateFrom: "", dateTo: "", note: "" }); setModal("ferien"); }}>+ Ferien eintragen</button>
          </div>

          <div className="card" style={{ padding: 0, marginBottom: 20 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>FERIENEINTRAGUNGEN</div>

            <table>
              <thead><tr><th>Mitarbeiter</th><th>Von</th><th>Bis</th><th>Notiz</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {ferienEntries.filter(f => !selectedEmpId || f.employeeId === selectedEmpId).length === 0
                  ? <tr><td colSpan={6} className="empty-state">Noch keine Ferien eingetragen</td></tr>
                  : ferienEntries.filter(f => !selectedEmpId || f.employeeId === selectedEmpId)
                      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
                      .map(f => {
                        const emp = employees.find(e => e.id === f.employeeId);
                        const statusBadge = !f.status || f.status === "approved"
                          ? <span style={{ fontSize: 10, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>✓ Genehmigt</span>
                          : f.status === "pending"
                          ? <span style={{ fontSize: 10, color: "var(--st-c-pausiert)", background: "var(--st-bg-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>⏳ Ausstehend</span>
                          : <span style={{ fontSize: 10, color: "var(--st-c-abgelehnt)", background: "var(--st-bg-abgelehnt)", border: `1px solid color-mix(in srgb, var(--st-c-abgelehnt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}><span className="msr" style={{ fontSize: 12 }}>close</span> Abgelehnt</span>;
                        return (
                          <tr key={f.id} style={f.status === "rejected" ? { opacity: 0.5 } : {}}>
                            <td>{emp?.name || "—"}</td>
                            <td>{formatDate(f.dateFrom)}</td>
                            <td>{formatDate(f.dateTo)}</td>
                            <td style={{ color: "var(--text4)" }}>{f.note || "—"}</td>
                            <td>{statusBadge}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {(!f.status || f.status === "approved") && <button className="btn btn-ghost" style={{ padding: "2px 7px", fontSize: 11, marginRight: 4 }} onClick={() => { setFerienForm(f); setModal("ferien"); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>}
                              <button className="btn btn-danger" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => delFerien(f.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                            </td>
                          </tr>
                        );
                      })
                }
              </tbody>
            </table>
          </div>

          {/* Absenzen-Liste (read-only, Erfassung via MA-Self-Service) */}
          {(() => {
            const filteredAbs = absences.filter(a => !selectedEmpId || a.employeeId === selectedEmpId).sort((a, b) => (a.dateFrom || a.date || "").localeCompare(b.dateFrom || b.date || ""));
            if (filteredAbs.length === 0) return null;
            return (
              <div className="card" style={{ padding: 0, marginBottom: 20 }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border2)", fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>INTERN / ABSENZEN</div>
                <table>
                  <thead><tr><th>Mitarbeiter</th><th>Typ</th><th>Von</th><th>Bis</th><th>Notiz</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {filteredAbs.map(a => {
                      const emp = employees.find(e => e.id === a.employeeId);
                      const t = absenzTypes.find(x => x.id === a.type);
                      const statusBadge = !a.status || a.status === "approved"
                        ? <span style={{ fontSize: 10, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>✓ Genehmigt</span>
                        : a.status === "pending"
                        ? <span style={{ fontSize: 10, color: "var(--st-c-pausiert)", background: "var(--st-bg-pausiert)", border: `1px solid color-mix(in srgb, var(--st-c-pausiert) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}>⏳ Ausstehend</span>
                        : <span style={{ fontSize: 10, color: "var(--st-c-abgelehnt)", background: "var(--st-bg-abgelehnt)", border: `1px solid color-mix(in srgb, var(--st-c-abgelehnt) 30%, transparent)`, borderRadius: 20, padding: "2px 7px" }}><span className="msr" style={{ fontSize: 12 }}>close</span> Abgelehnt</span>;
                      return (
                        <tr key={a.id} style={a.status === "rejected" ? { opacity: 0.5 } : {}}>
                          <td>{emp?.name || "—"}</td>
                          <td><span className="tag" style={{ background: t?.color || "#888", fontSize: 10 }}>{t?.label || a.type || "Absenz"}</span></td>
                          <td>{formatDate(a.dateFrom || a.date)}</td>
                          <td>{formatDate(a.dateTo || a.date)}</td>
                          <td style={{ color: "var(--text4)" }}>{a.note || "—"}</td>
                          <td>{statusBadge}</td>
                          <td style={{ textAlign: "right" }}>
                            <button className="btn btn-danger" style={{ padding: "2px 7px", fontSize: 11 }} onClick={() => delAbs(a.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Ferien-Übersicht pro Mitarbeiter */}
          {employees.length > 0 && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text4)" }}>FERIENANSPRUCH ÜBERSICHT</div>
                <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
                  {[viewYear - 1, viewYear, viewYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <table>
                <thead><tr><th>Mitarbeiter</th><th>Pensum</th><th style={{ textAlign: "right" }}>Anspruch</th><th style={{ textAlign: "right" }}>Übertrag</th><th style={{ textAlign: "right" }}>Bezogen</th><th style={{ textAlign: "right" }}>Geplant</th><th style={{ textAlign: "right" }}>Rest</th></tr></thead>
                <tbody>
                  {employees.map(emp => {
                    const fs = calcFerienYear(emp, viewYear);
                    return (
                      <tr key={emp.id}>
                        <td><strong>{emp.name}</strong></td>
                        <td style={{ color: "var(--text4)" }}>{emp.pensum || 100}%</td>
                        <td style={{ textAlign: "right" }}>{fs.anspruchH}h</td>
                        <td style={{ textAlign: "right", color: "var(--text4)" }}>{fs.ubertragH}h</td>
                        <td style={{ textAlign: "right" }}>{fs.bezogenH}h</td>
                        <td style={{ textAlign: "right", color: "var(--pending)" }}>{fs.zukunftH}h</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: fs.restH < 0 ? "var(--negative)" : "var(--positive)" }}>{fs.restH}h</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MONATSABSCHLUSS ── */}
      {tab === "monatsabschluss" && (
        <div>
          <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 16 }}>
            Geschlossene Monate können in der Zeiterfassung nicht mehr bearbeitet werden. Monate können jederzeit wieder geöffnet werden.
          </div>
          {(() => {
            const allDates = [
              ...(data.timeEntries || []).map(e => e.date),
              ...(data.projects || []).map(p => p.startDate || p.createdAt),
              ...(data.invoices || []).map(i => i.date),
              ...(data.expenses || []).map(e => e.date),
            ].filter(Boolean).sort();
            const today = new Date();
            const earliest = allDates[0] ? new Date(allDates[0]) : today;
            const startYear = earliest.getFullYear();
            const startMonth = earliest.getMonth(); // 0-indexed
            const availableYears = [];
            for (let y = startYear; y <= today.getFullYear() + 1; y++) availableYears.push(y);
            return (
          <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <select value={viewYear} onChange={e => setViewYear(+e.target.value)} style={{ width: 90, fontSize: 12 }}>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {months.map((m, i) => {
              const monthStr = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
              const isClosed = closedMonths.includes(monthStr);
              const isFuture = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && i > today.getMonth());
              const isCurrent = viewYear === today.getFullYear() && i === today.getMonth();
              const isBeforeStart = viewYear < startYear || (viewYear === startYear && i < startMonth);
              if (isBeforeStart) return null;
              return (
                <div key={monthStr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: i < 11 ? "1px solid var(--border2)" : "none", background: isClosed ? "#f9f7f4" : "transparent", opacity: isFuture ? 0.4 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, minWidth: 100 }}>{m} {viewYear}</div>
                    {isCurrent && <span style={{ fontSize: 10, color: "var(--st-c-gesendet)", background: "var(--st-bg-gesendet)", padding: "2px 7px", borderRadius: 20 }}>Aktuell</span>}
                    {isClosed && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--st-c-abgeschlossen)", background: "var(--st-bg-abgeschlossen)", padding: "2px 7px", borderRadius: 20 }}>● Geschlossen</span>}
                    {!isClosed && !isFuture && <span style={{ fontSize: 10, color: "var(--st-c-aktiv)", background: "var(--st-bg-aktiv)", padding: "2px 7px", borderRadius: 20 }}>○ Offen</span>}
                  </div>
                  {!isFuture && (
                    <button
                      className={isClosed ? "btn btn-ghost" : "btn btn-ghost"}
                      style={{ fontSize: 11, padding: "4px 14px", color: isClosed ? "var(--positive)" : "var(--negative)", borderColor: isClosed ? "#b0d8c0" : "#e8b0b0" }}
                      onClick={() => toggleMonth(monthStr)}
                    >
                      {isClosed ? "Öffnen" : "Schliessen"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          </>
          );
          })()}
        </div>
      )}

      {/* ── MITARBEITER ── */}
      {tab === "mitarbeiter" && (
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
      )}


      {/* ── JAHRESABSCHLUSS ── */}
      {tab === "jahresabschluss" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "var(--text4)" }}>Ferienüberträge bestätigen und Überstunden abrechnen</div>
            <select value={abschlussYear} onChange={e => setAbschlussYear(+e.target.value)} style={{ width: 100, fontSize: 12 }}>
              {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}</option>; })}
            </select>
          </div>

          {employees.length === 0 && <div className="empty-state">Keine Mitarbeiter erfasst</div>}

          {employees.filter(emp => emp.eintrittsdatum && emp.eintrittsdatum <= `${abschlussYear}-12-31`).length === 0 && employees.length > 0 && (
            <div className="empty-state">Keine Mitarbeiter waren {abschlussYear} angestellt</div>
          )}

          {employees.filter(emp => emp.eintrittsdatum && emp.eintrittsdatum <= `${abschlussYear}-12-31`).map(emp => {
            const fs = calcFerienYear(emp, abschlussYear);
            const ubSaldo = calcEffectiveUbSaldo(emp);
            const currentUebertrag = (emp.ferienUebertragVorjahr || {})[abschlussYear + 1];
            const formDef = { ferienUebertrag: fs.restH > 0 ? fs.restH : 0, ubHours: ubSaldo > 0 ? ubSaldo : 0, ubZuschlag: 25 };
            const form = { ...formDef, ...(abschlussForm[emp.id] || {}) };
            const setForm = (val: Partial<AbschlussForm>) => setAbschlussForm(prev => ({ ...prev, [emp.id]: { ...form, ...val } }));
            const stundenlohn = emp.monatslohn
              ? Math.round((emp.monatslohn * 12 / ((emp.wochenstunden || 35) * 52)) * 100) / 100
              : 0;
            const auszahlungBetrag = Math.round(form.ubHours * stundenlohn * (1 + form.ubZuschlag / 100) * 100) / 100;
            const existingPayouts = (data.uberstundenAbschluss || []).filter(a => a.empId === emp.id && a.year === abschlussYear);

            return (
              <div key={emp.id} className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border2)" }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{emp.name}</strong>
                    {emp.role && <span style={{ fontSize: 12, color: "var(--text4)", marginLeft: 10 }}>{emp.role}</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text4)" }}>{emp.pensum || 100}% · {((emp.wochenstunden || 35) * (emp.pensum || 100) / 100).toFixed(1)}h/Wo</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                  {/* Ferien */}
                  <div>
                    <div className="section-label" style={{ marginBottom: 10 }}>Ferien {abschlussYear}</div>
                    {[
                      { label: "Jahresanspruch", value: `${fs.anspruchH}h` },
                      fs.ubertragH > 0 ? { label: "Übertrag Vorjahr", value: `+${fs.ubertragH}h` } : null,
                      { label: "Bezogen", value: `-${fs.bezogenH}h` },
                    ].filter((r): r is { label: string; value: string } => !!r).map(r => (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", padding: "2px 0" }}>
                        <span>{r.label}</span><span>{r.value}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, padding: "6px 0 0", marginTop: 4, borderTop: "1px solid var(--border2)" }}>
                      <span>Restanspruch</span>
                      <span style={{ color: fs.restH > 0 ? "var(--positive)" : fs.restH < 0 ? "var(--negative)" : "var(--text4)" }}>{fs.restH}h</span>
                    </div>

                    {fs.restH > 0 ? (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Übertrag ins {abschlussYear + 1}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="number" min={0} max={fs.restH} step={0.5}
                            value={form.ferienUebertrag}
                            onChange={e => setForm({ ferienUebertrag: Math.min(+e.target.value, fs.restH) })}
                            style={{ width: 70, fontSize: 12 }}
                          />
                          <span style={{ fontSize: 12, color: "var(--text4)" }}>h von {fs.restH}h</span>
                        </div>
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 14px", marginTop: 10 }}
                          onClick={() => saveFerienUebertrag(emp, form.ferienUebertrag)}>
                          Bestätigen
                        </button>
                        {currentUebertrag !== undefined && (
                          <div style={{ fontSize: 11, color: "var(--positive)", marginTop: 6 }}>✓ {currentUebertrag}h bestätigt für {abschlussYear + 1}</div>
                        )}
                      </div>
                    ) : fs.restH < 0 ? (
                      <div style={{ fontSize: 11, color: "var(--negative)", marginTop: 12 }}>Negativsaldo — Bezug übersteigt Anspruch</div>
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 12 }}>Kein Restanspruch — kein Übertrag nötig</div>
                    )}
                  </div>

                  {/* Überstunden */}
                  <div>
                    <div className="section-label" style={{ marginBottom: 10 }}>Überstunden (Saldo gesamt)</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                      <span>Verbleibend</span>
                      <span style={{ color: ubSaldo > 0 ? "var(--positive)" : ubSaldo < 0 ? "var(--negative)" : "var(--text4)" }}>{ubSaldo}h</span>
                    </div>

                    {existingPayouts.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        {existingPayouts.map(p => (
                          <div key={p.id} style={{ fontSize: 11, color: "var(--st-c-bezahlt)", background: "var(--st-bg-bezahlt)", border: `1px solid color-mix(in srgb, var(--st-c-bezahlt) 30%, transparent)`, borderRadius: 20, padding: "4px 12px", marginBottom: 4 }}>
                            ✓ {p.hoursSettled}h ausbezahlt — {formatCHF(p.auszahlungBetrag)} ({p.zuschlagPercent}% Zuschlag)
                          </div>
                        ))}
                      </div>
                    )}

                    {ubSaldo > 0 ? (
                      <>
                        <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 6 }}>Stunden ausbezahlen</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                          <input
                            type="number" min={0.5} max={ubSaldo} step={0.5}
                            value={form.ubHours}
                            onChange={e => setForm({ ubHours: Math.min(+e.target.value, ubSaldo) })}
                            placeholder="Std."
                            style={{ width: 65, fontSize: 12 }}
                          />
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>h ×</span>
                          <input
                            type="number" min={0} step={1}
                            value={form.ubZuschlag}
                            onChange={e => setForm({ ubZuschlag: +e.target.value })}
                            style={{ width: 52, fontSize: 12 }}
                          />
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>% Zuschlag</span>
                        </div>
                        {form.ubZuschlag < 25 && (
                          <div style={{ fontSize: 10, color: "var(--warning)", marginBottom: 6 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> OR Art. 321c: mind. 25% Zuschlag empfohlen</div>
                        )}
                        {stundenlohn > 0 ? (
                          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                            {form.ubHours}h × {formatCHF(stundenlohn)}/h = <strong>{formatCHF(auszahlungBetrag)}</strong>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: "var(--warning)", marginBottom: 10 }}>Kein Monatslohn hinterlegt</div>
                        )}
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 11, padding: "4px 14px" }}
                          disabled={!stundenlohn || !(form.ubHours > 0)}
                          onClick={() => saveUbAbschluss(emp, form)}
                        >
                          Erfassen
                        </button>
                        <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 6 }}>Restliche Stunden werden übertragen.</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text4)" }}>Kein Überstundensaldo vorhanden.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal === "emp" && (
        <Modal title={empForm.id ? "Mitarbeiter bearbeiten" : "Neuer Mitarbeiter"} onClose={() => setModal(null)} onSave={saveEmp} wide>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 10 }}>PERSONALIEN</div>
          <div className="form-row">
            <FormField label="Name *"><input value={empForm.name || ""} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} autoFocus style={!empForm.name?.trim() ? { borderColor: "var(--warning)" } : {}} /></FormField>
            <FormField label="Funktion / Rolle"><input value={empForm.role || ""} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} placeholder="z.B. Architekt, Praktikant…" /></FormField>
            <FormField label="Personal-Nr.">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={empForm.personalNr || ""} onChange={e => setEmpForm({ ...empForm, personalNr: e.target.value })} style={{ flex: 1 }} placeholder="001" />
                {empForm.id && empForm.personalNr === "" && (
                  <button type="button" className="btn btn-ghost" style={{ padding: "0 10px", height: 36, fontSize: 11 }} onClick={() => setEmpForm({ ...empForm, personalNr: nextPersonalNr() })}>Auto</button>
                )}
              </div>
              {empForm.personalNr && !/^\d+$/.test(empForm.personalNr) && (
                <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}>Nicht-numerische Nr. wird nicht für Auto-Zählung verwendet</div>
              )}
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="Adresse"><input value={empForm.adresse || ""} onChange={e => setEmpForm({ ...empForm, adresse: e.target.value })} placeholder="Musterstrasse 1" /></FormField>
            <FormField label="PLZ / Ort"><input value={empForm.ort || ""} onChange={e => setEmpForm({ ...empForm, ort: e.target.value })} placeholder="8001 Zürich" /></FormField>
          </div>
          <div className="form-row">
            <FormField label="AHV-Nr."><input value={empForm.ahvNr || ""} onChange={e => setEmpForm({ ...empForm, ahvNr: e.target.value })} placeholder="756.1234.5678.90" /></FormField>
            <FormField label="Geburtsdatum"><DateInput value={empForm.geburtsdatum || ""} onChange={e => setEmpForm({ ...empForm, geburtsdatum: e.target.value })} /></FormField>
            <FormField label="E-Mail"><input type="email" value={empForm.email || ""} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} /></FormField>
          </div>
          <div className="form-row">
            <FormField label="Eintrittsdatum *"><DatePicker value={empForm.eintrittsdatum || ""} onChange={e => setEmpForm({ ...empForm, eintrittsdatum: e.target.value })} style={!empForm.eintrittsdatum ? { borderColor: "var(--warning)" } : {}} /></FormField>
          </div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>ARBEITSZEIT & FERIEN</div>
          <div className="form-row">
            <FormField label="Pensum %">
              <input type="number" min={10} max={100} step={5} value={empForm.pensum || 100} onChange={e => setEmpForm({ ...empForm, pensum: +e.target.value })} />
            </FormField>
            <FormField label="Wochenstunden (100%)">
              <input type="number" min={1} max={50} step={0.5} value={empForm.wochenstunden || data.settings.defaultWochenstunden || 35} onChange={e => setEmpForm({ ...empForm, wochenstunden: +e.target.value })} />
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Effektiv: {(((empForm.wochenstunden || 35) * (empForm.pensum || 100)) / 100).toFixed(1)}h/Wo</div>
            </FormField>
            <FormField label="Ferien (Wochen/Jahr)">
              <input type="number" min={4} max={10} step={0.5} value={empForm.ferienWochen || data.settings.defaultFerienWochen || 5} onChange={e => setEmpForm({ ...empForm, ferienWochen: +e.target.value })} />
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>Minimum: 4 Wochen (OR)</div>
            </FormField>
          </div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "14px 0 10px", paddingTop: 12, borderTop: "1px solid var(--border2)" }}>LOHN & AUSZAHLUNG</div>
          <div className="form-row">
            <FormField label="Monatslohn Brutto CHF (100% Basis)">
              <input type="number" min={0} step={100} value={empForm.monatslohn || ""} onChange={e => setEmpForm({ ...empForm, monatslohn: +e.target.value })} placeholder="z.B. 7000" />
              {(empForm.pensum || 100) < 100 && (empForm.monatslohn || 0) > 0 && (
                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 3 }}>Effektiv bei {empForm.pensum}%: {formatCHF(Math.round((empForm.monatslohn as number) * ((empForm.pensum as number) / 100) * 100) / 100)}</div>
              )}
            </FormField>
            <FormField label="IBAN Lohnkonto">
              <input
                value={empForm.lohnIban || ""}
                onChange={e => setEmpForm({ ...empForm, lohnIban: formatIban(e.target.value) })}
                placeholder="CH00 0000 0000 0000 0000 0"
              />
            </FormField>
            <FormField label=" ">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
                <input type="checkbox" checked={!!empForm.dreizehnterLohn} onChange={e => setEmpForm({ ...empForm, dreizehnterLohn: e.target.checked })} style={{ width: "auto" }} />
                13. Monatslohn
              </label>
            </FormField>
          </div>
          <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 8 }}>Sozialabzüge Arbeitnehmer (anpassbar)</div>
          <div className="form-row">
            <FormField label="AHV/IV/EO %">
              <input type="number" step={0.01} min={0} value={empForm.ahvSatz ?? 5.3} onChange={e => setEmpForm({ ...empForm, ahvSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Standard 5.30%</div>
            </FormField>
            <FormField label="ALV %">
              <input type="number" step={0.01} min={0} value={empForm.alvSatz ?? 1.1} onChange={e => setEmpForm({ ...empForm, alvSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Standard 1.10%</div>
            </FormField>
            <FormField label="BVG / PK AN %">
              <input type="number" step={0.1} min={0} value={empForm.bvgSatz ?? 8.0} onChange={e => setEmpForm({ ...empForm, bvgSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>Arbeitnehmer-Anteil</div>
            </FormField>
          </div>
          <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 8 }}>Sozialabgaben Arbeitgeber</div>
          <div className="form-row">
            <FormField label="PK / BVG AG %">
              <input type="number" step={0.1} min={0} value={empForm.pkAGSatz ?? (data.settings.defaultPkAGSatz ?? 8.0)} onChange={e => setEmpForm({ ...empForm, pkAGSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>AG muss mind. AN-Anteil zahlen</div>
            </FormField>
          </div>
          <div className="form-row">
            <FormField label="NBU % (Nichtberufsunfall)">
              <input type="number" step={0.01} min={0} value={empForm.nbuSatz ?? 1.5} onChange={e => setEmpForm({ ...empForm, nbuSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>trägt AN</div>
            </FormField>
            <FormField label="KTG % (Krankentaggeld)">
              <input type="number" step={0.01} min={0} value={empForm.ktgSatz ?? 0.5} onChange={e => setEmpForm({ ...empForm, ktgSatz: +e.target.value })} />
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 3 }}>je nach Vertrag</div>
            </FormField>
            <FormField label=" ">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", textTransform: "none", fontSize: 13 }}>
                <input type="checkbox" checked={!!empForm.quellensteuerPflichtig} onChange={e => setEmpForm({ ...empForm, quellensteuerPflichtig: e.target.checked })} style={{ width: "auto" }} />
                Quellensteuerpflichtig
              </label>
              {empForm.quellensteuerPflichtig && (
                <input type="number" step={0.1} min={0} value={empForm.quellensteuerSatz ?? 10} onChange={e => setEmpForm({ ...empForm, quellensteuerSatz: +e.target.value })} placeholder="Satz %" style={{ marginTop: 4 }} />
              )}
            </FormField>
          </div>

          {/* APP-ZUGANG */}
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text4)", margin: "18px 0 12px", paddingTop: 14, borderTop: "1px solid var(--border2)" }}>APP-ZUGANG</div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={!!empForm._appAccess} onChange={e => setEmpForm({ ...empForm, _appAccess: e.target.checked })} style={{ width: "auto" }} />
              Zugang zur App aktivieren
            </label>
          </div>
          {empForm._appAccess && (
            <>
              <div className="form-row">
                <FormField label="Benutzername *">
                  <input value={empForm._appUsername || ""} onChange={e => setEmpForm({ ...empForm, _appUsername: e.target.value })} placeholder="vorname.nachname" style={!empForm._appUsername?.trim() ? { borderColor: "var(--warning)" } : {}} />
                </FormField>
                <FormField label={empForm._appUserId ? "Neues Passwort (leer = unverändert)" : "Passwort"}>
                  <input type="password" value={empForm._appPassword || ""} onChange={e => setEmpForm({ ...empForm, _appPassword: e.target.value })} placeholder={empForm._appUserId ? "••••••" : "Passwort vergeben"} />
                </FormField>
              </div>
              <FormField label="Rolle">
                <select value={empForm._appRoleId || ""} onChange={e => setEmpForm({ ...empForm, _appRoleId: e.target.value })}>
                  <option value="">— Rolle wählen —</option>
                  {(data.appRoles || []).map(r => (
                    <option key={r.id} value={r.id}>{r.name}{r.permissions === null ? " (Alle Rechte)" : ` (${(r.permissions || []).length} Bereiche)`}</option>
                  ))}
                </select>
                {!empForm._appRoleId && <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}>Bitte eine Rolle wählen</div>}
                {empForm._appRoleId && (() => {
                  const role = (data.appRoles || []).find(r => r.id === empForm._appRoleId);
                  if (!role) return null;
                  if (role.permissions === null) return <div style={{ fontSize: 10, color: "var(--positive)", marginTop: 3 }}>Zugriff auf alle Bereiche</div>;
                  if (!role.permissions?.length) return <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 3 }}><span className="msr" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 3 }}>warning</span> Rolle hat keine Bereiche — Benutzer sieht nichts</div>;
                  return <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 3 }}>{role.permissions.join(", ")}</div>;
                })()}
              </FormField>
              <div style={{ fontSize: 10, color: "var(--text5)", marginTop: 4 }}>Rollen und Berechtigungen unter Einstellungen → App-Rollen verwalten.</div>
            </>
          )}
        </Modal>
      )}

      {modal === "abs" && (
        <Modal title={absForm.id ? "Absenz bearbeiten" : "Absenz erfassen"} onClose={() => setModal(null)} onSave={saveAbs}>
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
      )}

      {modal === "ferien" && (
        <Modal title={ferienForm.id ? "Ferien bearbeiten" : "Ferien eintragen"} onClose={() => setModal(null)} onSave={saveFerien}>
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
      )}

    </div>
  );
}