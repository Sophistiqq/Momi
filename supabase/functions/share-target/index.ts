import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const BUCKET = Deno.env.get('MOMENTS_BUCKET') ?? 'moments';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Android's share sheet does a real browser navigation: POST multipart/form-data
  // straight to this URL. We store the files, create a "pending_style" post,
  // and respond with an HTML page (not JSON) since this is a page load, not a fetch.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    return handleShare(req);
  }

  // Lets either of you fix the caption right after upload, or later from the feed.
  const captionMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)\/caption$/);
  if (req.method === 'PATCH' && captionMatch) {
    return handleCaption(req, captionMatch[1]);
  }

  // Comments on a post.
  const commentsMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)\/comments$/);
  if (req.method === 'GET' && commentsMatch) {
    return handleComments(commentsMatch[1]);
  }
  if (req.method === 'POST' && commentsMatch) {
    return handleAddComment(req, commentsMatch[1]);
  }

  if (req.method === 'GET' && url.pathname.endsWith('/share-target/posts')) {
    return handleList();
  }

  return new Response('Not found', { status: 404 });
});

async function handleShare(req: Request): Promise<Response> {
  const form = await req.formData();
  const text = (form.get('text') as string) ?? '';
  const files = form.getAll('photos') as File[];

  if (files.length === 0) {
    return renderPage('Nothing came through — try sharing again.');
  }

  const postId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error: postErr } = await supabase.from('posts').insert({
    id: postId,
    caption: text,
    created_at: createdAt,
    status: 'pending_style',
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

async function handleCaption(req: Request, postId: string): Promise<Response> {
  const { caption } = await req.json();
  const { error } = await supabase
    .from('posts')
    .update({ caption })
    .eq('id', postId);
  if (error) throw error;
  return Response.json({ ok: true });
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

async function handleAddComment(req: Request, postId: string): Promise<Response> {
  const { author, body } = await req.json();
  if (!body || !body.trim()) {
    return Response.json({ error: 'comment body required' }, { status: 400 });
  }
  const { error } = await supabase.from('comments').insert({
    id: crypto.randomUUID(),
    post_id: postId,
    author: (author ?? '').trim(),
    body: body.trim(),
  });
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handleList(): Promise<Response> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, caption, created_at, status, post_media(id, object_key, mime_type, sort_order)')
    .order('created_at', { ascending: false })
    .limit(50);
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
