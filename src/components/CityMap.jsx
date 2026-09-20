import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ZONES, DRAIN_NODES, COOL_ASSETS, LAHORE_CENTER } from '../data/lahore.js'
import { bandColor, BAND_COLORS, bandColorHex } from '../lib/risk.js'
import { UNVERIFIED_LABEL } from '../data/complaints.js'

/**
 * Marker glyphs, drawn as SVG rather than emoji.
 *
 * A Leaflet DivIcon takes an HTML string, so this cannot be a lucide component
 * the way the rest of the app's icons are — but it can still be the app's own
 * drawing rather than the operating system's. An emoji marker renders as a
 * different picture, in a different palette, on every platform, which on a map
 * already carrying the app's emerald rings reads as a foreign object.
 *
 * Each is a solid disc with a white ring so it stays legible over both the pale
 * built-up tiles and the green ones. The fills are CSS variables, which resolve
 * inside inline SVG because the node is in the document — so these follow the
 * palette rather than restating it.
 */
const COOL_GLYPH = {
  // Teardrop: apex at the top, circular bowl below.
  water: 'M12 6.4c-2.5 2.7-3.7 4.5-3.7 6.2a3.7 3.7 0 1 0 7.4 0c0-1.7-1.2-3.5-3.7-6.2Z',
  camp: 'M12 6.4 6.4 17.6h11.2Z',
  hospital: 'M10.7 6.8h2.6v3.9h3.9v2.6h-3.9v3.9h-2.6v-3.9H6.8v-2.6h3.9Z',
}
// A map pin, for any asset type added later without a glyph of its own.
const COOL_FALLBACK =
  'M12 5.8a4.6 4.6 0 0 0-4.6 4.6c0 3.4 4.6 7.8 4.6 7.8s4.6-4.4 4.6-7.8A4.6 4.6 0 0 0 12 5.8Zm0 6.3a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z'

const RISK_LEGEND = [
  { key: 'safe', label: 'Safe' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'high', label: 'High' },
  { key: 'severe', label: 'Severe' },
]

/**
 * Small fixed legend — bottom-left of the map.
 *
 * Opaque white rather than the translucent `--glass-bg` the popups use. At 76%
 * alpha the basemap's own place labels read through the panel and sit behind
 * this text, so both become hard to read — the legend looked like it was
 * colliding with the map when it was really just failing to cover it. A solid
 * ground is what every basemap vendor does with this panel, for this reason.
 * The border and shadow keep it reading as a floating chip rather than a hole
 * cut in the map.
 *
 * The labels run on `.label-micro`, which is the app's own uppercase tracked
 * recipe, instead of the 0.55rem / 0.08em this used to hand-roll: those were
 * two of the arbitrary values the type scale was introduced to remove, and at
 * 8.8px they rendered smaller than anything else in the app.
 */
function MapLegend({ showComplaints = false }) {
  // Capped so the panel wraps to a second line on a narrow map rather than
  // running the full width and under Leaflet's attribution at bottom-right.
  const item = { color: 'var(--text-primary)' }
  return (
    <div
      className="map-legend"
      style={{
        position: 'absolute', bottom: 10, left: 10, zIndex: 1000,
        background: 'var(--bg-primary)',
        borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
        border: '1px solid var(--glass-border)', flexWrap: 'wrap',
        maxWidth: 'calc(100% - 7rem)',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.12)',
      }}
    >
      {RISK_LEGEND.map(b => (
        <span key={b.key} className="label-micro flex items-center gap-1" style={item}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: BAND_COLORS[b.key], display: 'inline-block' }} />
          {b.label}
        </span>
      ))}
      {showComplaints && (
        // Named as a report rather than as a hazard: every other entry here is
        // a modelled score, and this one is somebody's unverified account of
        // their own street. The dashed ring around it is the rounding, drawn.
        <span className="label-micro flex items-center gap-1" style={item}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px dashed #007A55', display: 'inline-block' }} />
          Report pin — approximate
        </span>
      )}
    </div>
  )
}

const makeCoolIcon = (type) =>
  L.divIcon({
    className: '',
    html:
      '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" ' +
      'style="filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))">' +
      '<circle cx="12" cy="12" r="10" fill="var(--accent-green-dark)" ' +
      'stroke="var(--bg-primary)" stroke-width="2"/>' +
      `<path d="${COOL_GLYPH[type] ?? COOL_FALLBACK}" fill="var(--bg-primary)"/>` +
      '</svg>',
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
        color: '#007A55',
        weight: 2.5,
        dashArray: '6 6',
        fillColor: '#007A55',
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
  showComplaints = false,
  hazard = 'flood',
  air,
  heat,
  servicedIds = [],
  selectedDrainId,
  onSelectDrain,
  drainNodes,
  complaintCounts = {},
  complaints = [],
}) {
  // Live telemetry when the caller has it, the calibrated seeds otherwise —
  // never a frozen copy, or the markers would sit at their seed values while
  // the Field Ops rows beside them ticked upward on the same drains.
  const nodes = drainNodes ?? DRAIN_NODES

  /**
   * Reports that carry a pin. Only these get a marker; a report with no
   * coordinate keeps the zone count badge above and is deliberately NOT
   * dropped at the zone's centre, which would put a pin on a place the reporter
   * never named.
   *
   * The memo is keyed on a string signature rather than on `complaints`, and
   * that is load-bearing: the board gets a new array identity on every 60 s
   * pull, so keying on the array would rebuild every marker once a minute and
   * churn Leaflet for no change in what is drawn.
   */
  const pinSignature = complaints
    .filter(c => Number.isFinite(c?.lat) && Number.isFinite(c?.lng))
    .map(c => `${c.clientId}:${c.lat},${c.lng}`)
    .join('|')
  const pins = useMemo(
    () => complaints.filter(c => Number.isFinite(c?.lat) && Number.isFinite(c?.lng)),
    // Keyed on `pinSignature`, not on `complaints` — see the note above.
    [pinSignature],
  )

  const zoneValue = (z) => {
    if (hazard === 'heat') return heat?.score ?? 0
    if (hazard === 'air') return air?.score ?? 0
    return zoneScores[z.id]?.score ?? 0
  }

  const selectedDrain = selectedDrainId ? nodes.find(d => d.id === selectedDrainId) : null
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
        const reports = complaintCounts[z.id] ?? 0
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
                {/* Deliberately the last line, in the muted grey, and labelled
                    unverified on its face. It is a count of what residents said,
                    and it is not an input to the score printed above it. */}
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, borderTop: '1px solid rgba(15,23,42,0.08)', paddingTop: 4 }}>
                  {UNVERIFIED_LABEL}: <strong>{reports}</strong>
                </div>
              </div>
            </Popup>
            {showComplaints && reports > 0 && (
              <Tooltip permanent direction="right" offset={[22, 0]} className="report-badge">
                {reports} report{reports === 1 ? '' : 's'}
              </Tooltip>
            )}
          </CircleMarker>
        )
      })}

      {/* Selection ring for the active zone — the map-side "mark" */}
      {selectedZone && (
        <SelectionRing key={`ring-${selectedZone.id}`} lat={selectedZone.lat} lng={selectedZone.lng} />
      )}

      {showDrains && nodes.map(d => {
        const isServiced = servicedSet.has(d.id)
        const isTaskSelected = selectedDrainId === d.id
        return (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={isTaskSelected ? 11 : 6}
            pathOptions={{
              // Selection uses the deep emerald: the accent emerald is also the
              // "safe" band colour, so a selected low-fill drain drawn in it
              // would be invisible against its own unselected state.
              color: isTaskSelected ? '#007A55' : bandColorHex(d.fillPct),
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
                <div style={{ margin: '4px 0 2px', fontSize: 13 }}>Fill level: <strong>{d.fillPct.toFixed(2)}%</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· simulated telemetry</span></div>
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

      {/* Pinned citizen reports. Two shapes, because they say two different
          things: a small solid marker for the pin itself, and a dashed ring in
          METRES for what that pin is actually worth. A report rounded to ~110 m
          drawn as a bare dot would claim a precision it does not have — and the
          ring must be `Circle` (metres), not `CircleMarker` (pixels), or it
          would shrink and grow with the zoom instead of staying honest. */}
      {showComplaints && pins.map(c => (
        <CircleMarker
          key={c.clientId}
          center={[c.lat, c.lng]}
          radius={5}
          pathOptions={{
            color: '#007A55',
            weight: 1.5,
            fillColor: '#007A55',
            fillOpacity: 0.85,
          }}
        >
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 170 }}>
              <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {UNVERIFIED_LABEL}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.75 }}>
                Position is approximate — about {c.locationPrecisionM ?? 111} m, placed by whoever
                filed the report.
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
      {showComplaints && pins.map(c => (
        <Circle
          key={`acc-${c.clientId}`}
          center={[c.lat, c.lng]}
          radius={c.locationPrecisionM ?? 111}
          interactive={false}
          pathOptions={{
            color: '#007A55',
            weight: 1,
            dashArray: '4 5',
            fillColor: '#007A55',
            fillOpacity: 0.06,
          }}
        />
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
      <MapLegend showComplaints={showComplaints} />
    </div>
  )
}
