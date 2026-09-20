import { useMemo, useState } from 'react'
import { AlertTriangle, Users } from 'lucide-react'
import ComplaintCard from './ComplaintCard.jsx'
import { CREWS, CREW_NOTE, suggestCrewFor } from '../data/crews.js'
import { STATUS_CLAIM_NOTE } from '../data/complaints.js'

/** How many reports the panel shows before it stops. It is a sidebar, not a feed. */
const MAX_SHOWN = 5

/**
 * What residents are reporting in the zones this crew's drains sit in.
 *
 * ## Why this is a separate panel and not part of the queue
 *
 * The queue above is ordered by a scored model — rain, fill, population, the
 * calibrated refill corridor — and every number in it traces to a paper or a
 * live feed. A citizen complaint is the one signal in this product that nobody
 * has verified. Letting one of those reorder the queue, or move a priority, or
 * enter a risk score would quietly put an unverified claim inside a number that
 * claims to be derived. So it cannot: this panel reads the queue and never
 * writes to it, and it says so on its face rather than leaving a reader to
 * assume the adjacency means influence.
 *
 * What a crew does here is claim a report — "we have seen this", "we are on
 * it", "job done" — which is a statement attached to somebody's report, not a
 * work order. Claims are attributed to the prototype roster below and are
 * labelled as such wherever they appear.
 */
export default function FieldReportsPanel({
  complaints = [],
  queue = [],
  assignments = {},
  onSetStatus,
  loadPhotos,
  loadVideo,
  apiConfigured = false,
}) {
  const [crewId, setCrewId] = useState(CREWS[0].id)
  const crew = CREWS.find(c => c.id === crewId) ?? CREWS[0]

  /**
   * The zones this crew serves: those of the drains assigned to it, plus the
   * ones the model would send it — a drain nobody has assigned yet belongs to
   * the crew whose depot is nearest, which is the same rule the queue's
   * "Suggested" line uses. Without the second half the panel would sit empty
   * until someone worked through the queue, which is the wrong way round: the
   * whole point is to show a crew the reports near the work it is about to do.
   */
  const servedZoneIds = useMemo(() => {
    const ids = new Set()
    for (const task of queue) {
      const owner = assignments[task.id] ?? suggestCrewFor(task)?.id ?? null
      if (owner === crewId && task.zoneId) ids.add(task.zoneId)
    }
    return ids
  }, [queue, assignments, crewId])

  const reports = useMemo(() => complaints
    .filter(c => c.zoneId && servedZoneIds.has(c.zoneId) && c.status !== 'resolved')
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, MAX_SHOWN), [complaints, servedZoneIds])

  return (
    <div className="lux-card-glass">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={15} color="var(--accent-gold)" />
          <p className="label-eyebrow" style={{ color: 'var(--accent-gold)' }}>
            Citizen reports in your zones — {reports.length}
          </p>
        </div>
        <select
          aria-label="Claim these reports as"
          className="field-lux field-lux-sm"
          value={crewId}
          onChange={e => setCrewId(e.target.value)}
        >
          {CREWS.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle size={12} style={{ flex: 'none', marginTop: 2 }} />
        <span>
          Advisory only. A citizen report never reorders the queue above, changes a drain&rsquo;s
          priority, or enters a risk score — the queue is scored from rain, fill and population, and
          reports are none of those. Claiming one records what {crew.name} says about it.
        </span>
      </p>

      {reports.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Nothing reported in the zones {crew.name}&rsquo;s drains sit in, or everything there has
          already been closed. Reports filed by residents appear here as they arrive.
        </p>
      ) : (
        <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {reports.map(complaint => (
            <ComplaintCard
              key={complaint.clientId}
              complaint={complaint}
              // Deliberately NOT `isOwn`: a crew does not own a resident's
              // report, so it is offered the crew column of the transition
              // table and never the reporter's "it's fixed", and it is never
              // offered Remove.
              crew={crew}
              apiConfigured={apiConfigured}
              onSetStatus={onSetStatus}
              loadPhotos={loadPhotos}
              loadVideo={loadVideo}
            />
          ))}
        </div>
      )}

      <p className="mt-3 text-micro" style={{ color: 'var(--text-muted)' }}>{STATUS_CLAIM_NOTE}</p>
      <p className="mt-1 text-micro" style={{ color: 'var(--text-muted)' }}>{CREW_NOTE}</p>
    </div>
  )
}
