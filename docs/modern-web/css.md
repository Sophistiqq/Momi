# Modern CSS applied in `static/style.css`

Plain CSS, served verbatim (no build step) — so modern features are usable
directly. Nothing here needs a preprocessor.

## Applied

| Feature | Where | What it replaced / fixes |
|---|---|---|
| `color-scheme: dark` | `:root` | Native controls (`datetime-local` picker, scrollbars) render dark |
| `accent-color: var(--accent)` | `:root` | Tints native form control chrome |
| `--danger` token | `:root` | One source for the delete red (was `#ff5e5e` inline) |
| `min-height: 100dvh` | `body` | No jump when the mobile URL bar collapses |
| `text-wrap: balance` | `.logo`, `.state h2` | Balanced headline wrapping, no orphan words |
| `text-wrap: pretty` | `.post-caption`, `.comment .c-body` | Avoids orphaned lines in body text |
| `:focus-visible` | buttons, `.post-hit`, dots | Keyboard-only focus ring; no ring on mouse clicks |
| `@starting-style` + `transition-behavior: allow-discrete` | `.viewer[open]`, `.menu-list`, `.confirm-dialog`, `.update-banner` | Entry/exit animation when an element toggles `display: none` (was instant pop) |
| Native nesting (`@starting-style` inside `[open]`) | viewer/menu/banner | No build step |
| `@keyframes rise-in` + staggered `animation-delay` | `.timeline .post`, `.comment` | Staggered feed/comment entrance |
| `@media (prefers-reduced-motion: reduce)` | global | Kills all animation/transition + delay for users who opt out |
| Slider arrows `.media-nav`/`.btn-nav` | viewer | Prev/next buttons over the strip (was swipe/dots only) |
| Shimmer skeleton `.skel-*` | feed + customize loading states | Placeholder blocks with a shimmer sweep (was bare spinner) |

## Deliberately not applied

| Feature | Why |
|---|---|
| `oklch()` / `color-mix()` palette derivation | Would visibly shift the tuned dark palette; revisit when the design system grows |
| `@layer` cascade layers | Organizational churn on a 250-line file; specificity wars aren't happening yet |
| Full nesting pass | Same — structure is already grouped by section comments |
| `field-sizing: content` | Auto-growing textareas; progressive enhancement, add when wanted |
| Container queries | Fixed 640px feed + fixed viewer; no component-context responsiveness needed |
| `light-dark()` | App is dark-only |

## Snippets worth copying

```css
/* entry/exit animation for display:none toggles */
.el {
  transition: opacity .2s, overlay .2s allow-discrete, display .2s allow-discrete;
}
.el[open] { @starting-style { opacity: 0; } }

/* tint all native controls with the brand accent */
:root { accent-color: var(--accent); color-scheme: dark; }

/* keyboard-only focus ring */
.btn:focus-visible, .icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```
