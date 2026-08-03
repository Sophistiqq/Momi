import { createClient } from '@supabase/supabase-js';

// Session lives in a cookie (not localStorage) because the Android share
// sheet and the customize page's XHR are plain navigations/fetches that can't
// attach an Authorization header — cookies ride along. The edge function
// reads the same cookie and rejects requests without a valid session.
const cookieStorage = {
  getItem(key) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  },
  setItem(key, value) {
    // Slim sessions to tokens only: the full session (with Google user
    // metadata) exceeds Chrome's ~4KB cookie limit and gets silently
    // dropped. PKCE code verifiers must pass through untouched — they have
    // no access_token, and stripping them breaks the OAuth exchange.
    try {
      const s = JSON.parse(value);
      if (s?.access_token) {
        value = JSON.stringify({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at,
          token_type: s.token_type,
        });
      }
    } catch {}
    document.cookie = key + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax; Secure';
  },
  removeItem(key) {
    document.cookie = key + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  },
};

export const supabase = createClient(
  'https://wmouyojmcelxgkwjfpxz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtb3V5b2ptY2VseGdrd2pmcHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjA5MTEsImV4cCI6MjEwMTAzNjkxMX0.PRuJlyXfuCTmtUXf3MLwNdRs8JcFJpZ0Y4DDL3Hz_m8',
  {
    auth: {
      storageKey: 'sb-auth-token',
      storage: cookieStorage,
      persistSession: true,
      flowType: 'pkce',
    },
  },
);

// Synchronously know whether a session exists so the first render never
// flashes the login page for returning users.
export function hasStoredSession() {
  try {
    const raw = cookieStorage.getItem('sb-auth-token');
    return !!(raw && JSON.parse(raw)?.access_token);
  } catch {
    return false;
  }
}
