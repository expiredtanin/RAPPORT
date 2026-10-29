import { useEffect, useState } from 'react'
import { api, runtime } from '../api.js'

const SECRET_KEYS = new Set(['PB_SUPERUSER_PASSWORD', 'ADMIN_UI_PASSWORD'])
const WEBUI_KEYS = ['ADMIN_UI_BIND', 'ADMIN_UI_PORT', 'ADMIN_UI_TLS', 'ADMIN_UI_PASSWORD']

export default function SettingsPanel() {
  const [config, setConfig] = useState({})
  const [reveal, setReveal] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  const [error, setError] = useState(null)
  const [restartHint, setRestartHint] = useState(false)
  const [autostartEnabled, setAutostartEnabled] = useState(null) // null = unbekannt/lade

  useEffect(() => {
    api.getConfig().then(setConfig).catch(e => setError(String(e)))
    if (runtime === 'tauri') {
      import('@tauri-apps/plugin-autostart')
        .then(m => m.isEnabled())
        .then(setAutostartEnabled)
        .catch(() => setAutostartEnabled(false))
    }
  }, [])

  async function toggleAutostart() {
    if (runtime !== 'tauri') return
    try {
      const mod = await import('@tauri-apps/plugin-autostart')
      if (autostartEnabled) {
        await mod.disable()
        setAutostartEnabled(false)
      } else {
        await mod.enable()
        setAutostartEnabled(true)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  async function saveKey(key, value) {
    setSavingKey(key); setError(null)
    try {
      await api.setConfigValue(key, value)
      if (WEBUI_KEYS.includes(key)) setRestartHint(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingKey(null)
    }
  }

  function toggleLan() {
    const next = config.ADMIN_UI_BIND === '0.0.0.0' ? '127.0.0.1' : '0.0.0.0'
    if (next === '0.0.0.0') {
      const ok = window.confirm(
        'Im LAN freigeben?\n\n' +
        'Damit ist die Admin-UI von allen Geraeten im Netzwerk unter ' +
        `https://<hostname>.local:${config.ADMIN_UI_PORT || 9090} erreichbar. ` +
        'Login bleibt mit User "admin" und dem Passwort aus dieser Settings-Seite geschuetzt. ' +
        'Trotzdem: nur in vertrauenswuerdigen Netzen einschalten.'
      )
      if (!ok) return
    }
    setConfig(c => ({ ...c, ADMIN_UI_BIND: next }))
    saveKey('ADMIN_UI_BIND', next)
  }

  const lanOn = config.ADMIN_UI_BIND === '0.0.0.0'
  const entries = Object.entries(config)

  return (
    <section className="panel">
      <h2>Einstellungen</h2>
      {error && <p className="error-text">{error}</p>}
      {restartHint && (
        <p className="success-text">
          Aenderung gespeichert. <strong>App neu starten</strong>, damit der WebUI-Server mit der neuen Konfiguration laeuft.
        </p>
      )}

      <h3>Auto-Start</h3>
      <p className="muted">
        Fuer headless Mac-Mini-Deployments: App startet beim Login automatisch
        (versteckt im Tray) und faehrt sofort alle Container hoch.
      </p>
      <div className="webui-grid">
        <div className="webui-row">
          <div>
            <div className="settings-key">App beim Login starten</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {runtime !== 'tauri'
                ? 'Nur im Tauri-App-Modus verfuegbar (Browser kann das nicht).'
                : autostartEnabled === null
                  ? 'Lade ...'
                  : autostartEnabled
                    ? `Aktiv: LaunchAgent unter ~/Library/LaunchAgents/`
                    : 'Aus: App startet nicht automatisch beim Login'}
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={!!autostartEnabled}
              disabled={runtime !== 'tauri' || autostartEnabled === null}
              onChange={toggleAutostart}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="webui-row">
          <div>
            <div className="settings-key">Container nach App-Start hochfahren</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Triggert <code>docker compose up -d</code> sobald die App geladen ist.
              Sinnvoll zusammen mit dem Login-Autostart.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.AUTO_START_CONTAINERS_ON_LAUNCH === 'true'}
              onChange={e => {
                const v = e.target.checked ? 'true' : 'false'
                setConfig(c => ({ ...c, AUTO_START_CONTAINERS_ON_LAUNCH: v }))
                saveKey('AUTO_START_CONTAINERS_ON_LAUNCH', v)
              }}
            />
            <span className="slider" />
          </label>
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Admin-WebUI</h3>
      <p className="muted">
        Browser-basierter Zugang zur gleichen Admin-Oberflaeche &mdash; nuetzlich
        wenn diese App auf einem Mac Mini ohne Bildschirm laeuft.
      </p>

      <div className="webui-grid">
        <div className="webui-row">
          <div>
            <div className="settings-key">Im LAN freigeben</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {lanOn
                ? `Aktiv: jeder im Netzwerk kann https://<hostname>.local:${config.ADMIN_UI_PORT || 9090} erreichen`
                : 'Aus: nur lokal auf diesem Mac (https://127.0.0.1:9090)'}
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={lanOn} onChange={toggleLan} />
            <span className="slider" />
          </label>
        </div>

        <div className="webui-row">
          <div>
            <div className="settings-key">Port</div>
            <div className="muted" style={{ fontSize: 12 }}>Default 9090</div>
          </div>
          <input
            type="number"
            value={config.ADMIN_UI_PORT || ''}
            onChange={e => setConfig(c => ({ ...c, ADMIN_UI_PORT: e.target.value }))}
            onBlur={e => saveKey('ADMIN_UI_PORT', e.target.value)}
            className="settings-input"
            style={{ width: 80, textAlign: 'right' }}
          />
        </div>

        <div className="webui-row">
          <div>
            <div className="settings-key">TLS / HTTPS</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Self-signed Cert. Browser warnt einmal, danach akzeptiert.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.ADMIN_UI_TLS !== 'false'}
              onChange={e => {
                const v = e.target.checked ? 'true' : 'false'
                setConfig(c => ({ ...c, ADMIN_UI_TLS: v }))
                saveKey('ADMIN_UI_TLS', v)
              }}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="webui-row">
          <div style={{ flex: 1 }}>
            <div className="settings-key">Passwort (User: admin)</div>
            <input
              type={reveal.ADMIN_UI_PASSWORD ? 'text' : 'password'}
              value={config.ADMIN_UI_PASSWORD || ''}
              onChange={e => setConfig(c => ({ ...c, ADMIN_UI_PASSWORD: e.target.value }))}
              onBlur={e => saveKey('ADMIN_UI_PASSWORD', e.target.value)}
              className="settings-input"
              style={{ fontFamily: "'DM Mono', ui-monospace, monospace", marginTop: 4 }}
            />
          </div>
          <button
            type="button"
            className="reveal-toggle"
            onClick={() => setReveal(r => ({ ...r, ADMIN_UI_PASSWORD: !r.ADMIN_UI_PASSWORD }))}
          >
            {reveal.ADMIN_UI_PASSWORD ? 'Verbergen' : 'Anzeigen'}
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Alle Werte (Rohzugriff)</h3>
      <p className="muted">
        Direkter Zugriff auf alle <code>config.env</code>-Eintraege. Aenderungen an
        DB-relevanten Werten erfordern Stop &amp; Start der Container.
      </p>
      <div className="settings-grid">
        {entries.map(([key, value]) => {
          const isSecret = SECRET_KEYS.has(key)
          const shown = !isSecret || reveal[key]
          return (
            <div key={key} className="settings-row">
              <label>
                <span className="settings-key">{key}</span>
                <input
                  type={shown ? 'text' : 'password'}
                  value={value}
                  onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                  onBlur={e => saveKey(key, e.target.value)}
                  className="settings-input"
                />
              </label>
              {isSecret && (
                <button type="button"
                  className="reveal-toggle"
                  onClick={() => setReveal(r => ({ ...r, [key]: !r[key] }))}>
                  {shown ? 'Verbergen' : 'Anzeigen'}
                </button>
              )}
              {savingKey === key && <span className="muted">speichert ...</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
