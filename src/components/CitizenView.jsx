import { useMemo, useState } from 'react'
import { Droplets, Tent, Cross, MapPin } from 'lucide-react'
import CityMap from './CityMap.jsx'
import RiskCard from './RiskCard.jsx'
import BandMeter, { BandPill } from './BandMeter.jsx'
import { RainTimeline } from './Timeline24h.jsx'
import { ZONES, COOL_ASSETS } from '../data/lahore.js'
import { RECORDS, TELEMETRY_NOTE } from '../data/calibration.js'
import { bandColor, airWhy, heatWhy, drainWhy } from '../lib/risk.js'
import { haversineKm, nearestBy, walkMinutes } from '../lib/geo.js'

const aqiBand = aqi =>
  aqi <= 50 ? { c: 'var(--risk-safe)', l: 'Good' } :
  aqi <= 100 ? { c: 'var(--risk-moderate)', l: 'Moderate' } :
  aqi <= 150 ? { c: 'var(--risk-high)', l: 'Unhealthy (sensitive)' } :
  { c: 'var(--risk-severe)', l: 'Unhealthy+' }

const ASSET_ICON = { water: Droplets, camp: Tent, hospital: Cross }
const ASSET_LABEL = { water: 'Drinking water', camp: 'Relief camp', hospital: 'Heat unit' }

export default function CitizenView({ risk, selectedZone, onSelectZone, showCool, onToggleCool, onSwitch, servicedIds = [] }) {
  const [locateMsg, setLocateMsg] = useState(null)

  const zoneScore = risk.zoneScores[selectedZone.id]?.score ?? 0
  const whys = risk.floodWhyFor(selectedZone)
  const drainCard = risk.drainCard ?? { score: 0, parts: {}, missing: {} }

  // Nearest relief, measured from the zone the citizen already picked — not
  // from the map centre, so the distances mean something to a real person.
  const nearestRelief = useMemo(
    () => nearestBy(selectedZone, COOL_ASSETS, 3),
    [selectedZone],
  )

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
        <div className="lux-card-glass">
          <p className="label-micro">Rain next 6h — {selectedZone.name}</p>
          <p className="figure font-editorial text-3xl mt-1">{risk.rain6hMm != null ? `${risk.rain6hMm.toFixed(1)}` : '—'}<span className="text-sm"> mm</span></p>
        </div>
        <div className="lux-card-glass">
          <p className="label-micro">Air (US AQI) — {selectedZone.name}</p>
          <p className="figure font-editorial text-3xl mt-1" style={{ color: band.c }}>
            {risk.air?.aqi ?? '—'}
            <span className="text-xs ml-2 font-accent" style={{ color: band.c }}>{band.l}</span>
          </p>
        </div>
        <div className="lux-card-glass">
          <p className="label-micro">Temperature — {selectedZone.name}</p>
          <p className="figure font-editorial text-3xl mt-1">{risk.weather?.tempC != null ? `${Math.round(risk.weather.tempC)}°C` : '—'}</p>
        </div>
        <div className="lux-card-glass">
          <p className="label-micro">Humidity — {selectedZone.name}</p>
          <p className="figure font-editorial text-3xl mt-1">{risk.weather?.humidityPct != null ? `${risk.weather.humidityPct}%` : '—'}</p>
        </div>
      </div>

      {/* A degraded feed is the one thing on this screen a reader must not miss,
          and it was set in tracked uppercase at 10px — the quietest treatment on
          the page for the loudest message. It reads as a banner now. */}
      {showFallbackNote && (
        <div
          className="mb-6 rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--risk-moderate) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--risk-moderate) 30%, transparent)',
            color: 'var(--text-secondary)',
          }}
        >
          {risk.status === 'offline'
            ? 'Live feed unreachable — values withheld rather than guessed. Hit Retry or check your connection.'
            : 'Showing cached data — live feed temporarily unavailable'}
        </div>
      )}

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        {/* Map */}
        <div className="lux-card-glass" style={{ minHeight: 460, display: 'flex', flexDirection: 'column' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="label-eyebrow text-sm">Lahore — flood risk zones</h3>
            <button
              type="button"
              onClick={onToggleCool}
              aria-pressed={showCool}
              className="pill-toggle"
            >
              Cool assets
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 380 }}>
            <CityMap
              zoneScores={risk.zoneScores}
              selectedZone={selectedZone}
              onSelectZone={onSelectZone}
              showCool={showCool}
              drainNodes={risk.drainNodes}
              servicedIds={servicedIds}
            />
          </div>
          <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>
            {TELEMETRY_NOTE}
          </p>
        </div>

        {/* Zone panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="lux-card-glass">
            <p className="label-eyebrow">Your area</p>
            <div className="mt-3 flex gap-2">
              <select
                value={selectedZone.id}
                onChange={e => onSelectZone(ZONES.find(z => z.id === e.target.value))}
                className="field-lux"
              >
                {ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <button
                type="button"
                onClick={locateMe}
                className="btn-lux btn-lux-outline shrink-0"
              >
                Locate me
              </button>
            </div>
            {locateMsg && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{locateMsg}</p>
            )}

            {/* Everything above this line used to be the same size as
                everything below it: a heading, a dropdown, a button, the score
                and the action list all sat within a couple of pixels of each
                other, so the eye had no way in. The score is now unambiguously
                the largest thing on the screen, and the meter says where it sits
                on the ramp — the number means something without a lookup. */}
            <div className="mt-6 flex items-center justify-between gap-4">
              <div className="flex items-baseline gap-2">
                {/* The one 6xl figure in the app, and both the unit suite and
                    the E2E run select it by these two classes. Its text has to
                    stay the bare number, so the unit sits outside it rather
                    than as a child. */}
                <span className="figure font-editorial text-6xl" style={{ color: bandColor(zoneScore) }}>
                  {zoneScore}
                </span>
                <span className="label-micro">flood risk /100</span>
              </div>
              <BandPill score={zoneScore} />
            </div>

            <BandMeter score={zoneScore} height={8} className="mt-4" />
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border-light)' }}>
              <p className="label-micro mb-2" style={{ color: 'var(--accent-gold)' }}>What to do now</p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {actions.map((a, i) => (
                  <li key={i} className="flex gap-2"><span style={{ color: 'var(--accent-gold)' }}>—</span><span>{a}</span></li>
                ))}
              </ul>
            </div>
          </div>

          {/* 6h rain timeline + 72h chance strip — the zone's own forecast.
              Both strips go through RainTimeline. The 6-hour block used to be a
              hand-rolled chart two screens away from this one, on its own scale
              (`mm / 5`) and its own colour bands (`> 2` = high), which disagreed
              with the 72-hour strip directly below it: the same 4 mm hour was
              orange in one and green in the other. One chart, one scale, one
              palette — so the two can no longer contradict each other. */}
          <div className="lux-card-glass">
            <p className="label-micro">Rain — next 6 hours ({selectedZone.name})</p>
            <div className="mt-3">
              <RainTimeline
                hours={risk.weather?.next6h ?? []}
                times={risk.weather?.hourlyTime ?? []}
                prob={risk.weather?.next6hProb ?? []}
              />
            </div>
            <p className="label-micro mt-5">Rain chance — next 72 hours</p>
            <div className="mt-3">
              <RainTimeline
                hours={risk.weather?.next72h ?? []}
                times={risk.weather?.next72hTime ?? []}
                prob={risk.weather?.next72hProb ?? []}
                compact
              />
            </div>
          </div>

          {/* Nearest relief — water plants, camps and heat units, ranked by
              walking distance from the selected zone. */}
          <div className="lux-card-glass">
            <p className="label-micro">
              Nearest relief from {selectedZone.name}
            </p>
            <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {nearestRelief.map(a => {
                // Emoji stood here: three glyphs rendered by the OS font, at
                // three different sizes and baselines, in colours that had
                // nothing to do with the palette. These are the same three
                // concepts from the icon set the rest of the app already uses.
                const Icon = ASSET_ICON[a.type] ?? MapPin
                return (
                  <div key={a.id} className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="shrink-0 inline-flex items-center justify-center rounded-full"
                        style={{ width: 28, height: 28, background: 'var(--accent-green-light)', color: 'var(--accent-gold-dark)' }}
                      >
                        <Icon size={15} />
                      </span>
                      <div>
                        <p className="text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>{a.name}</p>
                        <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
                          {ASSET_LABEL[a.type] || 'Relief'} · {a.capacity.toLocaleString()} people/day
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="figure font-editorial text-xl" style={{ color: 'var(--accent-gold)' }}>{a.distanceKm.toFixed(1)}<span className="text-xs"> km</span></p>
                      <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
                        ~{walkMinutes(a.distanceKm)} min walk
                      </p>
                      <a
                        href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="label-micro"
                        style={{ color: 'var(--accent-gold)' }}
                      >
                        Navigate ↗
                      </a>
                    </div>
                  </div>
                )
              })}
              {nearestRelief.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No relief assets mapped near this zone.
                </p>
              )}
            </div>
            <p className="mt-3 text-micro" style={{ color: 'var(--text-muted)' }}>
              Distances are straight-line from the zone centre, not routing. Facility list is a reference set,
              not live municipal capacity. Walk time assumes 4.5 km/h.
            </p>
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

      {/* Multi-hazard — air + heat + waste/drain (the selected zone's own feed) */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
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
        <RiskCard
          num="V"
          title={`Waste & drainage — ${selectedZone.name}`}
          score={drainCard.score ?? 0}
          whys={drainWhy(drainCard, { zone: selectedZone })}
          footer="Drain fill is a calibrated simulation; drainage capacity and waste load come from published Lahore parameters."
        />
      </div>

      {/* Records strip */}
      <div className="mt-10">
        <p className="editorial-header-num text-xl mb-4">VI — The city, lately</p>
        <div className="grid md:grid-cols-5 gap-4">
          {RECORDS.map((r, i) => (
            <div key={i} className="lux-card-glass">
              <p className="label-micro" style={{ color: 'var(--accent-gold)' }}>{r.date}</p>
              <p className="mt-2 text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>{r.fact}</p>
              <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>src: {r.src}</p>
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
