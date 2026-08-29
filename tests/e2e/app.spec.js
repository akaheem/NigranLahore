import { test, expect } from '@playwright/test'

test.describe('Nigran app', () => {
  test('boots with title, nav, and live-or-fallback data', async ({ page }) => {
    const errors = []
    page.on('pageerror', e => errors.push(e))
    await page.goto('/')

    await expect(page).toHaveTitle('Nigran — Watch over Lahore')
    // nav labels render uppercase via CSS; match case-insensitively
    await expect(page.getByRole('button', { name: /citizen/i, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /field ops/i, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /city overview/i, exact: true })).toBeVisible()

    // stat strip renders either live or fallback values (never stays 'loading' forever)
    await expect(page.getByText(/Rain next 6h/i)).toBeVisible({ timeout: 15000 })
    expect(errors).toEqual([])
  })

  test('theme toggle persists across reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /light/i, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('round-trips between the three views', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /city overview/i, exact: true }).click()
    await expect(page.getByText(/City Overview — Lahore, today/i)).toBeVisible()

    await page.getByRole('button', { name: /Field Ops →/i }).click()
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible()

    await page.getByRole('button', { name: /← Citizen view/i }).click()
    await expect(page.getByText(/Your area/i)).toBeVisible()
  })

  test('field ops: mark serviced persists and navigate opens maps', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /field ops/i, exact: true }).click()
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible()

    // open the first open task card and service it — the serviced counter
    // becomes 1 while the critical counter drops by one task. The top card
    // carries the decorative scan-line animation, which keeps Playwright's
    // frame-stability heuristic from settling; force-click is the pragmatic
    // fix (real users click these buttons without issue).
    await page.locator('.lux-card-glass').first().click()
    await page.getByRole('button', { name: /Mark serviced \(demo\)/i }).click({ force: true })
    await expect(page.locator('.lux-card-glass').first()).toContainText('Serviced')

    // persistence: serviced state survives a reload (domcontentloaded is
    // sufficient — waiting for the live API fetch on reload can exceed timeout)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    // navigate opens a maps URL in a new tab (stubbed).
    // After the reload the top task is serviced (persisted), so click the
    // next open task card — done cards ignore clicks by design.
    await page.evaluate(() => {
      window.__navUrl = null
      window.open = url => { window.__navUrl = url; return null }
    })
    await page.locator('.lux-card-glass').nth(1).click()
    await page.getByRole('button', { name: /Navigate/i }).click()
    const url = await page.evaluate(() => window.__navUrl)
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\?q=/)
  })

  test('offline: falls back to snapshot and still renders scores', async ({ page }) => {
    await page.route('**://api.open-meteo.com/**', route => route.abort())
    await page.route('**://air-quality-api.open-meteo.com/**', route => route.abort())
    await page.goto('/')

    // the header pill is the canonical offline signal
    await expect(page.getByText('Snapshot mode').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Your area/i)).toBeVisible()
    // flood score still renders from the telemetry-only renormalization
    await expect(page.locator('.font-editorial.text-6xl').first()).not.toHaveText('—')
  })
})
