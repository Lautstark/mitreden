import { defineConfig, devices } from '@playwright/test';

/* E2E_PORT lets parallel checkouts run side by side. With reuseExistingServer,
 * a preview already squatting on this port is not a clash but a silent wrong
 * answer: the suite tests whatever that server is serving, and every failure
 * points at this repository's own selectors.
 *
 * 4173 is vite preview's default and was bildhaft's too, which made the
 * sibling case the likely one - a bildhaft preview left running turned "opens
 * with one Sammlung" into a timeout on `#rows .list__item`. bildhaft moved to
 * 4174 on 2026-08-24, so this default is mitreden's alone and E2E_PORT is for
 * two worktrees of this repo. */
const PORT = Number(process.env.E2E_PORT ?? 4173);

/**
 * The suite runs against the real production bundle, not the dev server, so a
 * build-only breakage cannot slip through to Pages. `npm run test:e2e` builds
 * first; the CI workflow gates deployment on this passing.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],

  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
