import { supabase, hasStoredSession } from './supabase.js';

// Shared auth state (Svelte 5 runes). `user` is null until we know the
// session state; `ready` flips once the async getSession round-trip lands.
export const session = $state({
  user: hasStoredSession() ? true : null,
  ready: false,
  signingIn: false,
  error: '',
});

let initPromise;

// Idempotent: the layout kicks this off and any page can await it so the
// session is fully recovered (token refreshed) before the first fetch.
export function initSession() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  // Surface auth changes into the UI state. Most importantly: when a token
  // refresh fails (stale/revoked session), supabase-js emits SIGNED_OUT and
  // clears the cookie — we must drop to the login screen instead of leaving
  // the feed stuck on an error.
  supabase.auth.onAuthStateChange((_event, s) => {
    session.user = s?.user ? true : null;
    session.ready = true;
  });

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    // Refresh the access token before the first feed fetch so a stale token
    // doesn't 401 the very first request. If this fails the session is dead
    // (the SIGNED_OUT event above logs us out and shows login).
    const { error } = await supabase.auth.refreshSession();
    session.user = error ? null : true;
  } else {
    session.user = null;
  }
  session.ready = true;
}

export async function signInWithGoogle() {
  session.error = '';
  session.signingIn = true;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin },
  });
  session.signingIn = false;
  if (error) session.error = error.message;
}

export async function signOut() {
  await supabase.auth.signOut();
  session.user = null;
}
