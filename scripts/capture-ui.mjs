/**
 * Capture the four views as PNGs, so the UI can be reviewed as rendered pixels
 * rather than as source.
 *
 * Run against a preview server:
 *   npm run build && npm run preview -- --port 4173 --strictPort &
 *   node scripts/capture-ui.mjs
 *
 * Viewport shots rather than `fullPage: true`, deliberately: the ambient
 * background layers and the vignette are `position: fixed`, and a stitched
 * full-page capture would paint them over the first screen only — making the
 * page look worse than it renders and sending the review after a fake problem.
 *
 * SwiftShader is required for the same reason the E2E config uses it: headless
 * GPU processes die after sustained dual-WebGL rendering (Galaxy + LiquidEther).
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.CAPTURE_URL ?? 'http://localhost:4173'
const OUT = 'screenshots'

// Each view's own heading, used to prove the right page was captured. Without
// this a botched seeding captures the default view four times and says nothing
// — which it did, because `useLocalStorageState` reads the value with
// `JSON.parse`, so a raw `'overview'` fails to parse and falls back to the
// default. The seeded value has to be JSON.
const VIEW_MARKER = {
  citizen: /Your area/i,
  ops: /Field Ops — prototype dispatch queue/i,
  overview: /City Overview — Lahore, today/i,
  complaints: /Complaints — what residents can see/i,
}

const CAPTURES = [
  { view: 'citizen', label: 'desktop', width: 1440, height: 900 },
  { view: 'citizen', label: 'desktop-footer', width: 1440, height: 900, scrollBottom: true },
  { view: 'ops', label: 'desktop', width: 1440, height: 900 },
  { view: 'overview', label: 'desktop', width: 1440, height: 900 },
  { view: 'complaints', label: 'desktop', width: 1440, height: 900 },
  { view: 'citizen', label: 'mobile', width: 390, height: 844 },
  { view: 'complaints', label: 'mobile', width: 390, height: 844 },
]

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

// Grouped by viewport: one context per size, so the seeding reload only happens
// when the size actually changes.
let current = null

for (const shot of CAPTURES) {
  const size = `${shot.width}x${shot.height}`
  if (current?.size !== size) {
    await current?.context.close()
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
    })
    current = { size, context, page: await context.newPage() }
  }

  const { page } = current
  // The active view is persisted in localStorage — JSON-encoded — so seed it
  // and reload rather than driving the nav: deterministic, and independent of
  // click timing.
  await page.goto(BASE, { waitUntil: 'load' })
  await page.evaluate(
    id => localStorage.setItem('nigran-view', JSON.stringify(id)),
    shot.view,
  )
  await page.reload({ waitUntil: 'load' })

  // Hard gate: the file that gets written has to be the view that was asked
  // for. A wrong page here would be reviewed as if it were the right one.
  await page.getByText(VIEW_MARKER[shot.view]).first()
    .waitFor({ timeout: 30_000 })
    .catch(() => { throw new Error(`captured page is not the ${shot.view} view`) })

  // The stat strip is the last data on the page to settle.
  await page.getByText(/Rain next 6h/i).waitFor({ timeout: 30_000 }).catch(() => {})
  // The decorative layers are lazily imported WebGL; without this the ambient
  // animation is captured mid-mount, which is not what a visitor sees.
  await page.waitForTimeout(3500)

  if (shot.scrollBottom) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(600)
  }

  const file = `${OUT}/${shot.view}-${shot.label}.png`
  await page.screenshot({ path: file, animations: 'disabled' })
  console.log(file)
}

await current?.context.close()
await browser.close()
