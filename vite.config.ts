import fs from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Read the public anon key from .dev.vars (gitignored, local-only) so the dev
// server can proxy /share-target to the Supabase edge function like the
// production _worker.js does.
const devVars: Record<string, string> = {};
if (fs.existsSync('.dev.vars')) {
  for (const line of fs.readFileSync('.dev.vars', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    devVars[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
}

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    proxy: {
      '/share-target': {
        target: 'https://wmouyojmcelxgkwjfpxz.supabase.co',
        changeOrigin: true,
        rewrite: (p) => '/functions/v1' + p,
        headers: { Authorization: `Bearer ${devVars.SUPABASE_ANON_KEY || ''}` },
      },
    },
  },
});
