<script lang="ts">
  import {
    fetchComments,
    addComment,
    updatePost,
    deletePost,
    toggleLike as apiToggleLike,
    formatDate,
    formatDateTime,
    type Comment,
    type Post,
  } from "$lib/api";

  interface Props {
    post: Post;
    initialComments?: Comment[];
    onClose: () => void;
    onDelete?: (id: string) => void;
    onRestore?: (id: string) => void;
    onShowOnMap?: (post: Post) => void;
  }

  let { post, initialComments, onClose, onDelete, onRestore, onShowOnMap }: Props = $props();

  let mediaIndex = $state(0);
  let fitMode = $state(false);
  let touchX = 0;
  let zoom = $state(1);
  let tapAt = 0;
  let pinch = $state({ active: false, dist: 0, scale: 1 });
  let comments = $state<Comment[]>([]);
  let loadingComments = $state(false);
  let newComment = $state("");
  let commenting = $state(false);
  let editingPost = $state(false);
  let captionDraft = $state("");
  let locationDraft = $state("");
  let isLiked = $state(false);
  let likeCount = $state(0);
  let heartBurst = $state(false);
  let liking = $state(false);

  let mediaCell: HTMLDivElement | undefined;
  let viewerEl: HTMLDialogElement | undefined;
  let deleteDialog: HTMLDialogElement | undefined;

  let confirmMsg = $derived(
    post.status === "trash"
      ? "Permanently delete this post? This cannot be undone."
      : "Move this post to Trash?",
  );

  $effect(() => {
    // Reset state whenever a (new) post opens
    if (!post) return;
    mediaIndex = 0;
    fitMode = false;
    zoom = 1;
    pinch = { active: false, dist: 0, scale: 1 };
    editingPost = false;
    isLiked = post.liked_by_me ?? false;
    likeCount = post.like_count ?? 0;
    heartBurst = false;

    // Use prefetched comments from the parent cache if available.
    if (initialComments !== undefined) {
      comments = initialComments;
      loadingComments = false;
      return;
    }

    // Skip the network round-trip when we already know there are no comments.
    const knownCount = post.comment_count ?? post.comments_count ?? -1;
    if (knownCount === 0) {
      comments = [];
      loadingComments = false;
      return;
    }

    comments = [];
    loadingComments = true;
    fetchComments(post.id)
      .then((c) => (comments = c))
      .catch(() => {})
      .finally(() => (loadingComments = false));
  });

  $effect(() => {
    if (viewerEl && !viewerEl.open) viewerEl.showModal();
  });

  function goTo(i: number): void {
    const n = post.post_media.length;
    mediaIndex = Math.max(0, Math.min(n - 1, i));
    zoom = 1;
    clearZoom();
  }

  function swipe(dx: number): void {
    if (Math.abs(dx) < 40) return;
    goTo(mediaIndex + (dx < 0 ? 1 : -1));
  }

  function onTouchStart(e: TouchEvent): void {
    touchX = e.touches[0].clientX;
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = {
        active: true,
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        scale: zoom,
      };
      applyZoom(e);
    }
  }

  function onTouchMove(e: TouchEvent): void {
    if (pinch.active && e.touches.length === 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      zoom = Math.min(4, Math.max(1, pinch.scale * (d / pinch.dist)));
      applyZoom(e);
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (pinch.active) {
      pinch.active = false;
      return;
    }
    const now = Date.now();
    if (now - tapAt < 300) {
      // Double-tap: trigger like with heart burst
      tapAt = 0;
      handleDoubleTapLike();
      return;
    }
    tapAt = now;
    swipe(e.changedTouches[0].clientX - touchX);
  }

  function onMediaClick(): void {
    if (zoom > 1) {
      zoom = 1;
      clearZoom();
      return;
    }
    fitMode = !fitMode;
  }

  function applyZoom(e?: TouchEvent): void {
    const slide = mediaCell?.querySelectorAll(".slide")[mediaIndex];
    const el = slide?.querySelector("img, video") as HTMLElement | null;
    if (!slide || !el) return;
    if (zoom > 1) {
      const r = slide.getBoundingClientRect();
      const cx =
        e && e.touches.length >= 2
          ? e.touches[0].clientX + (e.touches[1].clientX - e.touches[0].clientX) / 2
          : r.width / 2;
      const cy =
        e && e.touches.length >= 2
          ? e.touches[0].clientY + (e.touches[1].clientY - e.touches[0].clientY) / 2
          : r.height / 2;
      el.style.transformOrigin = cx - r.left + "px " + (cy - r.top) + "px";
      el.style.transform = "scale(" + zoom + ")";
    } else {
      clearZoom();
    }
  }

  function clearZoom(): void {
    const slide = mediaCell?.querySelectorAll(".slide")[mediaIndex];
    const el = slide?.querySelector("img, video") as HTMLElement | null;
    if (!el) return;
    el.style.transform = "";
    el.style.transformOrigin = "";
  }

  let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleToggleLike(): Promise<void> {
    if (liking) return;
    liking = true;
    const nextLiked = !isLiked;
    const nextCount = nextLiked ? likeCount + 1 : Math.max(0, likeCount - 1);

    isLiked = nextLiked;
    likeCount = nextCount;
    post.liked_by_me = nextLiked;
    post.like_count = nextCount;

    triggerHeartBurst();

    try {
      const res = await apiToggleLike(post.id);
      isLiked = res.liked;
      likeCount = res.like_count;
      post.liked_by_me = res.liked;
      post.like_count = res.like_count;
    } catch {
      // Revert on error
      isLiked = !nextLiked;
      likeCount = isLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
      post.liked_by_me = isLiked;
      post.like_count = likeCount;
    } finally {
      liking = false;
    }
  }

  function triggerHeartBurst() {
    heartBurst = false;
    if (heartBurstTimer) clearTimeout(heartBurstTimer);
    requestAnimationFrame(() => {
      heartBurst = true;
      heartBurstTimer = setTimeout(() => {
        heartBurst = false;
      }, 650);
    });
  }

  function handleDoubleTapLike() {
    if (!isLiked) {
      handleToggleLike();
    } else {
      triggerHeartBurst();
    }
  }

  function startEditPost(): void {
    captionDraft = post.caption || "";
    locationDraft = post.location || "";
    editingPost = true;
  }

  async function submitPost(): Promise<void> {
    const location = locationDraft.trim();
    const changedLocation = location !== post.location;
    const ok = await updatePost(post.id, {
      caption: captionDraft.trim(),
      location,
      lat: changedLocation ? null : undefined,
      lng: changedLocation ? null : undefined,
    });
    if (ok) {
      post.caption = captionDraft.trim();
      post.location = location;
      if (changedLocation) {
        post.lat = null;
        post.lng = null;
      }
    }
    editingPost = false;
  }

  function askDelete(): void {
    deleteDialog?.showModal();
  }

  async function handleDelete(): Promise<void> {
    const ok = await deletePost(post.id);
    if (ok) {
      if (onDelete) onDelete(post.id);
      onClose();
    }
  }

  async function handleRestore(): Promise<void> {
    const ok = await updatePost(post.id, { status: "pending_style" });
    if (ok) {
      if (onRestore) onRestore(post.id);
      onClose();
    }
  }

  function mapsHref(post: Post): string {
    const q =
      post.lat != null && post.lng != null
        ? `${post.lat},${post.lng}`
        : post.location ?? "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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

  async function submitComment(): Promise<void> {
    const body = newComment.trim();
    if (!body || commenting) return;
    commenting = true;
    try {
      if (await addComment(post.id, body)) {
        newComment = "";
        comments = await fetchComments(post.id);
      }
    } catch {
    } finally {
      commenting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (editingPost) return;
    if (e.key === "ArrowLeft") {
      goTo(mediaIndex - 1);
    } else if (e.key === "ArrowRight") {
      goTo(mediaIndex + 1);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<dialog class="pv-dialog" bind:this={viewerEl} onclose={() => onClose()}>
  <div class="pv-panel">
    <!-- Header -->
    <header class="pv-head">
      <div class="pv-user-info">
        <div class="pv-avatar" aria-hidden="true">
          {post.author?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <div class="pv-meta">
          <span class="pv-author">{post.author ?? "Someone"}</span>
          {#if post.location}
            <a
              class="pv-loc"
              href={mapsHref(post)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Maps"
            >
              <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true">
                <path d="M6 0a3.75 3.75 0 0 0-3.75 3.75C2.25 6.75 6 12 6 12s3.75-5.25 3.75-8.25A3.75 3.75 0 0 0 6 0zm0 5.25a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
              </svg>
              <span>{post.location.split(",")[0].trim()}</span>
            </a>
          {/if}
        </div>
      </div>

      <div class="pv-head-actions">
        <button
          class="pv-icon-btn"
          popovertarget="pv-post-menu"
          aria-label="Post options"
          id="pv-options-btn"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
            <circle cx="3" cy="8" r="1.6"/>
            <circle cx="8" cy="8" r="1.6"/>
            <circle cx="13" cy="8" r="1.6"/>
          </svg>
        </button>

        <div class="menu-list" id="pv-post-menu" popover>
          <button popovertarget="pv-post-menu" popovertargetaction="hide" onclick={startEditPost}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 2l3 3L5 14H2v-3L11 2z"/>
            </svg>
            Edit caption
          </button>
          {#if post.status === "trash"}
            <button popovertarget="pv-post-menu" popovertargetaction="hide" onclick={handleRestore} style="color: var(--accent);">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 8a5.5 5.5 0 1 1 1.5 3.8M2 12V8h4"/>
              </svg>
              Restore post
            </button>
            <button popovertarget="pv-post-menu" popovertargetaction="hide" onclick={askDelete} style="color: var(--danger);">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4"/>
              </svg>
              Delete permanently
            </button>
          {:else}
            <button popovertarget="pv-post-menu" popovertargetaction="hide" onclick={askDelete} style="color: var(--danger);">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4"/>
              </svg>
              Move to Trash
            </button>
          {/if}
        </div>

        <button class="pv-icon-btn pv-close-btn" onclick={() => onClose()} aria-label="Close viewer">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Main Content (Media + Info) -->
    <div class="pv-content">
      <!-- Media Stage -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <div
        class="pv-media-cell"
        class:pv-fit={fitMode}
        bind:this={mediaCell}
        role="button"
        tabindex="0"
        aria-label="Media viewer stage (tap to toggle fit)"
        onclick={onMediaClick}
        ondblclick={handleDoubleTapLike}
        ontouchstart={onTouchStart}
        ontouchmove={onTouchMove}
        ontouchend={onTouchEnd}
      >
        <div class="pv-strip" style="transform: translateX(-{mediaIndex * 100}%)">
          {#each post.post_media as m, i (m.id)}
            <div class="pv-slide slide">
              {#if (m.mime_type || "").startsWith("video")}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  src={m.url}
                  controls={i === mediaIndex}
                  preload="metadata"
                  onclick={(e) => e.stopPropagation()}
                ></video>
              {:else}
                <img src={m.url} alt={post.caption || ""} />
              {/if}
            </div>
          {/each}
        </div>

        {#if post.post_media.length > 1}
          <div class="pv-media-nav">
            <button
              type="button"
              class="pv-btn-nav"
              disabled={mediaIndex === 0}
              aria-label="Previous image"
              onclick={(e) => {
                e.stopPropagation();
                goTo(mediaIndex - 1);
              }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 2.5L4 8l6 5.5"/>
              </svg>
            </button>
            <button
              type="button"
              class="pv-btn-nav"
              disabled={mediaIndex === post.post_media.length - 1}
              aria-label="Next image"
              onclick={(e) => {
                e.stopPropagation();
                goTo(mediaIndex + 1);
              }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2.5L12 8l-6 5.5"/>
              </svg>
            </button>
          </div>

          <!-- Multi-media badge -->
          <div class="pv-media-counter">
            {mediaIndex + 1} / {post.post_media.length}
          </div>

          <div class="pv-dots">
            {#each post.post_media as m, i (m.id)}
              <button
                class:active={i === mediaIndex}
                aria-label={`Jump to slide ${i + 1}`}
                onclick={(e) => {
                  e.stopPropagation();
                  goTo(i);
                }}
              ></button>
            {/each}
          </div>
        {/if}

        {#if heartBurst}
          <div class="pv-heart-burst" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="76" height="76" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </div>
        {/if}
      </div>

      <!-- Info & Comments Sidebar/Panel -->
      <div class="pv-info-cell">
        <!-- Caption / Edit Section -->
        <div class="pv-caption-wrap">
          {#if !editingPost}
            <div class="pv-caption-box">
              <p class="pv-caption-text" class:pv-muted={!post.caption}>
                {post.caption || "No caption provided"}
              </p>

              {#if post.mentions?.length}
                <div class="pv-mentions">
                  {#each post.mentions as mention (mention)}
                    <span class="pv-mention-pill">@{mention}</span>
                  {/each}
                </div>
              {/if}

              <time class="pv-timestamp" datetime={post.created_at}>
                {formatDateTime(post.created_at)}
              </time>
            </div>
          {:else}
            <div class="pv-edit-form">
              <textarea
                class="input"
                bind:value={captionDraft}
                rows={3}
                placeholder="Write a caption…"
                onkeydown={(e) => e.ctrlKey && e.key === "Enter" && submitPost()}
              ></textarea>
              <input
                class="input"
                bind:value={locationDraft}
                placeholder="Add or update location…"
                style="margin-top: 8px;"
                onkeydown={(e) => e.ctrlKey && e.key === "Enter" && submitPost()}
              />
              <div class="caption-edit-actions">
                <button class="btn btn-ghost" onclick={() => (editingPost = false)}>Cancel</button>
                <button class="btn btn-primary" onclick={submitPost}>Save</button>
              </div>
            </div>
          {/if}
        </div>

        <!-- Actions Bar -->
        <div class="pv-actions">
          <button
            class="pv-action-btn"
            class:pv-liked={isLiked}
            onclick={handleToggleLike}
            aria-label={isLiked ? "Unlike" : "Like"}
            aria-pressed={isLiked}
            id="pv-like-btn"
          >
            <span class="pv-action-icon">
              {#if isLiked}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" class="pv-heart-icon">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pv-heart-icon">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              {/if}
            </span>
            {#if likeCount > 0}
              <span class="pv-action-count">{likeCount}</span>
            {/if}
          </button>

          <div class="pv-action-btn pv-comment-badge" aria-label="{comments.length} comments">
            <span class="pv-action-icon">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            {#if comments.length > 0}
              <span class="pv-action-count">{comments.length}</span>
            {/if}
          </div>

          <div class="pv-actions-spacer"></div>

          {#if post.lat != null || post.location}
            {#if onShowOnMap}
              <button
                class="pv-map-btn"
                onclick={() => {
                  onClose();
                  onShowOnMap(post);
                }}
                aria-label="Show on map"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                  <line x1="9" y1="3" x2="9" y2="18"/>
                  <line x1="15" y1="6" x2="15" y2="21"/>
                </svg>
                Map
              </button>
            {:else}
              <a
                class="pv-map-btn"
                href={mapsHref(post)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Google Maps"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                  <line x1="9" y1="3" x2="9" y2="18"/>
                  <line x1="15" y1="6" x2="15" y2="21"/>
                </svg>
                Map
              </a>
            {/if}
          {/if}
        </div>

        <!-- Scrollable Comments -->
        <div class="pv-scroll">
          <div class="pv-comments-section">
            <div class="pv-comments-header">
              <span>Comments</span>
              {#if comments.length > 0}
                <span class="pv-comments-count-pill">{comments.length}</span>
              {/if}
            </div>

            {#if loadingComments}
              <div class="stl-comments-loading" role="status" aria-label="Loading comments">
                {#each [0, 1, 2] as n (n)}
                  <div class="stl-skel-comment">
                    <div class="stl-skel-line" style="width:28%; height:10px;"></div>
                    <div class="stl-skel-line" style="width:85%; height:12px; margin-top:4px;"></div>
                  </div>
                {/each}
              </div>
            {:else if comments.length === 0}
              <p class="stl-comments-empty">No comments yet — be first.</p>
            {:else}
              <div class="stl-comments-list">
                {#each comments as c, ci (c.id)}
                  <div class="stl-comment" style="animation-delay:{Math.min(ci, 6) * 25}ms">
                    <div class="stl-comment-avatar" aria-hidden="true">
                      {c.author?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                    <div class="stl-comment-body">
                      <div class="stl-comment-content">
                        <strong class="stl-comment-author">{c.author ?? "Anonymous"}</strong>
                        <span class="stl-comment-text">{c.body}</span>
                      </div>
                      <time class="stl-comment-time">{relativeTime(c.created_at)}</time>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <!-- Composer -->
        <div class="pv-composer">
          <input
            class="pv-composer-input"
            bind:value={newComment}
            placeholder="Add a comment…"
            onkeydown={(e) => e.key === "Enter" && submitComment()}
            disabled={commenting}
            aria-label="Write a comment"
          />
          <button
            class="pv-composer-send"
            onclick={submitComment}
            aria-label="Post comment"
            disabled={commenting || !newComment.trim()}
          >
            {#if commenting}
              <span class="pv-spinner"></span>
            {:else}
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1.5 8L14.5 1.5 9.5 14.5l-1.6-5-6.4-1.5z"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
</dialog>

<dialog class="confirm-dialog" bind:this={deleteDialog}>
  <form method="dialog">
    <p class="confirm-msg">{confirmMsg}</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" value="cancel">Cancel</button>
      <button class="btn btn-danger" value="ok" onclick={handleDelete}>Delete</button>
    </div>
  </form>
</dialog>

<style>
  /* Native fullscreen dialog overlay styling */
  .pv-dialog {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: rgba(9, 9, 11, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    opacity: 0;
    transform: scale(0.96) translateY(16px);
    transition:
      opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.32s cubic-bezier(0.16, 1, 0.3, 1),
      overlay 0.32s allow-discrete,
      display 0.32s allow-discrete;
  }

  .pv-dialog[open] {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transform: scale(1) translateY(0);
  }

  @starting-style {
    .pv-dialog[open] {
      opacity: 0;
      transform: scale(0.96) translateY(16px);
    }
  }

  .pv-panel {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  }

  /* Header */
  .pv-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 10px;
    background: rgba(14, 14, 18, 0.92);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    z-index: 10;
    flex-shrink: 0;
  }

  .pv-user-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .pv-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #fff));
    color: #1a0e05;
    font-size: 0.86rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .pv-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .pv-author {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pv-loc {
    font-size: 0.74rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
    transition: color 0.15s;
  }

  .pv-loc:hover {
    color: var(--accent);
  }

  .pv-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pv-icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    transition: background 0.18s, color 0.18s, transform 0.15s;
    cursor: pointer;
  }

  .pv-icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
  }

  .pv-icon-btn:active {
    transform: scale(0.92);
  }

  /* Content area */
  .pv-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Media Stage */
  .pv-media-cell {
    position: relative;
    flex: 0 0 auto;
    width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    cursor: pointer;
    touch-action: pan-y;
    overflow: hidden;
  }

  .pv-strip {
    display: flex;
    height: 100%;
    width: 100%;
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  .pv-slide {
    flex: 0 0 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .pv-slide img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  .pv-media-cell.pv-fit .pv-slide img {
    object-fit: contain;
  }

  .pv-slide video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .pv-media-counter {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: rgba(9, 9, 11, 0.75);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.1);
    pointer-events: none;
    z-index: 4;
  }

  .pv-media-nav {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    pointer-events: none;
  }

  .pv-btn-nav {
    pointer-events: auto;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(14, 14, 18, 0.65);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    transition: background 0.18s, opacity 0.18s, transform 0.15s;
    cursor: pointer;
  }

  .pv-btn-nav:hover {
    background: rgba(14, 14, 18, 0.85);
    transform: scale(1.06);
  }

  .pv-btn-nav:active {
    transform: scale(0.92);
  }

  .pv-btn-nav:disabled {
    opacity: 0;
    pointer-events: none;
  }

  .pv-dots {
    position: absolute;
    bottom: 12px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 6px;
    z-index: 3;
    pointer-events: none;
  }

  .pv-dots button {
    pointer-events: auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.38);
    transition: background 0.2s, transform 0.2s;
    cursor: pointer;
  }

  .pv-dots button.active {
    background: var(--accent);
    transform: scale(1.3);
  }

  /* Info Cell */
  .pv-info-cell {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .pv-caption-wrap {
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .pv-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .pv-actions-spacer {
    flex: 1;
  }

  .pv-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 10px;
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

  .pv-action-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.05);
  }

  .pv-action-btn:active {
    transform: scale(0.9);
  }

  .pv-action-btn.pv-liked {
    color: #ff5577;
  }

  .pv-action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  .pv-heart-burst {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 15;
    animation: heart-burst 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    color: #ff5577;
    filter: drop-shadow(0 0 16px rgba(255, 85, 119, 0.65));
  }

  @keyframes heart-burst {
    0% { opacity: 0; transform: scale(0.5); }
    35% { opacity: 1; transform: scale(1.15); }
    70% { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.85); }
  }

  .pv-heart-icon {
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .pv-action-btn.pv-liked .pv-heart-icon {
    transform: scale(1.18);
  }

  .pv-action-count {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .pv-comment-badge {
    cursor: default;
    user-select: none;
  }

  .pv-comment-badge:hover {
    background: transparent;
    color: var(--muted);
  }

  .pv-comment-badge:active {
    transform: none;
  }

  .pv-map-btn {
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
    color: var(--accent);
    border: 1px solid rgba(217, 160, 102, 0.28);
    background: rgba(217, 160, 102, 0.08);
    text-decoration: none;
    box-sizing: border-box;
  }

  .pv-map-btn:hover {
    background: rgba(217, 160, 102, 0.16);
    border-color: var(--accent);
  }

  .pv-map-btn:active {
    transform: scale(0.93);
  }

  .pv-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px 8px;
  }

  .pv-caption-box {
    padding: 14px 16px 12px;
  }

  .pv-caption-text {
    font-size: 0.94rem;
    line-height: 1.48;
    color: var(--text);
    word-break: break-word;
  }

  .pv-caption-author {
    font-weight: 700;
    margin-right: 4px;
    color: var(--text);
  }

  .pv-caption-text.pv-muted {
    color: var(--muted);
    font-style: italic;
  }

  .pv-mentions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .pv-mention-pill {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--accent);
    background: rgba(217, 160, 102, 0.12);
    border: 1px solid rgba(217, 160, 102, 0.25);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .pv-timestamp {
    display: block;
    margin-top: 8px;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .pv-edit-form {
    padding: 14px 16px 12px;
  }

  /* Comments section */
  .pv-comments-section {
    padding-top: 14px;
  }

  .stl-comments-loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 0;
  }

  .stl-skel-comment {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

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
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
    animation: shimmer 1.3s ease infinite;
  }

  @keyframes shimmer {
    to {
      transform: translateX(100%);
    }
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

  @keyframes stl-rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
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

  .pv-comments-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 12px;
  }

  .pv-comments-count-pill {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }

  /* Composer */
  .pv-composer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(14, 14, 18, 0.95);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    flex-shrink: 0;
  }

  .pv-composer-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 999px;
    padding: 9px 16px;
    font: inherit;
    color: var(--text);
    font-size: 0.88rem;
    outline: none;
    transition: border-color 0.18s, background 0.18s;
  }

  .pv-composer-input:focus {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
  }

  .pv-composer-input::placeholder {
    color: var(--muted);
  }

  .pv-composer-send {
    width: 36px;
    height: 36px;
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

  .pv-composer-send:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .pv-composer-send:active:not(:disabled) {
    transform: scale(0.92);
  }

  .pv-composer-send:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .pv-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(0, 0, 0, 0.3);
    border-top-color: #000;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Desktop side-by-side modal */
  @media (min-width: 768px) {
    .pv-panel {
      width: min(1040px, 92vw);
      height: min(720px, 88vh);
      margin: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: var(--radius-lg);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    }

    .pv-content {
      flex-direction: row;
    }

    .pv-media-cell {
      flex: 1 1 auto;
      width: auto;
      aspect-ratio: auto;
      min-width: 0;
    }

    .pv-info-cell {
      flex: 0 0 380px;
      width: 380px;
      border-top: 0;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
    }
  }
</style>
