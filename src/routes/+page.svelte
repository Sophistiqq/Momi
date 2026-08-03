<script>
  import { onMount } from 'svelte';
  import PostViewer from '$lib/PostViewer.svelte';
  import { fetchPosts, formatDate } from '$lib/api.js';
  import { signOut } from '$lib/session.svelte.js';

  let posts = $state([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state(null);
  let refreshing = $state(false);

  let countText = $derived(posts.length ? `${posts.length} moment${posts.length > 1 ? 's' : ''}` : '');

  onMount(async () => {
    // Hardware/browser back while the post viewer is open should close the
    // viewer, not navigate the app away. We push a history entry on open and
    // pop it on close, so back lands on the popup first.
    window.addEventListener('popstate', () => {
      if (activePost) activePost = null;
    });
    await load();
  });

  function postMedia(post) {
    return post?.post_media?.[0] || null;
  }

  function isVideo(post) {
    const m = postMedia(post);
    return !!m && (m.mime_type || '').startsWith('video');
  }

  function feedSrc(post) {
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
    } catch {
      error = true;
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function openPost(post) {
    activePost = post;
    history.pushState({ viewer: true }, '');
  }

  function closePost() {
    if (!activePost) return;
    activePost = null;
    if (history.state?.viewer) history.back();
  }

  async function signOutAndReset() {
    await signOut();
    posts = [];
    activePost = null;
  }
</script>

<header class="topbar">
  <h1 class="logo logo-lg">Moments</h1>
  <div class="topbar-right">
    <span class="count">{countText}</span>
    <button class="btn btn-ghost" onclick={signOutAndReset} aria-label="Sign out">Sign out</button>
    <button class="icon-btn" onclick={load} disabled={loading} aria-label="Refresh">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class:spin={refreshing}>
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.5v3h-3"/>
      </svg>
    </button>
  </div>
</header>

<main>
  {#if loading}
    <div class="state show">
      <h2>Loading…</h2>
    </div>
  {:else if error}
    <div class="state show">
      <h2>Couldn&rsquo;t load</h2>
      <p>Check your connection and try again.</p>
      <button class="btn btn-primary" onclick={load}>Try again</button>
    </div>
  {:else if posts.length === 0}
    <div class="state show">
      <h2>Nothing here yet</h2>
      <p>Share a photo or video from your gallery — it&rsquo;ll land right here.</p>
    </div>
  {:else}
    <!-- Feed: vertical timeline, one entry per post -->
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
            {:else if postMedia(post)}
              <img src={postMedia(post).url} alt={post.caption || ''} loading="lazy" />
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
