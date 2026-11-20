// Erste Hilfe: drei Stufen, wenn etwas klemmt — Diagnose sammeln, Container neu erstellen,
// Daten zurücksetzen (mit Sicherheits-Backup und eingetipptem Bestätigungswort).
import { useState } from 'react'
import { api } from '../api.js'
import { Icon, Note, PageHead, useConfirm } from './ui.jsx'

export default function FirstAidPanel() {
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const confirm = useConfirm()

  async function run(kind, fn, okText) {
    setBusy(kind); setMsg(null)
    try { const r = await fn(); setMsg({ tone: 'ok', text: okText(r), detail: r?.log }) }
    catch (e) { setMsg({ tone: 'neg', text: String(e) }) }
    finally { setBusy(null) }
  }

  async function recreate() {
    const ok = await confirm({
      title: 'Container neu erstellen?', confirmLabel: 'Neu erstellen',
      body: <><p>Die Container werden gestoppt und frisch erstellt. Die Daten bleiben erhalten.</p><p style={{ marginTop: 8 }}>RAPPORT ist dabei etwa 30 Sekunden nicht erreichbar.</p></>,
    })
    if (ok) run('recreate', api.firstaidRecreate, () => 'Container neu erstellt.')
  }

  async function reset() {
    const ok = await confirm({
      title: 'Alle Daten zurücksetzen?', danger: true, confirmLabel: 'Endgültig zurücksetzen', typeWord: 'LÖSCHEN',
      body: <>
        <p><b>Alle Inhalte in der Datenbank gehen verloren</b> — Projekte, Rechnungen, Benutzer.</p>
        <ol>
          <li>Vom jetzigen Stand wird automatisch ein Sicherheits-Backup gemacht.</li>
          <li>Die Datenbank wird gelöscht und leer neu aufgebaut.</li>
        </ol>
        <p style={{ marginTop: 8 }}>Nur als letzter Ausweg, wenn die Datenbank nicht mehr startet. Meist hilft vorher «Backup wiederherstellen».</p>
      </>,
    })
    if (ok) run('reset', api.firstaidResetData, r => `Daten zurückgesetzt. Sicherheits-Backup: ${r.safety_backup?.filename}`)
  }

  const steps = [
    { id: 'diagnose', icon: 'assignment', title: 'Diagnose sammeln', text: 'Schreibt Logs, Docker-Zustand, Ereignisse und die Konfiguration (ohne Passwörter) in eine Textdatei im Backup-Ordner — zum Mitschicken bei Problemen.', btn: 'Diagnose erstellen', onClick: () => run('diagnose', api.firstaidDiagnose, r => `Diagnose gespeichert: ${r.filename} (${Math.round((r.bytes || 0) / 1024)} KB)`) },
    { id: 'recreate', icon: 'restart_alt', title: 'Container neu erstellen', text: 'Wenn ein Dienst hängt oder nicht mehr reagiert. Die Daten bleiben erhalten.', btn: 'Neu erstellen', onClick: recreate },
    { id: 'reset', icon: 'delete_forever', title: 'Daten zurücksetzen', text: 'Letzter Ausweg bei kaputter Datenbank. Löscht alle Inhalte (mit Sicherheits-Backup davor).', btn: 'Zurücksetzen …', onClick: reset, danger: true },
  ]

  return (
    <>
      <PageHead title="Erste Hilfe" sub="Der Reihe nach versuchen: erst Diagnose, dann neu erstellen, zuletzt zurücksetzen." />
      {msg && <Note tone={msg.tone} detail={msg.detail}>{msg.text}</Note>}
      <section className="card">
        {steps.map((s, i) => (
          <div key={s.id} className="row" style={{ padding: '16px 0' }}>
            <span className="num" style={{ width: 24, color: 'var(--text4)', fontWeight: 600 }}>{i + 1}</span>
            <Icon name={s.icon} style={{ color: s.danger ? 'var(--negative)' : 'var(--text3)' }} />
            <div className="row-main"><div className="row-title">{s.title}</div><span className="meta" style={{ maxWidth: 560 }}>{s.text}</span></div>
            <button className={`btn${s.danger ? ' btn-danger' : ''}`} disabled={busy != null} onClick={s.onClick}>{busy === s.id ? 'Läuft …' : s.btn}</button>
          </div>
        ))}
      </section>
    </>
  )
}
