// Gemeinsame Bausteine der Server-App: Kopfband, Symbol, Bestätigungsdialog, Formatierung.
//
// Bestätigungen laufen über <ConfirmProvider>/useConfirm() statt window.confirm/alert/prompt —
// die sind in der Tauri-WebView (WKWebView) stumm, destruktive Aktionen liessen sich dort sonst
// nicht bestätigen. Gleiche Regel wie in der Haupt-App (CLAUDE.md).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/** Material-Symbol (Rounded, lokal über das Paket material-symbols). */
export function Icon({ name, size, style, className = '' }) {
  return <span className={`msr ${className}`} style={{ ...(size ? { fontSize: size } : {}), ...style }} aria-hidden="true">{name}</span>
}

/** Kopfband einer Seite wie in der Haupt-App: Titel, Untertitel, Aktionen rechts. */
export function PageHead({ title, sub, actions }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1>{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {sub && <div className="page-sub">{sub}</div>}
    </header>
  )
}

/** Meldung (Info, ok, warn, neg) mit optionalen Details. */
export function Note({ tone = '', icon, children, detail }) {
  const ic = icon || (tone === 'ok' ? 'check_circle' : tone === 'warn' ? 'warning' : tone === 'neg' ? 'error' : 'info')
  return (
    <div className={`note ${tone}`} role={tone === 'neg' ? 'alert' : undefined}>
      <Icon name={ic} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {children}
        {detail && <details style={{ marginTop: 6 }}><summary>Details</summary><pre>{detail}</pre></details>}
      </div>
    </div>
  )
}

const ConfirmCtx = createContext(null)

/**
 * Stellt `useConfirm()` bereit: `await confirm({ title, body, confirmLabel, danger, typeWord })`
 * liefert true/false. Mit `typeWord` muss das Wort eingetippt werden (z.B. für den Daten-Reset).
 * `info: true` zeigt nur einen OK-Knopf (Ersatz für alert).
 */
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef(null)
  const confirm = useCallback(opts => new Promise(resolve => {
    resolver.current = resolve
    setTyped('')
    setReq(opts)
  }), [])
  const close = ok => {
    resolver.current?.(ok)
    resolver.current = null
    setReq(null)
  }
  useEffect(() => {
    if (!req) return
    const onKey = e => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  const blocked = !!req?.typeWord && typed !== req.typeWord
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(false) }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="dialog-body">
              <h2 id="confirm-title">{req.title}</h2>
              <div>{req.body}</div>
              {req.typeWord && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label htmlFor="confirm-word">Zum Bestätigen <b>{req.typeWord}</b> eintippen</label>
                  <input id="confirm-word" className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus autoComplete="off" />
                </div>
              )}
            </div>
            <div className="dialog-foot">
              {!req.info && <button className="btn btn-quiet" onClick={() => close(false)}>Abbrechen</button>}
              <button className={`btn btn-primary${req.danger ? ' btn-danger' : ''}`} disabled={blocked} onClick={() => close(true)} autoFocus={!req.typeWord}>
                {req.confirmLabel || (req.info ? 'OK' : 'Bestätigen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}

/** Bestätigungsdialog aus dem nächsten <ConfirmProvider>. */
export function useConfirm() {
  return useContext(ConfirmCtx)
}

// ── Formatierung ─────────────────────────────────────────────────────────────

/** «1.4 GB», «820 MB» … */
export function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/** «20.11.2026, 14:05» */
export function fmtDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || '—'
  return d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** «14:05:12» */
export function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || ''
  return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** «vor 3 Std.», «vor 2 Tagen» */
export function fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 48) return `vor ${h} Std.`
  return `vor ${Math.floor(h / 24)} Tagen`
}

/** Zustand eines Dienstes auf Deutsch. */
export const STATE_LABEL = { running: 'läuft', starting: 'startet', stopping: 'stoppt', stopped: 'gestoppt', error: 'Fehler' }

/** Name eines Dienstes für Menschen (Compose-IDs → Klartext). */
export function serviceLabel(s) {
  if (s.id === 'pb') return 'Datenbank (PocketBase)'
  if (s.id === 'app') return 'RAPPORT im Browser'
  return s.display_name || s.id
}
