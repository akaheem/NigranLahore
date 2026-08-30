import { useMemo, useState } from 'react'
import CityMap from './CityMap.jsx'
import RiskCard from './RiskCard.jsx'
import { RainTimeline } from './Timeline24h.jsx'
import { ZONES } from '../data/lahore.js'
import { RECORDS, TELEMETRY_NOTE } from '../data/calibration.js'
import { bandColor, airWhy, heatWhy } from '../lib/risk.js'

const aqiBand = aqi =>
  aqi <= 50 ? { c: 'var(--risk-safe)', l: 'Good' } :
  aqi <= 100 ? { c: 'var(--risk-moderate)', l: 'Moderate' } :
  aqi <= 150 ? { c: 'var(--risk-high)', l: 'Unhealthy (sensitive)' } :
  { c: 'var(--risk-severe)', l: 'Unhealthy+' }

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export default function CitizenView({ risk, selectedZone, onSelectZone, showCool, onToggleCool, onSwitch, servicedIds = [] }) {
  const [locateMsg, setLocateMsg] = useState(null)

  const zoneScore = risk.zoneScores[selectedZone.id]?.score ?? 0
  const whys = risk.floodWhyFor(selectedZone)

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocateMsg('Location not available on this device')
      return
    }
    setLocateMsg('Locating…')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const nearest = ZONES.reduce((a, b) => (haversineKm(here, b) < haversineKm(here, a) ? b : a))
        onSelectZone(nearest)
        setLocateMsg(`Nearest zone: ${nearest.name}`)
      },
      () => setLocateMsg('Location permission denied — pick your area below'),
      { timeout: 10000 },
    )
  }

  const actions = useMemo(() => {
    const list = []
    if (zoneScore >= 75) {
      list.push('Move vehicles out of basements & underpasses before the rain window')
      list.push('Avoid low-lying underpasses 4–8pm')
      list.push('Keep emergency kit & documents in a waterproof bag')
    } else if (zoneScore >= 50) {
      list.push('Park on elevated ground this evening')
      list.push('Clear the drain/grating near your home before rain starts')
    } else if (zoneScore >= 25) {
      list.push('Light rain may pond at known sore points — allow extra travel time')
    } else {
      list.push('No immediate flood action needed — go about your day')
    }
    if ((risk.air?.aqi ?? 0) > 100) list.push('Air is unhealthy — mask outdoors, windows closed at peak hours')
    if ((risk.heat?.score ?? 0) > 60) list.push('Heat risk high — hydrate, use the nearest filtration plant / shade 12–4pm')
    return list
  }, [zoneScore, risk.air, risk.heat])

  const band = aqiBand(risk.air?.aqi ?? 0)
  const showFallbackNote = risk.status === 'offline' || risk.status === 'stale'

  return (
    <div className="editorial-container py-10">
      {/* Live zone strip — the selected zone's OWN Open-Meteo feed */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="lux-card-glass py-4" style={{ padding: '1rem 1.25rem' }}>
          <p className="font-accent text-[0.6rem] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Rain next 6h — {selectedZone.name}</p>
          <p className="font-editorial text-3xl mt-1">{risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(1)}` : '—'}<span className="text-sm"> mm</span></p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <p className="font-accent text-[0.6rem] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Air (US AQI) — {selectedZone.name}</p>
          <p className="font-editorial text-3xl mt-1" style={{ color: band.c }}>
            {risk.air?.aqi ?? '—'}
            <span className="text-xs ml-2 font-accent" style={{ color: band.c }}>{band.l}</span>
          </p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <p className="font-accent text-[0.6rem] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Temperature — {selectedZone.name}</p>
          <p className="font-editorial text-3xl mt-1">{risk.weather?.tempC != null ? `${Math.round(risk.weather.tempC)}°C` : '—'}</p>
        </div>
        <div className="lux-card-glass" style={{ padding: '1rem 1.25rem' }}>
          <p className="font-accent text-[0.6rem] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Humidity — {selectedZone.name}</p>
          <p className="font-editorial text-3xl mt-1">{risk.weather?.humidityPct != null ? `${risk.weather.humidityPct}%` : '—'}</p>
        </div>
      </div>

      {showFallbackNote && (
        <p className="mb-6 font-accent text-[0.65rem] uppercase tracking-[0.15em]" style={{ color: 'var(--risk-moderate)' }}>
          {risk.status === 'offline'
            ? 'Live feed unreachable — values withheld rather than guessed. Hit Retry or check your connection.'
            : 'Showing cached data — live feed temporarily unavailable'}
        </p>
      )}

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        {/* Map */}
        <div className="lux-card-glass" style={{ padding: '1rem', minHeight: 460, display: 'flex', flexDirection: 'column' }}>
          <div className="flex items-center justify-between mb-3 px-2">
            <h3 className="font-accent uppercase tracking-[0.18em] text-sm">Lahore — flood risk zones</h3>
            <button
              type="button"
              onClick={onToggleCool}
              className="font-accent text-[0.65rem] uppercase tracking-[0.15em]"
              style={{ background: 'none', border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)', borderRadius: 999, padding: '0.25rem 0.8rem', cursor: 'pointer', opacity: showCool ? 1 : 0.5 }}
            >
              Cool assets {showCool ? 'on' : 'off'}
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 380 }}>
            <CityMap
              zoneScores={risk.zoneScores}
              selectedZone={selectedZone}
              onSelectZone={onSelectZone}
              showCool={showCool}
              servicedIds={servicedIds}
            />
          </div>
          <p className="mt-2 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
            {TELEMETRY_NOTE}
          </p>
        </div>

        {/* Zone panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="lux-card-glass">
            <p className="editorial-header-num text-lg">Your area</p>
            <div className="mt-3 flex gap-2">
              <select
                value={selectedZone.id}
                onChange={e => onSelectZone(ZONES.find(z => z.id === e.target.value))}
                className="w-full font-accent text-sm"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 8,
                  padding: '0.7rem 0.9rem',
                  outline: 'none',
                }}
              >
                {ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <button
                type="button"
                onClick={locateMe}
                className="font-accent text-[0.65rem] uppercase tracking-[0.12em] whitespace-nowrap"
                style={{ background: 'none', border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)', borderRadius: 8, padding: '0.7rem 0.9rem', cursor: 'pointer' }}
              >
                Locate me
              </button>
            </div>
            {locateMsg && (
              <p className="mt-2 text-[0.7rem]" style={{ color: 'var(--text-muted)' }}>{locateMsg}</p>
            )}
            <div className="mt-4 flex items-baseline gap-3">
              <span className="font-editorial text-6xl" style={{ color: bandColor(zoneScore) }}>{zoneScore}</span>
              <span className="font-accent uppercase tracking-[0.2em] text-xs" style={{ color: 'var(--text-secondary)' }}>
                flood risk /100
              </span>
            </div>
            <div className="mt-4">
              <p className="font-accent text-[0.65rem] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--accent-gold)' }}>What to do now</p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {actions.map((a, i) => (
                  <li key={i} className="flex gap-2"><span style={{ color: 'var(--accent-gold)' }}>—</span><span>{a}</span></li>
                ))}
              </ul>
            </div>
          </div>

          {/* 6h rain timeline + 72h chance strip — the zone's own forecast */}
          <div className="lux-card-glass">
            <p className="font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Rain — next 6 hours ({selectedZone.name})</p>
            <div className="mt-3 flex items-end gap-2" style={{ height: 80 }}>
              {(risk.weather?.next6h ?? []).map((mm, i) => {
                const prob = risk.weather?.next6hProb?.[i]
                const h = Math.max(4, Math.min(80, (mm / 5) * 80))
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      title={`${(risk.weather?.hourlyTime?.[i] ?? '').slice(11, 16)} — ${mm} mm${prob != null ? ` · ${prob}% chance` : ''}`}
                      style={{ width: '100%', height: h, background: mm > 2 ? 'var(--risk-high)' : mm > 0.3 ? 'var(--risk-moderate)' : 'var(--risk-safe)', borderRadius: 3, opacity: prob != null ? 0.4 + Math.min(0.6, (prob / 100) * 0.6) : 0.85, transition: 'height .6s var(--transition-lux)' }} />
                    <span className="text-[0.6rem]" style={{ color: 'var(--text-muted)' }}>{(risk.weather?.hourlyTime?.[i] ?? '').slice(11, 13)}</span>
                  </div>
                )
              })}
              {(risk.weather?.next6h ?? []).length === 0 && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>waiting for live data…</span>
              )}
            </div>
            <p className="mt-4 font-accent text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Rain chance — next 72 hours</p>
            <div className="mt-3">
              <RainTimeline
                hours={risk.weather?.next72h ?? []}
                times={risk.weather?.next72hTime ?? []}
                prob={risk.weather?.next72hProb ?? []}
                compact
              />
            </div>
          </div>
        </div>
      </div>

      {/* Why drawer — flood */}
      <div className="mt-8">
        <RiskCard
          num="II"
          title={`Why ${selectedZone.name} scores ${zoneScore}`}
          score={zoneScore}
          whys={whys}
          footer="Every number traces to a published source or a live feed — open the drawer, check the reasoning."
        />
      </div>

      {/* Multi-hazard — air + heat (the selected zone's own live feed) */}
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <RiskCard
          num="III"
          title={`Air quality — ${selectedZone.name}`}
          score={risk.air?.score ?? 0}
          whys={airWhy(risk.air ?? {})}
          footer="US AQI from Open-Meteo's air-quality model for this zone's coordinates — not a city average."
        />
        <RiskCard
          num="IV"
          title={`Heat stress — ${selectedZone.name}`}
          score={risk.heat?.score ?? 0}
          whys={heatWhy(risk.heat ?? {}, risk.weather ?? {})}
          footer="Live temperature + humidity from Open-Meteo; humid-heat banding; heatwave advisories trigger above 40°C in the Lahore plan."
        />
      </div>

      {/* Records strip */}
      <div className="mt-10">
        <p className="editorial-header-num text-xl mb-4">V — The city, lately</p>
        <div className="grid md:grid-cols-5 gap-4">
          {RECORDS.map((r, i) => (
            <div key={i} className="lux-card-glass" style={{ padding: '1rem 1.1rem' }}>
              <p className="font-accent text-[0.6rem] uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)' }}>{r.date}</p>
              <p className="mt-2 text-[0.82rem] leading-snug" style={{ color: 'var(--text-secondary)' }}>{r.fact}</p>
              <p className="mt-2 text-[0.62rem]" style={{ color: 'var(--text-muted)' }}>src: {r.src}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 text-center">
        <button type="button" className="btn-lux" onClick={onSwitch}><span>Field team view →</span></button>
      </div>
    </div>
  )
}
