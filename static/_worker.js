const SUPABASE_FUNCTION = 'https://wmouyojmcelxgkwjfpxz.supabase.co/functions/v1/share-target';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Share target routes: /share-target, /share-target/posts/:id/caption, /share-target/posts
    if (url.pathname.startsWith('/share-target')) {
      if (!env.SUPABASE_ANON_KEY) {
        return new Response('Worker Error: SUPABASE_ANON_KEY environment variable is not set in Cloudflare Pages.', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      const headers = new Headers();
      // Explicitly forward the auth cookie and other essential request headers
      const cookie = request.headers.get('cookie');
      if (cookie) headers.set('cookie', cookie);

      const accept = request.headers.get('accept');
      if (accept) headers.set('accept', accept);

      const contentType = request.headers.get('content-type');
      if (contentType) headers.set('content-type', contentType);

      headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`);

      return fetch(SUPABASE_FUNCTION + url.pathname.slice('/share-target'.length) + url.search, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      });
    }

    // sw.js must never sit in a browser cache: the service worker only
    // updates when the browser fetches a fresh script, and Cloudflare
    // Pages' default 7-day asset cache would keep phones on the old SW.
    if (url.pathname === '/sw.js') {
      const res = await env.ASSETS.fetch(request);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), 'Cache-Control': 'no-store' },
      });
    }

    // SPA fallback: client routes like /customize have no real file, so serve
    // index.html for navigation/html requests that 404 (SvelteKit does the rest).
    if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404) {
        return env.ASSETS.fetch(new Request(url.origin + '/index.html', request));
      }
      return res;
    }

    // Everything else: serve static assets from the Pages site.
    return env.ASSETS.fetch(request);
  },
};
