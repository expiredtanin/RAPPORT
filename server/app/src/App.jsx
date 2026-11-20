// RAPPORT Server — Wurzel der Admin-Oberfläche (Tauri-WebView und Browser-WebUI teilen sie).
// Hält Dienste und Auslastung (Polling), Navigation und die Sammelaktionen; die Seiten liegen in
// components/. Ohne erreichbaren Docker-Daemon zeigt sie zuerst den Einrichtungs-Assistenten.
import { useEffect, useState } from 'react'
import { api, runtime, openExternal } from './api.js'
import { ConfirmProvider, Icon, Note } from './components/ui.jsx'
import Overview from './components/Overview.jsx'
import LogViewer from './components/LogViewer.jsx'
import BackupPanel from './components/BackupPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import FirstAidPanel from './components/FirstAidPanel.jsx'
import AppUpdateBanner from './components/AppUpdateBanner.jsx'
import SetupWizard from './components/SetupWizard.jsx'

// «pocketbase» nur in der Tauri-App: die Verwaltung ist dort ein natives Child-Webview (pb_embed.rs).
const NAV = [
  { id: 'status', label: 'Übersicht', icon: 'dashboard' },
  { id: 'backup', label: 'Backups & Updates', icon: 'backup' },
  { id: 'logs', label: 'Logs', icon: 'subject' },
  ...(runtime === 'tauri' ? [{ id: 'pocketbase', label: 'Datenbank', icon: 'database' }] : []),
  { id: 'firstaid', label: 'Erste Hilfe', icon: 'medical_services' },
]

export default function App() {
  return <ConfirmProvider><Shell /></ConfirmProvider>
}

function Shell() {
  const [tab, setTabState] = useState('status')
  const [logService, setLogService] = useState(null)
  const [services, setServices] = useState([])
  const [stats, setStats] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [setupReady, setSetupReady] = useState(null) // null = prüfe, true = bereit, false = Assistent

  const setTab = (t, service) => { setTabState(t); if (service) setLogService(service) }

  async function refresh() {
    try { setServices(await api.listServices() ?? []); setError(null) } catch (e) { setError(String(e)) }
  }
  async function refreshStats() {
    try {
      const m = {}
      for (const s of await api.listStats() ?? []) m[s.service_id] = s
      setStats(m)
    } catch { /* docker stats scheitert gelegentlich — leise */ }
  }

  useEffect(() => {
    let cancelled = false
    api.setupStatus().then(s => { if (!cancelled) setSetupReady(!!s?.ready) }).catch(() => { if (!cancelled) setSetupReady(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!setupReady) return
    refresh(); refreshStats()
    const a = setInterval(refresh, 2000)
    const b = setInterval(refreshStats, 5000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [setupReady])

  // Das native PocketBase-Webview nur zeigen, solange sein Reiter offen ist.
  useEffect(() => {
    if (runtime !== 'tauri' || !setupReady) return
    if (tab === 'pocketbase') api.showPocketbaseEmbed().catch(e => setError(String(e)))
    else api.hidePocketbaseEmbed().catch(() => {})
  }, [tab, setupReady])

  async function onAll(action) {
    setBusy(true)
    try { await (action === 'start' ? api.startAll() : action === 'stop' ? api.stopAll() : api.restartAll()) }
    catch (e) { setError(String(e)) }
    finally { setBusy(false); refresh() }
  }
  async function onService(id, action) {
    try { await (action === 'start' ? api.startService(id) : action === 'stop' ? api.stopService(id) : api.restartService(id)) }
    catch (e) { setError(String(e)) }
    finally { refresh() }
  }

  if (setupReady === false) return <div className="app"><main className="main"><div className="content"><SetupWizard onReady={() => setSetupReady(true)} /></div></main></div>
  if (setupReady === null) return <div className="app"><Sidebar tab={tab} setTab={setTab} services={[]} /><main className="main"><div className="content"><p className="muted" style={{ padding: 40 }}>Verbinde …</p></div></main></div>

  return (
    <div className="app">
      <Sidebar tab={tab} setTab={setTab} services={services} />
      <div className="main">
        {tab !== 'pocketbase' && <AppUpdateBanner />}
        {error && tab !== 'pocketbase' && <div style={{ margin: '16px 32px 0' }}><Note tone="neg">{error}</Note></div>}
        {/* «pocketbase»: Inhalt leer — das native Child-Webview liegt darüber (feste Ränder in pb_embed.rs). */}
        <main className={tab === 'pocketbase' ? 'content content-embed' : 'content'}>
          {tab === 'status' && <Overview services={services} stats={stats} busy={busy} onAll={onAll} onService={onService} setTab={setTab} />}
          {tab === 'logs' && <LogViewer services={services} initial={logService} />}
          {tab === 'backup' && <BackupPanel />}
          {tab === 'firstaid' && <FirstAidPanel />}
          {tab === 'settings' && <SettingsPanel />}
        </main>
      </div>
    </div>
  )
}

/** Seitenleiste wie in der Haupt-App: Schriftzug, Navigation, unten Zustand, App öffnen, Einstellungen. */
function Sidebar({ tab, setTab, services }) {
  const running = services.filter(s => s.state === 'running').length
  const err = services.some(s => s.state === 'error')
  const state = !services.length ? '' : err ? 'error' : running === services.length ? 'ok' : running ? 'warn' : ''
  const app = services.find(s => s.id === 'app')
  const host = runtime === 'browser' ? window.location.hostname : '127.0.0.1'
  const appUrl = app?.state === 'running' ? `http://${host}:${app.port}/` : null
  return (
    <aside className="sidebar">
      <div className="side-head">
        <div className="side-wordmark">RAPPORT</div>
        <div className="side-sub">Server</div>
      </div>
      <nav className="side-nav">
        {NAV.map(n => (
          <button key={n.id} className={`side-link${tab === n.id ? ' on' : ''}`} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
            <Icon name={n.icon} /><span>{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="side-health"><span className="dot" data-state={state} /><span>{!services.length ? 'keine Verbindung' : err ? 'Fehler' : running === services.length ? 'Server läuft' : running ? 'teilweise gestartet' : 'gestoppt'}</span></div>
        {appUrl && <button className="side-link" onClick={() => openExternal(appUrl)} title={appUrl}><Icon name="open_in_new" /><span>RAPPORT öffnen</span></button>}
        <button className={`side-link${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')}><Icon name="settings" /><span>Einstellungen</span></button>
      </div>
    </aside>
  )
}
