<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchComments, addComment, updatePost, deletePost, formatDate, formatDateTime, type Comment, type Post } from '$lib/api';
  import { clickOutside } from '$lib/actions';

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
  let showMenu = $state(false);
  let mediaCell: HTMLDivElement | undefined;

  $effect(() => {
    // Reset state whenever a (new) post opens.
    if (!post) return;
    mediaIndex = 0;
    fitMode = false;
    zoom = 1;
    pinch = { active: false, dist: 0, scale: 1 };
    comments = [];
    editingPost = false;
    showMenu = false;
    loadingComments = true;
    fetchComments(post.id)
      .then((c) => (comments = c))
      .catch(() => {})
      .finally(() => (loadingComments = false));
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function swipe(dx: number): void {
    const n = post.post_media.length;
    if (Math.abs(dx) < 40) return;
    zoom = 1;
    mediaIndex = dx < 0 ? Math.min(n - 1, mediaIndex + 1) : Math.max(0, mediaIndex - 1);
    clearZoom();
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
    const ok = await updatePost(post.id, { caption: captionDraft.trim(), location: locationDraft.trim() });
    if (ok) {
      post.caption = captionDraft.trim();
      post.location = locationDraft.trim();
    }
    editingPost = false;
  }

  async function handleDelete(): Promise<void> {
    const isTrash = post.status === 'trash';
    if (!confirm(isTrash ? 'Permanently delete this post? This cannot be undone.' : 'Move this post to Trash?')) return;
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

<div class="viewer open">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="viewer-backdrop" onclick={onClose}></div>

  <div class="viewer-panel">
    <div class="info-head">
      <div class="info-head-text">
        <span class="info-name">{post.author}</span>
        {#if post.location}
          <span class="info-loc">{post.location.split(',')[0].trim()}</span>
        {/if}
      </div>
      <div class="info-actions">
        <div class="menu" use:clickOutside={() => (showMenu = false)}>
          <button class="icon-btn" onclick={() => (showMenu = !showMenu)} aria-label="Options">⋯</button>
          {#if showMenu}
            <div class="menu-list">
              <button onclick={() => { startEditPost(); showMenu = false; }}>Edit post</button>
              {#if post.status === 'trash'}
                <button onclick={() => { handleRestore(); showMenu = false; }} style="color: var(--primary);">Restore post</button>
                <button onclick={() => { handleDelete(); showMenu = false; }} style="color: #ff5e5e;">Delete permanently</button>
              {:else}
                <button onclick={() => { handleDelete(); showMenu = false; }} style="color: #ff5e5e;">Move to Trash</button>
              {/if}
            </div>
          {/if}
        </div>
        <button class="icon-btn close-btn" onclick={onClose} aria-label="Close">✕</button>
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
          <div class="dots">
            {#each post.post_media as m, i (m.id)}
              <button class:active={i === mediaIndex} aria-label={`Media ${i + 1}`} onclick={(e) => { e.stopPropagation(); mediaIndex = i; }}></button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="info-cell">
        <div class="info-scroll">
          {#if !editingPost}
            <div class="post-caption">
              <p class:muted={!post.caption}>{post.caption || 'No caption yet'}</p>
              <time>{formatDateTime(post.created_at)}</time>
              {#if post.location}
                <p class="post-location">{post.location}</p>
              {/if}
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
            <div class="comments-loading">
              <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
            </div>
          {:else if !comments.length}
            <p class="comments-empty">Be the first to comment.</p>
          {/if}
          {#each comments as c (c.id)}
            <div class="comment">
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
</div>

