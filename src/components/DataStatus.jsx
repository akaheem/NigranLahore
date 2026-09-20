import { Clock, CircleCheck, AlertTriangle, WifiOff } from 'lucide-react'

const dotStyle = color => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  boxShadow: `0 0 8px ${color}`,
})

const fmtTime = ts => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The pill's shape, in one place. All three states are the same treatment —
 * same size, same gap, same order — and only the colour and the glyph change.
 * Each state used to write the full incantation out inline instead:
 * `font-accent text-[0.62rem] uppercase tracking-[0.15em]`, three times, with
 * only the colour differing between them.
 */
const PILL = 'flex items-center gap-2 label-micro'

/**
 * Live-data status pill for the header — makes the live/stale/offline
 * contract visible instead of silent. Retry re-runs the fetch loop.
 *
 * The one control here is Retry, and it carried `fontSize: '0.58rem'` — the
 * smallest type anywhere in the app, on the only thing in the pill a person is
 * meant to click. It is a `.label-micro` on a bordered target now.
 */
export default function DataStatus({ status, lastUpdated, onRetry }) {
  if (status === 'loading') {
    return (
      <span className={PILL} style={{ color: 'var(--accent-gold)' }}>
        <span aria-hidden="true" style={{ ...dotStyle('var(--accent-gold)'), animation: 'pulse 1.6s infinite' }} />
        Fetching live data…
      </span>
    )
  }

  if (status === 'live') {
    return (
      <span className={PILL} style={{ color: 'var(--risk-safe)' }}>
        <CircleCheck size={12} aria-hidden="true" color="var(--risk-safe)" />
        Live{lastUpdated ? ` · ${fmtTime(lastUpdated)}` : ''}
      </span>
    )
  }

  const stale = status === 'stale'
  const tone = stale ? 'var(--risk-moderate)' : 'var(--risk-high)'
  return (
    <span className={PILL} style={{ color: tone }}>
      {stale
        ? <Clock size={12} aria-hidden="true" color={tone} />
        : <WifiOff size={12} aria-hidden="true" color={tone} />}
      {stale ? `Stale cache${lastUpdated ? ` · ${fmtTime(lastUpdated)}` : ''}` : 'Snapshot mode'}
      <button type="button" onClick={onRetry} className="label-micro data-status__retry">
        Retry
      </button>
      {stale
        ? <span aria-hidden="true" style={dotStyle('var(--risk-moderate)')} />
        : <AlertTriangle size={12} aria-hidden="true" color="var(--risk-high)" />}
    </span>
  )
}
