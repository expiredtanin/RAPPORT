// Backups & Updates: Sicherungen der PocketBase-Daten (automatisch und von Hand), Wiederherstellen,
// Speicherplatz und Container-Updates (immer mit Backup davor). Bestätigungen über useConfirm.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon, Note, PageHead, fmtAge, fmtBytes, fmtDateTime, useConfirm } from './ui.jsx'

export default function BackupPanel() {
  const [backups, setBackups] = useState(null)
  const [disk, setDisk] = useState(null)
  const [config, setConfig] = useState({})
  const [busy, setBusy] = useState(null) // 'backup' | 'restore' | 'check' | 'apply'
  const [msg, setMsg] = useState(null)   // { tone, text, detail }
  const [updates, setUpdates] = useState(null)
  const confirm = useConfirm()

  async function refresh() {
    try { setBackups(await api.listBackups() ?? []) } catch (e) { setMsg({ tone: 'neg', text: String(e) }); setBackups([]) }
    try { setDisk(await api.diskUsage()) } catch { /* leise */ }
  }
  useEffect(() => {
    refresh()
    api.getConfig().then(c => setConfig(c || {})).catch(() => {})
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [])

  async function runBackup() {
    setBusy('backup'); setMsg(null)
    try {
      const info = await api.backupNow()
      setMsg({ tone: 'ok', text: `Backup erstellt: ${info.filename} (${fmtBytes(info.bytes)})` })
      await refresh()
    } catch (e) { setMsg({ tone: 'neg', text: `Backup fehlgeschlagen: ${e}` }) }
    finally { setBusy(null) }
  }

  async function runRestore(b) {
    const ok = await confirm({
      title: 'Backup wiederherstellen?',
      danger: true, confirmLabel: 'Wiederherstellen',
      body: <>
        <p>Der aktuelle Datenstand wird durch das Backup vom <b>{fmtDateTime(b.created_iso)}</b> ersetzt.</p>
        <ol>
          <li>Vom jetzigen Stand wird zuerst automatisch ein Sicherheits-Backup gemacht.</li>
          <li>Der Server wird kurz gestoppt (RAPPORT ist für alle ca. eine Minute weg).</li>
          <li>Die Daten werden ersetzt, dann startet der Server wieder.</li>
        </ol>
        <p style={{ marginTop: 8 }}>Was seit dem Backup erfasst wurde, ist danach nur noch im Sicherheits-Backup.</p>
      </>,
    })
    if (!ok) return
    setBusy('restore'); setMsg(null)
    try {
      const res = await api.restoreBackup(b.filename)
      setMsg({ tone: 'ok', text: `Wiederhergestellt aus ${res.restored_from}. Sicherheits-Backup vom vorherigen Stand: ${res.safety_backup} — damit lässt sich der Schritt rückgängig machen.` })
      await refresh()
    } catch (e) { setMsg({ tone: 'neg', text: `Wiederherstellen fehlgeschlagen: ${e}` }) }
    finally { setBusy(null) }
  }

  async function checkUpdates() {
    setBusy('check'); setMsg(null)
    try { setUpdates(await api.checkContainerUpdates()) }
    catch (e) { setMsg({ tone: 'neg', text: `Update-Prüfung fehlgeschlagen: ${e}` }) }
    finally { setBusy(null) }
  }

  async function applyUpdates() {
    const n = updates?.updates?.length ?? 0
    const ok = await confirm({
      title: `${n} ${n === 1 ? 'Update' : 'Updates'} installieren?`,
      confirmLabel: 'Mit Backup installieren',
      body: <>
        <p>Zuerst wird ein Backup gemacht, dann werden die Container mit den neuen Images neu erstellt.</p>
        <p style={{ marginTop: 8 }}>RAPPORT ist dabei kurz nicht erreichbar.</p>
      </>,
    })
    if (!ok) return
    setBusy('apply'); setMsg(null)
    try {
      const res = await api.applyContainerUpdates()
      setUpdates(null)
      setMsg(res.updated_services?.length
        ? { tone: 'ok', text: `Aktualisiert: ${res.updated_services.join(', ')}${res.backup_filename ? ` · Backup ${res.backup_filename}` : ''}` }
        : { tone: '', text: 'Nichts aktualisiert.', detail: res.recreate_log })
      await refresh()
    } catch (e) { setMsg({ tone: 'neg', text: `Update fehlgeschlagen: ${e}` }) }
    finally { setBusy(null) }
  }

  const last = backups?.[0]
  const total = backups?.reduce((s, b) => s + (b.bytes || 0), 0) ?? 0
  const usedPct = disk && disk.host_total_bytes > 0 ? (1 - disk.host_free_bytes / disk.host_total_bytes) * 100 : null
  const auto = config.BACKUP_ENABLED !== 'false'
  const every = config.BACKUP_INTERVAL_HOURS || '24'
  const keep = config.BACKUP_RETENTION_COUNT || '7'

  return (
    <>
      <PageHead
        title="Backups & Updates"
        sub={Object.keys(config).length ? (auto ? `Automatisch alle ${every} Std., die letzten ${keep} werden behalten.` : 'Automatische Backups sind ausgeschaltet.') : 'Sicherungen der Datenbank und Updates der Container.'}
        actions={<>
          <button className="btn btn-primary" onClick={runBackup} disabled={!!busy}><Icon name="backup" />{busy === 'backup' ? 'Sichere …' : 'Backup jetzt'}</button>
        </>}
      />

      <div className="figs">
        <div><small>Letztes Backup</small><strong>{backups == null ? '…' : last ? fmtAge(last.created_iso) : 'noch keines'}</strong><em>{last ? fmtDateTime(last.created_iso) : ''}</em></div>
        <div><small>Gespeichert</small><strong className="num">{backups?.length ?? '…'}</strong><em>{fmtBytes(total)} zusammen</em></div>
        <div><small>Datenbank</small><strong className="num">{disk ? fmtBytes(disk.pb_data_bytes) : '…'}</strong><em>Docker-Volumes {disk ? fmtBytes(disk.docker_volumes_bytes) : '…'}</em></div>
        <div><small>Speicherplatz frei</small><strong className={`num ${usedPct >= 90 ? 'neg' : usedPct >= 80 ? 'warn' : ''}`}>{disk ? fmtBytes(disk.host_free_bytes) : '…'}</strong><em>{usedPct != null ? `${usedPct.toFixed(0)} % belegt` : ''}</em></div>
      </div>

      {msg && <Note tone={msg.tone} detail={msg.detail}>{msg.text}</Note>}
      {busy === 'restore' && <Note icon="hourglass_top">Wiederherstellen läuft — Server wird gestoppt, Daten ersetzt und neu gestartet …</Note>}

      <div className="cols">
        <section className="card card-table">
          <div className="k">Backups <span>{backups ? `${backups.length}` : ''}</span></div>
          {backups && backups.length === 0
            ? <div className="muted" style={{ padding: '4px 20px 20px' }}>Noch keine Backups. «Backup jetzt» erstellt das erste.</div>
            : (
              <table>
                <thead><tr><th>Erstellt</th><th>Alter</th><th style={{ textAlign: 'right' }}>Grösse</th><th /></tr></thead>
                <tbody>
                  {(backups || []).map(b => (
                    <tr key={b.filename} title={b.filename}>
                      <td className="num">{fmtDateTime(b.created_iso)}</td>
                      <td className="muted">{fmtAge(b.created_iso)}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{fmtBytes(b.bytes)}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-quiet" disabled={!!busy} onClick={() => runRestore(b)}><Icon name="settings_backup_restore" size={17} />Wiederherstellen</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="k">Container-Updates</div>
            <p className="hint" style={{ marginBottom: 12 }}>Prüft, ob neuere Images für Datenbank und Web-App bereitliegen. Installiert wird immer mit Backup davor.</p>
            {updates && updates.updates.length === 0 && <Note tone="ok">Alles aktuell.</Note>}
            {updates && updates.updates.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {updates.updates.map(u => (
                  <div key={u.service} className="row" style={{ padding: '8px 0' }}>
                    <Icon name="upgrade" style={{ color: 'var(--accent)' }} />
                    <div className="row-main"><div className="row-title">{u.service}</div><span className="meta mono">{u.image}</span></div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={checkUpdates} disabled={!!busy}><Icon name="refresh" />{busy === 'check' ? 'Prüfe …' : 'Nach Updates suchen'}</button>
              {updates?.updates?.length > 0 && <button className="btn btn-primary" onClick={applyUpdates} disabled={!!busy}>{busy === 'apply' ? 'Installiere …' : 'Installieren'}</button>}
            </div>
            {config.CONTAINER_AUTOUPDATE_ENABLED === 'true' && <p className="hint" style={{ marginTop: 10 }}>Automatische Updates sind eingeschaltet (alle {config.CONTAINER_AUTOUPDATE_INTERVAL_HOURS || 24} Std.).</p>}
          </section>
          <section className="card">
            <div className="k">So funktionieren Backups</div>
            <p className="hint">Gesichert werden alle PocketBase-Daten (Datenbank und Dateien) als Archiv auf diesem Mac. Damit die Datenbank konsistent ist, hält PocketBase dafür einige Sekunden an — darum laufen die automatischen Backups nachts{config.BACKUP_HOUR && config.BACKUP_HOUR !== '-1' ? ` (um ${config.BACKUP_HOUR} Uhr)` : ''}.</p>
            <p className="hint" style={{ marginTop: 8 }}>Für Ausfallsicherheit den Backup-Ordner zusätzlich extern sichern, z.B. mit Time Machine.</p>
            <p className="hint" style={{ marginTop: 8 }}>Ablage: <span className="mono">~/Library/Application Support/com.rapport.server-app/backups/</span></p>
          </section>
        </div>
      </div>
    </>
  )
}
