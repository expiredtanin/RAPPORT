// Hinweis auf ein Update der Server-App (Tauri-Updater, prüft alle 6 Std.). Installieren macht
// zuerst ein Backup der Datenbank, dann Download + Signaturprüfung + Neustart, mit Fortschritt.
import { useEffect, useState } from 'react'
import { runtime, api } from '../api.js'
import { Icon, Note } from './ui.jsx'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export default function AppUpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState('idle')          // idle|backup|download|install|done|error
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 })
  const [error, setError] = useState(null)
  const [failedAt, setFailedAt] = useState(null)

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

    let cur = 'backup'
    try {
      setStep('backup')
      await api.backupNow()

      cur = 'download'
      setStep('download')
      let totalBytes = 0
      let downloaded = 0
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data?.contentLength ?? 0
          setProgress({ downloaded: 0, total: totalBytes })
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0
          setProgress({ downloaded, total: totalBytes })
        } else if (event.event === 'Finished') {
          cur = 'install'
          setStep('install')
          setProgress({ downloaded: totalBytes, total: totalBytes })
        }
      })
      // Tauri restartet automatisch — sollten wir nie sehen
      setStep('done')
    } catch (e) {
      console.error('[update] failed:', e)
      setFailedAt(cur)
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
  const busy = step !== 'idle' && step !== 'error' && step !== 'done'
  const pct = progress.total > 0 ? Math.floor((progress.downloaded / progress.total) * 100) : 0
  const STEPS = [['backup', 'Backup der Datenbank'], ['download', 'Herunterladen und Signatur prüfen'], ['install', 'Installieren und neu starten']]

  return (
    <>
      <div className="banner">
        <Icon name="system_update" />
        <span style={{ flex: 1, minWidth: 0 }}>
          Neue Version der Server-App: <b>{update.version}</b>
          {update.body && <span className="muted"> · {update.body.split('\n')[0]}</span>}
        </span>
        <button className="btn btn-sm btn-primary" onClick={() => setShowModal(true)} disabled={busy}>Installieren …</button>
      </div>

      {showModal && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close() }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <div className="dialog-body">
              <h2>Server-App auf {update.version} aktualisieren</h2>
              {step === 'idle' && <>
                <ol>{STEPS.map(([k, l]) => <li key={k}>{l}</li>)}</ol>
                <p style={{ marginTop: 8 }}>Die Container laufen weiter — RAPPORT bleibt für alle erreichbar. Nur diese Verwaltung ist ein paar Sekunden weg.</p>
              </>}
              {step !== 'idle' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {STEPS.map(([k, l]) => {
                    const st = stepState(k, step, failedAt)
                    return (
                      <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: st === 'pending' ? 'var(--text4)' : 'var(--text)' }}>
                        <Icon name={{ pending: 'radio_button_unchecked', active: 'progress_activity', done: 'check_circle', error: 'cancel' }[st]} size={18}
                          style={{ color: st === 'done' ? 'var(--positive)' : st === 'error' ? 'var(--negative)' : st === 'active' ? 'var(--accent)' : 'var(--text5)' }} />
                        {l}
                      </div>
                    )
                  })}
                  {step === 'download' && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
                </div>
              )}
              {step === 'error' && <div style={{ marginTop: 14 }}><Note tone="neg" detail={error}>Das Update ist fehlgeschlagen. Die bisherige Version läuft weiter.</Note></div>}
              {step === 'done' && <div style={{ marginTop: 14 }}><Note tone="ok">Die App startet jetzt mit der neuen Version neu.</Note></div>}
            </div>
            <div className="dialog-foot">
              {step === 'idle' && <><button className="btn btn-quiet" onClick={close}>Abbrechen</button><button className="btn btn-primary" onClick={install}>Mit Backup installieren</button></>}
              {(step === 'error' || step === 'done') && <button className="btn" onClick={close}>Schliessen</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Zustand eines Schritts im Fortschritt; bei Fehler ist der fehlgeschlagene Schritt rot, frühere erledigt. */
function stepState(target, current, failedAt) {
  const order = ['idle', 'backup', 'download', 'install', 'done']
  const ti = order.indexOf(target)
  if (current === 'error') {
    const fi = order.indexOf(failedAt || 'backup')
    return ti < fi ? 'done' : ti === fi ? 'error' : 'pending'
  }
  const ci = order.indexOf(current)
  if (ci > ti) return 'done'
  if (ci === ti) return 'active'
  return 'pending'
}
