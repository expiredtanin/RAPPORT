// Einstellungen der Server-App, gruppiert: Start, Backups, Updates, Fernzugriff (Admin-WebUI),
// Datenbank-Zugang; darunter alle Werte aus config.env roh. Gespeichert wird beim Verlassen
// eines Feldes bzw. beim Umschalten (set_config_value).
import { useEffect, useState } from 'react'
import { api, runtime } from '../api.js'
import { Icon, Note, PageHead, useConfirm } from './ui.jsx'

const SECRET_KEYS = new Set(['PB_SUPERUSER_PASSWORD', 'ADMIN_UI_PASSWORD'])
const RESTART_KEYS = new Set(['ADMIN_UI_BIND', 'ADMIN_UI_PORT', 'ADMIN_UI_TLS', 'ADMIN_UI_PASSWORD'])

/** Zeile mit Titel, Erklärung und Bedienelement rechts. */
function Setting({ title, hint, children }) {
  return (
    <div className="setting">
      <div><div className="setting-title">{title}</div>{hint && <div className="hint">{hint}</div>}</div>
      {children}
    </div>
  )
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export default function SettingsPanel() {
  const [config, setConfig] = useState(null)
  const [reveal, setReveal] = useState({})
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState(null)
  const [restartHint, setRestartHint] = useState(false)
  const [autostart, setAutostart] = useState(null)
  const confirm = useConfirm()

  useEffect(() => {
    api.getConfig().then(c => setConfig(c || {})).catch(e => { setError(String(e)); setConfig({}) })
    if (runtime === 'tauri') {
      import('@tauri-apps/plugin-autostart').then(m => m.isEnabled()).then(setAutostart).catch(() => setAutostart(false))
    }
  }, [])

  async function save(key, value) {
    setSaving(key); setError(null)
    try {
      await api.setConfigValue(key, value)
      setSaved(key); setTimeout(() => setSaved(s => (s === key ? null : s)), 1500)
      if (RESTART_KEYS.has(key)) setRestartHint(true)
    } catch (e) { setError(`${key}: ${e}`) }
    finally { setSaving(null) }
  }
  const set = (key, value, persist = true) => { setConfig(c => ({ ...c, [key]: value })); if (persist) save(key, value) }
  const bool = (key, dflt = false) => (config?.[key] == null ? dflt : config[key] === 'true')

  async function toggleAutostart(on) {
    try {
      const m = await import('@tauri-apps/plugin-autostart')
      if (on) await m.enable(); else await m.disable()
      setAutostart(on)
    } catch (e) { setError(String(e)) }
  }

  async function toggleLan(on) {
    if (on) {
      const ok = await confirm({
        title: 'Im Netzwerk freigeben?', confirmLabel: 'Freigeben',
        body: <>
          <p>Diese Verwaltung ist dann von allen Geräten im Büronetz unter <span className="mono">https://{'<'}Name dieses Macs{'>'}.local:{config.ADMIN_UI_PORT || 9090}</span> erreichbar.</p>
          <p style={{ marginTop: 8 }}>Der Zugang bleibt mit Benutzer <b>admin</b> und dem Passwort unten geschützt. Nur in vertrauenswürdigen Netzen einschalten.</p>
        </>,
      })
      if (!ok) return
    }
    set('ADMIN_UI_BIND', on ? '0.0.0.0' : '127.0.0.1')
  }

  const text = (key, props = {}) => (
    <input className="input" value={config?.[key] ?? ''} onChange={e => set(key, e.target.value, false)} onBlur={e => save(key, e.target.value)} {...props} />
  )
  const secret = key => runtime !== 'tauri' ? <span className="hint">nur in der App auf dem Server-Mac</span> : (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input className="input mono" type={reveal[key] ? 'text' : 'password'} value={config?.[key] ?? ''} onChange={e => set(key, e.target.value, false)} onBlur={e => save(key, e.target.value)} style={{ width: 220 }} autoComplete="off" />
      <button className="btn btn-sm btn-quiet" onClick={() => setReveal(r => ({ ...r, [key]: !r[key] }))} title={reveal[key] ? 'Verbergen' : 'Anzeigen'}><Icon name={reveal[key] ? 'visibility_off' : 'visibility'} size={17} /></button>
    </div>
  )

  if (config == null) return <><PageHead title="Einstellungen" /><p className="muted">Lade …</p></>
  const empty = Object.keys(config).length === 0
  const lanOn = config.ADMIN_UI_BIND === '0.0.0.0'

  return (
    <>
      <PageHead title="Einstellungen" sub={saving ? `Speichere ${saving} …` : saved ? 'Gespeichert.' : 'Änderungen werden sofort gespeichert.'} />
      {error && <Note tone="neg">{error}</Note>}
      {restartHint && <Note tone="warn">Für Änderungen am Fernzugriff die Server-App einmal beenden (Menüleiste → Beenden) und neu öffnen.</Note>}
      {empty && <Note>Die Einstellungen lassen sich nur in der Server-App auf dem Server-Mac ändern.</Note>}
      {!empty && runtime !== 'tauri' && <Note>Im Browser lassen sich Passwörter nicht anzeigen oder ändern — dafür die Server-App auf dem Server-Mac öffnen.</Note>}

      {!empty && (
        <div className="cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <div className="stack">
            <section className="card">
              <div className="k">Start</div>
              <Setting title="Beim Anmelden starten" hint={runtime === 'tauri' ? 'Die Server-App startet mit dem Mac und läuft unsichtbar in der Menüleiste.' : 'Nur in der App auf dem Server-Mac.'}>
                <Switch label="Beim Anmelden starten" checked={autostart} disabled={runtime !== 'tauri' || autostart == null} onChange={toggleAutostart} />
              </Setting>
              <Setting title="Server beim App-Start hochfahren" hint="Startet Datenbank und Web-App, sobald die Server-App läuft.">
                <Switch label="Server beim App-Start hochfahren" checked={bool('AUTO_START_CONTAINERS_ON_LAUNCH')} onChange={v => set('AUTO_START_CONTAINERS_ON_LAUNCH', String(v))} />
              </Setting>
              <Setting title="Abgestürzte Dienste neu starten" hint={`Bis zu ${config.AUTO_RECOVERY_MAX_ATTEMPTS || 5} Versuche mit wachsender Pause.`}>
                <Switch label="Abgestürzte Dienste neu starten" checked={bool('AUTO_RECOVERY_ENABLED', true)} onChange={v => set('AUTO_RECOVERY_ENABLED', String(v))} />
              </Setting>
            </section>

            <section className="card">
              <div className="k">Backups</div>
              <Setting title="Automatische Backups" hint="Empfohlen. Zusätzlich den Backup-Ordner extern sichern (Time Machine).">
                <Switch label="Automatische Backups" checked={bool('BACKUP_ENABLED', true)} onChange={v => set('BACKUP_ENABLED', String(v))} />
              </Setting>
              <Setting title="Alle … Stunden">{text('BACKUP_INTERVAL_HOURS', { type: 'number', min: 1, style: { width: 90, textAlign: 'right' } })}</Setting>
              <Setting title="Uhrzeit" hint="Stunde für das tägliche Backup (0–23, −1 = ohne feste Zeit). Verpasste Backups werden nachgeholt.">{text('BACKUP_HOUR', { type: 'number', min: -1, max: 23, style: { width: 90, textAlign: 'right' } })}</Setting>
              <Setting title="Anzahl behalten" hint="Ältere werden automatisch gelöscht.">{text('BACKUP_RETENTION_COUNT', { type: 'number', min: 1, style: { width: 90, textAlign: 'right' } })}</Setting>
            </section>

            <section className="card">
              <div className="k">Updates</div>
              <Setting title="Container automatisch aktualisieren" hint="Installiert neue Images selbständig, immer mit Backup davor.">
                <Switch label="Container automatisch aktualisieren" checked={bool('CONTAINER_AUTOUPDATE_ENABLED')} onChange={v => set('CONTAINER_AUTOUPDATE_ENABLED', String(v))} />
              </Setting>
              {bool('CONTAINER_AUTOUPDATE_ENABLED') && <Setting title="Prüfen alle … Stunden">{text('CONTAINER_AUTOUPDATE_INTERVAL_HOURS', { type: 'number', min: 1, style: { width: 90, textAlign: 'right' } })}</Setting>}
            </section>
          </div>

          <div className="stack">
            <section className="card">
              <div className="k">Fernzugriff auf diese Verwaltung</div>
              <Setting title="Im Netzwerk freigeben" hint={lanOn ? `Erreichbar unter https://<Name dieses Macs>.local:${config.ADMIN_UI_PORT || 9090}` : `Nur auf diesem Mac: https://127.0.0.1:${config.ADMIN_UI_PORT || 9090}`}>
                <Switch label="Im Netzwerk freigeben" checked={lanOn} onChange={toggleLan} />
              </Setting>
              <Setting title="Port">{text('ADMIN_UI_PORT', { type: 'number', style: { width: 90, textAlign: 'right' } })}</Setting>
              <Setting title="HTTPS" hint="Eigenes Zertifikat: der Browser warnt beim ersten Besuch einmal.">
                <Switch label="HTTPS" checked={config.ADMIN_UI_TLS !== 'false'} onChange={v => set('ADMIN_UI_TLS', String(v))} />
              </Setting>
              <Setting title="Passwort" hint="Benutzer: admin">{secret('ADMIN_UI_PASSWORD')}</Setting>
            </section>

            <section className="card">
              <div className="k">Datenbank-Zugang (PocketBase)</div>
              <Setting title="Admin-E-Mail">{text('PB_SUPERUSER_EMAIL', { style: { width: 220 } })}</Setting>
              <Setting title="Admin-Passwort" hint="Für die PocketBase-Verwaltung.">{secret('PB_SUPERUSER_PASSWORD')}</Setting>
            </section>

            <section className="card">
              <details>
                <summary>Alle Werte (config.env)</summary>
                <p className="hint" style={{ margin: '8px 0' }}>Rohzugriff. Änderungen an Datenbank-Werten wirken erst nach Neustart der Container.</p>
                {Object.entries(config).sort(([a], [b]) => a.localeCompare(b)).map(([key]) => (
                  <div key={key} className="setting" style={{ padding: '8px 0' }}>
                    <div className="mono" style={{ fontSize: 12 }}>{key}</div>
                    {SECRET_KEYS.has(key) ? secret(key) : text(key, { style: { width: 240 } })}
                  </div>
                ))}
              </details>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
