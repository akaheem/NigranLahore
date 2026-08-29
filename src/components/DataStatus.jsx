import { Clock, CheckCircle2, AlertTriangle, WifiOff } from 'lucide-react'

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
 * Live-data status pill for the header — makes the live/stale/offline
 * contract visible instead of silent. Retry re-runs the fetch loop.
 */
export default function DataStatus({ status, lastUpdated, onRetry }) {
  if (status === 'loading') {
    return (
      <span className="flex items-center gap-2 font-accent text-[0.62rem] uppercase tracking-[0.15em]" style={{ color: 'var(--accent-gold)' }}>
        <span style={{ ...dotStyle('var(--accent-gold)'), animation: 'pulse 1.6s infinite' }} />
        Fetching live data…
      </span>
    )
  }

  if (status === 'live') {
    return (
      <span className="flex items-center gap-2 font-accent text-[0.62rem] uppercase tracking-[0.15em]" style={{ color: 'var(--risk-safe)' }}>
        <CheckCircle2 size={12} color="var(--risk-safe)" />
        Live{lastUpdated ? ` · ${fmtTime(lastUpdated)}` : ''}
      </span>
    )
  }

  const stale = status === 'stale'
  return (
    <span className="flex items-center gap-2 font-accent text-[0.62rem] uppercase tracking-[0.15em]" style={{ color: stale ? 'var(--risk-moderate)' : 'var(--risk-high)' }}>
      {stale ? <Clock size={12} color="var(--risk-moderate)" /> : <WifiOff size={12} color="var(--risk-high)" />}
      {stale ? `Stale cache${lastUpdated ? ` · ${fmtTime(lastUpdated)}` : ''}` : 'Snapshot mode'}
      <button
        type="button"
        onClick={onRetry}
        className="font-accent uppercase tracking-[0.15em]"
        style={{
          background: 'none',
          border: '1px solid var(--border-medium)',
          borderRadius: 999,
          color: 'var(--text-secondary)',
          fontSize: '0.58rem',
          padding: '0.12rem 0.55rem',
          cursor: 'pointer',
          transition: 'all .3s var(--transition-lux)',
        }}
      >
        Retry
      </button>
      {stale && <span style={dotStyle('var(--risk-moderate)')} />}
      {!stale && <AlertTriangle size={12} color="var(--risk-high)" />}
    </span>
  )
}
