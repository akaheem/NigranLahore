import { useState } from 'react'
import CityMap from './CityMap.jsx'
import { DISPATCH_CITATION, SORE_POINT_FACT } from '../data/calibration.js'
import { bandColor } from '../lib/risk.js'
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react'

export default function FieldOpsView({ risk, done, onComplete, onSwitch }) {
  const [selectedTask, setSelectedTask] = useState(null)

  const queue = risk.taskQueue
  const openTasks = queue.filter(t => !done[t.id])
  const topTask = openTasks[0]

  const complete = (id) => {
    onComplete(id)
    setSelectedTask(null)
  }

  const navigate = (t) => {
    window.open(`https://www.google.com/maps?q=${t.lat},${t.lng}`, '_blank', 'noopener')
  }

  const reasonFor = (t) => {
    const bits = []
    if (risk.rain6hMm == null) bits.push('No live rain forecast — priority driven by telemetry')
    else if (t.parts.urgency >= 60) bits.push(`${risk.rain6hMm.toFixed(1)}mm rain forecast in 6h — clear it before water arrives`)
    else bits.push('Dry window — safe to service now')
    bits.push(`${t.fillPct}% full`)
    if (t.lastServiceHrs >= 24) bits.push(`unserved ${t.lastServiceHrs}h`)
    bits.push(`${t.zoneName} population ${(t.population / 1000).toFixed(0)}k exposed`)
    return bits.join(' · ')
  }

  // Impact of clearing the top 3 OPEN tasks — real blockage volume + residents
  const top3 = openTasks.slice(0, 3)
  const blockageTons = top3.reduce((s, t) => s + (t.fillPct / 100) * t.capacityTons, 0).toFixed(1)
  const residents = top3.reduce((s, t) => s + t.population, 0).toLocaleString()

  return (
    <div className="editorial-container py-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="editorial-header-num text-xl">Field Ops — WASA / LWMC dispatch</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {openTasks.length} open tasks · priority re-ranks as the rain forecast updates {DISPATCH_CITATION}
          </p>
        </div>
        <button type="button" className="btn-lux btn-lux-outline" onClick={onSwitch}><span>← Citizen view</span></button>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6">
        {/* Queue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {queue.map((t, i) => {
            const isDone = done[t.id]
            const isTop = t.id === topTask?.id
            const rank = isDone ? null : String(1 + openTasks.indexOf(t)).padStart(2, '0')
            return (
              <div
                key={t.id}
                className="lux-card-glass fade-in-lux relative overflow-hidden"
                style={{
                  animationDelay: `${i * 0.05}s`,
                  padding: '1.1rem 1.3rem',
                  opacity: isDone ? 0.45 : 1,
                  borderColor: isTop ? 'var(--accent-gold)' : undefined,
                  cursor: isDone ? 'default' : 'pointer',
                }}
                onClick={() => !isDone && setSelectedTask(selectedTask === t.id ? null : t.id)}
              >
                {isTop && <div className="scan-line" aria-hidden="true" />}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {rank ? (
                      <span className="font-editorial text-3xl" style={{ color: bandColor(t.priority) }}>
                        {rank}
                      </span>
                    ) : (
                      <CheckCircle2 size={26} color="var(--risk-safe)" />
                    )}
                    <div>
                      <p className="font-accent text-sm uppercase tracking-[0.1em]" style={{ textDecoration: isDone ? 'line-through' : 'none' }}>
                        {t.name}
                      </p>
                      <p className="text-[0.72rem] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t.zoneName} · fill {t.fillPct}% · unserved {t.lastServiceHrs}h
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-editorial text-2xl" style={{ color: isDone ? 'var(--risk-safe)' : bandColor(t.priority) }}>
                      {t.priority}
                    </span>
                    {isDone && <CheckCircle2 size={16} color="var(--risk-safe)" style={{ display: 'block', marginLeft: 'auto', marginTop: 4 }} />}
                  </div>
                </div>

                {selectedTask === t.id && !isDone && (
                  <div className="fade-in-lux mt-3 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <p className="text-[0.8rem] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--accent-gold)' }}>Why now:</strong> {reasonFor(t)}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" className="btn-lux" style={{ padding: '0.5rem 1.1rem', fontSize: '0.7rem' }} onClick={(e) => { e.stopPropagation(); complete(t.id) }}>
                        <span>Mark serviced</span>
                      </button>
                      <button type="button" className="btn-lux btn-lux-outline" style={{ padding: '0.5rem 1.1rem', fontSize: '0.7rem' }} onClick={(e) => { e.stopPropagation(); navigate(t) }}>
                        <span>Navigate ↗</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Map + stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="lux-card-glass" style={{ padding: '1rem', minHeight: 380 }}>
            <CityMap zoneScores={risk.zoneScores} showDrains showCool={false} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="lux-card-glass" style={{ padding: '1rem' }}>
              <AlertTriangle size={16} color="var(--risk-high)" />
              <p className="font-editorial text-3xl mt-2">{queue.filter(t => !done[t.id] && t.priority >= 70).length}</p>
              <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Critical</p>
            </div>
            <div className="lux-card-glass" style={{ padding: '1rem' }}>
              <CheckCircle2 size={16} color="var(--risk-safe)" />
              <p className="font-editorial text-3xl mt-2">{openTasks.length === queue.length ? 0 : queue.length - openTasks.length}</p>
              <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Serviced</p>
            </div>
            <div className="lux-card-glass" style={{ padding: '1rem' }}>
              <Clock size={16} color="var(--accent-gold)" />
              <p className="font-editorial text-3xl mt-2">{risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(0)}` : '—'}<span className="text-sm">mm</span></p>
              <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Rain 6h</p>
            </div>
          </div>
          <div className="lux-card-glass" style={{ padding: '1.1rem 1.3rem' }}>
            <p className="font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>Completion impact</p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Servicing the top 3 open drains this window removes an estimated{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {blockageTons} tons
              </strong>{' '}
              of blockage volume ahead of the rain — protecting roughly{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {residents}
              </strong>{' '}
              residents from ponding at WASA-class sore points.
            </p>
            <p className="mt-2 text-[0.62rem]" style={{ color: 'var(--text-muted)' }}>{SORE_POINT_FACT}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
