<script lang="ts">
  import { onMount } from 'svelte';
  import PostViewer from '$lib/PostViewer.svelte';
  import { fetchPosts, formatDate, type Media, type Post } from '$lib/api';
  import { session, initSession, signInWithGoogle, signOut } from '$lib/session.svelte';

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state<Post | null>(null);
  let refreshing = $state(false);

  let countText = $derived(posts.length ? `${posts.length} moment${posts.length > 1 ? 's' : ''}` : '');

  onMount(async () => {
    // Hardware/browser back while the post viewer is open should close the
    // viewer, not navigate the app away. We push a history entry on open and
    // pop it on close, so back lands on the popup first.
    window.addEventListener('popstate', () => {
      if (activePost) activePost = null;
    });
    // Wait for the session to be recovered (token refreshed) before fetching,
    // otherwise the first request races a stale access token and 401s.
    await initSession();
    await load();
  });

  function postMedia(post: Post): Media | null {
    return post?.post_media?.[0] || null;
  }

  function isVideo(post: Post): boolean {
    const m = postMedia(post);
    return !!m && (m.mime_type || '').startsWith('video');
  }

  function feedSrc(post: Post): string {
    const m = postMedia(post);
    if (!m) return '';
    // #t=0.1 forces Chrome to grab a real frame instead of a black box.
    return (m.mime_type || '').startsWith('video') ? m.url + '#t=0.1' : m.url;
  }

  async function load() {
    loading = true;
    error = false;
    refreshing = true;
    try {
      posts = await fetchPosts();
    } catch (e: any) {
      // Session rejected server-side: drop to the login screen rather than
      // leave the feed stuck on an error.
      if (e?.message === '401') {
        await signOutAndReset();
        return;
      }
      error = true;
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function openPost(post: Post): void {
    activePost = post;
    history.pushState({ viewer: true }, '');
  }

  function closePost(): void {
    if (!activePost) return;
    activePost = null;
    if (history.state?.viewer) history.back();
  }

  async function signOutAndReset(): Promise<void> {
    await signOut();
    posts = [];
    activePost = null;
  }
</script>

<svelte:head>
  <title>Moments</title>
</svelte:head>

{#if !session.ready}
  <div class="state show">
    <div class="spinner"></div>
  </div>
{:else if !session.user}
  <div class="auth-box">
    <h1>Moments</h1>
    <p class="sub">A private journal for two.</p>
    <button onclick={signInWithGoogle}>Sign in with Google</button>
  </div>
{:else}
  <header class="bar">
    <div class="title-group">
      <h1>Moments</h1>
      {#if countText}<span class="count">{countText}</span>{/if}
    </div>
    <div class="bar-actions">
      <button class="icon-btn" onclick={load} disabled={refreshing} aria-label="Refresh timeline">
        <svg class:spin={refreshing} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
        </svg>
      </button>
      <button class="text-btn" onclick={signOutAndReset}>Sign out</button>
    </div>
  </header>

  <main class="feed">
    {#if loading}
      <div class="state show">
        <div class="spinner"></div>
      </div>
    {:else if error}
      <div class="state show">
        <p class="err-text">Could not load timeline.</p>
        <button onclick={load}>Try again</button>
      </div>
    {:else if posts.length === 0}
      <div class="state show">
        <p class="empty-text">No moments yet.</p>
        <p class="empty-sub">Share a photo or video from Android to post the first one.</p>
      </div>
    {:else}
      <div class="timeline">
        {#each posts as post (post.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <article
            class="post"
            role="button"
            tabindex="0"
            onclick={() => openPost(post)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPost(post);
              }
            }}
          >
            <time class="post-time" datetime={post.created_at}>{formatDate(post.created_at)}</time>
            <div class="post-media">
              {#if isVideo(post)}
                <video src={feedSrc(post)} preload="metadata" muted playsinline></video>
              {:else}
                {@const m = postMedia(post)}
                {#if m}
                  <img src={m.url} alt={post.caption || ''} loading="lazy" />
                {/if}
              {/if}
            {#if isVideo(post)}
              <svg class="play" viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
                <circle cx="12" cy="12" r="10.5" fill="rgba(0,0,0,.45)"/>
                <path d="M10 8.5l6 3.5-6 3.5z"/>
              </svg>
            {/if}
            {#if (post.post_media?.length || 0) > 1}
              <svg class="multi" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1.6" y="4.6" width="10" height="10" rx="1.8"/><path d="M4.5 1.5h7.9a2.1 2.1 0 0 1 2.1 2.1v7.9"/>
              </svg>
            {/if}
          </div>
          {#if post.caption}
            <p class="post-caption">{post.caption}</p>
          {/if}
          {#if post.location}
            <p class="post-location">{post.location}</p>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</main>

{#if activePost}
  <PostViewer post={activePost} onClose={closePost} />
{/if}
{/if}
