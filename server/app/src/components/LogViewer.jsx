// Logs: laufende Ausgabe eines Dienstes (docker compose logs, Ring-Buffer im Backend), mit Filter,
// Anhalten und Kopieren. Fehler- und Warnzeilen farbig.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { Icon, PageHead, serviceLabel } from './ui.jsx'

const lineTone = l => /\b(error|fatal|panic|failed)\b/i.test(l) ? 'err' : /\bwarn(ing)?\b/i.test(l) ? 'warn' : ''

export default function LogViewer({ services, initial }) {
  const [selected, setSelected] = useState(initial || services[0]?.id || '')
  const [lines, setLines] = useState([])
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  const stick = useRef(true)

  useEffect(() => { if (!selected && services.length) setSelected(services[0].id) }, [services, selected])

  useEffect(() => {
    if (!selected || paused) return
    let alive = true
    const tick = async () => { try { const d = await api.serviceLogs(selected); if (alive) setLines(d ?? []) } catch { /* leise */ } }
    tick()
    const t = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(t) }
  }, [selected, paused])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? lines.filter(l => l.toLowerCase().includes(f)) : lines
  }, [lines, filter])

  // Nur mitscrollen, wenn man unten ist — sonst springt die Ansicht beim Lesen weg.
  useEffect(() => { if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight }, [shown])

  async function copy() {
    try { await navigator.clipboard.writeText(shown.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* kein Clipboard */ }
  }

  return (
    <>
      <PageHead title="Logs" sub="Ausgabe der Dienste, die letzten 1000 Zeilen." />
      <section className="card log-card">
        <div className="log-bar">
          <div className="seg" role="tablist" aria-label="Dienst">
            {services.map(s => (
              <button key={s.id} role="tab" aria-selected={s.id === selected} className={s.id === selected ? 'on' : ''} onClick={() => setSelected(s.id)}>
                <span className="dot" data-state={s.state === 'running' ? 'ok' : s.state === 'error' ? 'error' : s.state === 'starting' ? 'warn' : ''} />{serviceLabel(s)}
              </button>
            ))}
          </div>
          <input className="input" style={{ flex: 1, minWidth: 140, maxWidth: 320, height: 30 }} placeholder="Filtern …" value={filter} onChange={e => setFilter(e.target.value)} />
          <span className="muted num" style={{ fontSize: 12 }}>{shown.length} Zeilen</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button className="btn btn-sm btn-quiet" onClick={() => setPaused(p => !p)} title={paused ? 'Weiter mitlesen' : 'Anhalten'}><Icon name={paused ? 'play_arrow' : 'pause'} size={17} />{paused ? 'Weiter' : 'Anhalten'}</button>
            <button className="btn btn-sm btn-quiet" onClick={copy}><Icon name={copied ? 'check' : 'content_copy'} size={17} />{copied ? 'Kopiert' : 'Kopieren'}</button>
          </div>
        </div>
        <div className="log-stream" ref={ref} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
          {shown.length === 0
            ? <span className="muted">{lines.length ? 'Keine Zeile passt zum Filter.' : 'Keine Ausgabe — der Dienst läuft vermutlich nicht.'}</span>
            : shown.map((l, i) => <div key={i} className={`log-line ${lineTone(l)}`}>{l}</div>)}
        </div>
      </section>
    </>
  )
}
