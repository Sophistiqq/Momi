import { supabase, hasStoredSession } from './supabase';

// Shared auth state (Svelte 5 runes). `user` is null until we know the
// session state; `ready` flips once the async getSession round-trip lands.
export const session = $state({
  user: hasStoredSession() ? true : null,
  ready: false,
  signingIn: false,
  error: '',
});

let initPromise: Promise<void> | undefined;

// Idempotent: the layout kicks this off and any page can await it so the
// session is fully recovered (token refreshed) before the first fetch.
export function initSession(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  // Surface auth changes into the UI state. Most importantly: when a token
  // refresh fails (stale/revoked session), supabase-js emits SIGNED_OUT and
  // clears the cookie — we must drop to the login screen instead of leaving
  // the feed stuck on an error.
  supabase.auth.onAuthStateChange((_event, s) => {
    session.user = s?.user ? true : null;
    session.ready = true;
  });

  try {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (s) {
      // Refresh only when the access token is close to expiring so the first
      // feed fetch can't race a stale token. Valid tokens pass through —
      // refreshing on every load would rotate the refresh token constantly
      // and fight across the PWA + browser tabs.
      const soon = Math.floor(Date.now() / 1000) + 30;
      if (s.refresh_token && (!s.expires_at || s.expires_at < soon)) {
        const { error } = await supabase.auth.refreshSession();
        session.user = error ? null : true;
      } else {
        session.user = true;
      }
    } else {
      session.user = null;
    }
  } catch {
    session.user = null;
  } finally {
    session.ready = true;
  }
}

export async function signInWithGoogle(): Promise<void> {
  session.error = '';
  session.signingIn = true;
  try {
    // Full-page redirect, not a popup: mobile browsers (esp. iOS Safari)
    // block popups, which silently broke Google sign-in on phones.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin, skipBrowserRedirect: true },
    });
    if (error) {
      session.error = error.message;
    } else if (data?.url) {
      window.location.assign(data.url);
    }
  } catch (e) {
    session.error = e instanceof Error ? e.message : 'Sign-in failed';
  } finally {
    session.signingIn = false;
  }
}

export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}
  // Force-clear cookie manually in case supabase-js leaves it on error
  document.cookie = 'sb-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  session.user = null;
}
