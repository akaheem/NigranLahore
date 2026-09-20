import { useState } from 'react'
import CityMap from './CityMap.jsx'
import FieldReportsPanel from './FieldReportsPanel.jsx'
import { DISPATCH_CITATION, SORE_POINT_FACT, SERVICE_POLICY, SERVICE_POLICY_NOTE } from '../data/calibration.js'
import { CREWS, CREW_NOTE, crewLoads, suggestCrewFor } from '../data/crews.js'
import { REAL_TIME, TIME_LAPSE } from '../data/telemetry.js'
import { bandColor, SERVICE_STATE_META } from '../lib/risk.js'
import { SYNC_LOCAL_ONLY, SYNC_PENDING, SYNC_SYNCED, SYNC_ERROR } from '../hooks/useServiceLog.js'
import { CheckCircle2, AlertTriangle, Clock, Users, Wrench, History } from 'lucide-react'

/**
 * Where the service history actually lives, said plainly. A count that is one
 * browser's private record is a different claim from one backed by a shared
 * database, and the screen must not blur the two.
 */
const SYNC_NOTE = {
  [SYNC_LOCAL_ONLY]: 'Service history is stored in this browser only — no shared log is configured.',
  // While the first request is in flight. It needs its own line rather than
  // falling through to the local-only text, which would assert that no shared
  // log is configured — false, and the exact opposite of what is happening.
  [SYNC_PENDING]: 'Connecting to the shared log…',
  [SYNC_SYNCED]: 'Service history is shared: every service recorded here is written to the shared log.',
  [SYNC_ERROR]: 'Shared log unreachable — services are being kept in this browser and will retry. Counts here may be behind.',
}

/**
 * Two clock modes, and only two. "Real time" is the model as it actually
 * runs — drain fill climbing at the calibrated real-world rates, which is
 * invisible over the length of a demo. "1 min = 1 day" is the same model on
 * a clock running 1440x faster, so D-1's calibrated 11%/day arrives in a
 * minute of watching. The rates are identical in both; only the clock moves.
 */
const CLOCK_MODES = [
  { id: 'real', rate: REAL_TIME, label: 'Real time' },
  { id: 'lapse', rate: TIME_LAPSE, label: '1 min = 1 day' },
]

export default function FieldOpsView({ risk, onComplete, onSwitch, servicedIds = [], selectedZone, onSelectZone, onSelectDrain, assignments = {}, onAssign, speed = REAL_TIME, onSetSpeed, serviceSync = SYNC_LOCAL_ONLY, board = null }) {
  const [selectedTask, setSelectedTask] = useState(null)

  const queue = risk.taskQueue
  // Openness is DERIVED from each drain's fill (see drainIsOpen), never a
  // stored flag — a serviced drain leaves this list on its own and returns to
  // it when it refills past the due threshold.
  const openTasks = queue.filter(t => t.open)
  const topTask = openTasks[0]
  const blockedCount = queue.filter(t => t.state === 'blocked').length

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
    bits.push(`${t.fillPct.toFixed(2)}% full`)
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
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="editorial-header-num text-2xl heading-split">Field Ops <em>— prototype dispatch queue</em></p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Decision-support queue for WASA/LWMC-style municipal teams · {openTasks.length} open tasks · rain urgency from the live Open-Meteo forecast · drain fill levels follow a time-driven refill model (D-1 fills in ~9 days, per the calibrated waste-load corridor) {DISPATCH_CITATION}
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
              Servicing clears a drain to ~{SERVICE_POLICY.clearedTo}% and starts the cycle again: it is work once it refills past{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{SERVICE_POLICY.dueAt}%</strong>, flagged at{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{SERVICE_POLICY.criticalAt}%</strong>, and at{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{SERVICE_POLICY.blockedAt}%</strong> it stops draining
              altogether and holds there until someone clears it.
            </p>
            <p className="text-micro mt-1" style={{ color: 'var(--text-muted)' }}>{SERVICE_POLICY_NOTE}</p>
            <p className="text-micro mt-1" style={{ color: 'var(--text-muted)' }}>{SYNC_NOTE[serviceSync] ?? SYNC_NOTE[SYNC_LOCAL_ONLY]}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Clock mode. The model is identical either way — this only picks
                how fast the clock feeding it runs. */}
            <div
              className="flex gap-1"
              role="group"
              aria-label="Simulation clock"
              style={{ background: 'var(--bg-tertiary)', borderRadius: 999, padding: '0.22rem' }}
            >
              {CLOCK_MODES.map(m => {
                const active = speed === m.rate
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSetSpeed?.(m.rate)}
                    aria-pressed={active}
                    className="text-sm font-medium"
                    style={{
                      background: active ? 'var(--accent-gold-light)' : 'transparent',
                      color: active ? 'var(--accent-gold-dark)' : 'var(--text-secondary)',
                      border: '1px solid transparent',
                      borderRadius: 999,
                      padding: '0.45rem 1rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'background .3s var(--transition-lux), color .3s var(--transition-lux)',
                    }}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
            <button type="button" className="btn-lux btn-lux-outline" onClick={onSwitch}><span>← Citizen view</span></button>
          </div>
        </div>

        {speed !== REAL_TIME && (
          <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--accent-gold-dark)' }}>Time-lapse on.</strong>{' '}
            The drain model is running on a clock {TIME_LAPSE}x faster than the wall clock, so one real
            minute is one simulated day. No rate has been changed — D-1 still fills at its calibrated
            11%/day, you are simply watching a day go by in a minute. Marking a drain serviced drops it
            back to ~5% and the refill plays out from there. The rain and air readings stay on the live
            Open-Meteo feed and are <em>not</em> accelerated, so treat the forecast as today&rsquo;s while the
            drains run ahead.
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6">
        {/* Queue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {queue.map((t, i) => {
            const isRefilling = !t.open
            const meta = SERVICE_STATE_META[t.state]
            const isTop = t.id === topTask?.id
            const rank = t.open ? String(1 + openTasks.indexOf(t)).padStart(2, '0') : null
            // A refilling drain is not work, but it is not finished either —
            // it is counting down to being work again, and the card says so.
            const refillNote = isRefilling
              ? t.lastServiceAt
                ? `cleared ${t.lastServiceHrs === 0 ? 'just now' : `${t.lastServiceHrs}h ago`} — reopens at ${SERVICE_POLICY.dueAt}%`
                : `reopens at ${SERVICE_POLICY.dueAt}%`
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
                  opacity: isRefilling ? 0.72 : 1,
                  borderColor: isTop ? 'var(--accent-gold)' : t.state === 'blocked' ? 'var(--risk-severe)' : undefined,
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedTask(selectedTask === t.id ? null : t.id)}
              >
                {isTop && <div className="scan-line" aria-hidden="true" style={{ pointerEvents: 'none' }} />}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {rank ? (
                      <span className="font-editorial text-3xl" style={{ color: bandColor(t.priority) }}>
                        {rank}
                      </span>
                    ) : t.state === 'blocked' ? (
                      <Wrench size={26} color="var(--risk-severe)" />
                    ) : (
                      <CheckCircle2 size={26} color="var(--risk-safe)" />
                    )}
                    <div>
                      <p className="font-accent text-sm uppercase tracking-label">
                        {t.name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t.zoneName} · fill {t.fillPct.toFixed(2)}% (simulated){refillNote ?? ` · unserved ${t.lastServiceHrs}h`}
                        {t.serviceCount > 0 && <> · serviced {t.serviceCount}×</>}
                        {assignedCrew && t.open && <> · {assignedCrew.name}</>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-editorial text-2xl" style={{ color: isRefilling ? 'var(--risk-safe)' : bandColor(t.priority) }}>
                      {t.priority}
                    </span>
                    <span
                      className="block label-micro mt-1"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>

                {selectedTask === t.id && (
                  <div className="fade-in-lux mt-3 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--accent-gold)' }}>{t.open ? 'Why now:' : 'Status:'}</strong>{' '}
                      {t.open ? reasonFor(t) : `${refillNote}. It becomes work again on its own — no one has to remember it.`}
                    </p>

                    {/* Service history — the record the shared log keeps. This is
                        what makes "serviced 4x" a fact rather than a claim. */}
                    {t.serviceEvents.length > 0 && (
                      <div className="mt-3">
                        <p
                          className="flex items-center gap-1.5 label-micro"
                        >
                          <History size={12} aria-hidden="true" />
                          Service history — {t.serviceCount} counted
                          {t.serviceEvents.length > t.serviceCount && `, ${t.serviceEvents.length - t.serviceCount} simulated`}
                        </p>
                        <ul className="mt-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {[...t.serviceEvents].reverse().slice(0, 4).map(e => (
                            <li key={e.id} className="text-micro leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              • {new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {e.crewId && ` · ${CREWS.find(c => c.id === e.crewId)?.name ?? e.crewId}`}
                              {Number.isFinite(e.fillAtService) && ` · cleared at ${e.fillAtService}%`}
                              {e.simulated && <em style={{ color: 'var(--accent-gold)' }}> · simulated clock, not counted</em>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Crew assignment — the step between "this drain matters"
                        and "someone is going". Suggested crew = nearest depot. */}
                    {t.open && (
                    <div className="mt-3">
                      <label
                        className="label-micro"
                        htmlFor={`crew-${t.id}`}
                      >
                        Assign crew
                      </label>
                      <select
                        id={`crew-${t.id}`}
                        value={assignments[t.id] ?? ''}
                        onChange={e => onAssign?.(t.id, e.target.value)}
                        className="field-lux mt-1"
                      >
                        <option value="">Unassigned</option>
                        {CREWS.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {loads[c.id]?.length ?? 0}/{c.capacityPerShift} · {c.depot}
                          </option>
                        ))}
                      </select>
                      {suggested && assignments[t.id] !== suggested.id && (
                        <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
                          Suggested: {suggested.name} — nearest depot.{' '}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAssign?.(t.id, suggested.id) }}
                            className="label-micro"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-gold)', cursor: 'pointer', padding: 0 }}
                          >
                            Assign
                          </button>
                        </p>
                      )}
                      {assignedCrew && (
                        <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
                          {assignedCrew.name} · {assignedCrew.shift} · depot {assignedCrew.depot}
                        </p>
                      )}
                    </div>
                    )}

                    <div className="flex gap-2 mt-3 items-center">
                      {t.open ? (
                        <button type="button" className="btn-lux btn-lux-sm" onClick={(e) => { e.stopPropagation(); complete(t.id) }}>
                          <span>Mark serviced (demo)</span>
                        </button>
                      ) : (
                        <span className="label-micro">
                          Cleared — refilling
                        </span>
                      )}
                      <button type="button" className="btn-lux btn-lux-outline btn-lux-sm" onClick={(e) => { e.stopPropagation(); navigate(t) }}>
                        <span>Navigate ↗</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Crew roster — who is being sent, and how loaded they already are */}
          <div className="lux-card-glass">
            <div className="flex items-center gap-2 mb-3">
              <Users size={15} color="var(--accent-gold)" />
              <p className="label-eyebrow" style={{ color: 'var(--accent-gold)' }}>
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
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{c.name}</p>
                      <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
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
                      <p className="text-micro uppercase font-accent" style={{ color: over ? 'var(--risk-high)' : 'var(--text-muted)' }}>
                        {over ? 'Over capacity' : 'tasks'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-micro" style={{ color: 'var(--text-muted)' }}>{CREW_NOTE}</p>
          </div>

          {/* What residents are saying, in the zones these drains sit in. Below
              the roster on purpose: it is context for the work, not the work.
              It reads the queue and never writes to it. */}
          <FieldReportsPanel
            complaints={board?.complaints ?? []}
            queue={queue}
            assignments={assignments}
            onSetStatus={board?.setStatus}
            loadPhotos={board?.loadPhotos}
            loadVideo={board?.loadVideo}
            apiConfigured={board?.apiConfigured ?? false}
          />
        </div>

        {/* Map + stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="lux-card-glass" style={{ minHeight: 380 }}>
            <CityMap
              zoneScores={risk.zoneScores}
              showDrains
              showCool={false}
              drainNodes={risk.drainNodes}
              selectedZone={selectedZone}
              onSelectZone={onSelectZone}
              servicedIds={servicedIds}
              selectedDrainId={selectedTask}
              onSelectDrain={(id) => setSelectedTask(cur => (cur === id ? null : id))}
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lux-card-glass">
              <AlertTriangle size={16} color="var(--risk-high)" />
              <p className="font-editorial text-3xl mt-2">{queue.filter(t => t.state === 'critical').length}</p>
              <p className="text-micro uppercase font-accent" style={{ color: 'var(--text-muted)' }}>Critical</p>
            </div>
            <div className="lux-card-glass">
              <Wrench size={16} color="var(--risk-severe)" />
              <p className="font-editorial text-3xl mt-2">{blockedCount}</p>
              <p className="text-micro uppercase font-accent" style={{ color: 'var(--text-muted)' }}>Blocked</p>
            </div>
            <div className="lux-card-glass">
              <CheckCircle2 size={16} color="var(--risk-safe)" />
              <p className="font-editorial text-3xl mt-2">{queue.length - openTasks.length}</p>
              <p className="text-micro uppercase font-accent" style={{ color: 'var(--text-muted)' }}>Refilling</p>
            </div>
            <div className="lux-card-glass">
              <Clock size={16} color="var(--accent-gold)" />
              <p className="font-editorial text-3xl mt-2">{risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(0)}` : '—'}<span className="text-sm">mm</span></p>
              <p className="text-micro uppercase font-accent" style={{ color: 'var(--text-muted)' }}>Rain 6h</p>
            </div>
          </div>
          <div className="lux-card-glass">
            <p className="label-eyebrow" style={{ color: 'var(--accent-gold)' }}>Completion impact</p>
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
            <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>{SORE_POINT_FACT}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
