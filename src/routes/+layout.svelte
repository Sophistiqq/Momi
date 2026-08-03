<script>
  import { onMount } from 'svelte';
  import { session, initSession, signInWithGoogle } from '$lib/session.svelte.js';

  let updateBanner;
  let updateBtn;
  let refreshing = false;

  onMount(() => {
    initSession();

    if (!('serviceWorker' in navigator)) return;
    const offer = (sw) => {
      if (!sw) return;
      updateBtn.onclick = () => sw.postMessage({ type: 'SKIP_WAITING' });
      updateBanner.hidden = false;
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed') offer(sw);
        });
      });
      if (reg.waiting) offer(reg.waiting);
    });

    setInterval(() => navigator.serviceWorker.ready.then((r) => r.update()), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') navigator.serviceWorker.ready.then((r) => r.update());
    });
  });
</script>

{#if !session.ready}
  <div class="state show">
    <h2>Loading…</h2>
  </div>
{:else if session.user}
  <slot />
{:else}
  <div class="state login show">
    <h1 class="logo">Moments</h1>
    <p>Sign in to see your moments.</p>
    <button class="btn btn-google" onclick={() => signInWithGoogle()} disabled={session.signingIn}>
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"/>
      </svg>
      <span>{session.signingIn ? 'Redirecting…' : 'Sign in with Google'}</span>
    </button>
    {#if session.error}
      <p class="auth-error">{session.error}</p>
    {/if}
  </div>
{/if}

<!-- New-version banner: shown when the service worker has an update ready -->
<div class="update-banner" bind:this={updateBanner} hidden>
  <span>New version available</span>
  <button class="btn btn-primary" bind:this={updateBtn}>Update</button>
</div>
