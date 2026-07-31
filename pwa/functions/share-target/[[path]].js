export async function onRequest({ request, env, params }) {
  // `params.path` is everything AFTER /share-target/ in the URL.
  // e.g. for POST /share-target          → params.path = []        → subPath = ""
  //      for PATCH /share-target/posts/X → params.path = ["posts","X","caption"]
  const subPath = params.path ? '/' + params.path.join('/') : '';
  const target = 'https://wmouyojmcelxgkwjfpxz.supabase.co/functions/v1/share-target' + subPath;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('authorization');
  headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`);

  return fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    duplex: 'half',
  });
}
