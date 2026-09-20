import { useMemo, useState } from 'react'
import CityMap from './CityMap.jsx'
import BandMeter from './BandMeter.jsx'
import { RainTimeline, AqiSparkline } from './Timeline24h.jsx'
import { ZONES, DRAIN_NODES, COOL_ASSETS } from '../data/lahore.js'
import { WASTE, AIR_RECORD_FACT } from '../data/calibration.js'
import { UNVERIFIED_LABEL } from '../data/complaints.js'
import { bandColor } from '../lib/risk.js'

const hazards = [
  { id: 'flood', label: 'Flood' },
  { id: 'air', label: 'Air' },
  { id: 'heat', label: 'Heat' },
]

const SORT_LABEL = { name: 'zone', risk: 'risk', population: 'residents' }

/**
 * A sortable column heading. `aria-sort` goes on the `<th>`, which is where the
 * spec puts it — so the button keeps its plain visible text as its accessible
 * name rather than having one rewritten by an `aria-label`, and the arrow stays
 * out of the name entirely.
 */
function SortHeader({ id, align = 'left', sort, onSort, children }) {
  const isActive = sort.key === id
  return (
    <th
      scope="col"
      aria-sort={isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'text-right' : undefined}
    >
      <button
        type="button"
        className="zone-table__sort"
        data-active={isActive ? '' : undefined}
        onClick={() => onSort(id)}
      >
        {children}
        <span aria-hidden="true">{isActive ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

/**
 * City Overview — the operator's all-hazard summary: layer-toggled map,
 * city impact counters, 24h rain/AQI outlook, and a zone drill-down table
 * that jumps into the Citizen view.
 */
export default function CityOverviewView({ risk, onOpenZone, onNavigate, servicedIds = [], selectedZone, onSelectZone, complaintCounts = {}, complaints = [] }) {
  const [hazard, setHazard] = useState('flood')
  const [showCool, setShowCool] = useState(true)
  const [showDrains, setShowDrains] = useState(true)
  const [showComplaints, setShowComplaints] = useState(false)
  // Highest risk first: an operator opening this screen wants the problem, not
  // the alphabetical list.
  const [sort, setSort] = useState({ key: 'risk', dir: 'desc' })

  const toggleSort = key => setSort(s => (
    s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      // A new column starts on whichever end is the interesting one: A→Z for
      // names, biggest-first for the two numeric columns.
      : { key, dir: key === 'name' ? 'asc' : 'desc' }
  ))

  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return ZONES
      .map(zone => ({
        zone,
        score: risk.zoneScores[zone.id]?.score ?? 0,
        drains: DRAIN_NODES.filter(n => n.zone === zone.id).length,
      }))
      .sort((a, b) => {
        if (sort.key === 'name') return a.zone.name.localeCompare(b.zone.name) * dir
        if (sort.key === 'population') return (a.zone.population - b.zone.population) * dir
        return (a.score - b.score) * dir
      })
  }, [risk.zoneScores, sort])

  const zonesHigh = Object.values(risk.zoneScores).filter(s => (s?.score ?? 0) >= 50).length
  // Lifecycle state, not a priority cut-off: a blocked drain is one that has
  // stopped draining, which is the thing an operator needs counted.
  const blockedDrains = risk.taskQueue.filter(t => t.state === 'blocked').length
  const openDrains = risk.taskQueue.filter(t => t.open).length
  const reliefCapacity = COOL_ASSETS.reduce((s, c) => s + c.capacity, 0)

  return (
    <div className="editorial-container py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="editorial-header-num text-2xl heading-split">City Overview <em>— Lahore, today</em></p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {zonesHigh} of 8 zones at high risk · {openDrains} drains open, {blockedDrains} blocked ·{' '}
            {risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(1)} mm` : '—'} rain in 6h
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-lux btn-lux-outline" onClick={() => onNavigate('citizen')}><span>← Citizen</span></button>
          <button type="button" className="btn-lux btn-lux-outline" onClick={() => onNavigate('ops')}><span>Field Ops →</span></button>
        </div>
      </div>

      {/* Impact counters — the reference's stat strip: one grey band, evenly
          split, hairline dividers, big number over a tracked caption. The
          relief figure is the emerald one, as the reference greens its own
          positive stats. */}
      <div className="stat-strip mb-8" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div>
          <p className="font-editorial text-4xl" style={{ color: 'var(--text-primary)' }}>
            {zonesHigh}<span className="text-base" style={{ color: 'var(--text-muted)' }}> / 8</span>
          </p>
          <p className="label-micro mt-1">Zones ≥ High</p>
        </div>
        <div>
          <p className="font-editorial text-4xl" style={{ color: 'var(--text-primary)' }}>
            {risk.rain6hMm != null ? risk.rain6hMm.toFixed(1) : '—'}<span className="text-base" style={{ color: 'var(--text-muted)' }}> mm</span>
          </p>
          <p className="label-micro mt-1">Rain 6h</p>
        </div>
        <div>
          <p className="font-editorial text-4xl" style={{ color: 'var(--text-primary)' }}>{blockedDrains}</p>
          <p className="label-micro mt-1">Blocked drains</p>
        </div>
        <div>
          <p className="font-editorial text-4xl" style={{ color: 'var(--accent-gold-dark)' }}>{reliefCapacity.toLocaleString()}</p>
          <p className="label-micro mt-1">Relief capacity / day</p>
        </div>
      </div>

      {/* Map card with hazard toggles */}
      <div className="lux-card-glass mb-6" style={{ minHeight: 480, display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-3 px-2 flex-wrap gap-2">
          <div className="flex gap-1">
            {hazards.map(h => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHazard(h.id)}
                className="text-sm font-medium"
                style={{
                  // Sentence case and no outline on the unselected ones, the
                  // same treatment as the header nav.
                  background: hazard === h.id ? 'var(--accent-gold-light)' : 'transparent',
                  color: hazard === h.id ? 'var(--accent-gold-dark)' : 'var(--text-secondary)',
                  border: '1px solid transparent',
                  borderRadius: 999,
                  padding: '0.3rem 0.9rem',
                  cursor: 'pointer',
                  transition: 'background .3s var(--transition-lux), color .3s var(--transition-lux)',
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setShowDrains(s => !s)}
              aria-pressed={showDrains}
              className="pill-toggle"
            >
              Drains
            </button>
            <button
              type="button"
              onClick={() => setShowCool(s => !s)}
              aria-pressed={showCool}
              className="pill-toggle"
            >
              Cool assets
            </button>
            {/* Off by default. Every other layer here is a model or a feed;
                this one is what residents said, and it should be asked for
                rather than switched on alongside them. */}
            <button
              type="button"
              onClick={() => setShowComplaints(s => !s)}
              aria-pressed={showComplaints}
              className="pill-toggle"
            >
              Citizen reports
            </button>
          </div>
        </div>
        {/* An explicit height, not `flex: 1`. The card's height here is
            content-derived (min-height only, no stretched grid row to resolve
            against), so a flex item's height is indefinite and the map's
            `height: 100%` computes to zero — Leaflet then draws nothing. */}
        <div style={{ height: 420 }}>
          <CityMap
            zoneScores={risk.zoneScores}
            hazard={hazard}
            air={risk.air}
            heat={risk.heat}
            showDrains={showDrains}
            showCool={showCool}
            showComplaints={showComplaints}
            complaintCounts={complaintCounts}
            complaints={complaints}
            drainNodes={risk.drainNodes}
            servicedIds={servicedIds}
            selectedZone={selectedZone}
            onSelectZone={onSelectZone}
          />
        </div>
        <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>
          {showComplaints
            ? `${UNVERIFIED_LABEL} — counts of what residents reported, per zone, plus a pin for the reports whose reporter chose to place one. Positions are approximate. They are not an input to any score on this page.`
            : `Why drains clog: ~${WASTE.organicsPct}% organics + ~${WASTE.filmPlasticPct}% film plastics of the ${Math.round(WASTE.kgPerCapPerDay * 1000)} g/cap/day waste stream; only ~${Math.round(WASTE.collectionRate * 100)}% collected.`}
        </p>
      </div>

      {/* Outlook — 24h detail + 72h horizon, all live Open-Meteo */}
      <div className="lux-card-glass mb-6">
        <p className="editorial-header-num text-lg heading-split">Forecast <em>— when will it rain, and how hard?</em></p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Hour-by-hour rainfall from Open-Meteo's weather model. In the 24-hour strip each bar is one hour — its height
          is the millimetres expected and its darkness is how confident the model is. The 72-hour strip compresses three
          days, so any bar you can see is a rain event worth planning around.
        </p>
        <p className="mt-4 label-eyebrow" style={{ color: 'var(--accent-gold)' }}>Next 24 hours — rain, hour by hour</p>
        <div className="mt-3">
          <RainTimeline hours={risk.weather?.next24h ?? []} times={risk.weather?.next24hTime ?? []} prob={risk.weather?.next24hProb ?? []} />
        </div>
        <p className="mt-5 label-eyebrow" style={{ color: 'var(--accent-gold)' }}>Next 72 hours — the 3-day rain picture</p>
        <div className="mt-3">
          <RainTimeline
            hours={risk.weather?.next72h ?? []}
            times={risk.weather?.next72hTime ?? []}
            prob={risk.weather?.next72hProb ?? []}
            compact
          />
        </div>
        <p className="mt-5 label-eyebrow" style={{ color: 'var(--accent-gold)' }}>Air quality — US AQI, last 12h → next 12h</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          The Air Quality Index converts PM2.5/PM10 into one health-relevant number: below 50 is fine for everyone,
          51–100 bothers only the most sensitive, 101–150 is a warning for children and asthma patients, above that is
          unhealthy for all.
        </p>
        <div className="mt-3">
          <AqiSparkline series={risk.air?.series ?? []} times={risk.air?.times ?? []} />
        </div>
        <p className="mt-3 text-micro" style={{ color: 'var(--text-muted)' }}>{AIR_RECORD_FACT}</p>
      </div>

      {/* Zone table */}
      <div className="lux-card-glass">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="label-micro" style={{ color: 'var(--accent-gold)' }}>Zones</p>
          <p className="label-micro">Sorted by {SORT_LABEL[sort.key]}, {sort.dir === 'asc' ? 'low to high' : 'high to low'}</p>
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="zone-table">
            <thead>
              <tr>
                <SortHeader id="name" sort={sort} onSort={toggleSort}>Zone</SortHeader>
                <SortHeader id="risk" align="right" sort={sort} onSort={toggleSort}>Risk</SortHeader>
                <SortHeader id="population" align="right" sort={sort} onSort={toggleSort}>Residents</SortHeader>
                <th scope="col" className="label-micro text-right">Drains</th>
                <th scope="col"><span className="sr-only">Open in Citizen view</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ zone, score, drains }) => {
                const isActive = selectedZone?.id === zone.id
                return (
                  <tr
                    key={zone.id}
                    className="zone-table__row"
                    data-active={isActive ? '' : undefined}
                    onClick={() => onSelectZone?.(zone)}
                  >
                    <td>
                      <button
                        type="button"
                        className="zone-table__name"
                        onClick={e => { e.stopPropagation(); onSelectZone?.(zone) }}
                      >
                        {zone.name}
                      </button>
                    </td>
                    <td>
                      {/* The number alone never said how far into a band a zone
                          sits, and the bands are not equal in what they mean —
                          74 and 76 looked identical. */}
                      <div className="flex items-center justify-end gap-2.5">
                        <BandMeter score={score} height={5} className="w-14 shrink-0" />
                        <span className="figure text-lg tabular-nums" style={{ color: bandColor(score) }}>{score}</span>
                      </div>
                    </td>
                    <td className="text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {zone.population.toLocaleString()}
                    </td>
                    <td className="text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {drains}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-lux btn-lux-outline btn-lux-xs"
                        onClick={() => onOpenZone(zone.id)}
                      >
                        <span>Open →</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
