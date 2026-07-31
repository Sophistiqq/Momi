const CACHE = 'moments-shell-v3'; // bump to invalidate every phone's cached shell
const SHELL = ['/', '/manifest.json', '/caption', '/style.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Android share target: upload the shared files to the function RIGHT HERE
  // (the SW has the raw body and the session cookie rides along on the
  // same-origin fetch), then redirect to a pure result page. Doing the upload
  // in the SW means no form round-trip through the Cache API — that's what
  // produced empty uploads and hung requests before.
  // We key off Accept, not request.mode: Chrome doesn't reliably mark
  // share-target POSTs as 'navigate', but the caption page's own background
  // requests always send Accept: application/json, which shares never do.
  if (
    event.request.method === 'POST' &&
    url.pathname.startsWith('/share-target') &&
    !(event.request.headers.get('accept') || '').includes('application/json')
  ) {
    event.respondWith(handleShare(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  // Pages: network-first, so every deploy is immediately visible online;
  // cache only as an offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Assets (manifest, icons, media): cache-first.
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

async function handleShare(request) {
  const body = await request.arrayBuffer();
  const redirect = (path) => Response.redirect(path, 303);
  let text = '';
  try {
    text = (await request.formData()).get('text') || '';
  } catch {}
  try {
    const res = await fetch('/share-target', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': request.headers.get('content-type') || 'multipart/form-data',
      },
      body,
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.postId) {
      return redirect(`/caption?id=${data.postId}&ok=1&text=${encodeURIComponent(text)}`);
    }
  } catch {}
  return redirect('/caption?ok=0');
}
