const rainColor = mm => {
  if (mm >= 30) return 'var(--risk-severe)'
  if (mm >= 15) return 'var(--risk-high)'
  if (mm >= 5) return 'var(--risk-moderate)'
  return 'var(--risk-safe)'
}

const mmBarHeight = mm => Math.max(4, Math.min(80, (mm / 15) * 80))

/**
 * 24-hour outlook visualizations for City Overview.
 * Bars colored by the calibrated rainfall bands (RAIN_BANDS in risk.js);
 * AQI sparkline is a pure 2px SVG line in the accent gold.
 */
export function RainTimeline({ hours = [], times = [] }) {
  if (!hours.length) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>loading live data…</p>
  }
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height: 80 }}>
        {hours.map((mm, i) => (
          <div key={i} className="flex-1 flex flex-col items-center" style={{ gap: 2 }}>
            <div
              title={`${times[i]?.slice(11, 13) ?? ''}:00 — ${mm ?? 0} mm`}
              style={{
                width: '100%',
                height: mmBarHeight(mm || 0),
                background: rainColor(mm || 0),
                borderRadius: '2px 2px 0 0',
                opacity: 0.85,
                transition: 'height .6s var(--transition-lux)',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-1">
        {hours.map((_, i) => (
          <span key={i} className="flex-1 text-center text-[0.55rem]" style={{ color: 'var(--text-muted)' }}>
            {i % 3 === 0 ? (times[i] ?? '').slice(11, 13) : ' '}
          </span>
        ))}
      </div>
    </div>
  )
}

export function AqiSparkline({ series = [], times = [] }) {
  if (!series.length) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>loading live data…</p>
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

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56 }}>
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="var(--accent-gold)"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
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
