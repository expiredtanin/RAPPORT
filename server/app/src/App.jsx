import { useEffect, useState } from 'react'
import { api, runtime, openExternal } from './api.js'
import ServiceCard from './components/ServiceCard.jsx'
import LogViewer from './components/LogViewer.jsx'
import BackupPanel from './components/BackupPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import FirstAidPanel from './components/FirstAidPanel.jsx'
import AppUpdateBanner from './components/AppUpdateBanner.jsx'
import EventFeed from './components/EventFeed.jsx'
import SetupWizard from './components/SetupWizard.jsx'

// "pocketbase" nur im Tauri-Runtime: das Embed ist ein natives Child-Webview,
// das gibt es im Browser-WebUI-Modus (headless Mac Mini) nicht.
// Settings bewusst zuletzt in der Liste — soll ganz unten in der Sidebar stehen.
const TABS = ['status', 'logs', 'backup', 'firstaid', ...(runtime === 'tauri' ? ['pocketbase'] : []), 'settings']
const TAB_LABELS = {
  status: 'Status',
  logs: 'Logs',
  backup: 'Backup',
  firstaid: 'Rescue',
  settings: 'Einstellungen',
  pocketbase: 'PocketBase',
}
const TAB_ICONS = {
  status: 'dashboard',
  logs: 'description',
  backup: 'backup',
  firstaid: 'medical_services',
  settings: 'settings',
  pocketbase: 'storage',
}

export default function App() {
  const [tab, setTab] = useState('status')
  const [services, setServices] = useState([])
  const [stats, setStats] = useState({})  // service_id → ContainerStats
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [setupReady, setSetupReady] = useState(null) // null = pruefe, true = bereit, false = Wizard

  async function refresh() {
    try {
      setServices(await api.listServices())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  async function refreshStats() {
    try {
      const list = await api.listStats()
      const m = {}
      for (const s of list ?? []) m[s.service_id] = s
      setStats(m)
    } catch { /* leise — docker stats kann mal scheitern */ }
  }

  useEffect(() => {
    // Erst Setup-Status pruefen — wenn nicht ready, blockt der Wizard die UI.
    let cancelled = false
    async function checkSetup() {
      try {
        const s = await api.setupStatus()
        if (!cancelled) setSetupReady(s.ready)
      } catch { if (!cancelled) setSetupReady(false) }
    }
    checkSetup()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!setupReady) return
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [setupReady])

  useEffect(() => {
    if (!setupReady) return
    refreshStats()
    const t = setInterval(refreshStats, 5000)
    return () => clearInterval(t)
  }, [setupReady])

  // PocketBase-Embed nur zeigen wenn der Tab aktiv ist — sonst wuerde die
  // native Child-Webview permanent im Fenster liegen (auch hinter anderen Tabs).
  useEffect(() => {
    if (runtime !== 'tauri' || !setupReady) return
    if (tab === 'pocketbase') api.showPocketbaseEmbed().catch(e => setError(String(e)))
    else api.hidePocketbaseEmbed().catch(() => {})
  }, [tab, setupReady])

  async function startAll() {
    setBusy(true)
    try { await api.startAll() } catch (e) { setError(String(e)) }
    finally { setBusy(false); refresh() }
  }

  async function stopAll() {
    setBusy(true)
    try { await api.stopAll() } catch (e) { setError(String(e)) }
    finally { setBusy(false); refresh() }
  }

  async function restartAll() {
    setBusy(true)
    try { await api.restartAll() } catch (e) { setError(String(e)) }
    finally { setBusy(false); refresh() }
  }

  const allRunning = services.length > 0 && services.every(s => s.state === 'running')
  const anyRunning = services.some(s => s.state === 'running' || s.state === 'starting')
  const frontendService = services.find(s => s.id === 'app')
  const frontendUrl = frontendService?.state === 'running' ? `http://127.0.0.1:${frontendService.port}/` : null

  // Setup blockt das normale Dashboard bis Docker-Daemon erreichbar ist.
  if (setupReady === false) {
    return (
      <div className="app">
        <SetupWizard onReady={() => setSetupReady(true)} />
      </div>
    )
  }
  if (setupReady === null) {
    return <div className="app"><p className="muted" style={{ padding: 40 }}>Lade ...</p></div>
  }

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-wordmark">RAPPORT</div>
          <div className="sidebar-sub">SERVER</div>
        </div>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t}
              className={t === tab ? 'tab active' : 'tab'}
              onClick={() => setTab(t)}>
              <span className="material-symbols-outlined tab-icon">{TAB_ICONS[t]}</span>
              {TAB_LABELS[t] ?? t}
            </button>
          ))}
        </nav>
        {frontendUrl && (
          <button className="sidebar-footer-link" onClick={() => openExternal(frontendUrl)} title={frontendUrl}>
            <span className="material-symbols-outlined tab-icon">open_in_browser</span>
            Im Browser öffnen
          </button>
        )}
      </div>

      <div className="main">
        <div className="content-header">
          {tab !== 'pocketbase' && (
            <div className="actions">
              <button onClick={startAll} disabled={busy || allRunning}>Alle starten</button>
              <button onClick={restartAll} disabled={busy || !anyRunning} title="Alle Container neu starten">Alle neu starten</button>
              <button onClick={stopAll} disabled={busy || !anyRunning}>Alle stoppen</button>
            </div>
          )}
        </div>

        {tab !== 'pocketbase' && <AppUpdateBanner />}
        {error && <div className="error-banner">{error}</div>}

        {/* Fuer "pocketbase" bleibt der Content-Bereich leer — das native
            Child-Webview (siehe pb_embed.rs) liegt darueber und deckt ihn ab.
            Kein eigenes Padding hier, sonst passt die Positions-Berechnung
            in Rust (fixe 15px-Aussenabstaende) nicht mehr zum sichtbaren Rand. */}
        <main className={tab === 'pocketbase' ? 'content content-embed' : 'content'}>
          {tab === 'status' && (
            <>
              <div className="grid">
                {services.length === 0 && <p className="muted">Keine Services registriert.</p>}
                {services.map(s => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    stats={stats[s.id]}
                    onStart={() => api.startService(s.id).then(refresh)}
                    onStop={() => api.stopService(s.id).then(refresh)}
                    onRestart={() => api.restartService(s.id).then(refresh)}
                  />
                ))}
              </div>
              <EventFeed limit={8} />
            </>
          )}
          {tab === 'logs' && <LogViewer services={services} />}
          {tab === 'backup' && <BackupPanel />}
          {tab === 'firstaid' && <FirstAidPanel />}
          {tab === 'settings' && <SettingsPanel />}
        </main>
      </div>
    </div>
  )
}
