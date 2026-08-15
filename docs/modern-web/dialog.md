# `<dialog>`

Used for: the fullscreen post viewer and the delete-confirm in
`PostViewer.svelte`. Replaces custom overlay divs, `confirm()`, a manual
Escape listener, and the `.open` class dance.

## Two kinds

- **Modal** — `showModal()`. Blocks the page, renders in the top layer,
  traps focus, closes on Escape. Use for viewer + confirm.
- **Non-modal** — `show()`. Only if you want a dismissible overlay that
  doesn't trap focus. Rarely what you want.

## Fullscreen viewer (PostViewer.svelte)

```svelte
<dialog class="viewer" bind:this={viewerEl} onclose={() => onClose()}>
  <div class="viewer-panel">…</div>
</dialog>
```

```svelte
$effect(() => {
  if (viewerEl && !viewerEl.open) viewerEl.showModal();
});
```

```css
.viewer {
  position: fixed; inset: 0;
  width: 100vw; height: 100vh; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; overflow: hidden;
  background: var(--bg);
  transition: opacity .2s, overlay .2s allow-discrete, display .2s allow-discrete;
}
.viewer[open] {
  display: flex;
  @starting-style { opacity: 0; }
}
```

- Escape closes the dialog natively → fires `close` → `onClose()` (which
  `history.back()`s). No custom keydown listener needed.
- Hardware back: the feed's `popstate` listener nulls `activePost`, which
  unmounts the dialog. Keep the `history.pushState({ viewer: true })` on open.
- Reset UA dialog defaults (`border`, `padding`, `max-width`, `margin: auto`)
  or the dialog centers itself with a frame.

## Delete confirm (PostViewer.svelte)

`confirm()` is blocking, unstylable, and ugly. `form method="dialog"` gives a
styled native modal where a submit button closes it.

```svelte
<dialog class="confirm-dialog" bind:this={deleteDialog}>
  <form method="dialog">
    <p class="confirm-msg">{confirmMsg}</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" value="cancel">Cancel</button>
      <button class="btn btn-danger" value="ok" onclick={handleDelete}>Delete</button>
    </div>
  </form>
</dialog>
```

```svelte
function askDelete() { deleteDialog?.showModal(); }
```

```css
.confirm-dialog::backdrop { background: rgba(0, 0, 0, .6); }
```

- Any `<button>` inside `method="dialog"` form closes the dialog on click;
  the `onclick` runs first (async delete keeps going after it closes).
- `::backdrop` is the dimmed area behind the dialog — free.
- Nested modals are fine: the confirm opens on top of the viewer dialog;
  Escape closes the topmost.
