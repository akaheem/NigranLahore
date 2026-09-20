/**
 * Relative times for the complaints board — "3 hours ago", "2 days ago".
 *
 * A board of citizen reports is read by how recent each one is: a flooded
 * underpass reported twenty minutes ago is a different fact from the same
 * underpass reported last week. So the card leads with the age of the report,
 * not with a timestamp the reader has to subtract in their head.
 *
 * Pure, and takes `now` as an argument, so the boundaries are testable without
 * freezing a clock.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Returns a human phrase, or `null` when there is no usable time — so a card
 * can leave the line out rather than print "Invalid Date".
 */
export function relativeTime(value, now = Date.now()) {
  const at = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(at)) return null

  const delta = now - at
  // A timestamp in the future means clock skew — this device's clock, or the
  // one that filed the report. "in 4 minutes" against a photograph of a flood
  // reads as nonsense, so the future collapses into the present.
  if (delta < MINUTE) return 'just now'

  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(delta / DAY)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  }

  // Past a month, an exact date is more use than a growing week count. Built by
  // hand rather than via toLocaleDateString so the output does not depend on
  // the runtime's locale data; UTC because a day's slip on a month-old report
  // costs nothing and a locale-dependent test is a test that fails elsewhere.
  const date = new Date(at)
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
