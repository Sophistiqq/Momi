<script lang="ts">
  import { onMount } from "svelte";
  import PostViewer from "$lib/PostViewer.svelte";
  import MapTimeline from "$lib/MapTimeline.svelte";
  import { fetchPosts, formatDate, formatDateTime, purgePost, restorePost, type Post } from "$lib/api";
  import { session, initSession, signOut } from "$lib/session.svelte";
  import { initPushNotifications } from "$lib/push";

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state<Post | null>(null);
  let focusedPostId = $state<string | null>(null);
  let showConnectors = $state(false);

  // Trash overlay state
  let showTrash = $state(false);
  let trashPosts = $state<Post[]>([]);
  let trashLoading = $state(false);
  let trashError = $state(false);
  let purgingId = $state<string | null>(null);
  let restoringId = $state<string | null>(null);
  let confirmPurgeId = $state<string | null>(null);

  let countText = $derived(
    posts.length
      ? `${posts.length} moment${posts.length > 1 ? "s" : ""}`
      : "",
  );

  onMount(async () => {
    window.addEventListener("popstate", () => {
      if (activePost) activePost = null;
      else if (showTrash) showTrash = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load(true);
    });
    await initSession();
    await load();
    initPushNotifications();
  });

  // IntersectionObserver to sync the background map camera with the currently centered slide
  function setupObserver(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-post-id");
            if (id) focusedPostId = id;
          }
        });
      },
      {
        root: node,
        threshold: 0.6,
      },
    );

    const slides = node.querySelectorAll(".snap-slide");
    slides.forEach((s) => observer.observe(s));

    return {
      update() {
        observer.disconnect();
        const currentSlides = node.querySelectorAll(".snap-slide");
        currentSlides.forEach((s) => observer.observe(s));
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  async function load(silent = false) {
    if (!silent) loading = true;
    error = false;
    try {
      posts = await fetchPosts();
      if (posts.length > 0 && !focusedPostId) {
        focusedPostId = posts[0].id;
      }
    } catch (e: any) {
      if (e?.message === "401") {
        await signOutAndReset();
        return;
      }
      if (!silent) error = true;
    } finally {
      loading = false;
    }
  }

  async function openTrash() {
    showTrash = true;
    history.pushState({ trash: true }, "");
    trashLoading = true;
    trashError = false;
    confirmPurgeId = null;
    try {
      trashPosts = await fetchPosts("trash");
    } catch {
      trashError = true;
    } finally {
      trashLoading = false;
    }
  }

  function closeTrash() {
    showTrash = false;
    confirmPurgeId = null;
    if (history.state?.trash) history.back();
  }

  async function handleRestore(post: Post) {
    restoringId = post.id;
    try {
      const ok = await restorePost(post.id);
      if (ok) {
        trashPosts = trashPosts.filter((p) => p.id !== post.id);
        await load(true);
      }
    } finally {
      restoringId = null;
    }
  }

  async function handlePurge(post: Post) {
    if (confirmPurgeId !== post.id) {
      confirmPurgeId = post.id;
      return;
    }
    purgingId = post.id;
    confirmPurgeId = null;
    try {
      const ok = await purgePost(post.id);
      if (ok) {
        trashPosts = trashPosts.filter((p) => p.id !== post.id);
      }
    } finally {
      purgingId = null;
    }
  }

  function handleDeletePost(postId: string) {
    posts = posts.filter((p) => p.id !== postId);
  }

  function handleRestorePost(postId: string) {
    posts = posts.filter((p) => p.id !== postId);
  }

  function focusPost(post: Post): void {
    focusedPostId = post.id;
    const slide = document.querySelector(`[data-post-id="${post.id}"]`);
    slide?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  function openPost(post: Post): void {
    const apply = () => {
      focusedPostId = post.id;
      activePost = post;
    };
    if (document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
    history.pushState({ viewer: true }, "");
  }

  function closePost(): void {
    if (!activePost) return;
    const apply = () => {
      activePost = null;
    };
    if (document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
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

<MapTimeline
  {posts}
  activePostId={focusedPostId}
  {showConnectors}
  onSelectPost={(post) => focusPost(post)}
/>

{#if !session.ready}
  <div class="state show">
    <div class="spinner"></div>
  </div>
{:else if !session.user}
  <!-- Auth is handled in +layout.svelte; this branch should not render -->
{:else}
  <header class="topbar">
    <span class="logo logo-lg">Moments</span>
    <div class="topbar-right">
      {#if countText}<span class="count">{countText}</span>{/if}
      <button
        type="button"
        class="icon-btn"
        class:active-btn={showConnectors}
        onclick={() => (showConnectors = !showConnectors)}
        aria-label={showConnectors ? "Hide route lines" : "Show route lines"}
        title={showConnectors ? "Hide route lines" : "Show route lines"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="6" r="3"></circle>
          <path d="M8.5 15.5l7-7"></path>
        </svg>
      </button>
      <a href="/customize" class="icon-btn add-btn" aria-label="Create new post" title="New post">
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </a>
      <button
        class="icon-btn menu-btn"
        popovertarget="app-menu"
        aria-label="Menu"
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"
          ><circle cx="3" cy="8" r="1.6" /><circle
            cx="8"
            cy="8"
            r="1.6"
          /><circle cx="13" cy="8" r="1.6" /></svg
        >
      </button>
      <div class="app-menu" id="app-menu" popover>
        <button
          popovertarget="app-menu"
          popovertargetaction="hide"
          onclick={openTrash}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M2.5 3.5h11M5.5 3.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-7 0v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10M6.5 6.5v5m3-5v5" /></svg
          >
          Trash
        </button>
        <button
          popovertarget="app-menu"
          popovertargetaction="hide"
          onclick={signOutAndReset}
          style="color: var(--danger);"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M10 3.5h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H10M6 5.5L3.5 8 6 10.5M14 8H3.5" /></svg
          >
          Sign out
        </button>
      </div>
    </div>
  </header>

  <main>
    {#if loading}
      <div class="snap-feed-wrapper" role="status" aria-label="Loading moments">
        <div class="snap-feed" style="overflow-x: hidden;">
          {#each [0, 1, 2] as n (n)}
            <div class="snap-slide">
              <div class="skel-hud">
                <div class="hud-top">
                  <div class="skel-line" style="width: 70px; height: 16px; border-radius: 12px;"></div>
                  <div class="skel-line" style="width: 50px; height: 14px;"></div>
                </div>
                <div class="skel-line" style="width: 85%; height: 14px; margin-top: 4px;"></div>
                <div class="skel-line" style="width: 60%; height: 14px;"></div>
                <div class="hud-bottom" style="margin-top: 6px;">
                  <div class="skel-line" style="width: 80px; height: 12px;"></div>
                  <div class="skel-line" style="width: 24px; height: 24px; border-radius: 50%;"></div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if error}
      <div class="state show">
        <h2>Couldn&rsquo;t load</h2>
        <p>Check your connection and try again.</p>
        <button class="btn btn-primary" onclick={() => load()}>Try again</button
        >
      </div>
    {:else if posts.length === 0}
      <div class="state show">
        <h2>Nothing here yet</h2>
        <p>Share a photo or video from your gallery — it&rsquo;ll land right here.</p>
      </div>
    {:else}
      <div class="snap-feed-wrapper">
        <div class="snap-feed" use:setupObserver>
          {#each posts as post (post.id)}
            <section
              class="snap-slide"
              data-post-id={post.id}
            >
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
              <div
                class="slide-hud"
                class:focused={post.id === focusedPostId}
                onclick={() => openPost(post)}
                role="button"
                tabindex="0"
              >
                <div class="hud-top">
                  <div class="hud-candy-badge">
                    <span class="hud-candy-dot"></span>
                    {#if (post.post_media?.length || 0) > 0}
                      <span>{post.post_media.length} {post.post_media.length === 1 ? 'item' : 'items'}</span>
                    {/if}
                  </div>
                  <span class="hud-time">
                    {new Date(post.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>

                {#if post.caption}
                  <p class="hud-caption">
                    {post.caption.length > 150 ? post.caption.slice(0, 150) + "…" : post.caption}
                  </p>
                {/if}

                <div class="hud-bottom">
                  <time class="hud-date" datetime={post.created_at}>
                    {formatDate(post.created_at)}
                  </time>
                  <div class="hud-tap-pill">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M6 3.5l4.5 4.5-4.5 4.5" />
                    </svg>
                  </div>
                </div>
              </div>
            </section>
          {/each}
        </div>
      </div>
    {/if}
  </main>

  {#if activePost}
    <PostViewer
      post={activePost}
      onClose={closePost}
      onDelete={handleDeletePost}
      onRestore={handleRestorePost}
    />
  {/if}

  <!-- ---- Trash Overlay ---- -->
  {#if showTrash}
    <div class="trash-overlay" role="dialog" aria-modal="true" aria-label="Trash">
      <header class="trash-header">
        <button class="icon-btn" onclick={closeTrash} aria-label="Close trash">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
        <span class="logo" style="font-size:1.1rem;">Trash</span>
        <span class="count" style="visibility: {trashPosts.length ? 'visible' : 'hidden'}">
          {trashPosts.length} item{trashPosts.length !== 1 ? 's' : ''}
        </span>
      </header>

      <div class="trash-body">
        {#if trashLoading}
          <div class="state show" style="min-height: 40vh;">
            <div class="spinner"></div>
          </div>
        {:else if trashError}
          <div class="state show" style="min-height: 40vh;">
            <h2>Couldn&rsquo;t load</h2>
            <button class="btn btn-primary" onclick={openTrash}>Retry</button>
          </div>
        {:else if trashPosts.length === 0}
          <div class="state show" style="min-height: 50vh;">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3">
              <path d="M6 12h36M18 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M20 22v12m8-12v12" />
              <rect x="10" y="12" width="28" height="30" rx="3" />
            </svg>
            <h2>Trash is empty</h2>
            <p style="color: var(--muted); font-size:.9rem;">Deleted moments will appear here.</p>
          </div>
        {:else}
          <p class="trash-hint">Items in trash can be restored or permanently deleted to free up storage.</p>
          <ul class="trash-list">
            {#each trashPosts as post (post.id)}
              <li class="trash-card" class:confirming={confirmPurgeId === post.id}>
                {#if (post.post_media?.length ?? 0) > 0}
                  <div class="trash-thumb-strip">
                    {#each post.post_media.slice(0, 3) as m}
                      {#if m.mime_type.startsWith('video')}
                        <div class="trash-thumb trash-thumb-video">
                          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" style="opacity:.7"><path d="M6 4l7 4-7 4V4z"/></svg>
                        </div>
                      {:else}
                        <img class="trash-thumb" src={m.url} alt="" loading="lazy" />
                      {/if}
                    {/each}
                    {#if post.post_media.length > 3}
                      <div class="trash-thumb trash-thumb-more">+{post.post_media.length - 3}</div>
                    {/if}
                  </div>
                {/if}

                <div class="trash-info">
                  {#if post.caption}
                    <p class="trash-caption">{post.caption.length > 120 ? post.caption.slice(0,120) + '…' : post.caption}</p>
                  {/if}
                  <time class="trash-date" datetime={post.created_at}>
                    {formatDateTime(post.created_at)}
                  </time>
                  {#if post.location}
                    <span class="trash-location">
                      <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" style="opacity:.5;flex-shrink:0"><path d="M8 1a4.5 4.5 0 0 0-4.5 4.5C3.5 9 8 15 8 15s4.5-6 4.5-9.5A4.5 4.5 0 0 0 8 1zm0 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>
                      {post.location.length > 60 ? post.location.slice(0,60)+'…' : post.location}
                    </span>
                  {/if}
                </div>

                <div class="trash-actions">
                  <button
                    class="btn btn-ghost trash-restore-btn"
                    onclick={() => handleRestore(post)}
                    disabled={restoringId === post.id || purgingId === post.id}
                  >
                    {#if restoringId === post.id}
                      <span class="spinner-sm"></span>
                    {:else}
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 3.5V8h4.5"/></svg>
                    {/if}
                    Restore
                  </button>
                  <button
                    class="btn trash-purge-btn"
                    class:btn-danger={confirmPurgeId === post.id}
                    onclick={() => handlePurge(post)}
                    disabled={purgingId === post.id || restoringId === post.id}
                  >
                    {#if purgingId === post.id}
                      <span class="spinner-sm"></span>
                    {:else if confirmPurgeId === post.id}
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8h12M8 2l6 6-6 6"/></svg>
                      Confirm delete
                    {:else}
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11M5.5 3.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-7 0v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10"/></svg>
                      Delete forever
                    {/if}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
{/if}
