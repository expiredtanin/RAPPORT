// Reiter «System»: Datenspeicher (lokal/Ordner, Konfliktkopien), Cloud-Verbindung mit
// Studio-Wechsel und neuem Studio, Backup-Export/-Import, Zurücksetzen, Datenbankübersicht.
// Der Backup-Export entfernt Klartext-Passwörter (Altbestand); Passwort-Hashes bleiben.

import React, { useState, useEffect } from "react";
import { storage, isCloudBackend, isFileBackend, fileStorage } from "../../storage/adapter";
import { canUseDataFolder, chooseDataFolder, folderHasData, writeDataToFolder, activateDataFolder, getDataDir } from "../../storage/data-folder";
import type { PocketBaseAdapter } from "../../storage/pocketbase-adapter";
import { localISODate } from "../../utils";
import { FormField, Modal } from "../../components/UI";
import { useConfirm } from "../../hooks/useConfirm";
import { Section, type DraftProps } from "./shared";
import type { ViewProps } from "../../types";

/** Cloud-Methoden des Adapters; nur sinnvoll aufrufen, wenn `isCloudBackend` true ist. */
const cloud = storage as unknown as PocketBaseAdapter;

/** Speicherort, Backup und Studio-Verwaltung. */
export function SystemTab({ s, setField, data, setView, isAdmin }: DraftProps & Pick<ViewProps, "data" | "setView"> & { isAdmin: boolean }) {
  const [initModal, setInitModal] = useState(false);
  // Cloud-spezifisch: Studios, in denen der aktuelle User Mitglied ist (für Switcher + Sharing)
  const [myStudios, setMyStudios] = useState<{ id: string; name?: string; slug?: string; appRoleId?: string }[]>([]);
  const [newStudioModal, setNewStudioModal] = useState<{ name: string; slug?: string; shareFrom: Set<string> } | null>(null);
  const [cloudUrl] = useState(() => localStorage.getItem("rapport_cloud_url") || "");
  const [activeStudioId] = useState(() => sessionStorage.getItem("rapport_studio_id") || "");
  useEffect(() => {
    if (!isCloudBackend) return;
    (async () => { setMyStudios(await cloud.myStudios?.() || []); })();
  }, []);
  const { askConfirm, ConfirmModalEl } = useConfirm();
  // Datenordner: Konfliktkopien der Sync-Dienste melden und Ordnerwechsel/-umzug
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  useEffect(() => {
    if (!isFileBackend) return;
    fileStorage.findConflictFiles().then(setConflictFiles).catch(() => {});
  }, []);
  const dataDir = getDataDir();
  const switchFolder = async () => {
    setFolderBusy(true);
    try {
      const dir = await chooseDataFolder();
      if (!dir || dir === dataDir) return;
      if (await folderHasData(dir)) {
        const from = isFileBackend ? "dem bisherigen Ordner" : "diesem lokalen Speicher";
        if (!await askConfirm(`Der Ordner enthält bereits Rapport-Daten. Diese Daten verwenden? Die Daten in ${from} bleiben unverändert erhalten, werden aber nicht übernommen.`, "Ordner verwenden")) return;
      } else {
        await writeDataToFolder(dir, data);
      }
      activateDataFolder(dir);
    } catch (e) {
      alert(`Der Ordner konnte nicht verwendet werden: ${(e as Error).message || e}`);
    } finally {
      setFolderBusy(false);
    }
  };

  const exportData = () => {
    // Strip legacy plaintext passwords; PBKDF2 hashes (passwordHash + passwordSalt) are
    // not reversible and remain in the backup so restored accounts keep working.
    const sanitized = {
      ...data,
      users: (data.users || []).map(u => {
        const { password, ...rest } = u;
        return rest;
      }),
    };
    const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studio-backup-${localISODate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async evt => {
      try {
        const imported = JSON.parse(evt.target?.result as string);
        if (await askConfirm("Aktuelle Daten wirklich überschreiben?", "Überschreiben")) {
          await storage.save(imported);
          window.location.reload();
        }
      } catch {
        alert("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      {ConfirmModalEl}
      {initModal && (
        <div className="modal-overlay" onClick={() => setInitModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, marginBottom: 6 }}>Neu initialisieren</div>
            <p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 16 }}>
              Die App wird auf den Ausgangszustand zurückgesetzt. Alle Projekte, Rechnungen, Mitarbeitende und Einstellungen gehen unwiderruflich verloren.
            </p>
            <div style={{ padding: "10px 14px", background: "var(--negative-bg)", border: "1px solid #e0b0b0", borderRadius: 8, fontSize: 12, color: "var(--negative)", marginBottom: 20, lineHeight: 1.6 }}>
              Backup vorher erstellen empfohlen.
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginBottom: 10 }} onClick={exportData}>↓ Backup erstellen</button>
            <button className="btn btn-danger" style={{ width: "100%", marginBottom: 10 }} onClick={async () => {
              setInitModal(false);
              if (!await askConfirm("Wirklich initialisieren? Alle Daten gehen verloren.", "Initialisieren")) return;
              await storage.clear();
              window.location.reload();
            }}>Trotzdem initialisieren</button>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setInitModal(false)}>Abbrechen</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="responsive-grid-2">
        <div className="card">
          {!isCloudBackend && canUseDataFolder && (
            <Section title="DATENSPEICHER">
              {isFileBackend ? (<>
                <div style={{ fontSize: 12, color: "var(--text4)", lineHeight: 1.7, marginBottom: 12 }}>
                  Die Daten liegen als Dateien in diesem Ordner (<code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>studio.json</code>, Zeiteinträge unter <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>time/</code>, Tagesbackups unter <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>backups/</code>, Belege, Logo und Bilder unter <code style={{ background: "var(--surface3)", padding: "1px 4px", borderRadius: 2 }}>Dateien/</code>).
                  Änderungen der anderen Person erscheinen automatisch; Gleichzeitiges wird zusammengeführt.
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text)", padding: "8px 10px", background: "var(--surface2)", borderRadius: 6, wordBreak: "break-all", marginBottom: 12 }}>{dataDir}</div>
                {conflictFiles.length > 0 && (
                  <div style={{ fontSize: 12, lineHeight: 1.6, padding: "10px 12px", borderRadius: 6, border: "1px solid #e8b0b0", background: "var(--negative-bg)", color: "var(--negative)", marginBottom: 12 }}>
                    Der Sync-Dienst hat Konfliktkopien angelegt (werden ignoriert): <strong>{conflictFiles.join(", ")}</strong>.
                    Bitte prüfen, ob darin Änderungen fehlen, und die Dateien danach löschen.
                  </div>
                )}
                <button className="btn btn-ghost" style={{ width: "100%" }} disabled={folderBusy} onClick={switchFolder}>Anderen Ordner wählen…</button>
              </>) : (<>
                <div style={{ fontSize: 12, color: "var(--text4)", lineHeight: 1.7, marginBottom: 12 }}>
                  Die Daten liegen im lokalen Speicher der App (begrenzt auf ca. 5 MB, ohne automatisches Backup).
                  In einem Ordner gibt es keine Grössengrenze und ein Tagesbackup; liegt er in iCloud Drive oder auf einem NAS, können zwei Personen damit arbeiten.
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} disabled={folderBusy} onClick={switchFolder}>In einen Datenordner umziehen…</button>
              </>)}
            </Section>
          )}
          {isCloudBackend && (
            <Section title="CLOUD-VERBINDUNG">
              <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 14, lineHeight: 1.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border2)" }}>
                  <span>Server</span><span style={{ color: "var(--text)", fontFamily: "monospace", fontSize: 11 }}>{(() => { try { return new URL(cloudUrl).host; } catch { return cloudUrl; } })()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border2)" }}>
                  <span>Aktives Studio</span><span style={{ color: "var(--text)", fontWeight: 500 }}>{myStudios.find(s => s.id === activeStudioId)?.name || "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>Studios des Accounts</span><strong style={{ color: "var(--text3)" }}>{myStudios.length}</strong>
                </div>
              </div>
              {isAdmin && (
                <button
                  className="btn btn-ghost"
                  style={{ width: "100%", marginBottom: 6 }}
                  onClick={() => setNewStudioModal({ name: "", shareFrom: new Set() })}
                >
                  + Weiteres Studio anlegen
                </button>
              )}
              {myStudios.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "block", fontSize: 9, letterSpacing: "0.12em", color: "var(--text4)", marginBottom: 6, fontWeight: 500 }}>STUDIO WECHSELN</label>
                  <select
                    className="login-input"
                    value={activeStudioId}
                    onChange={e => {
                      sessionStorage.setItem("rapport_studio_id", e.target.value);
                      window.location.reload();
                    }}
                  >
                    {myStudios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {isAdmin && (
                <a
                  className="btn btn-ghost"
                  style={{ width: "100%", marginTop: 10, textAlign: "center", display: "block", boxSizing: "border-box" }}
                  href={`${window.location.origin}/_/`}
                  target="_blank" rel="noreferrer"
                >
                  PocketBase-Verwaltung öffnen ↗
                </a>
              )}
            </Section>
          )}
          <Section title="DATEN & BACKUP">
            <p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 16 }}>
              {isCloudBackend
                ? "Daten liegen in der Cloud. Backup zieht den aktuellen Snapshot als JSON-Datei — z.B. für Archiv oder Migration."
                : "Alle Daten liegen ausschliesslich im Browser (localStorage). Regelmässige Backups sind empfohlen."}
            </p>
            <button className="btn btn-primary" style={{ width: "100%", marginBottom: 10 }} onClick={exportData}>↓ Backup als JSON herunterladen</button>
            {isAdmin && (
              <button className="btn btn-ghost" style={{ width: "100%", marginBottom: 10 }} onClick={() => setView("dataImport")}>
                ↑ Stammdaten importieren (CSV/Excel)…
              </button>
            )}
            {!isCloudBackend && (
              <label className="btn btn-ghost" style={{ width: "100%", textAlign: "center", display: "block", marginBottom: 10 }}>
                ↑ Backup importieren
                <input type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
              </label>
            )}
            {!isCloudBackend && (
              <button className="btn btn-danger" style={{ width: "100%" }} onClick={() => setInitModal(true)}>
                Neu initialisieren…
              </button>
            )}
          </Section>

          <Section title="DATENBANKÜBERSICHT">
            {[
              { label: "Kontakte", value: (data.persons || []).length },
              { label: "Projekte", value: data.projects.length },
              { label: "Zeiteinträge", value: data.timeEntries.length },
              { label: "Rechnungen", value: data.invoices.length },
              { label: "Offerten", value: (data.quotes || []).length },
              { label: "Verträge", value: (data.contracts || []).length },
              { label: "Spesen", value: (data.expenses || []).length },
              { label: "Interne Ausgaben", value: (data.internalExpenses || []).length },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: "1px solid var(--border2)" }}>
                <span style={{ color: "var(--text4)" }}>{r.label}</span>
                <strong style={{ color: "var(--text3)" }}>{r.value}</strong>
              </div>
            ))}
          </Section>
        </div>

        <div className="card">
          <Section title="ZEITERFASSUNG">
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={s.blockMaiTag !== false} onChange={e => setField({ blockMaiTag: e.target.checked })} style={{ width: "auto" }} />
              Tag der Arbeit (1. Mai) in Wochenansicht sperren
            </label>
          </Section>
        </div>
      </div>

      {/* Cloud: Neues Studio anlegen Modal */}
      {newStudioModal && (
        <Modal onClose={() => setNewStudioModal(null)} hideFooter>
          <h3 style={{ marginBottom: 6, fontFamily: "'Inter', sans-serif", fontSize: 22 }}>Weiteres Studio anlegen</h3>
          <p style={{ fontSize: 12, color: "var(--text4)", marginBottom: 18, lineHeight: 1.6 }}>
            Neues Studio auf derselben Cloud-Instanz. Sie werden Admin. Stammdaten (Rollen, Templates, Absenz-Typen) werden automatisch eingespielt.
          </p>
          <FormField label="STUDIO-NAME">
            <input
              type="text"
              value={newStudioModal.name}
              onChange={e => setNewStudioModal(m => ({ ...m!, name: e.target.value }))}
              placeholder="z.B. Studio Zürich-Nord"
              autoFocus
            />
          </FormField>
          {myStudios.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label style={{ display: "block", fontSize: 9, letterSpacing: "0.12em", color: "var(--text4)", marginBottom: 8, fontWeight: 500 }}>
                PERSONEN ÜBERNEHMEN VON
              </label>
              <p style={{ fontSize: 11, color: "var(--text4)", marginBottom: 10, lineHeight: 1.6 }}>
                Ausgewählte Studios teilen ihre Kontakte mit dem neuen Studio. Änderungen sind danach für alle verlinkten Studios sichtbar.
              </p>
              <div style={{ border: "1px solid var(--border3)", borderRadius: 8, padding: 4, maxHeight: 180, overflowY: "auto" }}>
                {myStudios.map(s => (
                  <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13, borderRadius: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f7f4f0"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <input
                      type="checkbox"
                      checked={newStudioModal.shareFrom.has(s.id)}
                      onChange={e => setNewStudioModal(m => {
                        const next = new Set(m!.shareFrom);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        return { ...m!, shareFrom: next };
                      })}
                      style={{ width: "auto" }}
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setNewStudioModal(null)}>Abbrechen</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!newStudioModal.name.trim()}
              onClick={async () => {
                const name = newStudioModal.name.trim();
                const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
                const slug = `${baseSlug || "studio"}-${Date.now().toString(36)}`;
                try {
                  const newId = await cloud.createStudio(name, slug, Array.from(newStudioModal.shareFrom));
                  sessionStorage.setItem("rapport_studio_id", newId);
                  window.location.reload();
                } catch (e) {
                  alert("Fehler beim Anlegen: " + (e as Error).message);
                }
              }}
            >
              Anlegen
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
