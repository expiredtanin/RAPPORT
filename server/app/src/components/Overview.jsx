// Übersicht: Zustand des Servers auf einen Blick — Dienste mit Auslastung, letztes Backup,
// Speicherplatz, Zugänge und die letzten Ereignisse. Daten: listServices/listStats (aus App),
// listBackups, diskUsage, listEvents.
import { useEffect, useState } from 'react'
import { api, openExternal, runtime } from '../api.js'
import { Icon, Note, PageHead, STATE_LABEL, fmtAge, fmtBytes, fmtTime, serviceLabel, useConfirm } from './ui.jsx'

const KIND_ICON = { info: 'radio_button_unchecked', warn: 'warning', error: 'error' }

/** Auslastung als runder Balken. */
function Meter({ label, pct, value }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <span className="meter-bar"><i className={pct > 80 ? 'hot' : ''} style={{ width: `${Math.max(2, Math.min(100, pct || 0))}%` }} /></span>
      <b className="num">{value}</b>
    </div>
  )
}

export default function Overview({ services, stats, busy, onAll, onService, setTab }) {
  const [backups, setBackups] = useState(null)
  const [disk, setDisk] = useState(null)
  const [events, setEvents] = useState([])
  const confirm = useConfirm()

  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const b = await api.listBackups(); if (alive) setBackups(b ?? []) } catch { if (alive) setBackups([]) }
      try { const d = await api.diskUsage(); if (alive) setDisk(d) } catch { /* leise */ }
    }
    load()
    const t = setInterval(load, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => { try { const e = await api.listEvents(); if (alive) setEvents(e ?? []) } catch { /* leise */ } }
    tick()
    const t = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const running = services.filter(s => s.state === 'running').length
  const errors = services.filter(s => s.state === 'error')
  const allUp = services.length > 0 && running === services.length
  const anyUp = services.some(s => s.state === 'running' || s.state === 'starting')
  const health = errors.length ? 'error' : allUp ? 'ok' : anyUp ? 'warn' : 'idle'
  const headline = errors.length ? `${errors.map(serviceLabel).join(', ')} mit Fehler`
    : allUp ? 'Alles läuft' : anyUp ? `${running} von ${services.length} Diensten laufen` : 'Server ist gestoppt'

  const last = backups?.[0]
  const lastAgeH = last ? (Date.now() - new Date(last.created_iso).getTime()) / 3600000 : null
  const usedPct = disk && disk.host_total_bytes > 0 ? (1 - disk.host_free_bytes / disk.host_total_bytes) * 100 : null

  const app = services.find(s => s.id === 'app')
  const pb = services.find(s => s.id === 'pb')
  const host = runtime === 'browser' ? window.location.hostname : '127.0.0.1'
  const appUrl = app ? `http://${host}:${app.port}/` : null
  const pbUrl = pb ? `http://${host}:${pb.port}/_/` : null

  async function stopAll() {
    const ok = await confirm({
      title: 'Server stoppen?',
      body: <p>RAPPORT ist danach für alle im Büro nicht mehr erreichbar, bis du wieder startest. Daten bleiben erhalten.</p>,
      confirmLabel: 'Stoppen', danger: true,
    })
    if (ok) onAll('stop')
  }

  return (
    <>
      <PageHead
        title="Übersicht"
        sub={<><span className="dot" data-state={health === 'idle' ? '' : health} />{headline}</>}
        actions={<>
          {!allUp && <button className="btn btn-primary" disabled={busy} onClick={() => onAll('start')}><Icon name="play_arrow" />{anyUp ? 'Alle starten' : 'Server starten'}</button>}
          {anyUp && <button className="btn" disabled={busy} onClick={() => onAll('restart')}><Icon name="restart_alt" />Neu starten</button>}
          {anyUp && <button className="btn btn-quiet" disabled={busy} onClick={stopAll}><Icon name="stop" />Stoppen</button>}
        </>}
      />

      <div className="figs">
        <div><small>Dienste</small><strong className={`num ${health === 'ok' ? 'ok' : health === 'error' ? 'neg' : health === 'warn' ? 'warn' : ''}`}>{running} / {services.length}</strong><em>{allUp ? 'alle laufen' : errors.length ? 'Fehler' : anyUp ? 'teilweise' : 'gestoppt'}</em></div>
        <div><small>Letztes Backup</small><strong className={lastAgeH == null ? 'warn' : lastAgeH > 48 ? 'warn' : ''}>{backups == null ? '…' : last ? fmtAge(last.created_iso) : 'noch keines'}</strong><em>{backups ? `${backups.length} gespeichert` : ''}</em></div>
        <div><small>Daten</small><strong className="num">{disk ? fmtBytes(disk.pb_data_bytes) : '…'}</strong><em>PocketBase</em></div>
        <div><small>Speicherplatz frei</small><strong className={`num ${usedPct >= 90 ? 'neg' : usedPct >= 80 ? 'warn' : ''}`}>{disk ? fmtBytes(disk.host_free_bytes) : '…'}</strong><em>{usedPct != null ? `${usedPct.toFixed(0)} % belegt` : ''}</em></div>
      </div>

      {usedPct >= 90 && <Note tone="neg">Die Festplatte ist zu über 90 % voll. Alte Backups prüfen, sonst können Datenbank und Backups fehlschlagen.</Note>}
      {lastAgeH != null && lastAgeH > 48 && <Note tone="warn">Das letzte Backup ist älter als zwei Tage. <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setTab('backup')}>Zum Backup</button></Note>}

      <div className="cols">
        <div className="stack">
          <section className="card">
            <div className="k">Dienste</div>
            {services.length === 0 && <div className="muted">Keine Dienste gefunden — ist der Compose-Ordner richtig gesetzt?</div>}
            {services.map(s => {
              const st = stats[s.id]
              const up = s.state === 'running' || s.state === 'starting'
              return (
                <div key={s.id} className="row">
                  <span className="mark" data-state={s.state} />
                  <div className="row-main">
                    <div className="row-title">{serviceLabel(s)}</div>
                    <span className="meta">{STATE_LABEL[s.state] || s.state} · Port <span className="num">{s.port}</span>{s.last_error ? ' · ' : ''}{s.last_error && <span style={{ color: 'var(--negative)' }}>{s.last_error.split('\n')[0].slice(0, 120)}</span>}</span>
                    {st && s.state === 'running' && (
                      <div style={{ marginTop: 8, display: 'grid', gap: 4, maxWidth: 360 }}>
                        <Meter label="CPU" pct={st.cpu_percent} value={`${st.cpu_percent.toFixed(1)} %`} />
                        <Meter label="RAM" pct={st.mem_percent} value={fmtBytes(st.mem_bytes)} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {up
                      ? <>
                          <button className="btn btn-sm btn-quiet" title="Neu starten" onClick={() => onService(s.id, 'restart')}><Icon name="restart_alt" size={17} /></button>
                          <button className="btn btn-sm btn-quiet" title="Stoppen" onClick={() => onService(s.id, 'stop')}><Icon name="stop" size={17} /></button>
                        </>
                      : <button className="btn btn-sm" onClick={() => onService(s.id, 'start')}><Icon name="play_arrow" size={17} />Starten</button>}
                    <button className="btn btn-sm btn-quiet" title="Logs" onClick={() => setTab('logs', s.id)}><Icon name="subject" size={17} /></button>
                  </div>
                </div>
              )
            })}
          </section>

          <section className="card">
            <div className="k">Zugänge</div>
            <div className="row">
              <Icon name="captive_portal" style={{ color: 'var(--text4)' }} />
              <div className="row-main"><div className="row-title">RAPPORT im Browser</div><span className="meta mono">{appUrl || '—'}</span></div>
              <button className="btn btn-sm" disabled={app?.state !== 'running'} onClick={() => openExternal(appUrl)}>Öffnen</button>
            </div>
            <div className="row">
              <Icon name="database" style={{ color: 'var(--text4)' }} />
              <div className="row-main"><div className="row-title">PocketBase-Verwaltung</div><span className="meta">Benutzer, Daten und Regeln direkt in der Datenbank · <span className="mono">{pbUrl || '—'}</span></span></div>
              {runtime === 'tauri'
                ? <button className="btn btn-sm" disabled={pb?.state !== 'running'} onClick={() => setTab('pocketbase')}>Öffnen</button>
                : <button className="btn btn-sm" disabled={pb?.state !== 'running'} onClick={() => openExternal(pbUrl)}>Öffnen</button>}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>Verbinden: in RAPPORT beim ersten Start «Server» wählen bzw. im Anmeldefenster die Server-Adresse eintragen — <span className="mono">http://{'<'}Name dieses Macs{'>'}.local:{pb?.port || 18090}</span>.</div>
          </section>
        </div>

        <section className="card">
          <div className="k">Aktivität <span>{events.length ? `${events.length} Ereignisse` : ''}</span></div>
          {events.length === 0 && <div className="muted">Noch keine Ereignisse.</div>}
          {events.slice(0, 14).map((e, i) => (
            <div key={`${e.ts_iso}-${i}`} className="row" style={{ alignItems: 'flex-start', padding: '9px 0' }}>
              <Icon name={KIND_ICON[e.kind] || 'radio_button_unchecked'} size={16} style={{ marginTop: 2, color: e.kind === 'error' ? 'var(--negative)' : e.kind === 'warn' ? 'var(--warning)' : 'var(--text5)' }} />
              <div className="row-main"><div style={{ fontSize: 13 }}>{e.message}</div><span className="meta num">{fmtTime(e.ts_iso)}</span></div>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
