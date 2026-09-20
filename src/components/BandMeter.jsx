import { BANDS, BAND_COLORS, bandOf } from '../lib/risk.js'

/**
 * The 0-100 band ramp with a marker at `score`.
 *
 * Every hazard in this app used to be a bare number beside a colour word. That
 * states the band but not the position: 74 and 76 are one step apart and read
 * as the same red, and a reader has no way to see how far into a band a score
 * sits or how close it is to leaving it. The ramp puts the number on the scale
 * the model actually scores against.
 *
 * The four segments are the model's real band boundaries (25 / 50 / 75 / 100),
 * not an even gradient, so the ramp's own shape is the banding — which is why
 * the fill is a `clip-path` over the whole ramp rather than a `width: N%` bar.
 * A percentage-width fill would rescale the segments and quietly redraw the
 * boundaries at the wrong places.
 *
 * Colour comes from the `--risk-*` vars, not `BAND_COLORS_HEX`: this renders as
 * DOM and can resolve them, and staying on the vars keeps each band colour
 * defined in exactly one place. The hex twins are for Leaflet, which cannot.
 */
export default function BandMeter({ score, height = 6, className = '' }) {
  const value = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0
  const band = bandOf(value)

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      // The band word lives here rather than as visible text on purpose: the
      // caller already prints it, and a screen reader hearing "Severe" twice
      // for one number is worse than hearing it once with the value attached.
      aria-label={`${value} of 100, ${band.label} band`}
      className={`relative w-full ${className}`}
      style={{ height }}
    >
      {/* The ramp, tinted. `color-mix` derives the tint from the one band
          colour instead of introducing a second palette to keep in sync. Where
          it is unsupported the declaration is dropped, which leaves the track
          empty rather than wrong. */}
      <div className="absolute inset-0 flex overflow-hidden rounded-full">
        {BANDS.map(b => (
          <span
            key={b.key}
            className="flex-1"
            style={{ background: `color-mix(in srgb, ${BAND_COLORS[b.key]} 20%, transparent)` }}
          />
        ))}
      </div>

      {/* The same ramp at full strength, clipped to the score. `inset()` is
          relative to this element's own box, so it tracks the container width
          without measuring anything. */}
      <div
        className="absolute inset-0 flex overflow-hidden rounded-full"
        style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
      >
        {BANDS.map(b => (
          <span key={b.key} className="flex-1" style={{ background: BAND_COLORS[b.key] }} />
        ))}
      </div>

      {/* The marker, outlined in the card's own white so it stays legible
          wherever it lands. `content-box` keeps the measured width honest: the
          2px border is drawn outside the 2px core rather than eating into it. */}
      <span
        aria-hidden="true"
        className="absolute top-1/2 rounded-full"
        style={{
          left: `${value}%`,
          width: 2,
          height: height + 4,
          background: BAND_COLORS[band.key],
          border: '2px solid #FFFFFF',
          boxSizing: 'content-box',
          transform: 'translate(-50%, -50%)',
        }}
      />
    </div>
  )
}

/**
 * The band word as a pill — the score's own colour, tinted for its ground, with
 * a dot so the state still reads without relying on hue.
 *
 * Shared by the hero block and RiskCard rather than written twice: these two
 * show the same score a few hundred pixels apart, and two hand-rolled pills had
 * already drifted into different padding and different tints.
 */
export function BandPill({ score, className = '' }) {
  const band = bandOf(Number.isFinite(score) ? score : 0)
  const color = BAND_COLORS[band.key]
  return (
    <span
      className={`label-micro inline-flex items-center gap-1.5 rounded-full px-2 py-1 ${className}`}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="rounded-full" style={{ width: 5, height: 5, backgroundColor: color }} aria-hidden="true" />
      {band.label}
    </span>
  )
}
