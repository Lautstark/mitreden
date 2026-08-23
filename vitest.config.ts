import { defineConfig } from 'vitest/config';

/*
 * The checks that need no browser.
 *
 * mitreden's suite has been Playwright-only, which suited a page whose whole
 * behaviour is in the DOM. The standing backup brought a different kind of
 * question: what may be written into a folder that a sync client will carry
 * off the machine, and whether a library still survives the round trip out and
 * back. Neither is visible from the outside — an e2e can watch a file appear
 * but cannot assert what must never be inside it.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/unit/setup.ts'],
  },
});
