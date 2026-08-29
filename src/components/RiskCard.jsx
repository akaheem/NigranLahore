import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { bandColor, bandLabel } from '../lib/risk.js'

/**
 * Glass risk card — the citizen's headline view of one hazard.
 * score 0-100, whys: explainable reasons list, accent: hazard label.
 */
export default function RiskCard({ num, title, score, unit = '/100', whys = [], footer, delay = 0 }) {
  const [open, setOpen] = useState(false)
  const color = bandColor(score)
  const label = bandLabel(score)

  return (
    <div className="lux-card-glass fade-in-lux relative overflow-hidden" style={{ animationDelay: `${delay}s` }}>
      <div className="thin-line absolute top-0 left-0 right-0" style={{ background: color, height: 3 }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="editorial-header-num text-lg leading-none">{num}</p>
          <h3 className="mt-2 font-accent uppercase tracking-[0.15em] text-sm" style={{ color: 'var(--text-secondary)' }}>
            {title}
          </h3>
        </div>
        <div className="text-right">
          <div className="font-editorial text-5xl leading-none" style={{ color }}>
            {score}
            <span className="text-lg" style={{ color: 'var(--text-muted)' }}>{unit}</span>
          </div>
          <p className="font-accent text-[0.65rem] uppercase tracking-[0.2em] mt-1" style={{ color }}>
            {label}
          </p>
        </div>
      </div>

      {footer && <div className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>{footer}</div>}

      {whys.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 font-accent text-[0.68rem] uppercase tracking-[0.18em]"
            style={{ color: 'var(--accent-gold)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Why this number?
            <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .3s var(--transition-lux)' }} />
          </button>
          {open && (
            <ul className="fade-in-lux mt-3 space-y-2 text-[0.82rem] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {whys.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span style={{ color: 'var(--accent-gold)' }}>—</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
