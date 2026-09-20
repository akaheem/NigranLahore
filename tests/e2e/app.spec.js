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
    await expect(page.getByRole('button', { name: /complaints/i, exact: true })).toBeVisible()

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

  test('round-trips between the four views', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await page.getByRole('button', { name: /city overview/i, exact: true }).click({ force: true })
    await expect(page.getByText(/City Overview — Lahore, today/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /Field Ops →/i }).click({ force: true })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /← Citizen view/i }).click({ force: true })
    await expect(page.getByText(/Your area/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /complaints/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Complaints — what residents can see/i)).toBeVisible({ timeout: 15000 })
  })

  test('switching views starts the new page at the top', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')

    // Complaints is the longest view — a form plus the board — so it is the one
    // where a reader is most likely to be scrolled well down when they leave it.
    await page.getByRole('button', { name: /complaints/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Complaints — what residents can see/i)).toBeVisible({ timeout: 15000 })

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    // Asserted rather than assumed: if this view could not scroll, the check
    // below would pass for the wrong reason and guard nothing.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await page.getByRole('button', { name: /city overview/i, exact: true }).click({ force: true })
    await expect(page.getByText(/City Overview — Lahore, today/i)).toBeVisible({ timeout: 15000 })

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('field ops: mark serviced records an event and navigate opens maps', async ({ page }) => {
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

    // service the task — it leaves the open queue and starts counting down to
    // being work again, and the event lands in the service log.
    await serviceBtn.dispatchEvent('click')
    await expect(page.getByText(/reopens at 40%/).first()).toBeVisible({ timeout: 15000 })

    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('nigran-services-v1') || '{}'))
    const drained = Object.keys(log)
    expect(drained.length).toBeGreaterThan(0)
    const event = log[drained[0]].at(-1)
    expect(Number.isFinite(event.at)).toBe(true)
    // Real-time mode, so this is a real service and counts.
    expect(event.simulated).toBe(false)
  })

  test('field ops: the lapse runs a drain to the 95% block, and servicing restarts it', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await page.getByRole('button', { name: /field ops/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('group', { name: /simulation clock/i })
      .getByRole('button', { name: '1 min = 1 day' }).click({ force: true })

    // D-1's seed is 87% and it fills at its calibrated 11%/day, so a simulated
    // day — one real minute of lapse — carries it past 95%, where it stops.
    // toBeVisible polls, so a slow machine costs time rather than correctness.
    const d1 = page.locator('.lux-card-glass').filter({ hasText: 'Drain D-1 Shahdara Trunk' })
    await expect(d1.getByText('Blocked — must service')).toBeVisible({ timeout: 150_000 })
    // …and it is pinned there, not merely over the line once
    await expect(d1).toContainText('fill 95.00%')

    // Clearing it restarts the whole cycle: the terminal state is not the end.
    await d1.click({ force: true })
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: /Mark serviced \(demo\)/i }).dispatchEvent('click')

    await expect(d1.getByText('Recently serviced')).toBeVisible({ timeout: 15000 })
    await expect(d1).toContainText(/reopens at 40%/)
    await expect(d1).not.toContainText('Blocked — must service')

    // And the time-lapse service is flagged as such, which is what keeps it out
    // of the published count in the shared log.
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('nigran-services-v1') || '{}'))
    const event = log.d1.at(-1)
    expect(event.simulated).toBe(true)
    expect(event.speed).toBe(1440)
    expect(event.fillAtService).toBe(95)
  })

  test('field ops: simulation clock switches to time-lapse and the model moves', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await page.getByRole('button', { name: /field ops/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Field Ops — prototype dispatch queue/i)).toBeVisible({ timeout: 15000 })

    const clock = page.getByRole('group', { name: /simulation clock/i })
    // Real time is the default, and the honest one: no note claiming otherwise.
    await expect(clock.getByRole('button', { name: 'Real time' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/Time-lapse on/i)).toHaveCount(0)

    await clock.getByRole('button', { name: '1 min = 1 day' }).click({ force: true })

    await expect(clock.getByRole('button', { name: '1 min = 1 day' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/Time-lapse on/i).first()).toBeVisible()
    // The lapse runs the whole app, so the header has to admit to it on the
    // views that have no toggle of their own.
    await expect(page.locator('header').getByText('Time-lapse', { exact: true })).toBeVisible()

    // The point of the lapse: an untouched drain climbs on a 1440x clock, so
    // the top queue row has to change within seconds. At the calibrated real
    // rates (~0.5%/day) it would sit frozen for the length of the suite.
    const row = page.locator('.lux-card-glass').first()
    const before = await row.innerText()
    expect(before).toMatch(/fill \d+\.\d{2}%/)
    await expect.poll(() => row.innerText(), { timeout: 20_000 }).not.toBe(before)
  })

  test('complaints: file a report, back it, and remove it again', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await page.getByRole('button', { name: /complaints/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Complaints — what residents can see/i)).toBeVisible({ timeout: 15000 })

    // The board states two things on its face before anything is filed: that
    // nothing on it is verified, and where the reports actually live. The suite
    // runs with no backend, so the second must read as device-only — a board
    // that implied a shared database it does not have would be the one
    // dishonest claim in the app.
    await expect(page.getByText(/Citizen reports are unverified/i)).toBeVisible()
    await expect(page.getByText(/No shared board is configured/i)).toBeVisible()
    await expect(page.getByText('Nothing reported yet.')).toBeVisible()

    await page.getByLabel(/what is it about/i).selectOption('waterlogging')
    await page.getByLabel(/what is happening/i)
      .fill('Standing water outside the school on Multan Road since Tuesday — children are walking through it.')
    await page.getByRole('button', { name: /file this report/i }).click()

    await expect(page.getByText(/Report filed/i)).toBeVisible({ timeout: 15000 })
    const card = page.locator('article.lux-card-glass').first()
    await expect(card).toContainText('Standing water outside the school')
    // Filed with no board to file to, and the card says so rather than being
    // badged as synced.
    await expect(card.getByText('Saved on this device')).toBeVisible()

    // Backing a neighbour's report — one per device, and the running count is
    // shown as people rather than a bare number.
    await card.getByRole('button', { name: /me too/i }).click()
    await expect(card.getByRole('button', { name: /you confirmed this/i })).toBeVisible()
    await expect(card.getByText('1 person reported this')).toBeVisible()

    // It survives a reload, which is the point of storing it in IndexedDB
    // rather than in component state.
    await page.reload()
    const afterReload = page.locator('article.lux-card-glass').first()
    await expect(afterReload).toContainText('Standing water outside the school', { timeout: 15000 })
    await expect(afterReload.getByRole('button', { name: /you confirmed this/i })).toBeVisible()
    await expect(afterReload.getByText('1 person reported this')).toBeVisible()

    // Removing it is the only destructive action on the board, and it is offered
    // only on a report this device filed.
    await afterReload.getByRole('button', { name: /remove/i }).click()
    await expect(page.getByText('Nothing reported yet.')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('article.lux-card-glass')).toHaveCount(0)
  })

  test('complaints: a report can move, and the card names who moved it', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await page.getByRole('button', { name: /complaints/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Complaints — what residents can see/i)).toBeVisible({ timeout: 15000 })

    await page.getByLabel(/what is happening/i)
      .fill('The drain outside the school has been overflowing since Tuesday morning.')
    await page.getByRole('button', { name: /file this report/i }).click()
    await expect(page.getByText(/Report filed/i)).toBeVisible({ timeout: 15000 })

    const card = page.locator('article.lux-card-glass').first()
    // A report nobody has touched reads as Filed and credits nobody. The point
    // of the assertion is the absence: "the reporter says it is still
    // happening" would be a claim the filer never made, on every new card.
    await expect(card.getByText('Filed')).toBeVisible()
    await expect(card).not.toContainText('still happening')

    // The move the filer is offered is theirs to make, and only theirs.
    await card.getByRole('button', { name: "It's fixed" }).click()

    await expect(card.getByText('Resolved')).toBeVisible({ timeout: 15000 })
    // Who says so, and when — a Resolved that came from the resident and one
    // that came from a crew are different claims, and the card keeps them apart.
    await expect(card).toContainText('The reporter says it is fixed')
    await expect(card).toContainText('just now')

    // It survives a reload, so the move is a record rather than a re-render.
    await page.reload()
    const afterReload = page.locator('article.lux-card-glass').first()
    await expect(afterReload.getByText('Resolved')).toBeVisible({ timeout: 15000 })
    await expect(afterReload).toContainText('The reporter says it is fixed')
    // And the resident may say the problem came back.
    await expect(afterReload.getByRole('button', { name: /still happening/i })).toBeVisible()
  })

  test('complaints: a pin is opt-in, and never carries more than three decimals', async ({ page, context }) => {
    test.setTimeout(120_000)
    // A fix far more precise than anything that should be published: the fourth
    // decimal is about 11 m, which is a doorstep.
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 31.5204123, longitude: 74.3581234 })

    await page.goto('/')
    await page.getByRole('button', { name: /complaints/i, exact: true }).click({ force: true })
    await expect(page.getByText(/Complaints — what residents can see/i)).toBeVisible({ timeout: 15000 })

    // Nothing is placed until the button is pressed, and the copy says so.
    await expect(page.getByText(/only if you press it/i)).toBeVisible()
    await expect(page.getByText('31.520, 74.358')).toHaveCount(0)

    await page.getByRole('button', { name: /use my location/i }).click()
    await expect(page.getByText('31.520, 74.358')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Pinned approximately/i)).toBeVisible()
    await expect(page.getByText(/about 111 m/)).toBeVisible()

    await page.getByLabel(/what is happening/i)
      .fill('Water is standing outside the school gate and the children walk through it.')
    await page.getByRole('button', { name: /file this report/i }).click()
    await expect(page.getByText(/Report filed/i)).toBeVisible({ timeout: 15000 })

    // What was actually STORED, read back out of IndexedDB — the promise is
    // about the record, not about what a line of copy said.
    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('nigran-complaints')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const request = open.result.transaction('complaints').objectStore('complaints').getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result.map(c => ({ lat: c.lat, lng: c.lng })))
      }
    }))

    expect(stored).toHaveLength(1)
    expect(stored[0].lat).toBe(31.52)
    expect(stored[0].lng).toBe(74.358)
    // The guarantee, stated as the rule rather than as the one expected value:
    // no stored coordinate may carry more precision than three decimals.
    for (const value of [stored[0].lat, stored[0].lng]) {
      const decimals = String(value).split('.')[1] ?? ''
      expect(decimals.length).toBeLessThanOrEqual(3)
    }
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
