# Moved

The shared design language now lives in its own repository, because it governs
three products and was being kept inside one of them:

**https://github.com/Lautstark/design** — [the rule
set](https://github.com/Lautstark/design/blob/main/docs/design.md), and a
[gallery](https://lautstark.github.io/design/) that renders every component with
live tokens, a light/dark switch and an accent picker.

mitreden's tokens are no longer maintained by hand, and no longer live in this
repository at all. They are derived from one declared accent (`#ff8bc7`,
declared in `products/mitreden.json` over there), contrast-checked at
generation time by that repository's `build.js`, and committed there as
`tokens/mitreden.css`. This app imports that file from the pinned package —
see the first import in `src/main.ts` — so there is nothing here to edit.

(This paragraph used to describe them being written into `ui.html` between
markers by a sync step. Both the file and the step are gone: `ui.html` became
`index.html` plus `src/` in the move to Vite, and the package is installed
rather than copied in.)
