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

import React, { useState } from "react";
import { Header } from "../components/UI";
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
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("studio");
  const isDirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const isAdmin = !currentUser || currentUser.role === "admin";

  const setField = (changes: Partial<StudioSettings>) => { setS(prev => ({ ...prev, ...changes })); setSaved(false); };

  const save = () => {
    update("settings", s);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!isAdmin) {
    return <PersonalSettings data={data} update={update} currentUser={currentUser} uiZoom={uiZoom || 1} setUiZoom={setUiZoom || (() => {})} />;
  }

  return (
    <div>
      {/* ── Profil-Tab ── */}
      {tab === "profil" && <PersonalSettings data={data} update={update} currentUser={currentUser} uiZoom={uiZoom || 1} setUiZoom={setUiZoom || (() => {})} nav={
        <div className="filter-bar" style={{ marginBottom: 20 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`pill${tab === t.id ? " active" : ""}`}>{t.label}</button>
          ))}
        </div>
      } />}

      {/* ── Settings-Tabs (studio / dokumente / team / system / kalender) ── */}
      {tab !== "profil" && <>
        {/* Stable header — Speichern only for settings tabs */}
        <Header title="Einstellungen" action={
          SETTINGS_TABS.has(tab)
            ? <button className="btn btn-primary" style={{ background: saved ? "var(--positive)" : isDirty ? "#8a6a3a" : "#2a2a22", transition: "background 0.3s" }} onClick={save}>
                {saved ? "✓ Gespeichert" : isDirty ? "Speichern *" : "Gespeichert"}
              </button>
            : null
        } />

        <div className="filter-bar" style={{ marginBottom: 20 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`pill${tab === t.id ? " active" : ""}`}>{t.label}</button>
          ))}
        </div>

        {tab === "studio" && <StudioTab s={s} setField={setField} data={data} />}
        {tab === "dokumente" && <DocumentsTab s={s} setField={setField} />}
        {tab === "erscheinungsbild" && <DocDesignSettings s={s} setField={setField} data={data} update={update} />}
        {tab === "team" && <TeamTab s={s} setField={setField} data={data} update={update} isAdmin={isAdmin} />}
        {tab === "kalender" && <CalendarTab data={data} update={update} />}
        {tab === "system" && <SystemTab s={s} setField={setField} data={data} setView={setView} isAdmin={isAdmin} />}
        {tab === "support" && <UpdatesSupport />}
      </>}
    </div>
  );
}
