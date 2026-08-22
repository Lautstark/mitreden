# Moved

The shared design language now lives in its own repository, because it governs
three products and was being kept inside one of them:

**https://github.com/Lautstark/design** — [the rule
set](https://github.com/Lautstark/design/blob/main/docs/design.md), and a
[gallery](https://lautstark.github.io/design/) that renders every component with
live tokens, a light/dark switch and an accent picker.

mitreden's tokens are no longer maintained by hand. They are derived from one
declared accent (`#ff8bc7`), contrast-checked at generation time, and written into
`ui.html` between markers by that repository's `build.js`. Editing them here lasts
until the next sync.
