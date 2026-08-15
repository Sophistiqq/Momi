<script lang="ts">
  import { onMount } from "svelte";
  import PostViewer from "$lib/PostViewer.svelte";
  import MapTimeline from "$lib/MapTimeline.svelte";
  import { fetchPosts, formatDate, type Post } from "$lib/api";
  import { session, initSession, signOut } from "$lib/session.svelte";
  import { initPushNotifications } from "$lib/push";

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let activePost = $state<Post | null>(null);
  let focusedPostId = $state<string | null>(null);
  let showTrash = $state(false);
  let showConnectors = $state(true);

  let countText = $derived(
    posts.length
      ? `${posts.length} moment${posts.length > 1 ? "s" : ""}${showTrash ? " in trash" : ""}`
      : "",
  );

  onMount(async () => {
    window.addEventListener("popstate", () => {
      if (activePost) activePost = null;
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
      posts = await fetchPosts(showTrash ? "trash" : undefined);
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
    <span class="logo logo-lg">{showTrash ? "Trash" : "Moments"}</span>
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
          onclick={toggleTrash}
        >
          {#if showTrash}
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M1.5 8h13M1.5 8l4-4M1.5 8l4 4" /></svg
            >
            Back to feed
          {:else}
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M2.5 3.5h11M5.5 3.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-7 0v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10M6.5 6.5v5m3-5v5"
              /></svg
            >
            Trash
          {/if}
        </button>
        <button
          popovertarget="app-menu"
          popovertargetaction="hide"
          onclick={signOutAndReset}
          style="color: var(--danger);"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M10 3.5h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H10M6 5.5L3.5 8 6 10.5M14 8H3.5"
            /></svg
          >
          Sign out
        </button>
      </div>
    </div>
  </header>

  <main>
    {#if loading}
      <div class="timeline" role="status" aria-label="Loading moments">
        {#each [0, 1, 2, 3, 4] as n (n)}
          <div class="skel-post-card">
            <div class="skel-line" style="width: 50%; height: 16px;"></div>
            <div class="skel-line" style="width: 30%; height: 12px; margin-top: 6px;"></div>
          </div>
        {/each}
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
        <h2>{showTrash ? "Trash is empty" : "Nothing here yet"}</h2>
        <p>
          {showTrash
            ? "Your deleted moments will appear here."
            : "Share a photo or video from your gallery — it&rsquo;ll land right here."}
        </p>
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
{/if}
