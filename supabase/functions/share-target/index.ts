import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendNotification } from 'npm:web-push-neo@0.1.2';

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

    if (req.method === 'GET' && url.pathname.endsWith('/share-target/people')) {
      const people = await allUsers(user);
      return Response.json({
        me: authorName(user),
        other: people.find((p) => p.id !== user.id)?.name ?? null,
      });
    }

    // Web push: fetch the public VAPID key, store/remove a device subscription.
    if (req.method === 'GET' && url.pathname.endsWith('/share-target/push/public-key')) {
      const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      if (!publicKey) return Response.json({ error: 'push not configured' }, { status: 503 });
      return Response.json({ publicKey });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/share-target/push/subscribe')) {
      return handlePushSubscribe(req, user);
    }
    if (req.method === 'DELETE' && url.pathname.endsWith('/share-target/push/subscribe')) {
      return handlePushUnsubscribe(req, user);
    }

    // Likes on a post.
    const likeMatch = url.pathname.match(/\/share-target\/posts\/([^/]+)\/like$/);
    if (req.method === 'POST' && likeMatch) {
      return handleToggleLike(likeMatch[1], user);
    }

    if (req.method === 'GET' && url.pathname.endsWith('/share-target/posts')) {
      return handleList(req, user);
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

// Every signed-up user in this project, id + display name. Used to resolve
// @mentions and to find "the other person" for push notifications. The
// service role can list auth users; if that's disabled, we fall back to
// just the caller.
async function allUsers(user: any): Promise<{ id: string; name: string }[]> {
  const users: { id: string; name: string }[] = [];
  try {
    const { data } = await supabase.auth.admin.listUsers();
    for (const u of data?.users ?? []) users.push({ id: u.id, name: authorName(u) });
  } catch (e) {
    console.error('listUsers failed:', e);
  }
  if (!users.some((u) => u.id === user.id)) users.push({ id: user.id, name: authorName(user) });
  return users;
}

// Form values arrive as strings; null stays null.
function parseCoord(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  const lat = parseCoord(form.get('lat'));
  const lng = parseCoord(form.get('lng'));
  const createdAtForm = form.get('created_at') as string | null;
  const files = form.getAll('photos') as File[];

  if (files.length === 0) {
    return renderPage('Nothing came through — try sharing again.');
  }

  const postId = crypto.randomUUID();
  const createdAt = createdAtForm || new Date().toISOString();

  // Resolve mentions against real signed-up users (and grab the partner's id
  // for the push notification in one auth listing).
  const people = await allUsers(user);
  const requested = (form.getAll('mentions') as string[]).map((m) => m.trim()).filter(Boolean);
  const mentions = people.map((p) => p.name).filter((n) => requested.includes(n));

  const { error: postErr } = await supabase.from('posts').insert({
    id: postId,
    caption: text,
    author: authorName(user),
    created_at: createdAt,
    status: 'pending_style',
    location,
    lat,
    lng,
    mentions,
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

  // Notify the other half that a post landed (or that they were tagged).
  const partner = people.find((p) => p.id !== user.id);
  if (partner) {
    const mentioned = mentions.includes(partner.name);
    await sendPushToUser(
      partner.id,
      mentioned ? `${authorName(user)} mentioned you` : `${authorName(user)} posted something new`,
      text.trim().slice(0, 80) || 'Open Moments to see it.',
      '/'
    );
  }

  // The PWA's caption page uploads in the background via XHR and wants JSON
  // back; a direct share-sheet navigation gets the HTML confirmation page.
  if (req.headers.get('accept')?.includes('application/json')) {
    return Response.json({ ok: true, postId, count: files.length });
  }
  return renderPage(`Saved ${files.length} item(s).`, postId, text);
}

async function handleUpdatePost(req: Request, postId: string): Promise<Response> {
  const { caption, location, status, lat, lng } = await req.json();
  const updateData: any = {};
  if (caption !== undefined) updateData.caption = caption;
  if (location !== undefined) updateData.location = location;
  if (status !== undefined) updateData.status = status;
  if (lat !== undefined) updateData.lat = lat;
  if (lng !== undefined) updateData.lng = lng;

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

    const { error: delLikesErr } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId);
    if (delLikesErr) console.error('Failed to remove post_likes:', delLikesErr);

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

async function handleToggleLike(postId: string, user: any): Promise<Response> {
  const { data: existing, error: getErr } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (getErr) throw getErr;

  let liked = false;
  if (existing) {
    // Unlike
    const { error: delErr } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
    if (delErr) throw delErr;
    liked = false;
  } else {
    // Like
    const name = authorName(user);
    const { error: insErr } = await supabase
      .from('post_likes')
      .insert({
        post_id: postId,
        user_id: user.id,
        author: name,
      });
    if (insErr) throw insErr;
    liked = true;

    // Send push notification to post author if it's the partner
    try {
      const { data: post } = await supabase
        .from('posts')
        .select('author')
        .eq('id', postId)
        .single();
      if (post && post.author !== name) {
        const people = await allUsers(user);
        const partner = people.find((p) => p.id !== user.id);
        if (partner) {
          await sendPushToUser(
            partner.id,
            `${name} liked your moment`,
            'Open Moments to see it.',
            '/'
          );
        }
      }
    } catch (e) {
      console.error('Failed to send like push notification:', e);
    }
  }

  const { count, error: countErr } = await supabase
    .from('post_likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (countErr) throw countErr;

  return Response.json({ ok: true, liked, like_count: count ?? 0 });
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

async function handlePushSubscribe(req: Request, user: any): Promise<Response> {
  const { endpoint, p256dh, auth } = await req.json();
  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: 'endpoint, p256dh, and auth are required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handlePushUnsubscribe(req: Request, user: any): Promise<Response> {
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return Response.json({ error: 'endpoint required' }, { status: 400 });
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id);
  if (error) throw error;
  return Response.json({ ok: true });
}

// Send a push notification to every device of the given user. Best-effort:
// expired subscriptions (404/410) are dropped and failures are logged, but
// nothing propagates to the caller. No-ops when VAPID secrets aren't set.
async function sendPushToUser(userId: string, title: string, body: string, url = '/'): Promise<void> {
  const subject = Deno.env.get('VAPID_SUBJECT');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!subject || !publicKey || !privateKey) return;

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error || !subs?.length) return;

  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 86400,
          urgency: 'normal',
          signal: AbortSignal.timeout(8000),
        }
      );
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      console.error('push failed:', e?.statusCode ?? e?.message ?? e);
    }
  }
}

async function handleList(req: Request, user?: any): Promise<Response> {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');
  const beforeParam = url.searchParams.get('before');

  const pageSize = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 500;

  let query = supabase
    .from('posts')
    .select('id, caption, author, created_at, status, location, lat, lng, mentions, post_media(id, object_key, mime_type, sort_order), post_likes(user_id, author), comments(id)')
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (beforeParam) {
    query = query.lt('created_at', beforeParam);
  }

  if (statusParam === 'trash') {
    query = query.eq('status', 'trash');
  } else {
    query = query.neq('status', 'trash');
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((post) => {
    const postLikes = (post as any).post_likes ?? [];
    const postComments = (post as any).comments ?? [];
    const likedByMe = user ? postLikes.some((l: any) => l.user_id === user.id) : false;
    return {
      ...post,
      liked_by_me: likedByMe,
      like_count: postLikes.length,
      likes: postLikes,
      comment_count: postComments.length,
      comments_count: postComments.length,
      post_media: (post.post_media ?? []).map((m: any) => ({
        ...m,
        url: `https://wmouyojmcelxgkwjfpxz.supabase.co/storage/v1/object/public/moments/${m.object_key}`,
      })),
    };
  });
  return Response.json(rows, {
    headers: {
      'Cache-Control': 'private, no-cache',
    },
  });
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
