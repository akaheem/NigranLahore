import { useState } from 'react'
import CityMap from './CityMap.jsx'
import { DISPATCH_CITATION, SORE_POINT_FACT } from '../data/calibration.js'
import { CREWS, CREW_NOTE, crewLoads, suggestCrewFor } from '../data/crews.js'
import { bandColor } from '../lib/risk.js'
import { CheckCircle2, AlertTriangle, Clock, Users } from 'lucide-react'

export default function FieldOpsView({ risk, done, onComplete, onSwitch, servicedIds = [], selectedZone, onSelectZone, onSelectDrain, assignments = {}, onAssign }) {
  const [selectedTask, setSelectedTask] = useState(null)

  const queue = risk.taskQueue
  const openTasks = queue.filter(t => !done[t.id])
  const topTask = openTasks[0]

  // Per-crew load: only OPEN tasks count against a shift's capacity.
  const loads = crewLoads(openTasks.map(t => t.id), assignments)

  const complete = (id) => {
    onComplete(id)
    setSelectedTask(null)
    if (onSelectDrain) onSelectDrain(null)
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
          <p className="editorial-header-num text-2xl">Field Ops — prototype dispatch queue</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Decision-support queue for WASA/LWMC-style municipal teams · {openTasks.length} open tasks · rain urgency from the live Open-Meteo forecast · drain fill levels follow a time-driven refill model (D-1 fills in ~9 days, per the calibrated waste-load corridor) {DISPATCH_CITATION}
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
            const refillNote = isDone && t.servicedAt
              ? `serviced ${t.lastServiceHrs === 0 ? 'just now' : `${t.lastServiceHrs}h ago`} — refilling`
              : null
            const assignedCrew = assignments[t.id] ? CREWS.find(c => c.id === assignments[t.id]) : null
            const suggested = suggestCrewFor(t)
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
                {isTop && <div className="scan-line" aria-hidden="true" style={{ pointerEvents: 'none' }} />}
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
                        {t.zoneName} · fill {t.fillPct}% (live model){refillNote ?? ` · unserved ${t.lastServiceHrs}h`}
                        {assignedCrew && !isDone && <> · {assignedCrew.name}</>}
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

                    {/* Crew assignment — the step between "this drain matters"
                        and "someone is going". Suggested crew = nearest depot. */}
                    <div className="mt-3">
                      <label
                        className="font-accent text-[0.6rem] uppercase tracking-[0.15em]"
                        style={{ color: 'var(--text-muted)' }}
                        htmlFor={`crew-${t.id}`}
                      >
                        Assign crew
                      </label>
                      <select
                        id={`crew-${t.id}`}
                        value={assignments[t.id] ?? ''}
                        onChange={e => onAssign?.(t.id, e.target.value)}
                        className="mt-1 w-full font-accent text-[0.75rem]"
                        style={{
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-medium)',
                          borderRadius: 8,
                          padding: '0.45rem 0.7rem',
                          outline: 'none',
                        }}
                      >
                        <option value="">Unassigned</option>
                        {CREWS.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {loads[c.id]?.length ?? 0}/{c.capacityPerShift} · {c.depot}
                          </option>
                        ))}
                      </select>
                      {suggested && assignments[t.id] !== suggested.id && (
                        <p className="mt-1.5 text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
                          Suggested: {suggested.name} — nearest depot.{' '}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAssign?.(t.id, suggested.id) }}
                            className="font-accent uppercase tracking-[0.12em]"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-gold)', cursor: 'pointer', padding: 0 }}
                          >
                            Assign
                          </button>
                        </p>
                      )}
                      {assignedCrew && (
                        <p className="mt-1.5 text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
                          {assignedCrew.name} · {assignedCrew.shift} · depot {assignedCrew.depot}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button type="button" className="btn-lux" style={{ padding: '0.5rem 1.1rem', fontSize: '0.7rem' }} onClick={(e) => { e.stopPropagation(); complete(t.id) }}>
                        <span>Mark serviced (demo)</span>
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

          {/* Crew roster — who is being sent, and how loaded they already are */}
          <div className="lux-card-glass" style={{ padding: '1.1rem 1.3rem' }}>
            <div className="flex items-center gap-2 mb-3">
              <Users size={15} color="var(--accent-gold)" />
              <p className="font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>
                Crew roster — today's shift
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {CREWS.map(c => {
                const load = loads[c.id]?.length ?? 0
                const over = load > c.capacityPerShift
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.82rem]" style={{ color: 'var(--text-secondary)' }}>{c.name}</p>
                      <p className="text-[0.66rem]" style={{ color: 'var(--text-muted)' }}>
                        {c.depot} · {c.shift}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-editorial text-2xl"
                        style={{ color: over ? 'var(--risk-high)' : load > 0 ? 'var(--accent-gold)' : 'var(--text-muted)' }}
                      >
                        {load}<span className="text-sm">/{c.capacityPerShift}</span>
                      </p>
                      <p className="text-[0.6rem] uppercase tracking-[0.12em] font-accent" style={{ color: over ? 'var(--risk-high)' : 'var(--text-muted)' }}>
                        {over ? 'Over capacity' : 'tasks'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[0.62rem]" style={{ color: 'var(--text-muted)' }}>{CREW_NOTE}</p>
          </div>
        </div>

        {/* Map + stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="lux-card-glass" style={{ padding: '1rem', minHeight: 380 }}>
            <CityMap
              zoneScores={risk.zoneScores}
              showDrains
              showCool={false}
              selectedZone={selectedZone}
              onSelectZone={onSelectZone}
              servicedIds={servicedIds}
              selectedDrainId={selectedTask}
              onSelectDrain={(id) => setSelectedTask(cur => (cur === id ? null : id))}
            />
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
              Servicing the top 3 open drains this window would remove an estimated{' '}
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
