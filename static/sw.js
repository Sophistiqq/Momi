const CACHE = 'moments-shell-v6'; // bump to invalidate every phone's cached shell
const MEDIA_CACHE = 'moments-media';
const SHELL = ['/', '/manifest.json', '/style.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
  );
});

// No skipWaiting(): the update waits for the user to tap "Update" on the
// banner, which sends SKIP_WAITING, which activates this worker and reloads.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Android share target: do NOT upload yet. Stash the shared files in
  // IndexedDB and redirect to the customize page, which previews them and
  // collects caption + location before uploading. Keying off Accept, not
  // request.mode: Chrome doesn't reliably mark share-target POSTs as
  // 'navigate', but the customize page's own requests always send
  // Accept: application/json, which shares never do.
  if (
    event.request.method === 'POST' &&
    url.pathname.startsWith('/share-target') &&
    !(event.request.headers.get('accept') || '').includes('application/json')
  ) {
    event.respondWith(handleShare(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  // API calls to the edge function: always network-only, never cache.
  // These are dynamic JSON responses (post list, comments) that must always
  // reflect the current database state — stale data here means ghost posts.
  if (url.pathname.startsWith('/share-target')) return;

  // Media requests from Supabase public storage bucket: cache-first
  const isMediaRequest = url.origin === 'https://wmouyojmcelxgkwjfpxz.supabase.co' && url.pathname.includes('/storage/v1/object/public/');
  if (isMediaRequest) {
    if (event.request.headers.has('range')) return;
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const network = await fetch(event.request);
        if (network.ok && (network.status === 200 || network.status === 304)) {
          cache.put(event.request, network.clone());
        }
        return network;
      })
    );
    return;
  }

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

  // Static assets (manifest, icons, style.css): stale-while-revalidate.
  // Range requests (video seeking) go straight to the network.
  if (event.request.headers.has('range')) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok && res.status === 200) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

async function handleShare(request) {
  const redirect = (path) => Response.redirect(path, 303);
  try {
    const form = await request.formData();
    const text = form.get('text') || '';
    const files = form.getAll('photos');

    if (!files.length) return redirect('/customize?ok=0');

    const id = crypto.randomUUID();
    // File objects are structured-cloneable, so blobs survive in IndexedDB.
    await storeShare(id, {
      text,
      files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
    });
    return redirect(`/customize?id=${id}`);
  } catch {
    return redirect('/customize?ok=0');
  }
}

const DB = 'momi-share';
const DB_VERSION = 1;
const STORE = 'pending';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeShare(id, share) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(share, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
