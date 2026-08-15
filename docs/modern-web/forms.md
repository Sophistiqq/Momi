# Forms & Inputs

Used for: the customize/share form in `customize/+page.svelte`.

## Wrap fields in a real `<form>`

Gives native submit-on-Enter, constraint validation, and a proper submit
target. The Post button becomes `type="submit"` and the handler calls
`e.preventDefault()`.

```svelte
<form onsubmit={post}>
  <label class="cap-label" for="date">Date & Time</label>
  <input class="input" id="date" type="datetime-local" bind:value={postDate} required />
  <input class="input" id="loc" bind:value={location} … autocomplete="off" enterkeyhint="done" />
  <button class="btn btn-primary" type="submit" disabled={posting}>Post</button>
</form>
```

```ts
async function post(e: SubmitEvent) {
  e.preventDefault();
  …
  const isoDate = new Date(postDate).toISOString(); // safe: required blocks empty
}
```

### What each bit buys you

| Attribute | Effect |
|---|---|
| `required` | Native validation stops submit when the date is empty — which previously crashed `new Date('').toISOString()` |
| `enterkeyhint="done"` | Correct mobile keyboard action key ("Done" instead of "Go") |
| `autocomplete="off"` | No address-bar autofill fighting a free-form place name |
| `type="datetime-local"` | Native picker; `color-scheme: dark` makes it render dark |

## Validation styling with `:has()`

The parent selector — style a form based on its children's state, no JS:

```css
.cap-card:has(input:invalid) input[type="datetime-local"] { border-color: var(--danger); }
```

Useful siblings: `form:has(:invalid)`, `label:has(:checked)`. Guards real
state the browser already computes; never write a validator just to tint a
border.

## Comment / caption inputs

Keep `bind:value` + Enter-to-submit (`onkeydown`) — these are not forms (no
submit action), so a form wrapper adds nothing. They're fine as-is.

## Feed cards (`+page.svelte`)

A card that opens a viewer isn't a link, and `<button>` can't legally contain
`<video>`/`<p>`. Correct pattern: keep `<article>` structure, add a real
full-card `<button>` overlay:

```svelte
<article class="post">
  <button type="button" class="post-hit" aria-label="Open post" onclick={() => openPost(post)}></button>
  <time …></time>
  <div class="post-media">…</div>
</article>
```

```css
.post { position: relative; }
.post-hit { position: absolute; inset: 0; z-index: 2; cursor: pointer; }
.post-hit:focus-visible { outline: 2px solid var(--accent); }
```

Removes `role="button"`, `tabindex`, manual Enter/Space handling, and the
`svelte-ignore` comments. Focus ring comes from `:focus-visible` (keyboard
only).
