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

  test('light theme is fixed and persists across reload', async ({ page }) => {
    // The hackathon edition ships light-only: no toggle button, data-theme pinned
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByRole('button', { name: /light/i })).toHaveCount(0)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('round-trips between the three views', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await page.getByRole('button', { name: /city overview/i, exact: true }).click({ force: true })
    await expect(page.getByText(/City Overview — Lahore, today/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /Field Ops →/i }).click({ force: true })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /← Citizen view/i }).click({ force: true })
    await expect(page.getByText(/Your area/i)).toBeVisible({ timeout: 15000 })
  })

  test('field ops: mark serviced persists and navigate opens maps', async ({ page }) => {
    // SwiftShader-rendered page load + nav clicks can consume most of the
    // default 30s budget on a loaded machine; this test alone needs headroom.
    test.setTimeout(90_000)
    await page.goto('/')
    await page.getByRole('button', { name: /field ops/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    // One drawer session, two actions: first Navigate (window.open stubbed),
    // then Mark serviced. Keeps headless-GPU load light by opening the drawer
    // exactly once — sustained dual-WebGL rendering has crashed long suites.
    await page.evaluate(() => {
      window.__navUrl = null
      window.open = url => { window.__navUrl = url; return null }
    })
    const card = page.locator('.lux-card-glass').first()
    await card.click({ force: true })
    const serviceBtn = page.getByRole('button', { name: /Mark serviced \(demo\)/i })
    await serviceBtn.waitFor({ state: 'attached', timeout: 15000 })
    // the drawer entrance runs 0.8s; wait it out before dispatching
    await page.waitForTimeout(1200)

    // navigate → Google Maps URL
    const navBtn = page.getByRole('button', { name: /Navigate/i })
    await navBtn.dispatchEvent('click')
    const url = await page.evaluate(() => window.__navUrl)
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\?q=/)

    // service the task — the "Serviced" stat appears and the id persists
    await serviceBtn.dispatchEvent('click')
    await expect(page.getByText('Serviced', { exact: true })).toBeVisible({ timeout: 15000 })
    const doneState = await page.evaluate(() => JSON.parse(localStorage.getItem('nigran-done-at') || '{}'))
    expect(Object.keys(doneState).length).toBeGreaterThan(0)
  })

  test('offline: withholds live values honestly, static scores still render', async ({ page }) => {
    await page.route('**://api.open-meteo.com/**', route => route.abort())
    await page.route('**://air-quality-api.open-meteo.com/**', route => route.abort())
    await page.goto('/')

    // the header pill is the canonical offline signal
    await expect(page.getByText('Snapshot mode')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Your area/i)).toBeVisible()
    // live weather/air are withheld ('—'), never invented
    await expect(page.getByText(/Rain next 6h — Shahdara/).locator('..')).toContainText('—')
    // flood score still renders from the telemetry-only renormalization
    await expect(page.locator('.font-editorial.text-6xl').first()).not.toHaveText('—')
  })
})
