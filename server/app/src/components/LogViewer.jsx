import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

export default function LogViewer({ services }) {
  const [selected, setSelected] = useState(services[0]?.id ?? '')
  const [lines, setLines] = useState([])
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!selected && services.length > 0) {
      setSelected(services[0].id)
    }
  }, [services, selected])

  useEffect(() => {
    if (!selected) return
    let alive = true
    async function tick() {
      try {
        const data = await api.serviceLogs(selected)
        if (alive) setLines(data)
      } catch { /* ignore */ }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(t) }
  }, [selected])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div className="log-viewer">
      <aside className="log-sidebar">
        {services.map(s => (
          <button key={s.id}
            className={s.id === selected ? 'log-tab active' : 'log-tab'}
            onClick={() => setSelected(s.id)}>
            <span className="state-dot" data-state={s.state} />
            {s.display_name}
          </button>
        ))}
      </aside>
      <pre ref={scrollRef} className="log-stream">
        {lines.length === 0
          ? <span className="muted">Keine Log-Zeilen (Service vermutlich nicht gestartet).</span>
          : lines.join('\n')}
      </pre>
    </div>
  )
}
