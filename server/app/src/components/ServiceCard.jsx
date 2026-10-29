const STATE_LABELS = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  error: 'Error',
}

function fmtMem(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function ServiceCard({ service, stats, onStart, onStop, onRestart }) {
  const { id, display_name, state, pid, port, last_error } = service
  const isRunning = state === 'running' || state === 'starting'
  const showStats = stats && state === 'running'

  return (
    <div className="card" data-state={state}>
      <div className="card-head">
        <span className="state-dot" data-state={state} />
        <h3 className="card-title">{display_name}</h3>
        <span className="port">:{port}</span>
      </div>

      <dl className="card-meta">
        <dt>Status</dt><dd>{STATE_LABELS[state] || state}</dd>
        {pid != null && (<><dt>PID</dt><dd>{pid}</dd></>)}
        <dt>ID</dt><dd className="mono">{id}</dd>
      </dl>

      {last_error && (
        <div className="card-error" title={last_error}>
          <pre>{last_error}</pre>
        </div>
      )}

      {showStats && (
        <div className="card-stats">
          <div className="stat-row">
            <span className="stat-label">CPU</span>
            <span className="stat-bar">
              <span
                className="stat-bar-fill"
                style={{ width: `${Math.min(100, stats.cpu_percent)}%` }}
                data-hot={stats.cpu_percent > 80}
              />
            </span>
            <span className="stat-value mono">{stats.cpu_percent.toFixed(1)}%</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">RAM</span>
            <span className="stat-bar">
              <span
                className="stat-bar-fill"
                style={{ width: `${Math.min(100, stats.mem_percent)}%` }}
                data-hot={stats.mem_percent > 80}
              />
            </span>
            <span className="stat-value mono">{fmtMem(stats.mem_bytes)}</span>
          </div>
        </div>
      )}

      <div className="card-actions">
        {!isRunning && <button onClick={onStart}>Starten</button>}
        {isRunning && (
          <>
            <button onClick={onRestart} title="Container neu starten">Neu starten</button>
            <button onClick={onStop}>Stoppen</button>
          </>
        )}
      </div>
    </div>
  )
}
