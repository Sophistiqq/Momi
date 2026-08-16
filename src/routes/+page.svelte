<script lang="ts">
  import { onMount } from "svelte";
  import PostViewer from "$lib/PostViewer.svelte";
  import MapTimeline from "$lib/MapTimeline.svelte";
  import SocialTimeline from "$lib/SocialTimeline.svelte";
  import { fetchPosts, fetchComments, getCachedPosts, formatDate, formatDateTime, purgePost, restorePost, type Post, type Comment } from "$lib/api";
  import { session, initSession, signOut } from "$lib/session.svelte";
  import { initPushNotifications } from "$lib/push";

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state<Post | null>(null);
  let focusedPostId = $state<string | null>(null);
  let showConnectors = $state(false);
  let showScrubber = $state(true);
  let activeTab = $state<"map" | "timeline">("timeline");

  // Trash overlay state
  let showTrash = $state(false);
  let trashPosts = $state<Post[]>([]);
  let trashLoading = $state(false);
  let trashError = $state(false);
  let purgingId = $state<string | null>(null);
  let restoringId = $state<string | null>(null);
  let confirmPurgeId = $state<string | null>(null);

  // --- Page-level comments cache (feeds PostViewer to avoid a fetch on open) ---
  let commentsCache = $state<Record<string, Comment[]>>({});
  const commentsCachePrefetching = new Set<string>();

  async function prefetchPostComments(postId: string) {
    if (commentsCache[postId] !== undefined || commentsCachePrefetching.has(postId)) return;
    const post = posts.find((p) => p.id === postId);
    const knownCount = post?.comment_count ?? post?.comments_count ?? -1;
    if (knownCount === 0) {
      commentsCache[postId] = [];
      return;
    }
    commentsCachePrefetching.add(postId);
    try {
      commentsCache[postId] = await fetchComments(postId);
    } catch {
      // Silent — PostViewer will fall back to fetching itself.
    } finally {
      commentsCachePrefetching.delete(postId);
    }
  }

  // Warm up comments whenever the focused post changes (covers both map swipe and timeline scroll).
  $effect(() => {
    if (focusedPostId) prefetchPostComments(focusedPostId);
  });

  let countText = $derived(
    posts.length
      ? `${posts.length} moment${posts.length > 1 ? "s" : ""}`
      : "",
  );

  onMount(() => {
    window.addEventListener("popstate", () => {
      if (activePost) activePost = null;
      else if (showTrash) showTrash = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load(true);
    });
    initSession();
    load();
    initPushNotifications();
  });

  // IntersectionObserver to sync the background map camera with the currently centered slide
  function setupObserver(node: HTMLElement, _postsList: Post[]) {
    let observer: IntersectionObserver | null = null;

    function attach() {
      if (observer) observer.disconnect();
      observer = new IntersectionObserver(
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
          threshold: 0.5,
        },
      );

      const slides = node.querySelectorAll(".snap-slide");
      slides.forEach((s) => observer?.observe(s));
    }

    attach();

    return {
      update(_newPosts: Post[]) {
        attach();
      },
      destroy() {
        if (observer) observer.disconnect();
      },
    };
  }

  async function load(silent = false) {
    // 1. Instant Cache-first render
    if (!silent && posts.length === 0) {
      const cached = getCachedPosts();
      if (cached && cached.length > 0) {
        posts = cached;
        focusedPostId = cached[0].id;
        loading = false;
      }
    }

    if (!silent && posts.length === 0) loading = true;
    error = false;

    // 2. Background network fetch
    try {
      const data = await fetchPosts();
      posts = data;
      if (posts.length > 0 && !focusedPostId) {
        focusedPostId = posts[0].id;
      }
    } catch (e: any) {
      if (e?.message === "401") {
        await signOutAndReset();
        return;
      }
      // If we don't even have cached posts, display error
      if (posts.length === 0 && !silent) error = true;
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

  let scrubberActive = $state(false);
  let scrubberTrackEl = $state<HTMLDivElement | undefined>();

  let focusedIndex = $derived(
    posts.findIndex((p) => p.id === focusedPostId) !== -1
      ? posts.findIndex((p) => p.id === focusedPostId)
      : 0
  );

  let scrubberPercent = $derived(
    posts.length > 1
      ? (focusedIndex / (posts.length - 1)) * 100
      : 0
  );

  // --- Pagination (client-side windowing) ---
  const PAGE_SIZE = 12;
  let visibleCount = $state(PAGE_SIZE);
  let visiblePosts = $derived(posts.slice(0, visibleCount));
  let hasMore = $derived(visibleCount < posts.length);

  function loadMore() {
    visibleCount = Math.min(visibleCount + PAGE_SIZE, posts.length);
  }

  // Svelte action: attach an IntersectionObserver to sentinel elements so
  // that scrolling near the end automatically reveals the next batch.
  function setupSentinel(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }

  // Reset visible window whenever the full post list refreshes
  $effect(() => {
    if (posts.length > 0) visibleCount = PAGE_SIZE;
  });

  function handleScrubberInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const index = parseInt(target.value, 10);
    if (posts[index]) {
      focusPost(posts[index], "auto");
    }
  }

  function handleScrubberTouch(clientY: number) {
    if (!scrubberTrackEl || posts.length === 0) return;
    const rect = scrubberTrackEl.getBoundingClientRect();
    const clampedY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const ratio = clampedY / rect.height;
    const index = Math.min(posts.length - 1, Math.max(0, Math.round(ratio * (posts.length - 1))));
    if (posts[index]) {
      focusPost(posts[index], "auto");
    }
  }

  function focusPost(post: Post, behavior: ScrollBehavior = "smooth"): void {
    focusedPostId = post.id;
    const slide = document.querySelector(`[data-post-id="${post.id}"]`);
    slide?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
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

  let timelineScrollY = $state(0);

  function switchTab(newTab: "map" | "timeline"): void {
    if (newTab === activeTab) return;

    if (activeTab === "timeline") {
      timelineScrollY = window.scrollY;
    }

    activeTab = newTab;

    if (newTab === "timeline") {
      requestAnimationFrame(() => {
        if (focusedPostId) {
          const el = document.querySelector(`.stl-card[data-post-id="${focusedPostId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "instant", block: "center" });
            return;
          }
        }
        if (timelineScrollY > 0) {
          window.scrollTo({ top: timelineScrollY, behavior: "instant" });
        }
      });
    } else if (newTab === "map") {
      requestAnimationFrame(() => {
        if (focusedPostId) {
          const post = posts.find((p) => p.id === focusedPostId);
          if (post) focusPost(post, "auto");
        }
      });
    }
  }

  function handleShowOnMap(post: Post): void {
    focusedPostId = post.id;
    switchTab("map");
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

{#if activeTab === "map"}
  <MapTimeline
    {posts}
    activePostId={focusedPostId}
    {showConnectors}
    onSelectPost={(post) => focusPost(post)}
  />
{/if}

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
          onclick={() => (showScrubber = !showScrubber)}
          class="menu-toggle-item"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
          <span style="flex:1;">Timeline slider</span>
          <span class="menu-pill" class:pill-active={showScrubber}>{showScrubber ? "ON" : "OFF"}</span>
        </button>

        <button
          onclick={() => (showConnectors = !showConnectors)}
          class="menu-toggle-item"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="6" r="3"></circle>
            <path d="M8.5 15.5l7-7"></path>
          </svg>
          <span style="flex:1;">Route lines</span>
          <span class="menu-pill" class:pill-active={showConnectors}>{showConnectors ? "ON" : "OFF"}</span>
        </button>

        <div class="menu-divider"></div>

        <button
          popovertarget="app-menu"
          popovertargetaction="hide"
          onclick={() => load()}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M2 8a6 6 0 1 0 1.5-3.9M2 3.5V8h4.5" /></svg
          >
          Fetch
        </button>
        <button
          popovertarget="app-menu"
          popovertargetaction="hide"
          onclick={async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            location.reload();
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M8 2v3l3-3M2 8a6 6 0 0 0 10.3 4.2M14 8a6 6 0 0 0-10.3-4.2" /></svg
          >
          Update
        </button>
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

  <!-- Floating view-switcher tab bar -->
  <div class="view-switcher-bar">
    <div class="view-switcher" role="tablist" aria-label="View mode">
      <button
        class="vs-tab"
        class:vs-active={activeTab === "timeline"}
        role="tab"
        aria-selected={activeTab === "timeline"}
        onclick={() => switchTab("timeline")}
        id="tab-timeline"
      >
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="16" height="5" rx="1.5"/>
          <rect x="2" y="10.5" width="10" height="3.5" rx="1.5"/>
          <rect x="2" y="16" width="7" height="2" rx="1"/>
        </svg>
        Timeline
      </button>
      <button
        class="vs-tab"
        class:vs-active={activeTab === "map"}
        role="tab"
        aria-selected={activeTab === "map"}
        onclick={() => switchTab("map")}
        id="tab-map"
      >
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="2 5 7 2.5 13 5 18 2.5 18 15.5 13 18 7 15.5 2 18"/>
          <line x1="7" y1="2.5" x2="7" y2="15.5"/>
          <line x1="13" y1="5" x2="13" y2="18"/>
        </svg>
        Map
      </button>
    </div>
  </div>

  <main class:timeline-main={activeTab === "timeline"}>
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
      {#if activeTab === "map"}
        <!-- Left side vertical scrubber slider -->
        {#if showScrubber && posts.length > 1}
          <aside
            class="timeline-scrubber-wrapper"
            class:active={scrubberActive}
            aria-label="Timeline Scrubber"
          >
            <div
              class="scrubber-capsule"
              bind:this={scrubberTrackEl}
              role="slider"
              tabindex="0"
              aria-valuemin="0"
              aria-valuemax={posts.length - 1}
              aria-valuenow={focusedIndex}
              aria-valuetext={`Moment ${focusedIndex + 1} of ${posts.length}`}
              ontouchstart={(e) => {
                scrubberActive = true;
                handleScrubberTouch(e.touches[0].clientY);
              }}
              ontouchmove={(e) => {
                if (scrubberActive) handleScrubberTouch(e.touches[0].clientY);
              }}
              ontouchend={() => (scrubberActive = false)}
              onmousedown={(e) => {
                scrubberActive = true;
                handleScrubberTouch(e.clientY);
                const onMove = (ev: MouseEvent) => handleScrubberTouch(ev.clientY);
                const onUp = () => {
                  scrubberActive = false;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              <!-- Notch ticks inside capsule -->
              <div class="scrubber-ticks" aria-hidden="true">
                <span class="scrubber-tick major"></span>
                <span class="scrubber-tick"></span>
                <span class="scrubber-tick"></span>
                <span class="scrubber-tick major"></span>
                <span class="scrubber-tick"></span>
                <span class="scrubber-tick"></span>
                <span class="scrubber-tick major"></span>
              </div>

              <div class="scrubber-track">
                <div class="scrubber-progress" style="height: {scrubberPercent}%;"></div>
              </div>

              <div
                class="scrubber-thumb"
                style="top: {scrubberPercent}%;"
              >
                <span class="scrubber-thumb-dot"></span>
                <div class="scrubber-bubble">
                  <span class="bubble-num">{focusedIndex + 1}</span>
                  <span class="bubble-total">/{posts.length}</span>
                  {#if posts[focusedIndex]}
                    <span class="bubble-date">{formatDate(posts[focusedIndex].created_at)}</span>
                  {/if}
                </div>
              </div>
            </div>
          </aside>
        {/if}

        <div class="snap-feed-wrapper">
          <div class="snap-feed" use:setupObserver={visiblePosts}>
            {#each visiblePosts as post (post.id)}
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
            {#if hasMore}
              <!-- Sentinel: scrolling to this triggers loading the next page of map slides -->
              <div
                class="snap-slide snap-sentinel"
                use:setupSentinel
              ></div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Social timeline view -->
        <SocialTimeline
          posts={visiblePosts}
          focusedPostId={focusedPostId}
          onOpenPost={openPost}
          onShowOnMap={handleShowOnMap}
          onFocusPost={(id) => (focusedPostId = id)}
        />
        {#if hasMore}
          <!-- Sentinel: when this enters the viewport the next batch of cards is revealed -->
          <div class="load-more-sentinel" use:setupSentinel aria-hidden="true"></div>
        {/if}
      {/if}
    {/if}
  </main>


  {#if activePost}
    <PostViewer
      post={activePost}
      initialComments={commentsCache[activePost.id]}
      onClose={closePost}
      onDelete={handleDeletePost}
      onRestore={handleRestorePost}
      onShowOnMap={handleShowOnMap}
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
