// Einstellungen in Reitern (Komponenten unter views/settings/):
//   Studio            – Stammdaten, Bankverbindung, MWST, Stundensatz, Logo (StudioTab)
//   Dokumente & Formate – Nummernformate (Projekt/Rechnung/Vertrag/Protokoll mit
//                       Platzhaltern YYYY, YY, MM, NN…), PDF-Dateiname, Seitenränder (DocumentsTab)
//   Erscheinungsbild  – Schriften, Farben, Briefpapier, eigenes CSS der Dokumente
//                       (components/DocDesignSettings.tsx, mit Live-Vorschau)
//   Team & Rollen     – App-Rollen mit Berechtigungen, Benutzerverwaltung, Cloud: Mitglieder einladen (TeamTab)
//   Feiertage & Absenzen – Feiertage (auch jährlich wiederkehrend) und Absenzarten (CalendarTab)
//   System            – Datenspeicher (lokal/Ordner), Backup-Export/-Import, Zurücksetzen,
//                       Cloud-Verbindung, Studios wechseln/anlegen (SystemTab)
//   Updates & Support – UpdatesSupport.tsx
//   Mein Profil       – persönlich (PersonalSettings): Adresse, Lohn-IBAN, Avatar, Zoom
//
// Die Reiter Studio/Dokumente/Erscheinungsbild/Team/System bearbeiten eine lokale Kopie (`s`) der
// Studio-Einstellungen und speichern gemeinsam mit «Speichern» (`isDirty` zeigt
// Änderungen); Feiertage, Absenzen und Rollen werden dagegen sofort gespeichert.
// Nicht-Admins sehen nur «Mein Profil».

import { applyEdit, jsonEqual } from "../storage/merge";
import { showToast } from "../toast";
import React, { useState, useEffect } from "react";
import { Header, PageTabs } from "../components/UI";
import UpdatesSupport from "../components/UpdatesSupport";
import DocDesignSettings from "../components/DocDesignSettings";
import { PersonalSettings } from "./settings/PersonalSettings";
import { StudioTab } from "./settings/StudioTab";
import { DocumentsTab } from "./settings/DocumentsTab";
import { TeamTab } from "./settings/TeamTab";
import { CalendarTab } from "./settings/CalendarTab";
import { SystemTab } from "./settings/SystemTab";
import type { Settings as StudioSettings, ViewProps } from "../types";

const TABS = [
  { id: "studio",    label: "Studio" },
  { id: "dokumente", label: "Dokumente & Formate" },
  { id: "erscheinungsbild", label: "Erscheinungsbild" },
  { id: "team",      label: "Team & Rollen" },
  { id: "kalender",  label: "Feiertage & Absenzen" },
  { id: "system",    label: "System" },
  { id: "support",   label: "Updates & Support" },
  { id: "profil",    label: "Mein Profil" },
];

const SETTINGS_TABS = new Set(["studio", "dokumente", "erscheinungsbild", "team", "system"]);

export default function Settings({ data, update, currentUser, uiZoom, setUiZoom, setView }: Pick<ViewProps, "data" | "update" | "currentUser" | "setView"> & {
  /** Zoomfaktor der Oberfläche (1 = 100 %) */
  uiZoom?: number;
  setUiZoom?: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [s, setS] = useState<StudioSettings>(data.settings);
  // Stand beim Öffnen bzw. letzten Speichern: Basis für applyEdit — gespeichert wird nur, was im Formular geändert
  // wurde. Vorher schrieb «Speichern» die ganze Kopie zurück und setzte fremde Änderungen zurück (Telefon, sogar
  // den Monatsabschluss eines anderen Clients; Test gleichzeitiges Arbeiten 25.11.2026).
  const [base, setBase] = useState<StudioSettings>(data.settings);
  // Formular unverändert und die Einstellungen ändern sich von aussen → nachziehen
  if (data.settings !== base && jsonEqual(s, base)) { setBase(data.settings); setS(data.settings); }
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("studio");
  const isDirty = !jsonEqual(s, base);
  const isAdmin = !currentUser || currentUser.role === "admin";

  const setField = (changes: Partial<StudioSettings>) => { setS(prev => ({ ...prev, ...changes })); setSaved(false); };

  const save = () => {
    // Nummernformate brauchen einen Zähler (N…), sonst entsteht immer dieselbe Nummer
    const noCounter = ([["Rechnungen", s.invoiceNumberFormat], ["Projekte", s.projectNumberFormat], ["Verträge", s.vertragNumberFormat]] as [string, string | undefined][])
      .filter(([, f]) => f && !/N/.test(f)).map(([l]) => l);
    if (noCounter.length) { showToast(`Nummernformat ${noCounter.join(", ")}: es fehlt der Zähler (z.B. NNN).`); return; }
    const roleIds = (s.roles || []).map(r => (r.id || "").trim());
    if ((s.roles || []).some(r => !r.id?.trim() || !r.label?.trim())) { showToast("Offerten-Rollen brauchen Kürzel und Bezeichnung."); return; }
    if (new Set(roleIds).size !== roleIds.length) { showToast("Jedes Kürzel der Offerten-Rollen nur einmal."); return; }
    let merged = s;
    update("settings", prev => (merged = applyEdit(base, s, prev)));
    setBase(merged); setS(merged);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // ⌘S / Ctrl+S speichert ungespeicherte Einstellungen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && isDirty) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!isAdmin) {
    return <PersonalSettings data={data} update={update} currentUser={currentUser} uiZoom={uiZoom || 1} setUiZoom={setUiZoom || (() => {})} />;
  }

  return (
    <div>
      {/* ── Profil-Tab ── */}
      {tab === "profil" && <PersonalSettings data={data} update={update} currentUser={currentUser} uiZoom={uiZoom || 1} setUiZoom={setUiZoom || (() => {})} nav={<PageTabs tabs={TABS} value={tab} onChange={setTab} />} />}

      {/* ── Settings-Tabs (studio / dokumente / team / system / kalender) ── */}
      {tab !== "profil" && <>
        {/* Stable header — Speichern only for settings tabs */}
        <Header title="Einstellungen" action={
          SETTINGS_TABS.has(tab)
            ? (isDirty
                ? <button className="btn btn-primary" onClick={save} title="Änderungen speichern (⌘S)">Änderungen speichern</button>
                : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, fontSize: 13, color: saved ? "var(--positive)" : "var(--text4)" }}>
                    <span className="msr" style={{ fontSize: 17 }}>check_circle</span>{saved ? "Gespeichert" : "Alles gespeichert"}
                  </span>)
            : null
        } tabs={<PageTabs tabs={TABS} value={tab} onChange={setTab} />} />


        {tab === "studio" && <StudioTab s={s} setField={setField} data={data} />}
        {tab === "dokumente" && <DocumentsTab s={s} setField={setField} />}
        {tab === "erscheinungsbild" && <DocDesignSettings s={s} setField={setField} data={data} update={update} />}
        {tab === "team" && <TeamTab s={s} setField={setField} data={data} update={update} isAdmin={isAdmin} />}
        {tab === "kalender" && <CalendarTab data={data} update={update} onSettingsSaved={c => { setS(prev => ({ ...prev, ...c })); setBase(prev => ({ ...prev, ...c })); }} />}
        {tab === "system" && <SystemTab s={s} setField={setField} data={data} setView={setView} isAdmin={isAdmin} currentUser={currentUser} />}
        {tab === "support" && <UpdatesSupport />}
      </>}
    </div>
  );
}
