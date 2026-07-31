const SUPABASE_FUNCTION = 'https://wmouyojmcelxgkwjfpxz.supabase.co/functions/v1/share-target';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Share target routes: /share-target, /share-target/posts/:id/caption, /share-target/posts
    if (url.pathname.startsWith('/share-target')) {
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('authorization');
      headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`);
      return fetch(SUPABASE_FUNCTION + url.pathname.slice('/share-target'.length), {
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

    // Everything else: serve static assets from the Pages site.
    return env.ASSETS.fetch(request);
  },
};
