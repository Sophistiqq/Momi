import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Anon-key client: used only to validate the caller's session (service role
// can't call getUser as a user). The session arrives via the sb-auth-token
// cookie, because the Android share-sheet POST and the caption page's XHR
// can't attach an Authorization header.
const anon = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
);

const BUCKET = Deno.env.get('MOMENTS_BUCKET') ?? 'moments';
const TOKEN_COOKIE = 'sb-auth-token';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const user = await getUser(req);
    if (!user) return unauthorized(req);

    // Android's share sheet does a real browser navigation: POST multipart/form-data
    // straight to this URL. We store the files, create a "pending_style" post,
    // and respond with an HTML page (not JSON) since this is a page load, not a fetch.
    if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
      return handleShare(req, user);
    }

    // Update/Delete/Restore a post.
    const postMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)$/);
    if (req.method === 'PATCH' && postMatch) {
      return handleUpdatePost(req, postMatch[1]);
    }
    if (req.method === 'DELETE' && postMatch) {
      return handleDeletePost(postMatch[1]);
    }

    // Lets either of you fix the caption right after upload, or later from the feed.
    const captionMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)\/caption$/);
    if (req.method === 'PATCH' && captionMatch) {
      return handleUpdatePost(req, captionMatch[1]);
    }

    // Comments on a post.
    const commentsMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)\/comments$/);
    if (req.method === 'GET' && commentsMatch) {
      return handleComments(commentsMatch[1]);
    }
    if (req.method === 'POST' && commentsMatch) {
      return handleAddComment(req, commentsMatch[1], user);
    }

    if (req.method === 'GET' && url.pathname.endsWith('/share-target/posts')) {
      return handleList(req);
    }

    return new Response('Not found', { status: 404 });
  } catch (err: any) {
    console.error('Unhandled error:', err);
    return Response.json(
      { error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
});

// Extract the access_token from the session cookie and verify it against
// Supabase Auth. Returns null (-> 401) for missing, malformed, or stale
// sessions. Service-role writes below are fine because the caller is proven
// to be a signed-in user of this project.
async function getUser(req: Request) {
  const m = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]*)`));
  if (!m) return null;
  try {
    const token = JSON.parse(decodeURIComponent(m[1]))?.access_token;
    if (!token) return null;
    const { data, error } = await anon.auth.getUser(token);
    return error ? null : data.user;
  } catch {
    return null;
  }
}

// Display name for a verified user. Google OAuth puts the real name in
// user_metadata; fall back to the email prefix.
function authorName(user: any) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Anonymous'
  );
}

function unauthorized(req: Request): Response {
  if ((req.headers.get('accept') ?? '').includes('application/json')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Moments</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#1b1622; color:#f2ece5;
    display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; text-align:center; }
  a { color:#d4a574; font-weight:600; }
</style></head>
<body>
  <p>Sign in on the Moments home screen first, then share again. <a href="/">Open Moments</a> · auth-v2</p>
</body></html>`, { status: 401, headers: { 'Content-Type': 'text/html' } });
}

async function handleShare(req: Request, user: any): Promise<Response> {
  const form = await req.formData();
  const text = (form.get('text') as string) ?? '';
  const location = (form.get('location') as string) ?? null;
  const createdAtForm = form.get('created_at') as string | null;
  const files = form.getAll('photos') as File[];

  if (files.length === 0) {
    return renderPage('Nothing came through — try sharing again.');
  }

  const postId = crypto.randomUUID();
  const createdAt = createdAtForm || new Date().toISOString();

  const { error: postErr } = await supabase.from('posts').insert({
    id: postId,
    caption: text,
    author: authorName(user),
    created_at: createdAt,
    status: 'pending_style',
    location,
  });
  if (postErr) throw postErr;

  let order = 0;
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const key = `${postId}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType: file.type || 'application/octet-stream' });
    if (upErr) throw upErr;

    const { error: mediaErr } = await supabase.from('post_media').insert({
      id: crypto.randomUUID(),
      post_id: postId,
      object_key: key,
      mime_type: file.type || 'application/octet-stream',
      sort_order: order++,
    });
    if (mediaErr) throw mediaErr;
  }

  // The PWA's caption page uploads in the background via XHR and wants JSON
  // back; a direct share-sheet navigation gets the HTML confirmation page.
  if (req.headers.get('accept')?.includes('application/json')) {
    return Response.json({ ok: true, postId, count: files.length });
  }
  return renderPage(`Saved ${files.length} item(s).`, postId, text);
}

async function handleUpdatePost(req: Request, postId: string): Promise<Response> {
  const { caption, location, status } = await req.json();
  const updateData: any = {};
  if (caption !== undefined) updateData.caption = caption;
  if (location !== undefined) updateData.location = location;
  if (status !== undefined) updateData.status = status;

  const { error } = await supabase
    .from('posts')
    .update(updateData)
    .eq('id', postId);
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handleDeletePost(postId: string): Promise<Response> {
  const { data: post, error: getErr } = await supabase
    .from('posts')
    .select('status')
    .eq('id', postId)
    .single();
  if (getErr) throw getErr;

  if (post && post.status === 'trash') {
    // Hard delete post_media, comments, and post from DB and Storage
    const { data: media, error: mediaErr } = await supabase
      .from('post_media')
      .select('object_key')
      .eq('post_id', postId);
    if (mediaErr) throw mediaErr;

    if (media && media.length > 0) {
      const keys = media.map((m) => m.object_key);
      const { error: storageErr } = await supabase.storage
        .from(BUCKET)
        .remove(keys);
      if (storageErr) console.error('Failed to remove storage objects:', storageErr);
    }

    const { error: delMediaErr } = await supabase
      .from('post_media')
      .delete()
      .eq('post_id', postId);
    if (delMediaErr) throw delMediaErr;

    const { error: delCommentsErr } = await supabase
      .from('comments')
      .delete()
      .eq('post_id', postId);
    if (delCommentsErr) throw delCommentsErr;

    const { error: delPostErr } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);
    if (delPostErr) throw delPostErr;

    return Response.json({ ok: true, permanent: true });
  } else {
    // Soft delete: update status to trash
    const { error } = await supabase
      .from('posts')
      .update({ status: 'trash' })
      .eq('id', postId);
    if (error) throw error;
    return Response.json({ ok: true, permanent: false });
  }
}

async function handleComments(postId: string): Promise<Response> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return Response.json(data ?? []);
}

async function handleAddComment(req: Request, postId: string, user: any): Promise<Response> {
  const { body } = await req.json();
  if (!body || !body.trim()) {
    return Response.json({ error: 'comment body required' }, { status: 400 });
  }
  const { error } = await supabase.from('comments').insert({
    id: crypto.randomUUID(),
    post_id: postId,
    author: authorName(user),
    body: body.trim(),
  });

  if (error) throw error;
  return Response.json({ ok: true });
}

async function handleList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');

  let query = supabase
    .from('posts')
    .select('id, caption, author, created_at, status, location, post_media(id, object_key, mime_type, sort_order)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (statusParam === 'trash') {
    query = query.eq('status', 'trash');
  } else {
    query = query.neq('status', 'trash');
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((post) => ({
    ...post,
    post_media: (post.post_media ?? []).map((m) => ({
      ...m,
      url: `https://wmouyojmcelxgkwjfpxz.supabase.co/storage/v1/object/public/moments/${m.object_key}`,
    })),
  }));
  return Response.json(rows);
}

function renderPage(message: string, postId?: string, caption = ''): Response {
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Moments</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#1b1622; color:#f2ece5;
    display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; text-align:center; }
  p.msg { color:#d4a574; margin-bottom:20px; }
  input { width:100%; max-width:320px; padding:10px 12px; border-radius:8px; border:1px solid #3a3145;
    background:#241d2e; color:#f2ece5; font-size:0.95rem; margin-bottom:12px; }
  button { padding:10px 18px; border-radius:8px; border:none; background:#d4a574; color:#1b1622; font-weight:600; }
  a { color:#a89bb0; font-size:0.85rem; margin-top:18px; }
</style></head>
<body>
  <p class="msg">${message}</p>
  ${postId ? `
  <input id="cap" placeholder="Add a caption…" value="${caption.replace(/"/g, '&quot;')}" />
  <button onclick="save()">Save caption</button>
  <script>
    async function save() {
      const caption = document.getElementById('cap').value;
      await fetch(location.origin + location.pathname + '/posts/${postId}/caption', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption })
      });
      document.querySelector('.msg').textContent = 'Saved.';
    }
  </script>` : ''}
  <a href="/">Back to Moments</a>
</body></html>`, {
    headers: { 'Content-Type': 'text/html' },
  });
}
