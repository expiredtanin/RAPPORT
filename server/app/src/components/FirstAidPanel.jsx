// Erste-Hilfe-Aktionen — drei Eskalationsstufen.
import { useState } from 'react'
import { api } from '../api.js'

export default function FirstAidPanel() {
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function runRecreate() {
    if (!window.confirm(
      'Container neu erstellen?\n\n' +
      'Was passiert:\n' +
      '  • docker compose down\n' +
      '  • docker compose up -d --force-recreate\n\n' +
      'Volumes bleiben → PocketBase-Daten + Storage-Files sind safe.\n' +
      'Services sind ~30s nicht erreichbar.'
    )) return
    setBusy('recreate'); setError(null); setResult(null)
    try {
      const r = await api.firstaidRecreate()
      setResult({ kind: 'recreate', msg: 'Container neu erstellt.', detail: r.log })
    } catch (e) { setError(String(e)) }
    finally { setBusy(null) }
  }

  async function runReset() {
    const word = window.prompt(
      'Daten komplett zuruecksetzen?\n\n' +
      'DESTRUKTIV: alle PocketBase-Inhalte gehen verloren.\n' +
      'Was passiert:\n' +
      '  1. Safety-Backup vom aktuellen Stand (automatisch)\n' +
      '  2. docker compose down -v (Volumes weg!)\n' +
      '  3. docker compose up -d (frisches Schema)\n\n' +
      'Tippe LOESCHEN ein um zu bestaetigen:'
    )
    if (word !== 'LOESCHEN') {
      if (word !== null) alert('Abgebrochen — du musst exakt LOESCHEN tippen.')
      return
    }
    if (!window.confirm('Letzte Warnung: Alle Daten werden zurueckgesetzt. Wirklich?')) return
    setBusy('reset'); setError(null); setResult(null)
    try {
      const r = await api.firstaidResetData()
      setResult({
        kind: 'reset',
        msg: `Daten zurueckgesetzt. Safety-Backup: ${r.safety_backup.filename}`,
        detail: r.log,
      })
    } catch (e) { setError(String(e)) }
    finally { setBusy(null) }
  }

  async function runDiagnose() {
    setBusy('diagnose'); setError(null); setResult(null)
    try {
      const r = await api.firstaidDiagnose()
      setResult({
        kind: 'diagnose',
        msg: `Diagnose-Bundle geschrieben: ${r.filename} (${(r.bytes / 1024).toFixed(0)} KB)`,
        detail: 'Unter ~/Library/Application Support/com.rapport.server-app/backups/',
      })
    } catch (e) { setError(String(e)) }
    finally { setBusy(null) }
  }

  return (
    <section className="panel">
      <h2>Erste Hilfe</h2>
      <p className="muted">
        Drei Werkzeuge fuer Notfaelle. Reihenfolge der Eskalation: erst <em>Diagnose</em>,
        dann <em>Neu erstellen</em>, dann <em>Daten-Reset</em>.
      </p>

      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="success-text" style={{ background: 'rgba(91, 208, 122, 0.08)', padding: 10, borderRadius: 12, border: '1px solid var(--green)' }}>
          {result.msg}
          {result.detail && (
            <details style={{ marginTop: 6 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Details</summary>
              <pre style={{ fontSize: 11, marginTop: 6, maxHeight: 200, overflow: 'auto' }}>{result.detail}</pre>
            </details>
          )}
        </div>
      )}

      <div className="firstaid-card">
        <h3><span className="material-symbols-outlined icon-heading">assignment</span>Diagnose-Bundle</h3>
        <p className="muted">
          Sammelt Container-Logs, docker version, ps -a, App-Events und (redacted)
          Config in eine Text-Datei unter backups/. Kann als Bug-Report mitgeschickt werden.
        </p>
        <button onClick={runDiagnose} disabled={busy != null}>
          {busy === 'diagnose' ? 'Sammle ...' : 'Diagnose erstellen'}
        </button>
      </div>

      <div className="firstaid-card">
        <h3><span className="material-symbols-outlined icon-heading">restart_alt</span>Container neu erstellen</h3>
        <p className="muted">
          Hilfsmittel wenn Container in komischen Zustaenden haengen (stuck, Memory-Leak, etc.).
          <strong> Volumes bleiben</strong> — PocketBase-Daten sind safe. Ca. 30s Downtime.
        </p>
        <button onClick={runRecreate} disabled={busy != null}>
          {busy === 'recreate' ? 'Erzeuge neu ...' : 'Container neu erstellen'}
        </button>
      </div>

      <div className="firstaid-card firstaid-danger">
        <h3><span className="material-symbols-outlined icon-heading" style={{ color: 'var(--red)' }}>delete_forever</span>Daten komplett zuruecksetzen</h3>
        <p className="muted">
          Letzter Ausweg wenn die Datenbank vermurkst ist (Schema-Korruption, PocketBase
          startet nicht mehr). <strong>Alle Daten gehen verloren</strong> —
          es wird automatisch ein Safety-Backup gemacht, das ist aber nur ein Snapshot
          des aktuellen (kaputten?) Stands.
        </p>
        <button onClick={runReset} disabled={busy != null} className="danger">
          {busy === 'reset' ? 'Loesche + initialisiere ...' : 'Daten zuruecksetzen'}
        </button>
      </div>
    </section>
  )
}
