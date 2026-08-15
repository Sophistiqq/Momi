# AGENTS.md

Moments is a private photo/video journal PWA. Two people share media from
Android to a feed; both are signed in via Google (Supabase Auth). The frontend
is a **SvelteKit (Svelte 5) SPA** built to static files with `adapter-static`
and served by Cloudflare Pages. There is **no test suite — deploys are the
test**.

## Stack / architecture

- **`src/`** — SvelteKit app (Svelte 5 runes, no SSR, SPA fallback):
  - `src/routes/+page.svelte` — the timeline feed + post viewer.
  - `src/routes/customize/+page.svelte` — post-share preview screen: reads the
    deferred share from IndexedDB, auto-detects GPS via EXIF (exifr) +
    reverse-geocodes via Nominatim, collects caption + location, then uploads.
  - `src/lib/supabase.js` — supabase-js client with a **cookie-backed storage**
    (see Auth model). `hasStoredSession()` reads the cookie synchronously so
    the first render never flashes the login page.
  - `src/lib/session.svelte.js` — shared auth state (Svelte 5 runes).
  - `src/lib/api.js` — fetch wrappers for the edge function + date helpers.
  - `src/lib/share.js` — IndexedDB reader for deferred shares + upload helper.
  - `src/lib/PostViewer.svelte` — fullscreen post viewer (native `<dialog>`;
    options menu is an HTML popover).
- **`static/`** — copied verbatim into the build: `manifest.json`,
  `style.css`, `icons/`, `sw.js`, and **`_worker.js`** (Cloudflare Pages
  request handler; see below).
- **`supabase/functions/share-target/index.ts`** — Supabase Edge Function
  (Deno). Owns all reads/writes: `POST /share-target` (store shared files +
  create post, optional `location`), `PATCH .../posts/:id/caption`,
  `GET|POST .../posts/:id/comments`, `GET /share-target/posts`. Uses the
  **service role** key for writes and an **anon** client only to validate the
  caller's session via `supabase.auth.getUser()`.
- **`supabase/migrations/`** — Postgres schema (SQL, Supabase CLI format).
- **`supabase/storage`** — `moments` bucket, public-read; object keys are the
  path (`<postId>/<uuid>.<ext>`).

## Upload flow (share → customize → upload)

1. Android share → POST `/share-target` (multipart, no `Accept: application/json`).
2. **`sw.js` does NOT upload.** It stashes the files + text in IndexedDB
   (`momi-share` DB, `pending` store) and 303-redirects to
   `/customize?id=<uuid>`.
3. The customize page reads the share, shows previews, extracts GPS from the
   first image's EXIF (exifr) and reverse-geocodes it (Nominatim), lets you
   edit caption + location, then POSTs multipart back to `/share-target` with
   `Accept: application/json`. The edge function inserts the post (with
   `location`) and returns `{ postId }`.

## Auth model (important)

- The session lives in the `sb-auth-token` **cookie**, not localStorage,
  because the Android share sheet and customize page are plain navigations
  that can't attach an Authorization header. The cookie is slimmed to
  access/refresh tokens only (full session with user metadata exceeds Chrome's
  ~4KB cookie limit).
- The edge function requires a valid session for **every** request (401
  otherwise) and derives the poster/commenter display name from the verified
  user — never trust an author/client-supplied identity.
- RLS is enabled on all tables with read-only policies for `authenticated`;
  all writes go through the edge function's service-role client (bypasses RLS).
- The anon key is public by design (it ships in `src/lib/supabase.js`).

## Developing migrations (tables)

1. Create a new file `supabase/migrations/00NN_short_name.sql`. **Number must
   be the next sequential integer — never reuse one.** A duplicate number
   makes `supabase db push` fail with a migration-version conflict. Current
   max is `0008`.
2. Use idempotent DDL where it fits: `create table if not exists`,
   `add column if not exists`.
3. RLS: enable it on new tables and add read policies for `authenticated`
   (see `0004_auth.sql`). All writes go through the function, so write
   policies aren't needed.
4. Apply + deploy:
   ```bash
   supabase db push            # or rely on CI below
   supabase functions deploy share-target
   ```
   If the function code references a column the DB doesn't have yet, GET
   `/share-target/posts` 500s (e.g. when `author` was added but the migration
   hadn't been pushed). Deploy DB before/when the function.

## Service worker

- `sw.js` handles the Android share flow: on a POST to `/share-target` (no
  `Accept: application/json`), it stores the files in IndexedDB and
  303-redirects to `/customize?id=<uuid>`. The customize page never re-uploads
  from the SW — it uploads itself.
- Updates are **manual**: the new SW installs and waits; the root layout shows
  an "Update available" banner (polling `registration.update()` every 5 min +
  on `visibilitychange`). Clicking sends `SKIP_WAITING`. Don't re-add
  `skipWaiting()`/auto-reload-on-controllerchange — that was deliberately
  removed as unreliable.

## Local dev

- Vite dev with a `/share-target` proxy to the Supabase edge function
  (injects the anon key from `.dev.vars`, which is gitignored/local-only):
  ```bash
  npm install
  npm run dev            # vite dev --port 8788
  ```
- To test the real production worker (`_worker.js` SPA fallback + proxy):
  ```bash
  npm run dev:worker     # vite build && wrangler pages dev build --port 8788
  ```
- `build/` is gitignored; `wrangler.jsonc` points `pages_build_output_dir` at
  `build`.

## Deployment

- **Cloudflare Pages**: connected to this repo via the dashboard. Must be
  configured with root directory = repo root, build command `npm run build`,
  output directory `build`, and `NODE_VERSION` = 22 (the `.node-version` file
  is a hint; Pages reads the env var). `_worker.js` ships in the build output
  (advanced mode) and is picked up automatically. Do NOT run
  `npx wrangler deploy` — there is no pages worker config and it fails.
- **Supabase**: `.github/workflows/deploy-supabase.yml` runs on pushes
  touching `supabase/**` and does `supabase db push` + `supabase functions
  deploy share-target`. Needs the `SUPABASE_ACCESS_TOKEN` GitHub secret
  (Personal Access Token from the Supabase dashboard).
- Function secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, `MOMENTS_BUCKET`) live on the function and persist
  across deploys; don't re-set them in CI.

## Conventions

- Svelte 5 runes (`$state`, `$derived`, `$effect`) for all reactive state;
  shared state lives in `.svelte.js` modules. Keep components dependency-free
  apart from `@supabase/supabase-js` and `exifr`.
- Posts land with `status = 'pending_style'`; auto-styling is an explicit
  future pass, not something to build speculatively.
- Future features in the pipeline (build them in Svelte): memories reels
  (animated showcases), maps of post locations, richer EXIF usage.
