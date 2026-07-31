# Moments — upload layer

Scope: just the capture-to-storage pipeline. Auto-styling is intentionally
deferred — posts land with `status = 'pending_style'` and a `style_json`
column that's `NULL` until you build that pass.

## How it works

1. Both phones install the PWA (Chrome → "Add to Home screen"). This requires
   the site served over HTTPS with `manifest.json` + a registered service
   worker — both are in `pwa/`.
2. `manifest.json` registers Moments as an Android **share target** for
   `image/*` and `video/*`. Its `action` points at a Supabase Edge Function.
3. From the gallery: Share → Moments. Android does a real POST navigation
   (multipart/form-data) straight to the Edge Function — no client JS needed
   to catch it.
4. The function stores each file in Supabase Storage, inserts a `posts` row
   and one `post_media` row per file, and responds with a tiny confirmation
   page where you can immediately fix the caption.

Everything lives on Supabase's free tier — no server to run:

- **Supabase Edge Function** (`supabase/functions/share-target`) — receives the
  share POST, uploads to Storage, writes Postgres rows, returns the caption
  page. Also serves `PATCH /posts/:id/caption` and `GET /posts`.
- **Supabase Postgres** — `posts` and `post_media` tables (schema in
  `supabase/migrations/`).
- **Supabase Storage** — the `moments` bucket holds the files (object_key is
  the path in the bucket).
- **Cloudflare Pages** — hosts the `pwa/` static files for free with a real
  HTTPS cert, which is what makes the install prompt + share sheet work.

## Setup

1. Create a free project at [supabase.com](https://supabase.com). Note the
   project ref (the part before `.supabase.co`).
2. Install the Supabase CLI and link it:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   supabase secrets set MOMENTS_BUCKET=moments
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
3. Deploy the function:
   ```bash
   supabase functions deploy share-target
   ```
4. Deploy `pwa/` to Cloudflare Pages with `wrangler` (not drag-drop — the
   proxy worker is skipped by the drag-drop uploader):
   ```bash
   npx wrangler pages deploy pwa --project-name <your-project>
   echo "<anon-key>" | npx wrangler pages secret put SUPABASE_ANON_KEY --project-name <your-project>
   ```
   The share target's `action` must be **same-origin** as the manifest (Chrome
   rejects cross-origin actions), so it stays `/share-target` and `pwa/_worker.js`
   proxies the request to your Supabase function. Redeploy after the secret is
   set. The share target only appears in Android's share sheet once the site is
   served over HTTPS with a real domain.
5. Enable Google sign-in:
   - Google Cloud Console → create an OAuth client ID (Web application)
     with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Supabase dashboard → Authentication → Providers → Google → paste the
     Client ID and Secret. Also set the Site URL to your pages.dev domain
     (Authentication → URL Configuration).
   - Then deploy the auth migration and function:
   ```bash
   supabase db push
   supabase functions deploy share-target
   ```
   (The function requires a signed-in session; redeploying the PWA without
   the function gives you a feed that 401s.)

## Known gaps

- iOS isn't handled — Safari doesn't support the Web Share Target API. Since
  you're both on Android this is out of scope for now. If that changes: an iOS
  Shortcut hitting the function URL directly, or a real Share Extension.
- Photos/videos route through the Edge Function, which has a 256MB memory
  limit — a single share should stay well under ~100MB or it may time out.
- Storage free tier allows 50MB per file upload.

## Next steps (not built yet)

- A feed page that reads `GET /posts` and renders the media (public URLs via
  `storage.from('moments').getPublicUrl(key)` — set the bucket to public-read,
  or add signed URLs).
- The auto-styling pass — flip `status` to `styled` and populate
  `style_json` once you're ready to build it.
- Auth: sign-in is required for everything. The PWA signs in with Google
  (Supabase Auth); the session lives in a cookie so the share-sheet
  navigation and caption page can send it. The edge function rejects every
  request without a valid session, and RLS blocks direct PostgREST reads
  with the anon key. Anyone with a Google account can sign in; to lock it
  to just the two of you: Supabase dashboard → Authentication → Providers →
  Google → turn off "Allow new users to sign up" after both accounts exist
  (existing sessions stay valid).
- Media stays in a public bucket: the feed loads storage URLs directly. Object
  keys are random UUIDs (unguessable), fine for a private journal. Making the
  bucket private needs signed URLs everywhere — not worth it.
