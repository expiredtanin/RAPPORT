// Setup-Wizard: zeigt sich wenn Docker-Daemon nicht erreichbar ist.
// Bietet einen einzigen Install-Knopf der von GitHub/docker.com direkt
// nach ~/.rapport/bin/ herunterlaedt und Colima startet.
import { useEffect, useState } from 'react'
import { api } from '../api.js'

const ACTION_INFO = {
  none_ready: {
    title: 'Alles bereit',
    desc: 'Docker-Daemon laeuft.',
    button: null,
  },
  start_colima: {
    title: 'Colima starten',
    desc: 'Docker, Colima und Lima sind installiert — der Daemon ist nur aus. Ein Klick reicht.',
    button: 'Colima starten',
  },
  install_all: {
    title: 'Alles automatisch installieren',
    desc: 'Wir laden Docker-CLI, Colima und Lima direkt von docker.com und github.com nach ~/.rapport/bin/ herunter — keine externen Package-Manager, kein sudo. Dauert ca. 2-3 Minuten beim ersten Mal.',
    button: 'Installieren und starten',
  },
}

export default function SetupWizard({ onReady }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [log, setLog] = useState(null)

  async function check() {
    try {
      const s = await api.setupStatus()
      setStatus(s)
      if (s.ready) onReady?.()
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [])

  async function install() {
    setBusy(true); setError(null); setLog(null)
    try {
      const res = await api.setupInstall()
      setLog(res.log)
      await check()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div className="setup-wizard">
        <p className="muted">Pruefe Setup ...</p>
      </div>
    )
  }

  if (status.ready) return null

  const info = ACTION_INFO[status.recommended_action]

  return (
    <div className="setup-wizard">
      <h1>Willkommen bei RAPPORT Server</h1>
      <p className="muted">
        Bevor die Server-App den Rapport-Stack verwalten kann, brauchen wir einen
        laufenden Docker-Daemon auf diesem Mac.
      </p>

      <div className="setup-checks">
        <Check label="Docker-CLI" ok={status.docker_cli} />
        <Check label="Colima installiert" ok={status.colima_installed} />
        <Check label="Lima installiert" ok={status.limactl_installed} />
        <Check label="Daemon erreichbar" ok={status.daemon_running} />
      </div>

      <h2>{info.title}</h2>
      <p>{info.desc}</p>

      {error && <p className="error-text">{error}</p>}

      {info.button && (
        <button onClick={install} disabled={busy} className="setup-primary">
          {busy ? 'Laeuft ...' : info.button}
        </button>
      )}

      {busy && (
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Status live im Status-Tab unter "App-Events" (sobald das Dashboard kommt).
          Dauert je nach Internet-Speed paar Minuten.
        </p>
      )}

      {log && (
        <details className="setup-log">
          <summary>Install-Log anzeigen</summary>
          <pre>{log}</pre>
        </details>
      )}
    </div>
  )
}

function Check({ label, ok }) {
  const iconName = ok ? 'check_circle' : 'cancel'
  return (
    <div className="setup-check" data-ok={ok} data-optional="false">
      <span className="material-symbols-outlined setup-check-icon">{iconName}</span>
      <span>{label}</span>
    </div>
  )
}
