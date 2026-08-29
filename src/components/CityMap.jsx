import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ZONES, DRAIN_NODES, COOL_ASSETS, LAHORE_CENTER } from '../data/lahore.js'
import { bandColor, BAND_COLORS } from '../lib/risk.js'

const coolEmoji = { water: '💧', camp: '⛺', hospital: '🏥' }

const RISK_LEGEND = [
  { key: 'safe', label: 'Safe' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'high', label: 'High' },
  { key: 'severe', label: 'Severe' },
]

/** Small fixed legend — bottom-left of the map. */
function MapLegend() {
  return (
    <div
      className="map-legend"
      style={{
        position: 'absolute', bottom: 10, left: 10, zIndex: 1000,
        background: 'rgba(27,23,31,.82)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
        border: '1px solid rgba(201,166,107,.35)',
      }}
    >
      {RISK_LEGEND.map(b => (
        <span key={b.key} className="flex items-center gap-1 font-accent" style={{ fontSize: '0.55rem', color: '#f5f1ea', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: BAND_COLORS[b.key], display: 'inline-block' }} />
          {b.label}
        </span>
      ))}
    </div>
  )
}

const makeCoolIcon = (type) =>
  L.divIcon({
    className: '',
    html: `<div style="font-size:18px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))">${coolEmoji[type] || '📍'}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })

function MapFlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 13, { duration: 1.2 })
  }, [target, map])
  return null
}

/**
 * City map — zone risk circles + drain nodes + cool assets.
 * Leaflet + free OSM tiles, lux-restyled via index.css filters.
 * hazard: 'flood' (per-zone scores) | 'air' | 'heat' (city-wide overlays).
 */
export default function CityMap({ zoneScores = {}, selectedZone, onSelectZone, showDrains = true, showCool = false, hazard = 'flood', air, heat }) {
  const zoneValue = (z) => {
    if (hazard === 'heat') return heat?.score ?? 0
    if (hazard === 'air') return air?.score ?? 0
    return zoneScores[z.id]?.score ?? 0
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={[LAHORE_CENTER.lat, LAHORE_CENTER.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%', borderRadius: 14 }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MapFlyTo target={selectedZone} />

      {ZONES.map(z => {
        const r = zoneValue(z)
        return (
          <CircleMarker
            key={z.id}
            center={[z.lat, z.lng]}
            radius={18 + (r / 100) * 22}
            pathOptions={{
              color: bandColor(r),
              weight: selectedZone?.id === z.id ? 3 : 1.5,
              fillColor: bandColor(r),
              fillOpacity: 0.35 + (r / 100) * 0.25,
            }}
            eventHandlers={{ click: () => onSelectZone?.(z) }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 180 }}>
                <strong>{z.name}</strong>
                <div style={{ margin: '6px 0 2px', fontSize: 13 }}>Flood risk: <strong style={{ color: bandColor(zoneScores[z.id]?.score ?? 0) }}>{zoneScores[z.id]?.score ?? 0}/100</strong></div>
                {hazard === 'air' && air && <div style={{ fontSize: 12, opacity: 0.75 }}>City-wide AQI: {air.aqi ?? '—'} (live, Open-Meteo)</div>}
                {hazard === 'heat' && heat && <div style={{ fontSize: 12, opacity: 0.75 }}>City-wide heat score: {heat.score} (live)</div>}
                <div style={{ fontSize: 12, opacity: 0.75 }}>Population {(z.population / 1000).toFixed(0)}k · Drain cap. {(z.drainageCapacity * 100).toFixed(0)}%</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {showDrains && DRAIN_NODES.map(d => (
        <CircleMarker
          key={d.id}
          center={[d.lat, d.lng]}
          radius={6}
          pathOptions={{ color: bandColor(d.fillPct), weight: 1.5, fillColor: bandColor(d.fillPct), fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 170 }}>
              <strong>{d.name}</strong>
              <div style={{ margin: '4px 0 2px', fontSize: 13 }}>Fill level: <strong>{d.fillPct}%</strong> <span style={{ fontSize: 11, color: '#8E7D66' }}>· simulated telemetry</span></div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Unserved for {d.lastServiceHrs}h · cap {d.capacityTons}t</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showCool && COOL_ASSETS.map(c => (
        <Marker key={c.id} position={[c.lat, c.lng]} icon={makeCoolIcon(c.type)}>
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 160 }}>
              <strong>{c.name}</strong>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Capacity ~{c.capacity.toLocaleString()} people/day · reference location</div>
            </div>
          </Popup>
        </Marker>
      ))}
      </MapContainer>
      <MapLegend />
    </div>
  )
}
