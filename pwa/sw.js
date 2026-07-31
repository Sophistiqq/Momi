const CACHE = 'moments-shell-v2'; // bump to invalidate every phone's cached shell
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
      Promise.all(keys.filter((k) => k !== CACHE && k !== 'share-pending').map((k) => caches.delete(k)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Android share target: catch the POST navigation, stash the files, and
  // redirect straight to the caption page. Without this, the browser shows a
  // blank splash for the entire upload before rendering anything.
  // We key off Accept, not request.mode: Chrome doesn't reliably mark
  // share-target POSTs as 'navigate', but the caption page's own background
  // upload always sends Accept: application/json, which shares never do.
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
  // Cache the raw request bytes, NOT request.formData(): formData() returns
  // stream-backed files that serialize empty into the cache, so a later
  // re-upload sends a bodiless multipart and the function hangs forever.
  const contentType = request.headers.get('content-type') || 'multipart/form-data';
  const body = await request.arrayBuffer();
  const id = crypto.randomUUID();
  const cache = await caches.open('share-pending');
  await cache.put('/share-pending-' + id, new Response(body, { headers: { 'Content-Type': contentType } }));
  return Response.redirect(`/caption?id=${id}`, 303);
}
