# Modern Web Reference

Platform-native HTML/CSS patterns for Moments. Rules of thumb:

1. **Reach for the platform first.** HTML/CSS that exists beats JS that reimplements it.
2. **The ladder:** does this feature exist in the browser already (popover, dialog,
   :has, native inputs)? Then use it. Skip the JS unless it's real app logic.
3. **Tiers:**
   - **Ship freely** — `:has()`, CSS nesting, `oklch()`/`color-mix()`, `text-wrap`,
     `@starting-style`, Popover API, `<dialog>`, `color-scheme`, `100dvh`, `:focus-visible`.
   - **Progressive only** — `field-sizing: content`, view transitions, scroll-driven
     animations. Degrade to "no animation" in old browsers automatically.
   - **Check before using** — anything Chromium-only (typed `attr()`, `@function`,
     `sibling-index()`). Guard with `@supports` or skip.

## Files

- `popover.md` — menu/tooltip pattern (Popover API + anchor positioning).
- `dialog.md` — modal pattern (`<dialog>` + `showModal` + `::backdrop`).
- `forms.md` — input/form semantics + `:has()` validation.
- `css.md` — the modern CSS already applied in `static/style.css`.

## Current usage in Moments

| Pattern | Where |
|---|---|
| `[popover]` options menu, anchor-positioned | `PostViewer.svelte` (`.menu-list`) |
| `<dialog>` fullscreen viewer | `PostViewer.svelte` (`.viewer`) |
| `<dialog>` delete confirm, `form method="dialog"` | `PostViewer.svelte` (`.confirm-dialog`) |
| `<form>` submit + `required` + `enterkeyhint` | `customize/+page.svelte` |
| `.post-hit` real `<button>` overlay for feed cards | `+page.svelte` |
| `color-scheme: dark`, `100dvh`, `text-wrap`, `:focus-visible`, `@starting-style` | `static/style.css` |

## Sources (2026)

- https://web.dev/learn/css/popover-and-dialog
- https://web.dev/learn/css/anchor-positioning
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-wrap
- https://zemna.net/blog/the-javascript-i-deleted-with-css-a-2026-survival-guide/
- https://github.com/GoogleChrome/modern-web-guidance
- https://coryrylan.com/blog/dropdown-menus-with-html-popovers-and-css-anchor-positioning
