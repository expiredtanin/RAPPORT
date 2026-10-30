// Zwei reine Anzeige-Dialoge der App: «Changelog» (Versionshistorie, siehe changelog.ts) und
// «Über Rapport» (Lizenz, Technologien). Beide sind absichtlich fest hell/dunkel gestaltet
// (weisse Karte, dunkler Kopf) und halten keinen eigenen State ausser dem Versions-Tab.

import { CHANGELOGS, LATEST_VERSION, versionLabel } from "../changelog";

/** Changelog-Dialog. `version` wählt den angezeigten Eintrag; `onSelectVersion` wechselt den Tab, `onClose` merkt sich «gesehen». */
export function ChangelogModal({ version, onSelectVersion, onClose }: { version: string; onSelectVersion: (v: string) => void; onClose: () => void }) {
  const versions = Object.keys(CHANGELOGS);
  const current = CHANGELOGS[version] || CHANGELOGS[LATEST_VERSION];
  const changelogVersion = version;
  const setChangelogVersion = onSelectVersion;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--surface)", borderRadius: 10, width: "100%", maxWidth: 480, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ background: "#1a1a18", padding: "28px 32px 20px" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#b07848", marginBottom: 8, fontWeight: 600 }}>CHANGELOG</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 28, color: "#f0ede8", fontWeight: 400, lineHeight: 1.1 }}>{versionLabel(changelogVersion)}</div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            {versions.map(v => (
              <button key={v} onClick={() => setChangelogVersion(v)} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, border: "1px solid", borderColor: v === changelogVersion ? "#b07848" : "#3a3a30", background: v === changelogVersion ? "#b07848" : "transparent", color: v === changelogVersion ? "var(--text)" : "var(--text4)", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em" }}>
                {versionLabel(v)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "20px 32px 8px", maxHeight: 340, overflowY: "auto" }}>
          {current.items.map(([title, desc]) => (
            <div key={title} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 4, flexShrink: 0, background: "#b07848", borderRadius: 2, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 12, color: "var(--text4)", lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 32px 24px" }}>
          <button className="btn btn-primary" style={{ width: "100%", fontSize: 13 }} onClick={onClose}>
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}

/** «Über Rapport»-Dialog mit Lizenz (AGPL-3.0) und verwendeten Technologien. */
export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--surface)", borderRadius: 10, width: "100%", maxWidth: 480, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ background: "#1a1a18", padding: "28px 32px 24px" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#b07848", marginBottom: 8, fontWeight: 600 }}>ÜBER RAPPORT</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 28, color: "#f0ede8", fontWeight: 400, lineHeight: 1.1 }}>Rapport</div>
          <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 6, letterSpacing: "0.04em" }}>{versionLabel(LATEST_VERSION)} · Studio-Management für Architekturbüros</div>
        </div>
        <div style={{ padding: "20px 32px 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text4)", letterSpacing: "0.1em", marginBottom: 12 }}>LIZENZ</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 4, flexShrink: 0, background: "#b07848", borderRadius: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>GNU AGPL-3.0</div>
              <div style={{ fontSize: 12, color: "var(--text4)", lineHeight: 1.5 }}>Rapport ist freie Software. Der Quellcode darf eingesehen, verändert und weitergegeben werden — unter den Bedingungen der AGPL-3.0-Lizenz.</div>
              <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#b07848", textDecoration: "none", display: "inline-block", marginTop: 4 }}>www.gnu.org/licenses/agpl-3.0 ↗</a>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text4)", letterSpacing: "0.1em", marginBottom: 12, marginTop: 20 }}>TECHNOLOGIEN</div>
          {[
            ["React 19", "UI-Framework"],
            ["Vite", "Build-Tool"],
            ["Tauri", "Desktop-App-Rahmen"],
            ["Material Symbols", "Icons von Google"],
          ].map(([name, desc]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0ede8" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{name}</div>
              <div style={{ fontSize: 12, color: "var(--text5)" }}>{desc}</div>
            </div>
          ))}
          <div style={{ marginTop: 20, padding: "12px 14px", background: "#f7f5f2", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text4)", lineHeight: 1.6 }}>
              Entwickelt von <span style={{ color: "var(--text)", fontWeight: 600 }}>Karim Gabriele Varano</span><br />
              <a href="https://rapport.gabrielevarano.ch/" target="_blank" rel="noreferrer" style={{ color: "#b07848", textDecoration: "none" }}>rapport.gabrielevarano.ch ↗</a>
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 32px 24px" }}>
          <button className="btn btn-primary" style={{ width: "100%", fontSize: 13 }} onClick={onClose}>Schliessen</button>
        </div>
      </div>
    </div>
    </>
  );
}
