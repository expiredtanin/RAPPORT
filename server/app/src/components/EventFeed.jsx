// Kompakter Event-Feed fuer den Status-Tab.
// Pollt alle 3s die letzten App-Events (Start, Backup, Updates, etc.).
// Default eingeklappt — zeigt nur den neuesten Event als Teaser im Header.
import { useEffect, useState } from 'react'
import { api } from '../api.js'

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('de-CH', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

const KIND_ICON = {
  info: 'circle',
  warn: 'warning',
  error: 'error',
}

export default function EventFeed({ limit = 8 }) {
  const [events, setEvents] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const list = await api.listEvents()
        if (alive) setEvents(list ?? [])
      } catch { /* leise */ }
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const latest = events[0]
  const visible = events.slice(0, limit)

  return (
    <div className="event-feed" data-open={open}>
      <button className="event-header" onClick={() => setOpen(o => !o)}>
        <span className="event-chevron">{open ? '▾' : '▸'}</span>
        <span className="event-header-title">App-Events ({events.length})</span>
        {!open && latest && (
          <span className="event-teaser">
            <span className="event-time">{fmtTime(latest.ts_iso)}</span>
            <span className="material-symbols-outlined event-icon" data-kind={latest.kind}>{KIND_ICON[latest.kind] ?? 'circle'}</span>
            <span className="event-msg">{latest.message}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="event-body">
          {visible.length === 0 ? (
            <span className="muted">Noch keine Events.</span>
          ) : visible.map((e, i) => (
            <div key={`${e.ts_iso}-${i}`} className="event-line" data-kind={e.kind}>
              <span className="event-time">{fmtTime(e.ts_iso)}</span>
              <span className="material-symbols-outlined event-icon" data-kind={e.kind}>{KIND_ICON[e.kind] ?? 'circle'}</span>
              <span className="event-msg">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
