<script lang="ts">
  import { fetchComments, addComment, updatePost, deletePost, formatDate, formatDateTime, type Comment, type Post } from '$lib/api';

  let { post, onClose, onDelete, onRestore }: { post: Post; onClose: () => void; onDelete?: (id: string) => void; onRestore?: (id: string) => void } = $props();

  let mediaIndex = $state(0);
  let fitMode = $state(false);
  let touchX = 0;
  let zoom = $state(1);
  let tapAt = 0;
  let pinch = $state({ active: false, dist: 0, scale: 1 });
  let comments = $state<Comment[]>([]);
  let loadingComments = $state(false);
  let newComment = $state('');
  let commenting = $state(false);
  let editingPost = $state(false);
  let captionDraft = $state('');
  let locationDraft = $state('');
  let mediaCell: HTMLDivElement | undefined;
  let viewerEl: HTMLDialogElement | undefined;
  let deleteDialog: HTMLDialogElement | undefined;

  let confirmMsg = $derived(
    post.status === 'trash'
      ? 'Permanently delete this post? This cannot be undone.'
      : 'Move this post to Trash?'
  );

  $effect(() => {
    // Reset state whenever a (new) post opens.
    if (!post) return;
    mediaIndex = 0;
    fitMode = false;
    zoom = 1;
    pinch = { active: false, dist: 0, scale: 1 };
    comments = [];
    editingPost = false;
    loadingComments = true;
    fetchComments(post.id)
      .then((c) => (comments = c))
      .catch(() => {})
      .finally(() => (loadingComments = false));
  });

  $effect(() => {
    // Open the native dialog whenever the viewer mounts.
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
      // Double-tap toggles 2x zoom.
      tapAt = 0;
      zoom = zoom > 1 ? 1 : 2.5;
      applyZoom();
      return;
    }
    tapAt = now;
    swipe(e.changedTouches[0].clientX - touchX);
  }

  function onMediaTap(): void {
    if (zoom > 1) {
      zoom = 1;
      clearZoom();
      return;
    }
    fitMode = !fitMode;
  }

  // Scale the current slide's media around the pinch midpoint.
  function applyZoom(e?: TouchEvent): void {
    const slide = mediaCell?.querySelectorAll('.slide')[mediaIndex];
    const el = slide?.querySelector('img, video') as HTMLElement | null;
    if (!slide || !el) return;
    if (zoom > 1) {
      const r = slide.getBoundingClientRect();
      const cx = e && e.touches.length >= 2 ? e.touches[0].clientX + (e.touches[1].clientX - e.touches[0].clientX) / 2 : r.width / 2;
      const cy = e && e.touches.length >= 2 ? e.touches[0].clientY + (e.touches[1].clientY - e.touches[0].clientY) / 2 : r.height / 2;
      el.style.transformOrigin = cx - r.left + 'px ' + (cy - r.top) + 'px';
      el.style.transform = 'scale(' + zoom + ')';
    } else {
      clearZoom();
    }
  }

  function clearZoom(): void {
    const slide = mediaCell?.querySelectorAll('.slide')[mediaIndex];
    const el = slide?.querySelector('img, video') as HTMLElement | null;
    if (!el) return;
    el.style.transform = '';
    el.style.transformOrigin = '';
  }

  function startEditPost(): void {
    captionDraft = post.caption || '';
    locationDraft = post.location || '';
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
    const ok = await updatePost(post.id, { status: 'pending_style' });
    if (ok) {
      if (onRestore) onRestore(post.id);
      onClose();
    }
  }

  function mapsHref(post: Post): string {
    const q = post.lat != null && post.lng != null ? `${post.lat},${post.lng}` : (post.location ?? '');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  async function submitComment(): Promise<void> {
    const body = newComment.trim();
    if (!body || commenting) return;
    commenting = true;
    try {
      if (await addComment(post.id, body)) {
        newComment = '';
        // Refetch so the server-set author shows immediately.
        comments = await fetchComments(post.id);
      }
    } catch {}
    commenting = false;
  }
</script>

<dialog class="viewer" bind:this={viewerEl} onclose={() => onClose()}>
  <div class="viewer-panel">
    <div class="info-head">
      <div class="info-head-text">
        <span class="info-name">{post.author}</span>
        {#if post.location}
          <a class="info-loc" href={mapsHref(post)} target="_blank" rel="noopener noreferrer">{post.location.split(',')[0].trim()}</a>
        {/if}
      </div>
      <div class="info-actions">
        <button class="icon-btn menu-btn" popovertarget="post-menu" aria-label="Options">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><circle cx="3" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="13" cy="8" r="1.6"/></svg>
        </button>
        <div class="menu-list" id="post-menu" popover>
          <button popovertarget="post-menu" popovertargetaction="hide" onclick={startEditPost}>Edit post</button>
          {#if post.status === 'trash'}
            <button popovertarget="post-menu" popovertargetaction="hide" onclick={handleRestore} style="color: var(--accent);">Restore post</button>
            <button popovertarget="post-menu" popovertargetaction="hide" onclick={askDelete} style="color: var(--danger);">Delete permanently</button>
          {:else}
            <button popovertarget="post-menu" popovertargetaction="hide" onclick={askDelete} style="color: var(--danger);">Move to Trash</button>
          {/if}
        </div>
        <button class="icon-btn close-btn" onclick={() => onClose()} aria-label="Close">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
    </div>

    <div class="viewer-content">
      <!-- Square stage by default (Instagram-style); tap for the full uncropped image -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="media-cell"
        class:fit={fitMode}
        bind:this={mediaCell}
        onclick={onMediaTap}
        ontouchstart={onTouchStart}
        ontouchmove={onTouchMove}
        ontouchend={onTouchEnd}
      >
        <div class="strip" style="transform: translateX(-{mediaIndex * 100}%)">
          {#each post.post_media as m, i (m.id)}
            <div class="slide">
              {#if (m.mime_type || '').startsWith('video')}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={m.url} controls={i === mediaIndex} preload="metadata" onclick={(e) => e.stopPropagation()}></video>
              {:else}
                <img src={m.url} alt={post.caption || ''} />
              {/if}
            </div>
          {/each}
        </div>
        {#if post.post_media.length > 1}
          <div class="media-nav">
            <button
              type="button"
              class="btn-nav prev"
              disabled={mediaIndex === 0}
              aria-label="Previous media"
              onclick={(e) => { e.stopPropagation(); goTo(mediaIndex - 1); }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L4 8l6 5.5"/></svg>
            </button>
            <button
              type="button"
              class="btn-nav next"
              disabled={mediaIndex === post.post_media.length - 1}
              aria-label="Next media"
              onclick={(e) => { e.stopPropagation(); goTo(mediaIndex + 1); }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5L12 8l-6 5.5"/></svg>
            </button>
          </div>
          <div class="dots">
            {#each post.post_media as m, i (m.id)}
              <button class:active={i === mediaIndex} aria-label={`Media ${i + 1}`} onclick={(e) => { e.stopPropagation(); goTo(i); }}></button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="info-cell">
        <div class="info-scroll">
          {#if !editingPost}
            <div class="post-caption">
              <p class:muted={!post.caption}>{post.caption || 'No caption yet'}</p>
              {#if post.mentions?.length}
                <p class="post-mentions">{post.mentions.map((n) => `@${n}`).join(' ')}</p>
              {/if}
              <time>{formatDateTime(post.created_at)}</time>
            </div>
          {:else}
            <div>
              <textarea class="input" bind:value={captionDraft} rows={3} placeholder="Write a caption…" onkeydown={(e) => e.ctrlKey && e.key === 'Enter' && submitPost()}></textarea>
              <input class="input" bind:value={locationDraft} placeholder="Add a place…" style="margin-top: 8px;" onkeydown={(e) => e.ctrlKey && e.key === 'Enter' && submitPost()} />
              <div class="caption-edit-actions" style="margin-top: 8px; display: flex; gap: 8px;">
                <button class="btn btn-ghost" onclick={() => (editingPost = false)}>Cancel</button>
                <button class="btn btn-primary" onclick={submitPost}>Save</button>
              </div>
            </div>
          {/if}

          <p class="comments-title">Comments</p>
          {#if loadingComments}
            <div class="skel-comments" role="status" aria-label="Loading comments">
              {#each [0, 1, 2] as n (n)}
                <div class="skel-comment">
                  <div class="skel-line" style="width: 30%;"></div>
                  <div class="skel-line" style="width: 85%;"></div>
                </div>
              {/each}
            </div>
          {:else if !comments.length}
            <p class="comments-empty">Be the first to comment.</p>
          {/if}
          {#each comments as c, i (c.id)}
            <div class="comment" style="animation-delay: {Math.min(i, 6) * 25}ms">
              <p class="c-author">{c.author || 'Anonymous'}</p>
              <p class="c-body">{c.body}</p>
              <span class="meta">{formatDate(c.created_at)}</span>
            </div>
          {/each}
        </div>

        <div class="composer">
          <input class="input" bind:value={newComment} placeholder="Add a comment…" onkeydown={(e) => e.key === 'Enter' && submitComment()} disabled={commenting} />
          <button class="icon-btn" onclick={submitComment} aria-label="Post" disabled={commenting || !newComment.trim()}>
            <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1.5 8L14.5 1.5 9.5 14.5l-1.6-5-6.4-1.5z"/>
            </svg>
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
