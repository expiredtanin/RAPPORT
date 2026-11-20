// Einrichtungs-Assistent: erscheint, solange kein Docker-Daemon erreichbar ist. Ein Knopf lädt
// Docker-CLI, Colima und Lima nach ~/.rapport/bin/ (ohne Homebrew, ohne sudo) bzw. startet Colima.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon, Note } from './ui.jsx'

const ACTION = {
  none_ready: { title: 'Alles bereit', text: 'Docker läuft.', button: null },
  start_colima: { title: 'Docker starten', text: 'Docker ist installiert, aber nicht gestartet. Ein Klick genügt.', button: 'Docker starten' },
  install_all: { title: 'Docker einrichten', text: 'RAPPORT Server lädt die nötigen Werkzeuge (Docker-CLI, Colima, Lima) direkt von docker.com und github.com nach ~/.rapport/bin/ — ohne Homebrew, ohne Administrator-Passwort. Beim ersten Mal etwa 2–3 Minuten.', button: 'Einrichten und starten' },
}

export default function SetupWizard({ onReady }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [log, setLog] = useState(null)

  async function check() {
    try { const s = await api.setupStatus(); setStatus(s); if (s.ready) onReady?.() }
    catch (e) { setError(String(e)) }
  }
  useEffect(() => {
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [])

  async function install() {
    setBusy(true); setError(null); setLog(null)
    try { const r = await api.setupInstall(); setLog(r?.log); await check() }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  if (!status) return <div className="setup"><p className="muted">Prüfe Docker …</p></div>
  if (status.ready) return null
  const a = ACTION[status.recommended_action] || ACTION.install_all

  return (
    <div className="setup">
      <div className="side-wordmark" style={{ color: 'var(--text)', marginBottom: 28 }}>RAPPORT</div>
      <h1>Server einrichten</h1>
      <p className="hint" style={{ fontSize: 14, marginBottom: 22 }}>RAPPORT Server betreibt Datenbank und Web-App in Containern. Dafür braucht es Docker auf diesem Mac.</p>
      <section className="card" style={{ marginBottom: 18 }}>
        {[['Docker-CLI', status.docker_cli], ['Colima', status.colima_installed], ['Lima', status.limactl_installed], ['Docker läuft', status.daemon_running]].map(([l, ok]) => (
          <div key={l} className="check" data-ok={!!ok}><Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} />{l}</div>
        ))}
      </section>
      <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 6 }}>{a.title}</h2>
      <p className="hint" style={{ fontSize: 13.5, marginBottom: 16 }}>{a.text}</p>
      {error && <Note tone="neg">{error}</Note>}
      {a.button && <button className="btn btn-primary" onClick={install} disabled={busy}><Icon name={busy ? 'progress_activity' : 'download'} />{busy ? 'Läuft …' : a.button}</button>}
      {busy && <p className="hint" style={{ marginTop: 12 }}>Je nach Internetverbindung einige Minuten. Das Fenster kann offen bleiben.</p>}
      {log && <details style={{ marginTop: 16 }}><summary>Protokoll anzeigen</summary><pre>{log}</pre></details>}
    </div>
  )
}
