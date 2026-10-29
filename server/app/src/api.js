// API-Wrapper. In der Tauri-WebView: via IPC (`invoke`). Im Browser (HTTP-WebUI
// vom headless Mac Mini): via fetch — Basic-Auth-Cookie/Header verwaltet der
// Browser selbst nach der ersten Login-Prompt.

const inTauri = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window || '__TAURI__' in window
)

let invoke = null
let openUrl = null
if (inTauri) {
  const mod = await import('@tauri-apps/api/core')
  invoke = mod.invoke
  openUrl = (await import('@tauri-apps/plugin-opener')).openUrl
}

// Oeffnet eine URL im System-Standardbrowser — Tauri-Webviews tun das bei
// target="_blank" nicht von selbst, deshalb der Opener-Plugin-Umweg. Im
// Browser-WebUI-Modus reicht ein ganz normaler neuer Tab.
export function openExternal(url) {
  return inTauri ? openUrl(url) : window.open(url, '_blank')
}

async function fetchJson(path, opts = {}) {
  const method = (opts.method ?? 'GET').toUpperCase()
  const writing = method !== 'GET' && method !== 'HEAD'
  const resp = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      // CSRF: state-changing Requests muessen den Custom-Header tragen.
      // Cross-origin Forms koennen ihn nicht setzen, cross-origin fetch
      // triggert Preflight, der serverseitig nicht erlaubt ist.
      ...(writing ? { 'x-rapport-csrf': '1' } : {}),
      ...(opts.headers ?? {}),
    },
  })
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`)
  }
  const text = await resp.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

export const api = inTauri
  ? {
      listServices: () => invoke('list_services'),
      serviceStatus: (id) => invoke('service_status', { id }),
      serviceLogs: (id) => invoke('service_logs', { id }),
      startService: (id) => invoke('start_service', { id }),
      stopService: (id) => invoke('stop_service', { id }),
      restartService: (id) => invoke('restart_service', { id }),
      startAll: () => invoke('start_all'),
      stopAll: () => invoke('stop_all'),
      restartAll: () => invoke('restart_all'),
      getConfig: () => invoke('get_config'),
      setConfigValue: (key, value) => invoke('set_config_value', { key, value }),
      backupNow: () => invoke('backup_now'),
      listBackups: () => invoke('list_backups'),
      restoreBackup: (filename) => invoke('restore_backup', { filename }),
      checkContainerUpdates: () => invoke('check_container_updates'),
      applyContainerUpdates: () => invoke('apply_container_updates'),
      listEvents: () => invoke('list_events'),
      listStats: () => invoke('list_stats'),
      diskUsage: () => invoke('disk_usage'),
      firstaidRecreate: () => invoke('firstaid_recreate'),
      firstaidResetData: () => invoke('firstaid_reset_data'),
      firstaidDiagnose: () => invoke('firstaid_diagnose'),
      setupStatus: () => invoke('setup_status'),
      setupInstall: () => invoke('setup_install'),
      showPocketbaseEmbed: () => invoke('show_pocketbase_embed'),
      hidePocketbaseEmbed: () => invoke('hide_pocketbase_embed'),
    }
  : {
      listServices: () => fetchJson('/services'),
      serviceStatus: async (id) => {
        const list = await fetchJson('/services')
        return list.find(s => s.id === id) ?? null
      },
      serviceLogs: (id) => fetchJson(`/services/${id}/logs`),
      startService: (id) => fetchJson(`/services/${id}/start`, { method: 'POST' }),
      stopService: (id) => fetchJson(`/services/${id}/stop`, { method: 'POST' }),
      restartService: (id) => fetchJson(`/services/${id}/restart`, { method: 'POST' }),
      startAll: () => fetchJson('/services/start-all', { method: 'POST' }),
      stopAll: () => fetchJson('/services/stop-all', { method: 'POST' }),
      restartAll: () => fetchJson('/services/restart-all', { method: 'POST' }),
      getConfig: () => Promise.resolve({}),
      setConfigValue: () => Promise.resolve(null),
      backupNow: () => fetchJson('/backups/now', { method: 'POST' }),
      listBackups: () => fetchJson('/backups'),
      restoreBackup: (filename) => fetchJson(`/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' }),
      checkContainerUpdates: () => fetchJson('/container-updates/check', { method: 'POST' }),
      applyContainerUpdates: () => fetchJson('/container-updates/apply', { method: 'POST' }),
      listEvents: () => fetchJson('/events'),
      listStats: () => fetchJson('/stats'),
      diskUsage: () => fetchJson('/disk'),
      firstaidRecreate: () => fetchJson('/firstaid/recreate', { method: 'POST' }),
      firstaidResetData: () => fetchJson('/firstaid/reset-data', { method: 'POST' }),
      firstaidDiagnose: () => fetchJson('/firstaid/diagnose', { method: 'POST' }),
      setupStatus: () => fetchJson('/setup/status'),
      setupInstall: () => fetchJson('/setup/install', { method: 'POST' }),
    }

export const runtime = inTauri ? 'tauri' : 'browser'
