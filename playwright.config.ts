import { playwrightConfig } from '@lautstark/toolchain/playwright';

/* E2E_PORT lets parallel checkouts run side by side. With reuseExistingServer,
 * a preview already squatting on this port is not a clash but a silent wrong
 * answer: the suite tests whatever that server is serving, and every failure
 * points at this repository's own selectors.
 *
 * 4173 is vite preview's default and was bildhaft's too, which made the
 * sibling case the likely one - a bildhaft preview left running turned "opens
 * with one Sammlung" into a timeout on `#rows .list__item`. bildhaft moved to
 * 4174 on 2026-08-24, so this default is mitreden's alone and E2E_PORT is for
 * two worktrees of this repo.
 *
 * Everything else — the built page served by `vite preview` on a strict port,
 * the desktop and mobile projects, one retry on CI, the trace on the first
 * retry — is @lautstark/toolchain's, which is where the three products' three
 * identical copies of it went on 2026-09-16.
 *
 * The suite still runs against the real production bundle rather than the dev
 * server, so a build-only breakage cannot slip through to Pages. `npm run
 * test:e2e` builds first; the CI workflow gates deployment on this passing.
 */
export default playwrightConfig({ port: Number(process.env.E2E_PORT ?? 4173) });
