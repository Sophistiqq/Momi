import type { RequestEvent } from '@sveltejs/kit';
import { supabase as db, anon as anonClient, BUCKET, TOKEN_COOKIE } from './db';
import { processImage } from './image';
import { sendPushToUser } from './push';

export async function handleRequest(event: RequestEvent): Promise<Response> {
  const { request, params } = event;
  const user = await getUser(request);
  if (!user) return unauthorized(request);

  const rest: string = (params as any).rest ?? '';

  if (request.method === 'POST' && rest === '') return handleShare(request, user);

  const postMatch = rest.match(/^posts\/([^/]+)$/);
  if (request.method === 'PATCH' && postMatch) return handleUpdatePost(request, postMatch[1]);
  if (request.method === 'DELETE' && postMatch) return handleDeletePost(postMatch[1]);

  const captionMatch = rest.match(/^posts\/([^/]+)\/caption$/);
  if (request.method === 'PATCH' && captionMatch) return handleUpdatePost(request, captionMatch[1]);

  const commentsMatch = rest.match(/^posts\/([^/]+)\/comments$/);
  if (request.method === 'GET' && commentsMatch) return handleComments(commentsMatch[1]);
  if (request.method === 'POST' && commentsMatch) return handleAddComment(request, commentsMatch[1], user);

  const likeMatch = rest.match(/^posts\/([^/]+)\/like$/);
  if (request.method === 'POST' && likeMatch) return handleToggleLike(likeMatch[1], user);

  if (request.method === 'GET' && rest === 'people') {
    const people = await allUsers(user);
    return Response.json({
      me: authorName(user),
      other: people.find((p) => p.id !== user.id)?.name ?? null,
    });
  }

  if (request.method === 'GET' && rest === 'push/public-key') {
    if (!process.env.VAPID_PUBLIC_KEY) return Response.json({ error: 'push not configured' }, { status: 503 });
    return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  }
  if (request.method === 'POST' && rest === 'push/subscribe') return handlePushSubscribe(request, user);
  if (request.method === 'DELETE' && rest === 'push/subscribe') return handlePushUnsubscribe(request);

  if (request.method === 'GET' && rest === 'posts') return handleList(request, user);

  return new Response('Not found', { status: 404 });
}

async function getUser(req: Request) {
  const m = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]*)`));
  if (!m) return null;
  try {
    const token = JSON.parse(decodeURIComponent(m[1]))?.access_token;
    if (!token) return null;
    const { data, error } = await anonClient().auth.getUser(token);
    return error ? null : data.user;
  } catch {
    return null;
  }
}

function authorName(user: any) {
  return user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Anonymous';
}

async function allUsers(user: any): Promise<{ id: string; name: string }[]> {
  const users: { id: string; name: string }[] = [];
  try {
    const { data } = await db().auth.admin.listUsers();
    for (const u of data?.users ?? []) users.push({ id: u.id, name: authorName(u) });
  } catch (e) {
    console.error('listUsers failed:', e);
  }
  if (!users.some((u) => u.id === user.id)) users.push({ id: user.id, name: authorName(user) });
  return users;
}

function parseCoord(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function unauthorized(req: Request): Response {
  if ((req.headers.get('accept') ?? '').includes('application/json')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Moments</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#1b1622;color:#f2ece5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}a{color:#d4a574;font-weight:600}</style></head><body><p>Sign in on the Moments home screen first, then share again. <a href="/">Open Moments</a></p></body></html>',
    { status: 401, headers: { 'Content-Type': 'text/html' } }
  );
}

async function handleShare(req: Request, user: any): Promise<Response> {
  const form = await req.formData();
  const text = (form.get('text') as string) ?? '';
  const location = (form.get('location') as string) ?? null;
  const lat = parseCoord(form.get('lat'));
  const lng = parseCoord(form.get('lng'));
  const createdAtForm = form.get('created_at') as string | null;
  const files = form.getAll('photos') as File[];

  if (files.length === 0) return renderPage('Nothing came through — try sharing again.');

  const postId = crypto.randomUUID();
  const createdAt = createdAtForm || new Date().toISOString();
  const people = await allUsers(user);
  const requested = (form.getAll('mentions') as string[]).map((m) => m.trim()).filter(Boolean);
  const mentions = people.map((p) => p.name).filter((n) => requested.includes(n));

  const { error: postErr } = await db().from('posts').insert({
    id: postId, caption: text, author: authorName(user), created_at: createdAt,
    status: 'pending_style', location, lat, lng, mentions,
  });
  if (postErr) throw postErr;

  let order = 0;
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const processed = isImage ? await processImage(file) : null;
    const ext = processed ? 'webp' : (file.name.split('.').pop() || 'bin').toLowerCase();
    const key = `${postId}/${crypto.randomUUID()}.${ext}`;
    const bytes = processed ? processed.bytes : new Uint8Array(await file.arrayBuffer());
    const mime = processed ? processed.contentType : (file.type || 'application/octet-stream');

    const { error: upErr } = await db().storage.from(BUCKET()).upload(key, bytes, { contentType: mime });
    if (upErr) throw upErr;

    const { error: mediaErr } = await db().from('post_media').insert({
      id: crypto.randomUUID(), post_id: postId, object_key: key,
      mime_type: mime, sort_order: order++, placeholder: processed?.placeholder ?? null,
    });
    if (mediaErr) throw mediaErr;
  }

  const partner = people.find((p) => p.id !== user.id);
  if (partner) {
    const mentioned = mentions.includes(partner.name);
    await sendPushToUser(
      partner.id,
      mentioned ? `${authorName(user)} mentioned you` : `${authorName(user)} posted something new`,
      text.trim().slice(0, 80) || 'Open Moments to see it.', '/'
    );
  }

  if (req.headers.get('accept')?.includes('application/json')) {
    return Response.json({ ok: true, postId, count: files.length });
  }
  return renderPage(`Saved ${files.length} item(s).`, postId, text);
}

async function handleUpdatePost(req: Request, postId: string): Promise<Response> {
  const { caption, location, status, lat, lng } = await req.json();
  const updateData: Record<string, any> = {};
  if (caption !== undefined) updateData.caption = caption;
  if (location !== undefined) updateData.location = location;
  if (status !== undefined) updateData.status = status;
  if (lat !== undefined) updateData.lat = lat;
  if (lng !== undefined) updateData.lng = lng;
  const { error } = await db().from('posts').update(updateData).eq('id', postId);
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handleDeletePost(postId: string): Promise<Response> {
  const { data: post, error: getErr } = await db().from('posts').select('status').eq('id', postId).single();
  if (getErr) throw getErr;

  if (post?.status === 'trash') {
    const { data: media } = await db().from('post_media').select('object_key').eq('post_id', postId);
    if (media?.length) {
      const { error: storageErr } = await db().storage.from(BUCKET()).remove(media.map((m: any) => m.object_key));
      if (storageErr) console.error('Failed to remove storage objects:', storageErr);
    }
    await db().from('post_media').delete().eq('post_id', postId);
    await db().from('comments').delete().eq('post_id', postId);
    await db().from('post_likes').delete().eq('post_id', postId);
    const { error: delErr } = await db().from('posts').delete().eq('id', postId);
    if (delErr) throw delErr;
    return Response.json({ ok: true, permanent: true });
  } else {
    const { error } = await db().from('posts').update({ status: 'trash' }).eq('id', postId);
    if (error) throw error;
    return Response.json({ ok: true, permanent: false });
  }
}

async function handleToggleLike(postId: string, user: any): Promise<Response> {
  const { data: existing, error: getErr } = await db()
    .from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', user.id).maybeSingle();
  if (getErr) throw getErr;

  let liked = false;
  if (existing) {
    const { error: delErr } = await db().from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
    if (delErr) throw delErr;
  } else {
    const name = authorName(user);
    const { error: insErr } = await db().from('post_likes').insert({ post_id: postId, user_id: user.id, author: name });
    if (insErr) throw insErr;
    liked = true;

    try {
      const { data: post } = await db().from('posts').select('author').eq('id', postId).single();
      if (post && post.author !== name) {
        const people = await allUsers(user);
        const partner = people.find((p) => p.id !== user.id);
        if (partner) await sendPushToUser(partner.id, `${name} liked your moment`, 'Open Moments to see it.', '/');
      }
    } catch (e) {
      console.error('Failed to send like push:', e);
    }
  }

  const { count } = await db()
    .from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);

  return Response.json({ ok: true, liked, like_count: count ?? 0 });
}

async function handleComments(postId: string): Promise<Response> {
  const { data, error } = await db()
    .from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
  if (error) throw error;
  return Response.json(data ?? []);
}

async function handleAddComment(req: Request, postId: string, user: any): Promise<Response> {
  const { body } = await req.json();
  if (!body?.trim()) return Response.json({ error: 'comment body required' }, { status: 400 });
  const { error } = await db().from('comments').insert({
    id: crypto.randomUUID(), post_id: postId, author: authorName(user), body: body.trim(),
  });
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handlePushSubscribe(req: Request, user: any): Promise<Response> {
  const { endpoint, p256dh, auth } = await req.json();
  if (!endpoint || !p256dh || !auth) return Response.json({ error: 'endpoint, p256dh, and auth are required' }, { status: 400 });
  const { error } = await db()
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handlePushUnsubscribe(req: Request): Promise<Response> {
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return Response.json({ error: 'endpoint required' }, { status: 400 });
  const { error } = await db().from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
  return Response.json({ ok: true });
}

async function handleList(req: Request, user?: any): Promise<Response> {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');
  const beforeParam = url.searchParams.get('before');
  const pageSize = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 500;

  let query = db()
    .from('posts')
    .select('id, caption, author, created_at, status, location, lat, lng, mentions, post_media(id, object_key, mime_type, sort_order, placeholder), post_likes(user_id, author), comments(id)')
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (beforeParam) query = query.lt('created_at', beforeParam);
  if (statusParam === 'trash') query = query.eq('status', 'trash');
  else query = query.neq('status', 'trash');

  const { data, error } = await query;
  if (error) throw error;

  const supabaseUrl = process.env.SUPABASE_URL!;
  const rows = (data ?? []).map((post: any) => {
    const postLikes = post.post_likes ?? [];
    const postComments = post.comments ?? [];
    return {
      ...post,
      liked_by_me: user ? postLikes.some((l: any) => l.user_id === user.id) : false,
      like_count: postLikes.length,
      likes: postLikes,
      comment_count: postComments.length,
      comments_count: postComments.length,
      post_media: (post.post_media ?? []).map((m: any) => ({
        ...m,
        url: `${supabaseUrl}/storage/v1/object/public/${BUCKET()}/${m.object_key}`,
      })),
    };
  });

  return Response.json(rows, { headers: { 'Cache-Control': 'private, no-cache' } });
}

function renderPage(message: string, postId?: string, caption = ''): Response {
  const safeCap = caption.replace(/"/g, '&quot;');
  const body = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Moments</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#1b1622;color:#f2ece5;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}p.msg{color:#d4a574;margin-bottom:20px}input{width:100%;max-width:320px;padding:10px 12px;border-radius:8px;border:1px solid #3a3145;background:#241d2e;color:#f2ece5;font-size:.95rem;margin-bottom:12px}button{padding:10px 18px;border-radius:8px;border:none;background:#d4a574;color:#1b1622;font-weight:600}a{color:#a89bb0;font-size:.85rem;margin-top:18px}</style></head><body><p class="msg">${message}</p>${postId ? `<input id="cap" placeholder="Add a caption..." value="${safeCap}"/><button onclick="save()">Save caption</button><script>async function save(){const c=document.getElementById("cap").value;await fetch(location.origin+location.pathname+"/posts/${postId}/caption",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({caption:c})});document.querySelector(".msg").textContent="Saved."}</script>` : ''}<a href="/">Back to Moments</a></body></html>`;
  return new Response(body, { headers: { 'Content-Type': 'text/html' } });
}
