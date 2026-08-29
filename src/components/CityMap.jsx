import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ZONES, DRAIN_NODES, COOL_ASSETS, LAHORE_CENTER } from '../data/lahore.js'

export const bandColor = score =>
  score >= 75 ? 'var(--risk-severe)' : score >= 50 ? 'var(--risk-high)' : score >= 25 ? 'var(--risk-moderate)' : 'var(--risk-safe)'

const coolEmoji = { water: '💧', camp: '⛺', hospital: '🏥' }

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
 */
export default function CityMap({ zoneScores = {}, selectedZone, onSelectZone, showDrains = true, showCool = false }) {
  return (
    <MapContainer
      center={[LAHORE_CENTER.lat, LAHORE_CENTER.lng]}
      zoom={12}
      style={{ height: '100%', width: '100%', borderRadius: 14 }}
      scrollWheelZoom
      attributionControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapFlyTo target={selectedZone} />

      {ZONES.map(z => {
        const r = zoneScores[z.id]?.score ?? 0
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
                <div style={{ margin: '6px 0 2px', fontSize: 13 }}>Flood risk: <strong style={{ color: bandColor(r) }}>{r}/100</strong></div>
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
              <div style={{ margin: '4px 0 2px', fontSize: 13 }}>Fill level: <strong>{d.fillPct}%</strong></div>
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
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Capacity ~{c.capacity.toLocaleString()} people/day</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
