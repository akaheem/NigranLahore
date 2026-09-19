import { useState } from 'react'
import CityMap from './CityMap.jsx'
import { RainTimeline, AqiSparkline } from './Timeline24h.jsx'
import { ZONES, DRAIN_NODES, COOL_ASSETS } from '../data/lahore.js'
import { WASTE, AIR_RECORD_FACT } from '../data/calibration.js'
import { bandColor } from '../lib/risk.js'
import { AlertTriangle, Clock, Droplets, Tent } from 'lucide-react'

const hazards = [
  { id: 'flood', label: 'Flood' },
  { id: 'air', label: 'Air' },
  { id: 'heat', label: 'Heat' },
]

/**
 * City Overview — the operator's all-hazard summary: layer-toggled map,
 * city impact counters, 24h rain/AQI outlook, and a zone drill-down table
 * that jumps into the Citizen view.
 */
export default function CityOverviewView({ risk, done, onOpenZone, onNavigate, servicedIds = [], selectedZone, onSelectZone }) {
  const [hazard, setHazard] = useState('flood')
  const [showCool, setShowCool] = useState(true)
  const [showDrains, setShowDrains] = useState(true)

  const zonesHigh = Object.values(risk.zoneScores).filter(s => (s?.score ?? 0) >= 50).length
  const criticalDrains = risk.taskQueue.filter(t => !done[t.id] && t.priority >= 70).length
  const reliefCapacity = COOL_ASSETS.reduce((s, c) => s + c.capacity, 0)

  return (
    <div className="editorial-container py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="editorial-header-num text-2xl">City Overview — Lahore, today</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {zonesHigh} of 8 zones at high risk · {criticalDrains} critical drains ·{' '}
            {risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(1)} mm` : '—'} rain in 6h
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-lux btn-lux-outline" onClick={() => onNavigate('citizen')}><span>← Citizen</span></button>
          <button type="button" className="btn-lux btn-lux-outline" onClick={() => onNavigate('ops')}><span>Field Ops →</span></button>
        </div>
      </div>

      {/* Impact counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <AlertTriangle size={16} color="var(--risk-high)" />
          <p className="font-editorial text-3xl mt-2">{zonesHigh}<span className="text-sm"> / 8</span></p>
          <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Zones ≥ High</p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <Clock size={16} color="var(--accent-gold)" />
          <p className="font-editorial text-3xl mt-2">{risk.rain6hMm != null ? risk.rain6hMm.toFixed(1) : '—'}<span className="text-sm"> mm</span></p>
          <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Rain 6h</p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <Droplets size={16} color="var(--risk-moderate)" />
          <p className="font-editorial text-3xl mt-2">{criticalDrains}</p>
          <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Critical drains</p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <Tent size={16} color="var(--risk-safe)" />
          <p className="font-editorial text-3xl mt-2">{reliefCapacity.toLocaleString()}</p>
          <p className="text-[0.62rem] uppercase tracking-[0.15em] font-accent" style={{ color: 'var(--text-muted)' }}>Relief capacity / day</p>
        </div>
      </div>

      {/* Map card with hazard toggles */}
      <div className="lux-card-glass mb-6" style={{ padding: '1rem', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-3 px-2 flex-wrap gap-2">
          <div className="flex gap-1">
            {hazards.map(h => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHazard(h.id)}
                className="font-accent text-[0.65rem] uppercase tracking-[0.15em]"
                style={{
                  background: hazard === h.id ? 'var(--accent-gold-light)' : 'transparent',
                  color: hazard === h.id ? 'var(--accent-gold-dark)' : 'var(--text-secondary)',
                  border: `1px solid ${hazard === h.id ? 'transparent' : 'var(--border-medium)'}`,
                  borderRadius: 999,
                  padding: '0.25rem 0.8rem',
                  cursor: 'pointer',
                  transition: 'all .3s var(--transition-lux)',
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
              className="font-accent text-[0.65rem] uppercase tracking-[0.15em]"
              style={{ background: 'none', border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)', borderRadius: 999, padding: '0.25rem 0.8rem', cursor: 'pointer', opacity: showDrains ? 1 : 0.5 }}
            >
              Drains {showDrains ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => setShowCool(s => !s)}
              className="font-accent text-[0.65rem] uppercase tracking-[0.15em]"
              style={{ background: 'none', border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)', borderRadius: 999, padding: '0.25rem 0.8rem', cursor: 'pointer', opacity: showCool ? 1 : 0.5 }}
            >
              Cool assets {showCool ? 'on' : 'off'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 380 }}>
          <CityMap
            zoneScores={risk.zoneScores}
            hazard={hazard}
            air={risk.air}
            heat={risk.heat}
            showDrains={showDrains}
            showCool={showCool}
            servicedIds={servicedIds}
            selectedZone={selectedZone}
            onSelectZone={onSelectZone}
          />
        </div>
        <p className="mt-2 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
          Why drains clog: ~{WASTE.organicsPct}% organics + ~{WASTE.filmPlasticPct}% film plastics of the {Math.round(WASTE.kgPerCapPerDay * 1000)} g/cap/day waste stream; only ~{Math.round(WASTE.collectionRate * 100)}% collected.
        </p>
      </div>

      {/* Outlook — 24h detail + 72h horizon, all live Open-Meteo */}
      <div className="lux-card-glass mb-6" style={{ padding: '1.1rem 1.3rem' }}>
        <p className="editorial-header-num text-lg">Forecast — when will it rain, and how hard?</p>
        <p className="text-[0.72rem] mt-1" style={{ color: 'var(--text-secondary)' }}>
          Hour-by-hour rainfall from Open-Meteo's weather model. In the 24-hour strip each bar is one hour — its height
          is the millimetres expected and its darkness is how confident the model is. The 72-hour strip compresses three
          days, so any bar you can see is a rain event worth planning around.
        </p>
        <p className="mt-4 font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>Next 24 hours — rain, hour by hour</p>
        <div className="mt-3">
          <RainTimeline hours={risk.weather?.next24h ?? []} times={risk.weather?.next24hTime ?? []} prob={risk.weather?.next24hProb ?? []} />
        </div>
        <p className="mt-5 font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>Next 72 hours — the 3-day rain picture</p>
        <div className="mt-3">
          <RainTimeline
            hours={risk.weather?.next72h ?? []}
            times={risk.weather?.next72hTime ?? []}
            prob={risk.weather?.next72hProb ?? []}
            compact
          />
        </div>
        <p className="mt-5 font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>Air quality — US AQI, last 12h → next 12h</p>
        <p className="text-[0.72rem] mt-1" style={{ color: 'var(--text-secondary)' }}>
          The Air Quality Index converts PM2.5/PM10 into one health-relevant number: below 50 is fine for everyone,
          51–100 bothers only the most sensitive, 101–150 is a warning for children and asthma patients, above that is
          unhealthy for all.
        </p>
        <div className="mt-3">
          <AqiSparkline series={risk.air?.series ?? []} times={risk.air?.times ?? []} />
        </div>
        <p className="mt-3 text-[0.62rem]" style={{ color: 'var(--text-muted)' }}>{AIR_RECORD_FACT}</p>
      </div>

      {/* Zone table */}
      <div className="lux-card-glass" style={{ padding: '1.1rem 1.3rem' }}>
        <p className="font-accent text-[0.65rem] uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--accent-gold)' }}>Zones</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {ZONES.map(z => {
            const score = risk.zoneScores[z.id]?.score ?? 0
            const drains = DRAIN_NODES.filter(n => n.zone === z.id).length
            const isActive = selectedZone?.id === z.id
            return (
              <div
                key={z.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectZone?.(z)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelectZone?.(z) }}
                className="flex items-center justify-between gap-3 flex-wrap"
                style={{
                  borderBottom: '1px solid var(--border-light)',
                  paddingBottom: '0.6rem',
                  cursor: 'pointer',
                  borderRadius: 8,
                  padding: '0.45rem 0.6rem',
                  marginInline: '-0.6rem',
                  transition: 'background .3s var(--transition-lux)',
                  background: isActive ? 'var(--glow-color)' : 'transparent',
                  outline: isActive ? '1px solid var(--accent-gold)' : 'none',
                }}
              >
                <span className="font-accent text-sm uppercase tracking-[0.1em]" style={{ minWidth: 120, color: isActive ? 'var(--accent-gold)' : undefined }}>
                  {isActive ? '▸ ' : ''}{z.name}
                </span>
                <span className="font-editorial text-2xl" style={{ color: bandColor(score) }}>{score}</span>
                <span className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>{z.population.toLocaleString()} residents</span>
                <span className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>{drains} drain{drains === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  className="btn-lux btn-lux-outline"
                  style={{ padding: '0.3rem 0.8rem', fontSize: '0.65rem' }}
                  onClick={() => onOpenZone(z.id)}
                >
                  <span>Open →</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
