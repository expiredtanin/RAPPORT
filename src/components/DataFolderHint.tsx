// Hinweis nach dem Update: Daten aus dem lokalen Speicher (≈5 MB, ohne Backup) in den Rapport-Ordner umziehen.
//
// Erscheint nur in der Desktop-App im lokalen Modus, nach der Anmeldung. «Später» blendet ihn bis zum nächsten
// Start aus, «Nicht mehr anzeigen» merkt sich das dauerhaft (`rapport_folder_hint`). Umzug: «In Rapport-Ordner
// umziehen» nimmt `~/Documents/Rapport`, «Anderen Ort…» legt `<Ort>/Rapport` an. Ist der Zielordner leer, werden die
// Daten hineingeschrieben (Anhänge als Dateien), enthält er schon Rapport-Daten, wird erst nachgefragt
// (die lokalen Daten bleiben in jedem Fall unverändert stehen).

import { useState } from "react";
import {
  canUseDataFolder, chooseDataFolder, folderHasData, writeDataToFolder, activateDataFolder,
  defaultRapportFolder, rapportFolderIn,
} from "../storage/data-folder";
import { isCloudBackend, isFileBackend } from "../storage/adapter";
import type { AppData } from "../types";

/** Zeigt den Umzugshinweis, falls er zutrifft; sonst nichts. */
export default function DataFolderHint({ data }: { data: AppData }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem("rapport_folder_hint") === "off");
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!canUseDataFolder || isCloudBackend || isFileBackend || hidden) return null;

  const choose = async (chooseLocation: boolean) => {
    setBusy(true); setError("");
    try {
      let dir = await defaultRapportFolder();
      if (chooseLocation) {
        const parent = await chooseDataFolder("Ort für den Rapport-Ordner wählen");
        if (!parent) return;
        dir = await rapportFolderIn(parent);
      }
      if (await folderHasData(dir)) { setExisting(dir); return; }
      await writeDataToFolder(dir, data);
      activateDataFolder(dir);
    } catch (e) {
      setError(`Der Ordner konnte nicht verwendet werden: ${(e as Error).message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 1500, width: 380, maxWidth: "calc(100vw - 40px)" }}>
      <div className="card" style={{ padding: "18px 20px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Daten in den Rapport-Ordner umziehen?</div>
        {existing ? (<>
          <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, marginBottom: 14 }}>
            Der Ordner <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{existing}</span> enthält schon Rapport-Daten.
            Diese verwenden? Die Daten aus diesem lokalen Speicher bleiben unverändert erhalten, werden aber nicht übernommen.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => activateDataFolder(existing)}>Ordner verwenden</button>
            <button className="btn btn-ghost" onClick={() => setExisting(null)}>Abbrechen</button>
          </div>
        </>) : (<>
          <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, marginBottom: 14 }}>
            Bisher liegen Ihre Daten im lokalen Speicher der App: begrenzt auf ca. 5 MB, ohne Backup.
            Im Rapport-Ordner liegen Daten, Belege und Bilder als normale Dateien — ohne Grenze, mit Tagesbackup.
            Liegt er in iCloud Drive oder auf einem NAS, kann eine zweite Person mitarbeiten.
          </div>
          {error && <div style={{ fontSize: 12, color: "var(--danger, #8a1a1a)", marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => choose(false)}>In Rapport-Ordner umziehen</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => choose(true)}>Anderen Ort…</button>
            <button className="btn btn-ghost" onClick={() => setHidden(true)}>Später</button>
            <button className="btn btn-ghost" style={{ marginLeft: "auto", border: "none", boxShadow: "none", color: "var(--text4)" }}
              onClick={() => { localStorage.setItem("rapport_folder_hint", "off"); setHidden(true); }}>Nicht mehr anzeigen</button>
          </div>
        </>)}
      </div>
    </div>
  );
}
