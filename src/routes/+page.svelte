<script lang="ts">
  import { onMount } from 'svelte';
  import PostViewer from '$lib/PostViewer.svelte';
  import { fetchPosts, formatDate, type Media, type Post } from '$lib/api';
  import { session, initSession, signOut } from '$lib/session.svelte';

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state<Post | null>(null);
  let showTrash = $state(false);

  let countText = $derived(posts.length ? `${posts.length} moment${posts.length > 1 ? 's' : ''}${showTrash ? ' in trash' : ''}` : '');

  onMount(async () => {
    // Hardware/browser back while the post viewer is open should close the
    // viewer, not navigate the app away. We push a history entry on open and
    // pop it on close, so back lands on the popup first.
    window.addEventListener('popstate', () => {
      if (activePost) activePost = null;
    });
    // Auto-refresh when returning to the tab (replaces the old manual button).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') load(true);
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

  async function load(silent = false) {
    if (!silent) loading = true;
    error = false;
    try {
      posts = await fetchPosts(showTrash ? 'trash' : undefined);
    } catch (e: any) {
      // Session rejected server-side: drop to the login screen rather than
      // leave the feed stuck on an error.
      if (e?.message === '401') {
        await signOutAndReset();
        return;
      }
      if (!silent) error = true;
    } finally {
      loading = false;
    }
  }

  async function toggleTrash() {
    showTrash = !showTrash;
    await load();
  }

  function handleDeletePost(postId: string) {
    posts = posts.filter((p) => p.id !== postId);
  }

  function handleRestorePost(postId: string) {
    posts = posts.filter((p) => p.id !== postId);
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
  <!-- Auth is handled in +layout.svelte; this branch should not render -->
{:else}
  <header class="topbar">
    <span class="logo logo-lg">{showTrash ? 'Trash' : 'Moments'}</span>
    <div class="topbar-right">
      {#if countText}<span class="count">{countText}</span>{/if}
      <button class="icon-btn menu-btn" popovertarget="app-menu" aria-label="Menu">⋯</button>
      <div class="app-menu" id="app-menu" popover>
        <button popovertarget="app-menu" popovertargetaction="hide" onclick={toggleTrash}>
          {#if showTrash}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8h13M1.5 8l4-4M1.5 8l4 4"/></svg>
            Back to feed
          {:else}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11M5.5 3.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-7 0v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10M6.5 6.5v5m3-5v5"/></svg>
            Trash
          {/if}
        </button>
        <button popovertarget="app-menu" popovertargetaction="hide" onclick={signOutAndReset} style="color: var(--danger);">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H10M6 5.5L3.5 8 6 10.5M14 8H3.5"/></svg>
          Sign out
        </button>
      </div>
    </div>
  </header>

  <main>
    {#if loading}
      <div class="timeline" role="status" aria-label="Loading moments">
        {#each [0, 1, 2] as n (n)}
          <div class="skel-post">
            <div class="skel-line" style="width: 32%;"></div>
            <div class="skel-media" style="aspect-ratio: 4 / 3;"></div>
            <div class="skel-line" style="width: 84%;"></div>
            <div class="skel-line" style="width: 55%;"></div>
          </div>
        {/each}
      </div>
    {:else if error}
      <div class="state show">
        <h2>Couldn&rsquo;t load</h2>
        <p>Check your connection and try again.</p>
        <button class="btn btn-primary" onclick={() => load()}>Try again</button>
      </div>
    {:else if posts.length === 0}
      <div class="state show">
        <h2>{showTrash ? 'Trash is empty' : 'Nothing here yet'}</h2>
        <p>{showTrash ? 'Your deleted moments will appear here.' : 'Share a photo or video from your gallery — it&rsquo;ll land right here.'}</p>
      </div>
    {:else}
      <div class="timeline">
        {#each posts as post, i (post.id)}
          <article class="post" style="animation-delay: {Math.min(i, 8) * 35}ms">
            <button type="button" class="post-hit" aria-label="Open post" onclick={() => openPost(post)}></button>
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
            {#if post.mentions?.length}
              <p class="post-mentions">{post.mentions.map((n) => `@${n}`).join(' ')}</p>
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
    <PostViewer post={activePost} onClose={closePost} onDelete={handleDeletePost} onRestore={handleRestorePost} />
  {/if}
{/if}
