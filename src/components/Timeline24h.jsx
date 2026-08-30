const rainColor = mm => {
  if (mm >= 30) return 'var(--risk-severe)'
  if (mm >= 15) return 'var(--risk-high)'
  if (mm >= 5) return 'var(--risk-moderate)'
  return 'var(--risk-safe)'
}

const mmBarHeight = mm => Math.max(4, Math.min(80, (mm / 15) * 80))

/**
 * Rain outlook visualizations for Citizen / City Overview.
 * Bars colored by the calibrated rainfall bands (RAIN_BANDS in risk.js).
 * `prob` (optional % per hour) tints bar opacity — a light-rain hour with 90%
 * chance reads darker than the same mm at 20% chance.
 * `compact` renders a denser 72h strip with a sparser hour label rhythm.
 * Every timeline includes a plain-language legend so a first-time visitor can
 * read it without guessing what bar heights/colors mean.
 */
const RAIN_LEGEND = [
  { c: 'var(--risk-safe)', l: 'trace' },
  { c: 'var(--risk-moderate)', l: 'light ≥5mm' },
  { c: 'var(--risk-high)', l: 'heavy ≥15mm' },
  { c: 'var(--risk-severe)', l: 'intense ≥30mm' },
]

export function RainTimeline({ hours = [], times = [], prob = [], compact = false }) {
  if (!hours.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Waiting for the live Open-Meteo feed — bars appear the moment data lands.
      </p>
    )
  }
  const totalMm = hours.reduce((s, v) => s + (v || 0), 0)
  const wetHours = hours.filter(v => (v || 0) >= 0.3).length
  const peakProb = prob.length ? Math.max(...prob.map(p => p || 0)) : null
  return (
    <div>
      <p className="text-[0.7rem] mb-2" style={{ color: 'var(--text-secondary)' }}>
        {totalMm < 0.3
          ? 'No meaningful rain expected in this window — bars show trace amounts only.'
          : `${wetHours} hour${wetHours === 1 ? '' : 's'} with rain · ${totalMm.toFixed(1)} mm total${peakProb != null ? ` · peak chance ${peakProb}%` : ''}. Taller bar = more mm; darker = more likely.`}
      </p>
      <div className="flex items-end gap-0.5" style={{ height: 80 }}>
        {hours.map((mm, i) => {
          const p = prob[i]
          return (
            <div key={i} className="flex-1 flex flex-col items-center" style={{ gap: 2 }}>
              <div
                title={`${times[i]?.slice(11, 16) ?? ''} — ${mm ?? 0} mm${p != null ? ` · ${p}% chance` : ''}`}
                style={{
                  width: '100%',
                  height: mmBarHeight(mm || 0),
                  background: rainColor(mm || 0),
                  borderRadius: '2px 2px 0 0',
                  opacity: p != null ? 0.35 + Math.min(0.65, (p / 100) * 0.65) : 0.85,
                  transition: 'height .6s var(--transition-lux)',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-0.5 mt-1">
        {hours.map((_, i) => (
          <span key={i} className="flex-1 text-center text-[0.55rem]" style={{ color: 'var(--text-muted)' }}>
            {compact ? (i % 12 === 0 ? (times[i] ?? '').slice(11, 13) : ' ') : (i % 3 === 0 ? (times[i] ?? '').slice(11, 13) : ' ')}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {RAIN_LEGEND.map(b => (
          <span key={b.l} className="flex items-center gap-1 font-accent" style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: b.c, display: 'inline-block' }} />
            {b.l}
          </span>
        ))}
      </div>
    </div>
  )
}

export function AqiSparkline({ series = [], times = [] }) {
  if (!series.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Waiting for the live Open-Meteo air feed — the 24-hour AQI line appears when data lands.
      </p>
    )
  }
  const W = 100
  const H = 40
  const points = series.map((aqi, i) => {
    const x = series.length > 1 ? (i / (series.length - 1)) * W : W / 2
    const y = H - Math.min(1, (aqi || 0) / 300) * H
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const max = Math.max(...series.map(v => v || 0))
  const current = series[series.length - 1] ?? 0
  const bandLabel =
    current <= 50 ? 'Good — air is safe for everyone' :
    current <= 100 ? 'Moderate — unusually sensitive people should limit long outdoor exertion' :
    current <= 150 ? 'Unhealthy for sensitive groups — children, elderly and asthma patients should ease off outdoor activity' :
    'Unhealthy — everyone should limit prolonged outdoor exertion'

  return (
    <div>
      <p className="text-[0.7rem] mb-2" style={{ color: 'var(--text-secondary)' }}>
        The line traces US AQI hour-by-hour, past 12 hours to the next 12: <strong>{current} now</strong>, peaking at {max}.{' '}
        {bandLabel}. Hover the line for hourly values.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56 }}>
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="var(--accent-gold)"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <title>{`US AQI: ${series.map((v, i) => `${(times[i] ?? '').slice(11, 13) || i}h ${v}`).join(', ')}`}</title>
        </polyline>
      </svg>
      <div className="flex justify-between font-accent text-[0.6rem] uppercase tracking-[0.15em]" style={{ color: 'var(--text-muted)' }}>
        <span>Now {current}</span>
        <span>24h max {max}</span>
      </div>
      {times.length > 0 && (
        <div className="flex justify-between text-[0.55rem]" style={{ color: 'var(--text-muted)' }}>
          <span>{times[0]?.slice(11, 13)}:00</span>
          <span>{times[times.length - 1]?.slice(11, 13)}:00</span>
        </div>
      )}
    </div>
  )
}
