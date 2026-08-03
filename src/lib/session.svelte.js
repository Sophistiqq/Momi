import { supabase, hasStoredSession } from './supabase.js';

// Shared auth state (Svelte 5 runes). `user` is null until we know the
// session state; `ready` flips once the async getSession round-trip lands.
export const session = $state({
  user: hasStoredSession() ? true : null,
  ready: false,
  signingIn: false,
  error: '',
});

export async function initSession() {
  const { data } = await supabase.auth.getSession();
  session.user = data.session ? (data.session.user ?? true) : null;
  session.ready = true;
  // Google's redirect lands back with a PKCE code; the exchange happens
  // after init, so this picks up the resulting session.
  supabase.auth.onAuthStateChange((_event, s) => {
    if (s?.user && !session.user) {
      session.user = s.user;
      session.ready = true;
    }
  });
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
