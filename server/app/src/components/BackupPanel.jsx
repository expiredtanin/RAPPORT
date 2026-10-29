import { useEffect, useState } from 'react'
import { api } from '../api.js'

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDate(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('de-CH', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `vor ${Math.floor(ms / 60_000)} min`
  if (h < 48) return `vor ${h} h`
  return `vor ${Math.floor(h / 24)} Tagen`
}

export default function BackupPanel() {
  const [backups, setBackups] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [updateCheck, setUpdateCheck] = useState(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState(null)
  const [applyResult, setApplyResult] = useState(null)
  const [disk, setDisk] = useState(null)

  async function refresh() {
    try {
      const list = await api.listBackups()
      setBackups(list ?? [])
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    async function loadDisk() {
      try { setDisk(await api.diskUsage()) } catch { /* leise */ }
    }
    loadDisk()
    const t = setInterval(loadDisk, 60000)  // disk-Check teuer (psql + df), 1x/min reicht
    return () => clearInterval(t)
  }, [])

  async function runBackup() {
    setBusy(true); setError(null); setLastResult(null)
    try {
      const info = await api.backupNow()
      setLastResult(info)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function checkUpdates() {
    setUpdateBusy(true); setUpdateError(null); setApplyResult(null)
    try {
      const res = await api.checkContainerUpdates()
      setUpdateCheck(res)
    } catch (e) {
      setUpdateError(String(e))
    } finally {
      setUpdateBusy(false)
    }
  }

  async function runRestore(filename) {
    const ok = window.confirm(
      `Snapshot ${filename} wiederherstellen?\n\n` +
      'Achtung — DESTRUKTIV:\n' +
      '  1. Sicherheits-Backup vom aktuellen Stand wird automatisch erstellt\n' +
      '  2. Stack (pb, app) wird gestoppt\n' +
      '  3. Komplette PocketBase-Daten werden ueberschrieben mit dem Snapshot-Inhalt\n' +
      '  4. Stack wird wieder gestartet\n\n' +
      'Aktuelle Daten gehen verloren (sind aber im Safety-Backup gesichert).'
    )
    if (!ok) return
    setBusy(true); setError(null); setLastResult(null)
    try {
      const res = await api.restoreBackup(filename)
      setLastResult({
        filename: `Restore aus ${res.restored_from}`,
        bytes: 0,
      })
      // Auch das Safety-Backup im Banner anzeigen:
      setTimeout(() => {
        alert(
          `Restore fertig.\n\n` +
          `Safety-Backup vom alten Stand: ${res.safety_backup}\n\n` +
          `Falls etwas nicht stimmt: das Safety-Backup wiederherstellen ` +
          `bringt den Zustand vor dem Restore zurueck.`
        )
      }, 100)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function applyUpdates() {
    const count = updateCheck?.updates?.length ?? 0
    if (count > 0) {
      const ok = window.confirm(
        `${count} Container-Update(s) anwenden?\n\n` +
        'Ablauf:\n' +
        '  1. tar.gz-Backup von /pb/pb_data\n' +
        '  2. docker compose up -d (recreate)\n\n' +
        'Services sind waehrend Recreate kurz weg.'
      )
      if (!ok) return
    }
    setUpdateBusy(true); setUpdateError(null); setApplyResult(null)
    try {
      const res = await api.applyContainerUpdates()
      setApplyResult(res)
      setUpdateCheck(null)
      await refresh()
    } catch (e) {
      setUpdateError(String(e))
    } finally {
      setUpdateBusy(false)
    }
  }

  const usedPct = disk && disk.host_total_bytes > 0
    ? (1 - disk.host_free_bytes / disk.host_total_bytes) * 100
    : 0
  const diskWarn = usedPct >= 80
  const diskCrit = usedPct >= 90

  return (
    <section className="panel">
      <h2>Backup &amp; Restore</h2>

      {disk && (
        <div className="disk-panel" data-state={diskCrit ? 'crit' : diskWarn ? 'warn' : 'ok'}>
          <div className="disk-row">
            <span className="disk-label">Festplatte ({fmtBytes(disk.host_free_bytes)} frei von {fmtBytes(disk.host_total_bytes)})</span>
            <div className="disk-bar">
              <div className="disk-bar-fill" style={{ width: `${usedPct}%` }} data-state={diskCrit ? 'crit' : diskWarn ? 'warn' : 'ok'} />
            </div>
            <span className="disk-pct mono">{usedPct.toFixed(0)}%</span>
          </div>
          <div className="disk-meta">
            <span>PocketBase-Daten: <strong>{disk.pb_data_bytes != null ? fmtBytes(disk.pb_data_bytes) : '—'}</strong></span>
            <span>Backups: <strong>{fmtBytes(disk.backups_total_bytes)}</strong> ({disk.backup_count} Dateien)</span>
            <span>Docker-Volumes total: <strong>{disk.docker_volumes_bytes != null ? fmtBytes(disk.docker_volumes_bytes) : '—'}</strong></span>
          </div>
          {diskCrit && <p className="error-text"><span className="material-symbols-outlined icon-inline">error</span>Disk &gt; 90% voll — aelteste Backups manuell pruefen.</p>}
          {diskWarn && !diskCrit && <p style={{ color: 'var(--amber)' }}><span className="material-symbols-outlined icon-inline">warning</span>Disk &gt; 80% voll.</p>}
        </div>
      )}
      <p className="muted">
        Snapshots werden automatisch alle <code>BACKUP_INTERVAL_HOURS</code> (Default 24h) erstellt
        und nach <code>BACKUP_RETENTION_COUNT</code> (Default 7) aelteste-zuerst geprunet.
        Speicherort: <code>~/Library/Application&nbsp;Support/com.rapport.server-app/backups/</code>.
        Methode: tar.gz von <code>/pb/pb_data</code> via <code>docker compose exec pb</code>.
      </p>

      <div className="row">
        <button onClick={runBackup} disabled={busy}>
          {busy ? 'Backup laeuft ...' : 'Backup jetzt erstellen'}
        </button>
        <button onClick={refresh} disabled={busy} title="Liste neu laden">
          Aktualisieren
        </button>
      </div>

      {lastResult && (
        <p className="success-text">
          Neues Backup: <code>{lastResult.filename}</code> ({fmtBytes(lastResult.bytes)})
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      <h3 style={{ marginTop: 32 }}>Container-Updates</h3>
      <p className="muted">
        Prueft ob neuere Image-Tags fuer die Compose-Services verfuegbar sind.
        Anwenden macht erst Pre-Backup, dann <code>docker compose up -d</code> (recreate).
        Auto-Update kontrolliert via <code>CONTAINER_AUTOUPDATE_ENABLED</code>.
      </p>
      <div className="row">
        <button onClick={checkUpdates} disabled={updateBusy}>
          {updateBusy && !applyResult ? 'Pruefe ...' : 'Auf Updates pruefen'}
        </button>
        {updateCheck && updateCheck.updates.length > 0 && (
          <button onClick={applyUpdates} disabled={updateBusy}>
            {updateBusy ? 'Anwenden ...' : `${updateCheck.updates.length} Update(s) mit Backup anwenden`}
          </button>
        )}
      </div>
      {updateError && <p className="error-text">{updateError}</p>}
      {updateCheck && updateCheck.updates.length === 0 && (
        <p className="success-text">Alle Images sind aktuell.</p>
      )}
      {updateCheck && updateCheck.updates.length > 0 && (
        <ul className="muted" style={{ fontSize: 13 }}>
          {updateCheck.updates.map(u => (
            <li key={u.service}>
              <strong>{u.service}</strong> ({u.image})
              <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 11, marginLeft: 8 }}>
                {u.old_id.slice(0, 19)} → {u.new_id.slice(0, 19)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {applyResult && applyResult.updated_services.length > 0 && (
        <p className="success-text">
          Update angewendet: {applyResult.updated_services.join(', ')}
          {applyResult.backup_filename && (
            <> · Backup: <code>{applyResult.backup_filename}</code></>
          )}
        </p>
      )}
      {applyResult && applyResult.updated_services.length === 0 && (
        <p className="muted">{applyResult.recreate_log}</p>
      )}

      <h3 style={{ marginTop: 24 }}>Vorhandene Snapshots ({backups.length})</h3>
      {backups.length === 0 ? (
        <p className="muted">Noch keine Backups vorhanden.</p>
      ) : (
        <table className="backup-table">
          <thead>
            <tr>
              <th>Datei</th>
              <th>Erstellt</th>
              <th>Alter</th>
              <th style={{ textAlign: 'right' }}>Groesse</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map(b => (
              <tr key={b.filename}>
                <td className="mono">{b.filename}</td>
                <td>{fmtDate(b.created_iso)}</td>
                <td className="muted">{fmtAge(b.created_iso)}</td>
                <td style={{ textAlign: 'right' }}>{fmtBytes(b.bytes)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="reveal-toggle"
                    onClick={() => runRestore(b.filename)}
                    disabled={busy}
                    title="Diesen Snapshot wiederherstellen"
                  >
                    Wiederherstellen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
