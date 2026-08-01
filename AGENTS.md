# AGENTS.md

Moments is a private photo/video journal PWA. Two people share media from
Android to a feed; both are signed in via Google (Supabase Auth). The repo has
no build step and no test suite — deploys are the test.

## Stack / architecture

- **`pwa/`** — the static PWA (vanilla JS + Alpine.js, one `index.html` feed +
  post viewer, one `caption.html` post-share page, `style.css`, `sw.js`).
  Served by Cloudflare Pages. The domain is `momi-8yq.pages.dev`.
- **`pwa/_worker.js`** — Cloudflare Pages request handler. Proxies every
  `/share-target*` request to the Supabase Edge Function, injecting the
  `SUPABASE_ANON_KEY` env var as a Bearer header. Everything else is served
  statically via `env.ASSETS`.
- **`supabase/functions/share-target/index.ts`** — Supabase Edge Function
  (Deno). Owns all reads/writes: `POST /share-target` (store shared files +
  create post), `PATCH .../posts/:id/caption`, `GET|POST .../posts/:id/comments`,
  `GET /share-target/posts`. Uses the **service role** key for writes and an
  **anon** client only to validate the caller's session via
  `supabase.auth.getUser()`.
- **`supabase/migrations/`** — Postgres schema (SQL, Supabase CLI format).
- **`supabase/storage`** — `moments` bucket, public-read; object keys are the
  path (`<postId>/<uuid>.<ext>`).

## Auth model (important)

- The session lives in the `sb-auth-token` **cookie**, not localStorage,
  because the Android share sheet and caption XHR are plain navigations that
  can't attach an Authorization header. The cookie is slimmed to
  access/refresh tokens only (full session with user metadata exceeds Chrome's
  ~4KB cookie limit).
- The edge function requires a valid session for **every** request (401
  otherwise) and derives the poster/commenter display name from the verified
  user — never trust an author/client-supplied identity.
- RLS is enabled on all tables with read-only policies for `authenticated`;
  all writes go through the edge function's service-role client (bypasses RLS).
- The anon key is public by design (it ships in `pwa/index.html`).

## Developing migrations (tables)

1. Create a new file `supabase/migrations/00NN_short_name.sql`. **Number must
   be the next sequential integer — never reuse one.** A duplicate number
   makes `supabase db push` fail with a migration-version conflict (this
   happened: two `0004_*.sql` files). Current max is `0005`.
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
  `Accept: application/json`), it uploads the body straight to the function and
  303-redirects to `/caption?id=<postId>&ok=1&text=...`. The caption page never
  re-uploads — it only collects an optional caption for that id.
- Updates are **manual**: the new SW installs and waits; `index.html` shows an
  "Update available" banner (polling `registration.update()` every 5 min +
  on `visibilitychange`). Clicking sends `SKIP_WAITING`. Don't re-add
  `skipWaiting()`/auto-reload-on-controllerchange — that was deliberately
  removed as unreliable.

## Local dev

- Wrangler is a devDependency (`package.json`); `wrangler.jsonc` at the repo
  root points `pages_build_output_dir` at `pwa/`. Just run:
  ```bash
  npm install
  npm run dev            # wrangler pages dev --ip 0.0.0.0 --port 8788
  ```
- `.dev.vars` at the repo root holds `SUPABASE_ANON_KEY` (public; gitignored,
  local-only). It's only read when wrangler runs with this repo as its config
  root, so run `npm run dev` from the repo root, not `pwa/`.
- The `_worker.js` proxy needs that key or every `/share-target` call 401s.
- `node_modules/`, `.dev.vars`, and `.wrangler/` are gitignored.

## Deployment (all automatic on push to `master`)

- **Cloudflare Pages**: connected to this repo via the dashboard (root dir
  `pwa`, no build command, output = root). `_worker.js` is picked up
  automatically. Do NOT run `npx wrangler deploy` — there is no `wrangler.toml`
  and it fails.
- **Supabase**: `.github/workflows/deploy-supabase.yml` runs on pushes
  touching `supabase/**` and does `supabase db push` + `supabase functions
  deploy share-target`. Needs the `SUPABASE_ACCESS_TOKEN` GitHub secret
  (Personal Access Token from the Supabase dashboard).
- Function secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, `MOMENTS_BUCKET`) live on the function and persist
  across deploys; don't re-set them in CI.

## Conventions

- No build, no lint, no tests. Keep changes dependency-free — the whole app is
  CDN Alpine + supabase-js.
- Posts land with `status = 'pending_style'`; auto-styling is an explicit
  future pass, not something to build speculatively.
