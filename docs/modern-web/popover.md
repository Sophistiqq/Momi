# Popover API + Anchor Positioning

Used for: the post options menu in `PostViewer.svelte`. Replaces the old
`showMenu` state + `clickOutside` Svelte action + manual `top/right`
positioning.

## How it works

- `popover` on the target element → it lives in the **top layer** (never clipped
  by `overflow: hidden` ancestors, no z-index fights), gets light-dismiss
  (click outside), Escape-to-close, and focus management **for free**.
- `popovertarget="id"` on a button → that button toggles the popover. It also
  becomes the popover's **implicit anchor** for positioning.
- `popovertargetaction="hide"` on a button inside the popover → hides it (use
  on menu items so the menu closes after an action).

## The menu pattern (PostViewer.svelte)

```svelte
<button class="icon-btn menu-btn" popovertarget="post-menu" aria-label="Options">⋯</button>

<div class="menu-list" id="post-menu" popover>
  <button popovertarget="post-menu" popovertargetaction="hide" onclick={startEditPost}>Edit post</button>
  <button popovertarget="post-menu" popovertargetaction="hide" onclick={askDelete} style="color: var(--danger);">Move to Trash</button>
</div>
```

```css
.menu-btn { font-size: 1.15rem; line-height: 1; }
.menu-list {
  position: fixed;
  position-anchor: auto;                 /* use the popovertarget button as anchor */
  position-area: bottom span-right;      /* below the button, right-aligned */
  position-try-fallbacks: flip-block, flip-inline;  /* flip if it would overflow */
  inset: unset; margin: 0;               /* reset UA centering */
  /* …visuals… */
  transition: opacity .15s, translate .15s, overlay .15s, display .15s allow-discrete;
}
.menu-list[popover]:popover-open {
  @starting-style { opacity: 0; translate: 0 -4px; }
}
```

## Notes

- Reset the UA popover defaults (`inset: 0; margin: auto;`) or your
  `position-area` placement will lose to the centered fallback.
- `position-area: bottom span-right` = the cell below the anchor, aligned to
  its inline-end. `top center`, `right span-bottom`, etc. cover the rest.
- Entry/exit animation needs `transition-behavior: allow-discrete` + `@starting-style`
  because the element toggles `display: none`.
- Keep the trigger and popover as siblings near each other in the DOM.
