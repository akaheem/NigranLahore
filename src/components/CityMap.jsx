import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ZONES, DRAIN_NODES, COOL_ASSETS, LAHORE_CENTER } from '../data/lahore.js'
import { bandColor, BAND_COLORS, bandColorHex } from '../lib/risk.js'

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
        background: 'var(--glass-bg)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
        border: '1px solid var(--glass-border)',
      }}
    >
      {RISK_LEGEND.map(b => (
        <span key={b.key} className="flex items-center gap-1 font-accent" style={{ fontSize: '0.55rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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

/** Fly the map to a target (zone or drain) whenever it changes. */
function MapFlyTo({ target, zoom = 13 }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], zoom, { duration: 1.2 })
  }, [target, map, zoom])
  return null
}

/** Pulsing selection ring — the visible "this area is marked" cue. */
function SelectionRing({ lat, lng, radius = 46 }) {
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={radius}
      interactive={false}
      pathOptions={{
        color: '#4E9E2F',
        weight: 2.5,
        dashArray: '6 6',
        fillColor: '#4E9E2F',
        fillOpacity: 0.06,
        className: 'zone-ring',
      }}
    />
  )
}

/**
 * City map — zone risk circles + drain nodes + cool assets.
 * Leaflet + free OSM tiles, lux-restyled via index.css filters.
 * hazard: 'flood' (per-zone scores) | 'air' | 'heat' (city-wide overlays).
 * Selection is two-way: selecting a zone (dropdown, table row, or map circle)
 * flies to it and draws a pulsing ring; clicking a drain marker highlights
 * its task card and vice versa via selectedDrainId/onSelectDrain.
 */
export default function CityMap({
  zoneScores = {},
  selectedZone,
  onSelectZone,
  showDrains = true,
  showCool = false,
  hazard = 'flood',
  air,
  heat,
  servicedIds = [],
  selectedDrainId,
  onSelectDrain,
}) {
  const zoneValue = (z) => {
    if (hazard === 'heat') return heat?.score ?? 0
    if (hazard === 'air') return air?.score ?? 0
    return zoneScores[z.id]?.score ?? 0
  }

  const selectedDrain = selectedDrainId ? DRAIN_NODES.find(d => d.id === selectedDrainId) : null
  const servicedSet = new Set(servicedIds)

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
        <MapFlyTo target={selectedZone} zoom={13} />
        <MapFlyTo target={selectedDrain} zoom={14} />

      {ZONES.map(z => {
        const r = zoneValue(z)
        const isSelected = selectedZone?.id === z.id
        return (
          <CircleMarker
            key={z.id}
            center={[z.lat, z.lng]}
            radius={18 + (r / 100) * 22}
            pathOptions={{
              color: bandColorHex(r),
              weight: isSelected ? 4 : 1.5,
              fillColor: bandColorHex(r),
              fillOpacity: 0.35 + (r / 100) * 0.25,
            }}
            eventHandlers={{ click: () => onSelectZone?.(z) }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 180 }}>
                <strong>{z.name}</strong>
                <div style={{ margin: '6px 0 2px', fontSize: 13 }}>Flood risk: <strong style={{ color: bandColor(zoneScores[z.id]?.score ?? 0) }}>{zoneScores[z.id]?.score ?? 0}/100</strong></div>
                {hazard === 'air' && air && <div style={{ fontSize: 12, opacity: 0.75 }}>AQI (zone model): {air.aqi ?? '—'} (live, Open-Meteo)</div>}
                {hazard === 'heat' && heat && <div style={{ fontSize: 12, opacity: 0.75 }}>Heat score (zone model): {heat.score} (live)</div>}
                <div style={{ fontSize: 12, opacity: 0.75 }}>Population {(z.population / 1000).toFixed(0)}k · Drain cap. {(z.drainageCapacity * 100).toFixed(0)}%</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Selection ring for the active zone — the map-side "mark" */}
      {selectedZone && (
        <SelectionRing key={`ring-${selectedZone.id}`} lat={selectedZone.lat} lng={selectedZone.lng} />
      )}

      {showDrains && DRAIN_NODES.map(d => {
        const isServiced = servicedSet.has(d.id)
        const isTaskSelected = selectedDrainId === d.id
        return (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={isTaskSelected ? 11 : 6}
            pathOptions={{
              // Selection uses the deeper green: the accent green is also the
              // "safe" band colour, so a selected low-fill drain drawn in it
              // would be invisible against its own unselected state.
              color: isTaskSelected ? '#4E9E2F' : bandColorHex(d.fillPct),
              weight: isTaskSelected ? 3 : 1.5,
              dashArray: isServiced ? '3 3' : undefined,
              fillColor: bandColorHex(isServiced ? 10 : d.fillPct),
              fillOpacity: isServiced ? 0.35 : 0.9,
            }}
            eventHandlers={{ click: () => onSelectDrain?.(d.id) }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 170 }}>
                <strong>{d.name}</strong>
                {isServiced && <div style={{ fontSize: 12, color: 'var(--risk-safe)', marginTop: 2 }}>✓ Serviced (demo)</div>}
                <div style={{ margin: '4px 0 2px', fontSize: 13 }}>Fill level: <strong>{d.fillPct}%</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· simulated telemetry</span></div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Unserved for {d.lastServiceHrs}h · cap {d.capacityTons}t</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Selection ring around the active task's drain */}
      {selectedDrain && (
        <SelectionRing key={`drain-ring-${selectedDrain.id}`} lat={selectedDrain.lat} lng={selectedDrain.lng} radius={26} />
      )}

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
