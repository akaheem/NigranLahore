import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { bandColor } from '../lib/risk.js'
import BandMeter, { BandPill } from './BandMeter.jsx'

/**
 * Glass risk card — the citizen's headline view of one hazard.
 * score 0-100, whys: explainable reasons list, accent: hazard label.
 *
 * The layout is a deliberate hierarchy rather than four peers: the roman
 * numeral identifies the hazard, the heading names it, the score is the single
 * largest thing in the card, the band pill says what the score means, and the
 * meter says where it sits. Previously the number, the label and the heading
 * were all within a couple of pixels of each other, so nothing led.
 */
export default function RiskCard({ num, title, score, unit = '/100', whys = [], footer, delay = 0 }) {
  const [open, setOpen] = useState(false)
  const color = bandColor(score)

  return (
    // `flex flex-col` exists for one reason: the three cards in the III/IV/V row
    // sit in a `md:grid-cols-3`, so the grid stretches them to a common height,
    // but their contents above the disclosure differ — a title that wraps to one
    // line beside one that wraps to two, and footers of two lines beside three.
    // Block flow therefore left "Why this number?" at three different heights,
    // which reads as three misaligned cards rather than one row. As a column,
    // `mt-auto` on the disclosure can absorb the slack and the three controls
    // land on a common baseline.
    <div className="lux-card-glass fade-in-lux relative overflow-hidden flex flex-col" style={{ animationDelay: `${delay}s` }}>
      <div className="thin-line absolute top-0 left-0 right-0" style={{ background: color, height: 3 }} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="editorial-header-num text-lg leading-none">{num}</p>
          {/* `label-eyebrow text-sm` is the composition the components layer
              exists to allow: the class supplies family, case and tracking, and
              the utility supplies the size. A card heading is read, not
              skimmed, so it stays a step above the micro labels below it. */}
          <h3 className="label-eyebrow text-sm mt-2">{title}</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="figure text-5xl" style={{ color }}>
            {score}
            <span className="text-lg" style={{ color: 'var(--text-muted)' }}>{unit}</span>
          </div>
          <BandPill score={score} className="mt-2" />
        </div>
      </div>

      <BandMeter score={score} className="mt-4" />

      {footer && <div className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>{footer}</div>}

      {whys.length > 0 && (
        // `mt-auto` rather than `mt-4` so this sits at the foot of the card and
        // lines up across the row; `pt-4` keeps a real gap even on the tallest
        // card in the row, where there is no slack left to absorb.
        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="label-micro flex items-center gap-1.5"
            style={{ color: 'var(--accent-gold)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Why this number?
            <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .3s var(--transition-lux)' }} />
          </button>
          {open && (
            <ul className="fade-in-lux mt-3 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
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
