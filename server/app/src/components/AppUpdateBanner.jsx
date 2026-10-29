// Auto-Update-Banner. Pollt latest.json alle 6h.
// Bei Klick: Modal-Overlay mit Live-Fortschritt + sichtbare Errors.
import { useEffect, useState } from 'react'
import { runtime, api } from '../api.js'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export default function AppUpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState('idle')          // idle|backup|download|install|done|error
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (runtime !== 'tauri') return
    let alive = true
    let timer = null

    async function check() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const u = await check()
        if (alive) setUpdate(u)
      } catch (e) {
        if (alive) console.warn('updater check:', e)
      }
    }

    check()
    timer = setInterval(check, CHECK_INTERVAL_MS)
    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [])

  async function install() {
    if (!update) return
    setShowModal(true)
    setError(null)
    setProgress({ downloaded: 0, total: 0 })

    try {
      setStep('backup')
      console.log('[update] starting pre-backup')
      const backup = await api.backupNow()
      console.log('[update] backup ok:', backup)

      setStep('download')
      console.log('[update] starting download + install')
      let totalBytes = 0
      let downloaded = 0
      await update.downloadAndInstall((event) => {
        console.log('[update] event:', event.event, event.data ?? '')
        if (event.event === 'Started') {
          totalBytes = event.data?.contentLength ?? 0
          setProgress({ downloaded: 0, total: totalBytes })
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0
          setProgress({ downloaded, total: totalBytes })
        } else if (event.event === 'Finished') {
          setStep('install')
          setProgress({ downloaded: totalBytes, total: totalBytes })
        }
      })
      // Tauri restartet automatisch — sollten wir nie sehen
      setStep('done')
    } catch (e) {
      console.error('[update] failed:', e)
      setStep('error')
      setError(String(e?.message ?? e))
    }
  }

  function close() {
    if (step === 'idle' || step === 'error' || step === 'done') {
      setShowModal(false)
      setStep('idle')
      setError(null)
    }
  }

  if (!update) return null

  return (
    <>
      <div className="update-banner">
        <span className="material-symbols-outlined update-bell">system_update</span>
        <span className="update-text">
          Update verfuegbar: <strong>v{update.version}</strong>
          {update.body && <span className="muted"> · {update.body.split('\n')[0]}</span>}
        </span>
        <button onClick={() => setShowModal(true)} disabled={showModal && step !== 'idle' && step !== 'error'}>
          Backup + Installieren
        </button>
      </div>

      {showModal && (
        <div className="update-modal-backdrop" onClick={step === 'idle' ? close : undefined}>
          <div className="update-modal" onClick={e => e.stopPropagation()}>
            <h2>Update auf v{update.version}</h2>

            {step === 'idle' && (
              <>
                <p className="muted">Ablauf:</p>
                <ol className="update-steps">
                  <li>pg_dumpall Pre-Backup (~10 Sek)</li>
                  <li>Neue Binary herunterladen + Signatur pruefen (~10-30 Sek)</li>
                  <li>App-Restart mit neuer Version</li>
                </ol>
                <p className="muted">
                  Container laufen waehrend Restart weiter — keine Downtime auf der
                  Service-Seite. Admin-UI ist ~10s nicht verfuegbar.
                </p>
                <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                  <button onClick={close}>Abbrechen</button>
                  <button onClick={install} className="setup-primary">Backup + Installieren</button>
                </div>
              </>
            )}

            {step !== 'idle' && (
              <div className="update-progress">
                <Step name="Pre-Backup" state={stepState('backup', step)} />
                <Step name="Download" state={stepState('download', step)} extra={progressLabel(progress, step)} />
                <Step name="Installation" state={stepState('install', step)} />
              </div>
            )}

            {step === 'error' && (
              <>
                <p className="error-text" style={{ marginTop: 16 }}>
                  <strong>Fehler:</strong>
                </p>
                <pre className="update-error-pre">{error}</pre>
                <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
                  <button onClick={close}>Schliessen</button>
                </div>
              </>
            )}

            {step === 'done' && (
              <p className="success-text">App restartet jetzt mit der neuen Version ...</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function stepState(target, current) {
  const order = ['idle', 'backup', 'download', 'install', 'done', 'error']
  const ti = order.indexOf(target)
  const ci = order.indexOf(current)
  if (current === 'error' && ci > ti) return 'error'
  if (ci > ti) return 'done'
  if (ci === ti) return 'active'
  return 'pending'
}

function progressLabel(p, step) {
  if (step !== 'download') return ''
  if (p.total === 0) return 'startet ...'
  const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB'
  const pct = p.total > 0 ? Math.floor((p.downloaded / p.total) * 100) : 0
  return `${mb(p.downloaded)} / ${mb(p.total)}  (${pct}%)`
}

function Step({ name, state, extra }) {
  const icon = {
    pending: 'radio_button_unchecked',
    active: 'progress_activity',
    done: 'check_circle',
    error: 'cancel',
  }[state]
  return (
    <div className="update-step" data-state={state}>
      <span className="material-symbols-outlined update-step-icon">{icon}</span>
      <span className="update-step-name">{name}</span>
      {extra && <span className="update-step-extra muted">{extra}</span>}
    </div>
  )
}
