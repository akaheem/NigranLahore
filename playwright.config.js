import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // The design system uses long luxury transitions + continuous ambient
    // animation; Playwright's stability heuristic can otherwise time out on
    // clicks. actionTimeout: force-clicks in tests are avoided, this keeps
    // the auto-waiting within reason.
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless GPU processes die after sustained dual-WebGL rendering
          // (Galaxy + LiquidEther), killing pages mid-test with
          // 'session closed'. SwiftShader keeps the suite deterministic;
          // the guards in Galaxy.jsx skip the starfield when WebGL is
          // unavailable, degrading decoration while core features stay live.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
