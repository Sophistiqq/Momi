// _worker.js
var SUPABASE_FUNCTION = "https://wmouyojmcelxgkwjfpxz.supabase.co/functions/v1/share-target";
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/share-target")) {
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("authorization");
      headers.set("Authorization", `Bearer ${env.SUPABASE_ANON_KEY}`);
      return fetch(SUPABASE_FUNCTION + url.pathname.slice("/share-target".length), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body
      });
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=bundledWorker-0.8030371337013273.mjs.map
