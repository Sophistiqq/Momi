<script lang="ts">
  import {
    fetchComments,
    addComment,
    updatePost,
    deletePost,
    toggleLike as apiToggleLike,
    formatDate,
    formatDateTime,
    type Post,
    type Comment,
  } from "$lib/api";

  interface Props {
    posts: Post[];
    focusedPostId?: string | null;
    onDelete?: (id: string) => void;
    onShowOnMap: (post: Post) => void;
    onFocusPost?: (id: string) => void;
  }

  let { posts, focusedPostId, onDelete, onShowOnMap, onFocusPost }: Props = $props();

  // Plain reactive maps for item states to prevent Svelte 5 unsafe state mutation during template evaluation
  let likedMap = $state<Record<string, boolean>>({});
  let likeCountMap = $state<Record<string, number>>({});
  let commentsMap = $state<Record<string, Comment[]>>({});
  let commentsLoadingMap = $state<Record<string, boolean>>({});
  let commentExpandedMap = $state<Record<string, boolean>>({});
  let newCommentMap = $state<Record<string, string>>({});
  let commentingMap = $state<Record<string, boolean>>({});
  let heartBurstId = $state<string | null>(null);

  // Media carousel state per card
  let mediaIndexMap = $state<Record<string, number>>({});
  let videoPausedMap = $state<Record<string, boolean>>({});

  // Caption/location editing state per card
  let editingMap = $state<Record<string, boolean>>({});
  let captionDraftMap = $state<Record<string, string>>({});
  let locationDraftMap = $state<Record<string, string>>({});

  // Non-reactive: gesture tracking + imperative video refs.
  const touchStartXByPost = new Map<string, number>();
  const videoRefs: Record<string, HTMLVideoElement | undefined> = {};
  const vidKey = (postId: string, i: number) => `${postId}:${i}`;

  // Only one video plays at a time across the whole feed.
  $effect(() => {
    const onPlay = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      if (!(v instanceof HTMLVideoElement)) return;
      document.querySelectorAll("video").forEach((o) => {
        if (o !== v) o.pause();
      });
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  });

  function goToMedia(postId: string, count: number, i: number): void {
    const next = Math.max(0, Math.min(count - 1, i));
    if (next === (mediaIndexMap[postId] ?? 0)) return;
    mediaIndexMap[postId] = next;
    for (let s = 0; s < count; s++) {
      if (s !== next) videoRefs[vidKey(postId, s)]?.pause();
    }
  }

  function swipeMedia(postId: string, count: number, dx: number): void {
    if (Math.abs(dx) < 40) return;
    goToMedia(postId, count, (mediaIndexMap[postId] ?? 0) + (dx < 0 ? 1 : -1));
  }

  function onMediaTouchStart(postId: string, e: TouchEvent): void {
    touchStartXByPost.set(postId, e.touches[0].clientX);
  }

  function onMediaTouchEnd(postId: string, count: number, e: TouchEvent): void {
    const startX = touchStartXByPost.get(postId);
    if (startX === undefined) return;
    swipeMedia(postId, count, e.changedTouches[0].clientX - startX);
  }

  function toggleVideoPlay(postId: string, i: number, e: Event): void {
    e.stopPropagation();
    const vel = videoRefs[vidKey(postId, i)];
    if (!vel) return;
    if (vel.paused) vel.play().catch(() => {});
    else vel.pause();
  }

  function startEditPost(post: Post): void {
    captionDraftMap[post.id] = post.caption || "";
    locationDraftMap[post.id] = post.location || "";
    editingMap[post.id] = true;
  }

  async function submitPostEdit(post: Post): Promise<void> {
    const caption = (captionDraftMap[post.id] ?? "").trim();
    const location = (locationDraftMap[post.id] ?? "").trim();
    const changedLocation = location !== post.location;
    const ok = await updatePost(post.id, {
      caption,
      location,
      lat: changedLocation ? null : undefined,
      lng: changedLocation ? null : undefined,
    });
    if (ok) {
      post.caption = caption;
      post.location = location;
      if (changedLocation) {
        post.lat = null;
        post.lng = null;
      }
    }
    editingMap[post.id] = false;
  }

  async function moveToTrash(postId: string): Promise<void> {
    if (await deletePost(postId)) onDelete?.(postId);
  }

  // Non-reactive: only used as a control-flow guard, never drives rendering.
  const prefetching = new Set<string>();

  async function prefetchComments(postId: string) {
    // Already cached, already in-flight, or known to be empty → skip.
    if (commentsMap[postId] !== undefined || prefetching.has(postId)) return;
    const post = posts.find((p) => p.id === postId);
    const knownCount = post?.comment_count ?? post?.comments_count ?? -1;
    if (knownCount === 0) {
      commentsMap[postId] = [];
      return;
    }

    prefetching.add(postId);
    // Set loading so a mid-flight tap shows the spinner instead of an empty flash.
    commentsLoadingMap[postId] = true;
    try {
      commentsMap[postId] = await fetchComments(postId);
    } catch {
      // Silent failure — commentsMap stays undefined so toggleComments retries on tap.
      delete commentsMap[postId];
    } finally {
      prefetching.delete(postId);
      commentsLoadingMap[postId] = false;
    }
  }

  // Sync scroll position & focused post with map view
  function setupTimelineObserver(node: HTMLElement, _postsList: Post[]) {
    let focusObserver: IntersectionObserver | null = null;
    let prefetchObserver: IntersectionObserver | null = null;

    function attach() {
      if (focusObserver) focusObserver.disconnect();
      if (prefetchObserver) prefetchObserver.disconnect();

      // Tight margin: only fires when the card is well centred — drives map sync.
      focusObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const id = entry.target.getAttribute("data-post-id");
              if (id && onFocusPost) onFocusPost(id);
            }
          }
        },
        { root: null, rootMargin: "-25% 0px -40% 0px", threshold: 0.1 }
      );

      // Wide margin: fires ~500 px before the card reaches the viewport so
      // comments are warmed up well before the user can tap.
      prefetchObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const id = entry.target.getAttribute("data-post-id");
              if (id) prefetchComments(id);
            }
          }
        },
        { root: null, rootMargin: "500px 0px" }
      );

      const cards = node.querySelectorAll(".stl-card");
      cards.forEach((c) => {
        focusObserver?.observe(c);
        prefetchObserver?.observe(c);
      });
    }

    attach();

    return {
      update(_newPosts: Post[]) {
        attach();
      },
      destroy() {
        focusObserver?.disconnect();
        prefetchObserver?.disconnect();
      },
    };
  }

  async function toggleLike(postId: string) {
    const post = posts.find((p) => p.id === postId);
    const isLiked = likedMap[postId] !== undefined ? likedMap[postId] : (post?.liked_by_me ?? false);
    const currentCount = likeCountMap[postId] !== undefined ? likeCountMap[postId] : (post?.like_count ?? 0);
    const nextLiked = !isLiked;
    const nextCount = nextLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    // Optimistic update
    likedMap[postId] = nextLiked;
    likeCountMap[postId] = nextCount;
    if (post) {
      post.liked_by_me = nextLiked;
      post.like_count = nextCount;
    }

    try {
      const res = await apiToggleLike(postId);
      likedMap[postId] = res.liked;
      likeCountMap[postId] = res.like_count;
      if (post) {
        post.liked_by_me = res.liked;
        post.like_count = res.like_count;
      }
    } catch {
      // Revert on failure
      likedMap[postId] = isLiked;
      likeCountMap[postId] = currentCount;
      if (post) {
        post.liked_by_me = isLiked;
        post.like_count = currentCount;
      }
    }
  }

  async function toggleComments(postId: string) {
    const expanded = commentExpandedMap[postId] ?? false;
    commentExpandedMap[postId] = !expanded;

    // Already cached or a prefetch is in-flight → just expand and wait.
    if (!expanded && commentsMap[postId] === undefined && !prefetching.has(postId)) {
      // If we already know the count is 0, skip the network round-trip and
      // just show the empty composer straight away.
      const post = posts.find((p) => p.id === postId);
      const knownCount = post?.comment_count ?? post?.comments_count ?? -1;
      if (knownCount === 0) {
        commentsMap[postId] = [];
        return;
      }

      commentsLoadingMap[postId] = true;
      try {
        const fetched = await fetchComments(postId);
        commentsMap[postId] = fetched;
      } catch {
        commentsMap[postId] = [];
      } finally {
        commentsLoadingMap[postId] = false;
      }
    }
  }

  async function submitComment(postId: string) {
    const body = (newCommentMap[postId] ?? "").trim();
    if (!body || commentingMap[postId]) return;
    commentingMap[postId] = true;
    try {
      if (await addComment(postId, body)) {
        newCommentMap[postId] = "";
        const updated = await fetchComments(postId);
        commentsMap[postId] = updated;
        const post = posts.find((p) => p.id === postId);
        if (post) {
          post.comment_count = updated.length;
          post.comments_count = updated.length;
        }
      }
    } catch {
    } finally {
      commentingMap[postId] = false;
    }
  }

  function relativeTime(s: string): string {
    const diff = Date.now() - new Date(s).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return formatDate(s);
  }

  function handleLikeTap(postId: string) {
    toggleLike(postId);
    heartBurstId = postId;
    setTimeout(() => {
      if (heartBurstId === postId) heartBurstId = null;
    }, 600);
  }
</script>

<div class="stl-feed" role="feed" aria-label="Moments timeline" use:setupTimelineObserver={posts}>
  {#if posts.length === 0}
    <div class="stl-empty">
      <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="10" width="36" height="28" rx="4"/>
        <circle cx="17" cy="20" r="3"/>
        <path d="M6 32l10-8 6 5 7-7 13 10"/>
      </svg>
      <p>No moments yet</p>
    </div>
  {:else}
    {#each posts as post, idx (post.id)}
      {@const isLiked = likedMap[post.id] !== undefined ? likedMap[post.id] : (post.liked_by_me ?? false)}
      {@const likeCount = likeCountMap[post.id] !== undefined ? likeCountMap[post.id] : (post.like_count ?? 0)}
      {@const isExpanded = commentExpandedMap[post.id] ?? false}
      {@const comments = commentsMap[post.id] ?? []}
      {@const commentCount = commentsMap[post.id] !== undefined ? commentsMap[post.id].length : (post.comments_count ?? post.comment_count ?? 0)}
      {@const commentsLoading = commentsLoadingMap[post.id] ?? false}
      {@const isCommenting = commentingMap[post.id] ?? false}
      {@const media = post.post_media ?? []}
      <article
        class="stl-card"
        style="animation-delay: {Math.min(idx, 8) * 40}ms"
        data-post-id={post.id}
      >
        <!-- Header -->
        <header class="stl-card-head">
          <div class="stl-avatar" aria-hidden="true">
            {post.author?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div class="stl-meta">
            <span class="stl-author">{post.author ?? "Someone"}</span>
            {#if post.location}
              <span class="stl-loc">
                <svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor" aria-hidden="true">
                  <path d="M6 0a3.75 3.75 0 0 0-3.75 3.75C2.25 6.75 6 12 6 12s3.75-5.25 3.75-8.25A3.75 3.75 0 0 0 6 0zm0 5.25a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
                </svg>
                {post.location.split(",")[0].trim()}
              </span>
            {/if}
          </div>
          <time class="stl-time" datetime={post.created_at}>
            {relativeTime(post.created_at)}
          </time>
          <div class="stl-head-actions">
            <button
              class="stl-menu-btn"
              popovertarget={`post-menu-${post.id}`}
              aria-label="Post options"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <circle cx="3" cy="8" r="1.6"/>
                <circle cx="8" cy="8" r="1.6"/>
                <circle cx="13" cy="8" r="1.6"/>
              </svg>
            </button>
            <div class="menu-list" id={`post-menu-${post.id}`} popover>
              <button
                popovertarget={`post-menu-${post.id}`}
                popovertargetaction="hide"
                onclick={() => startEditPost(post)}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 2l3 3L5 14H2v-3L11 2z"/>
                </svg>
                Edit caption
              </button>
              <button
                popovertarget={`post-menu-${post.id}`}
                popovertargetaction="hide"
                onclick={() => moveToTrash(post.id)}
                style="color: var(--danger);"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4"/>
                </svg>
                Move to Trash
              </button>
            </div>
          </div>
        </header>

        <!-- Media carousel -->
        {#if media.length > 0}
          {@const mi = mediaIndexMap[post.id] ?? 0}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <div
            class="stl-media-wrap"
            role="region"
            aria-label="Post media"
            ontouchstart={(e) => onMediaTouchStart(post.id, e)}
            ontouchend={(e) => onMediaTouchEnd(post.id, media.length, e)}
          >
            <div class="stl-strip" style="transform: translateX(-{mi * 100}%)">
              {#each media as m, i (m.id)}
                <div class="stl-slide">
                  {#if m.mime_type?.startsWith("video")}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
                    <div
                      class="stl-video-container"
                      role="button"
                      tabindex="0"
                      aria-label={(videoPausedMap[vidKey(post.id, i)] ?? true) ? "Play video" : "Pause video"}
                      onclick={(e) => toggleVideoPlay(post.id, i, e)}
                    >
                      <!-- svelte-ignore a11y_media_has_caption -->
                      <video
                        bind:this={videoRefs[vidKey(post.id, i)]}
                        src={m.url}
                        playsinline
                        loop
                        preload={i === 0 ? "auto" : "metadata"}
                        onplay={() => (videoPausedMap[vidKey(post.id, i)] = false)}
                        onpause={(e) => {
                          const v = e.currentTarget;
                          if (v && v.seeking) return;
                          videoPausedMap[vidKey(post.id, i)] = true;
                        }}
                      ></video>
                      {#if i === mi && (videoPausedMap[vidKey(post.id, i)] ?? true)}
                        <div class="stl-play-badge" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <img
                      class="stl-media"
                      src={m.url}
                      alt={post.caption ?? ""}
                      loading="lazy"
                      decoding="async"
                      fetchpriority={i === 0 && idx < 2 ? "high" : "low"}
                    />
                  {/if}
                </div>
              {/each}
            </div>

            {#if media.length > 1}
              <div class="stl-media-count" aria-label="{media.length} items">
                {mi + 1} / {media.length}
              </div>

              <div class="stl-media-nav">
                <button
                  type="button"
                  class="stl-btn-nav"
                  disabled={mi === 0}
                  aria-label="Previous image"
                  onclick={(e) => {
                    e.stopPropagation();
                    goToMedia(post.id, media.length, mi - 1);
                  }}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 2.5L4 8l6 5.5"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="stl-btn-nav"
                  disabled={mi === media.length - 1}
                  aria-label="Next image"
                  onclick={(e) => {
                    e.stopPropagation();
                    goToMedia(post.id, media.length, mi + 1);
                  }}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 2.5L12 8l-6 5.5"/>
                  </svg>
                </button>
              </div>

              <div class="stl-dots">
                {#each media as m, i (m.id)}
                  <button
                    class:active={i === mi}
                    aria-label={`Jump to slide ${i + 1}`}
                    onclick={(e) => {
                      e.stopPropagation();
                      goToMedia(post.id, media.length, i);
                    }}
                  ></button>
                {/each}
              </div>
            {/if}

            {#if heartBurstId === post.id}
              <div class="stl-heart-burst" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="72" height="72" fill="currentColor">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Caption -->
        {#if editingMap[post.id]}
          <div class="stl-edit-form">
            <textarea
              class="input"
              rows={3}
              placeholder="Write a caption…"
              bind:value={captionDraftMap[post.id]}
            ></textarea>
            <input
              class="input"
              placeholder="Add or update location…"
              style="margin-top: 8px;"
              bind:value={locationDraftMap[post.id]}
            />
            <div class="stl-edit-actions">
              <button class="btn btn-ghost" onclick={() => (editingMap[post.id] = false)}>Cancel</button>
              <button class="btn btn-primary" onclick={() => submitPostEdit(post)}>Save</button>
            </div>
          </div>
        {:else if post.caption}
          <div class="stl-caption">
            {post.caption}
          </div>
        {/if}

        <!-- Date stamp -->
        <div class="stl-date-strip">
          <time datetime={post.created_at}>{formatDateTime(post.created_at)}</time>
        </div>

        <!-- Actions -->
        <div class="stl-actions">
          <button
            class="stl-action-btn"
            class:stl-liked={isLiked}
            onclick={() => handleLikeTap(post.id)}
            aria-label={isLiked ? "Unlike" : "Like"}
            aria-pressed={isLiked}
            id="like-{post.id}"
          >
            <span class="stl-action-icon">
              {#if isLiked}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" class="stl-heart-icon">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="stl-heart-icon">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              {/if}
            </span>
            {#if likeCount > 0}
              <span class="stl-action-count">{likeCount}</span>
            {/if}
          </button>

          <button
            class="stl-action-btn"
            class:stl-active={isExpanded}
            onclick={() => toggleComments(post.id)}
            aria-label="Comments"
            aria-expanded={isExpanded}
            id="comments-{post.id}"
          >
            <span class="stl-action-icon">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            {#if commentCount > 0}
              <span class="stl-action-count">{commentCount}</span>
            {/if}
          </button>

          <div class="stl-actions-spacer"></div>

          {#if post.lat != null || post.location}
            <button
              class="stl-map-btn"
              onclick={() => onShowOnMap(post)}
              aria-label="Show on map"
              id="map-{post.id}"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                <line x1="9" y1="3" x2="9" y2="18"/>
                <line x1="15" y1="6" x2="15" y2="21"/>
              </svg>
              Map
            </button>
          {/if}
        </div>

        <!-- Comments -->
        {#if isExpanded}
          <div class="stl-comments-wrap">
            {#if commentsLoading}
              <div class="stl-comments-loading" aria-label="Loading comments">
                {#each [0, 1] as n (n)}
                  <div class="stl-skel-comment">
                    <div class="stl-skel-line" style="width:28%; height:10px;"></div>
                    <div class="stl-skel-line" style="width:72%; height:12px; margin-top:4px;"></div>
                  </div>
                {/each}
              </div>
            {:else if comments.length === 0}
              <p class="stl-comments-empty">No comments yet — be first.</p>
            {:else}
              <div class="stl-comments-list">
                {#each comments as c, ci (c.id)}
                  <div class="stl-comment" style="animation-delay:{Math.min(ci, 5) * 20}ms">
                    <div class="stl-comment-avatar" aria-hidden="true">
                      {c.author?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                    <div class="stl-comment-body">
                      <div class="stl-comment-content">
                        <strong class="stl-comment-author">{c.author || "Anonymous"}</strong>
                        <span class="stl-comment-text">{c.body}</span>
                      </div>
                      <time class="stl-comment-time">{relativeTime(c.created_at)}</time>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="stl-composer">
              <input
                class="stl-composer-input"
                value={newCommentMap[post.id] ?? ""}
                oninput={(e) => { newCommentMap[post.id] = (e.target as HTMLInputElement).value; }}
                placeholder="Add a comment…"
                disabled={isCommenting}
                onkeydown={(e) => e.key === "Enter" && submitComment(post.id)}
                aria-label="Write a comment"
              />
              <button
                class="stl-composer-send"
                onclick={() => submitComment(post.id)}
                disabled={isCommenting || !(newCommentMap[post.id] ?? "").trim()}
                aria-label="Post comment"
              >
                {#if isCommenting}
                  <span class="spinner-sm"></span>
                {:else}
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1.5 8L14.5 1.5 9.5 14.5l-1.6-5-6.4-1.5z"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        {/if}
      </article>
    {/each}
  {/if}
</div>

<style>
  .stl-feed {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 8px 0 calc(40px + env(safe-area-inset-bottom));
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
  }

  .stl-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 80px 24px;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .stl-card {
    position: relative;
    background: transparent;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    content-visibility: auto;
    contain-intrinsic-size: 1px 520px;
    animation: stl-rise 0.38s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes stl-rise {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: none; }
  }

  .stl-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 10px;
  }

  .stl-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #fff));
    color: #1a0e05;
    font-size: 0.82rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stl-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .stl-author {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.1;
  }

  .stl-loc {
    font-size: 0.72rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stl-time {
    font-size: 0.72rem;
    color: var(--muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .stl-head-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .stl-menu-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--muted);
    background: transparent;
    border: none;
    transition: background 0.18s, color 0.18s, transform 0.15s;
    cursor: pointer;
  }

  .stl-menu-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }

  .stl-menu-btn:active {
    transform: scale(0.92);
  }

  .stl-media-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    background: var(--surface);
    outline: none;
    touch-action: pan-y;
  }

  .stl-strip {
    display: flex;
    height: 100%;
    width: 100%;
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  .stl-slide {
    position: relative;
    flex: 0 0 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .stl-media {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  .stl-video-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
  }

  .stl-video-container video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    background: #000;
  }

  .stl-play-badge {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(14, 14, 18, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: stl-badge-pop 0.22s cubic-bezier(0.18, 0.89, 0.32, 1.28) both;
  }

  .stl-play-badge svg {
    margin-left: 3px; /* visual center for play triangle */
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
  }

  @keyframes stl-badge-pop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.65); }
    100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .stl-media-nav {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    pointer-events: none;
  }

  .stl-btn-nav {
    pointer-events: auto;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(14, 14, 18, 0.65);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    transition: background 0.18s, opacity 0.18s, transform 0.15s;
    cursor: pointer;
  }

  .stl-btn-nav:hover {
    background: rgba(14, 14, 18, 0.85);
    transform: scale(1.06);
  }

  .stl-btn-nav:active {
    transform: scale(0.92);
  }

  .stl-btn-nav:disabled {
    opacity: 0;
    pointer-events: none;
  }

  .stl-dots {
    position: absolute;
    bottom: 10px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 6px;
    z-index: 3;
    pointer-events: none;
  }

  .stl-dots button {
    pointer-events: auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.38);
    transition: background 0.2s, transform 0.2s;
    cursor: pointer;
  }

  .stl-dots button.active {
    background: var(--accent);
    transform: scale(1.3);
  }

  .stl-media-count {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(9, 9, 11, 0.75);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    color: #fff;
  }

  .stl-heart-burst {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: heart-burst 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    color: #ff5577;
    filter: drop-shadow(0 0 14px rgba(255, 85, 119, 0.6));
  }

  @keyframes heart-burst {
    0% { opacity: 0; transform: scale(0.5); }
    35% { opacity: 1; transform: scale(1.15); }
    70% { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.85); }
  }

  .stl-caption {
    padding: 8px 16px 6px;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--text);
    word-break: break-word;
  }

  .stl-edit-form {
    padding: 10px 16px 4px;
  }

  .stl-edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }

  .stl-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
  }

  .stl-actions-spacer { flex: 1; }

  .stl-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    height: 36px;
    border-radius: 8px;
    color: var(--muted);
    font: inherit;
    border: none;
    background: transparent;
    transition: color 0.18s, background 0.18s, transform 0.18s;
    cursor: pointer;
    line-height: 1;
    box-sizing: border-box;
    vertical-align: middle;
  }

  .stl-action-btn:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .stl-action-btn:active { transform: scale(0.88); }
  .stl-action-btn.stl-liked { color: #ff5577; }
  .stl-action-btn.stl-active { color: var(--accent); }
  
  .stl-action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  .stl-action-count {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
  }

  .stl-heart-icon {
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .stl-action-btn.stl-liked .stl-heart-icon { transform: scale(1.18); }

  .stl-map-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 30px;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.18s, background 0.18s, transform 0.18s;
    letter-spacing: 0.02em;
    box-sizing: border-box;
    color: var(--accent);
    border: 1px solid rgba(217, 160, 102, 0.28);
    background: rgba(217, 160, 102, 0.08);
    margin-right: 4px;
  }

  .stl-map-btn:hover { background: rgba(217, 160, 102, 0.16); border-color: var(--accent); }
  .stl-map-btn:active { transform: scale(0.93); }

  .stl-comments-wrap {
    border-top: 1px solid rgba(255,255,255,0.05);
    padding: 10px 16px 0;
    animation: stl-rise 0.22s ease both;
  }

  .stl-comments-loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 0;
  }

  .stl-skel-comment { display: flex; flex-direction: column; gap: 5px; }

  .stl-skel-line {
    background: var(--surface-2);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }

  .stl-skel-line::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent);
    animation: shimmer 1.3s ease infinite;
  }

  .stl-comments-empty {
    font-size: 0.82rem;
    color: var(--muted);
    font-style: italic;
    padding: 10px 0 6px;
  }

  .stl-comments-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 0 8px;
  }

  .stl-comment {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    animation: stl-rise 0.22s ease both;
  }

  .stl-comment-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--accent);
    font-size: 0.65rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid rgba(217, 160, 102, 0.25);
    margin-top: 1px;
  }

  .stl-comment-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .stl-comment-content {
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--text);
    word-break: break-word;
  }

  .stl-comment-author {
    font-weight: 700;
    color: var(--text);
    font-size: 0.82rem;
    margin-right: 5px;
  }

  .stl-comment-text {
    color: var(--text);
  }

  .stl-comment-time {
    font-size: 0.68rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .stl-composer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0 12px;
    border-top: 1px solid rgba(255,255,255,0.05);
    margin-top: 4px;
  }

  .stl-composer-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 999px;
    padding: 8px 14px;
    font: inherit;
    color: var(--text);
    font-size: 0.84rem;
    outline: none;
    transition: border-color 0.15s;
    -webkit-user-select: text;
    user-select: text;
  }

  .stl-composer-input:focus { border-color: var(--accent); }
  .stl-composer-input::placeholder { color: var(--muted); }

  .stl-composer-send {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent);
    color: #1a0e05;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: filter 0.15s, transform 0.15s;
    cursor: pointer;
  }

  .stl-composer-send:hover:not(:disabled) { filter: brightness(1.1); }
  .stl-composer-send:active:not(:disabled) { transform: scale(0.9); }
  .stl-composer-send:disabled { opacity: 0.4; cursor: default; }

  .stl-date-strip {
    padding: 0 16px 12px;
    font-size: 0.7rem;
    color: rgba(155, 152, 163, 0.45);
    letter-spacing: 0.02em;
  }
</style>