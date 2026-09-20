const rainColor = mm => {
  if (mm >= 30) return 'var(--risk-severe)'
  if (mm >= 15) return 'var(--risk-high)'
  if (mm >= 5) return 'var(--risk-moderate)'
  return 'var(--risk-safe)'
}

/**
 * Below this, an hour is not rain. The same threshold the summary sentence
 * above the chart calls a "wet hour", so the picture and the sentence can never
 * disagree about how many hours of rain there were.
 */
const DRY_MM = 0.3

/**
 * The axis tops out on one of these rather than on the window's own maximum.
 * A data-max scale redraws itself every time the feed ticks: the same 8 mm bar
 * is tall on a dry day and a stub on a wet one, and two screenshots of this
 * chart are not comparable. These are the calibrated rainfall figures, so the
 * axis lands on a number the rest of the app already talks about.
 */
const SCALE_STEPS = [5, 15, 30, 60, 120]

const PLOT_H = 104
/* A calm window draws a flat rule, not a short chart. At the wet height it was
   56px of nothing above a baseline, which reads as a chart that failed to load
   — the exact misreading this state exists to prevent. */
const CALM_H = 26
const AXIS_W = '2.1rem'

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
  { c: 'var(--border-medium)', l: 'dry' },
  { c: 'var(--risk-safe)', l: 'under 5mm' },
  { c: 'var(--risk-moderate)', l: '≥5mm' },
  { c: 'var(--risk-high)', l: '≥15mm' },
  { c: 'var(--risk-severe)', l: '≥30mm' },
]

export function RainTimeline({ hours = [], times = [], prob = [], compact = false, labelEvery }) {
  if (!hours.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Waiting for the live Open-Meteo feed — bars appear the moment data lands.
      </p>
    )
  }
  const totalMm = hours.reduce((s, v) => s + (v || 0), 0)
  const wetHours = hours.filter(v => (v || 0) >= DRY_MM).length
  const peakProb = prob.length ? Math.max(...prob.map(p => p || 0)) : null
  const windowMax = Math.max(...hours.map(v => v || 0))
  const scaleMax = SCALE_STEPS.find(s => s >= windowMax) ?? SCALE_STEPS[SCALE_STEPS.length - 1]

  // The calibrated thresholds that fit under this axis, plus the top of the
  // scale. A label is dropped when it would overprint the next one up — on a
  // 120mm axis, 5mm and 15mm sit 9px apart and would collide.
  const ticks = SCALE_STEPS
    .filter(s => s <= scaleMax)
    .map(mm => ({ mm, pct: (mm / scaleMax) * 100 }))
    .filter((t, i, all) => i === all.length - 1 || all[i + 1].pct - t.pct >= 14)

  // "No rain in the next 24 hours" is the common case, and it used to render as
  // two dozen green stubs — a colour that means "trace rain" everywhere else in
  // this component, on a day with none. A flat outlook now gets a short, calm
  // plot whose bars are neutral, so it reads as nothing coming rather than as a
  // chart that failed to load.
  const calm = totalMm < DRY_MM
  const plotH = calm ? CALM_H : PLOT_H
  const every = labelEvery ?? (compact ? 12 : hours.length <= 8 ? 1 : 3)

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
        {calm
          ? `No meaningful rain expected in the next ${hours.length} hours — ${totalMm.toFixed(1)} mm across the window.`
          : `${wetHours} hour${wetHours === 1 ? '' : 's'} with rain · ${totalMm.toFixed(1)} mm total${peakProb != null ? ` · peak chance ${peakProb}%` : ''}. Taller bar = more mm; darker = more likely.`}
      </p>

      <div className="flex gap-2">
        {/* The mm scale. Outside the plot rather than laid over it, so the
            gridlines stay clean and no label sits on top of a bar.

            Suppressed when calm, and this is most of why the state looked
            broken: with no rain the axis tops out on its own floor, so the only
            tick that survives the collision filter *is* the scale maximum — a
            lone "5" floating in an empty box, with no bar anywhere on the plot
            for it to measure. */}
        {!calm && (
          <div className="relative shrink-0" style={{ width: AXIS_W, height: plotH }} aria-hidden="true">
            {ticks.map(t => (
              <span
                key={t.mm}
                className="label-micro absolute right-0 tabular-nums"
                style={{ bottom: `${t.pct}%`, transform: 'translateY(50%)' }}
              >
                {t.mm}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="relative" style={{ height: plotH }}>
            {/* Gridlines go with the axis they belong to — a rule with no label
                beside it is just a line through the middle of nothing. */}
            {!calm && ticks.map(t => (
              <div
                key={t.mm}
                className="absolute left-0 right-0"
                style={{ bottom: `${t.pct}%`, height: 1, background: 'var(--border-light)' }}
              />
            ))}
            <div className="absolute left-0 right-0 bottom-0" style={{ height: 1, background: 'var(--border-medium)' }} />

            {/* `items-stretch` gives every column the plot's full height, which
                is what lets a bar's `height: %` mean "percent of the axis"
                rather than resolving against an auto-height parent. */}
            <div className="absolute inset-0 flex items-stretch gap-0.5">
              {hours.map((mm, i) => {
                const v = mm || 0
                const p = prob[i]
                const wet = v >= DRY_MM
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div
                      data-testid="rain-bar"
                      title={`${times[i]?.slice(11, 16) ?? ''} — ${v} mm${p != null ? ` · ${p}% chance` : ''}`}
                      style={{
                        width: '100%',
                        height: `${(v / scaleMax) * 100}%`,
                        minHeight: wet ? 3 : 2,
                        backgroundColor: wet ? rainColor(v) : 'var(--border-medium)',
                        borderRadius: '2px 2px 0 0',
                        opacity: wet && p != null ? 0.45 + Math.min(0.55, (p / 100) * 0.55) : 1,
                        transition: 'height .6s var(--transition-lux)',
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-0.5 mt-1">
            {hours.map((_, i) => (
              <span
                key={i}
                data-testid="rain-label"
                className="flex-1 text-center text-micro tabular-nums"
                style={{ color: 'var(--text-muted)' }}
              >
                {i % every === 0 ? (times[i] ?? '').slice(11, 13) : ' '}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Nothing to decode on a flat outlook. Five band swatches under a bare
          baseline invite the reader to hunt for a colour that is not on the
          plot, which is the same failed-chart misreading by another route. */}
      {!calm && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
          {RAIN_LEGEND.map(b => (
            <span key={b.l} className="label-micro flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: b.c, display: 'inline-block' }} />
              {b.l}
            </span>
          ))}
        </div>
      )}
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
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
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
      <div className="label-micro flex justify-between tabular-nums">
        <span>Now {current}</span>
        <span>24h max {max}</span>
      </div>
      {times.length > 0 && (
        <div className="flex justify-between text-micro tabular-nums" style={{ color: 'var(--text-muted)' }}>
          <span>{times[0]?.slice(11, 13)}:00</span>
          <span>{times[times.length - 1]?.slice(11, 13)}:00</span>
        </div>
      )}
    </div>
  )
}
