<script lang="ts">
  import {
    fetchComments,
    addComment,
    formatDate,
    formatDateTime,
    type Post,
    type Comment,
  } from "$lib/api";

  interface Props {
    posts: Post[];
    onOpenPost: (post: Post) => void;
    onShowOnMap: (post: Post) => void;
  }

  let { posts, onOpenPost, onShowOnMap }: Props = $props();

  // Plain reactive maps for item states to prevent Svelte 5 unsafe state mutation during template evaluation
  let likedMap = $state<Record<string, boolean>>({});
  let likeCountMap = $state<Record<string, number>>({});
  let commentsMap = $state<Record<string, Comment[]>>({});
  let commentsLoadingMap = $state<Record<string, boolean>>({});
  let commentExpandedMap = $state<Record<string, boolean>>({});
  let newCommentMap = $state<Record<string, string>>({});
  let commentingMap = $state<Record<string, boolean>>({});
  let heartBurstId = $state<string | null>(null);

  function toggleLike(postId: string) {
    const isLiked = likedMap[postId] ?? false;
    const currentCount = likeCountMap[postId] ?? 0;
    likedMap[postId] = !isLiked;
    likeCountMap[postId] = !isLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
  }

  async function toggleComments(postId: string) {
    const expanded = commentExpandedMap[postId] ?? false;
    commentExpandedMap[postId] = !expanded;

    if (!expanded && commentsMap[postId] === undefined) {
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
        commentsMap[postId] = await fetchComments(postId);
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

<div class="stl-feed" role="feed" aria-label="Moments timeline">
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
      {@const isLiked = likedMap[post.id] ?? false}
      {@const likeCount = likeCountMap[post.id] ?? 0}
      {@const isExpanded = commentExpandedMap[post.id] ?? false}
      {@const comments = commentsMap[post.id] ?? []}
      {@const commentsLoading = commentsLoadingMap[post.id] ?? false}
      {@const isCommenting = commentingMap[post.id] ?? false}
      {@const media = post.post_media ?? []}
      {@const thumb = media.find((m) => !m.mime_type?.startsWith("video")) ?? media[0]}
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
        </header>

        <!-- Media -->
        {#if media.length > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <div
            class="stl-media-wrap"
            onclick={() => onOpenPost(post)}
            role="button"
            tabindex="0"
            aria-label="Open post"
          >
            {#if thumb?.mime_type?.startsWith("video")}
              <div class="stl-media-video-thumb">
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={thumb.url} preload="none" muted playsinline class="stl-media"></video>
                <div class="stl-play-badge" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor">
                    <path d="M5 3.5l9 4.5-9 4.5V3.5z"/>
                  </svg>
                </div>
              </div>
            {:else}
              <img class="stl-media" src={thumb.url} alt={post.caption ?? ""} loading="lazy" />
            {/if}

            {#if media.length > 1}
              <div class="stl-media-count" aria-label="{media.length} items">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
                  <rect x="1" y="4" width="10" height="10" rx="1.5"/>
                  <rect x="5" y="1" width="10" height="10" rx="1.5" fill-opacity="0.5"/>
                </svg>
                {media.length}
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
        {#if post.caption}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <div class="stl-caption" role="button" tabindex="0" onclick={() => onOpenPost(post)}>
            <span class="stl-caption-author">{post.author?.split(" ")[0] ?? "Them"}</span>
            {" "}{post.caption.length > 120 ? post.caption.slice(0, 120) + "…" : post.caption}
          </div>
        {/if}

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
            {#if comments.length > 0}
              <span class="stl-action-count">{comments.length}</span>
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

          <button
            class="stl-open-btn"
            onclick={() => onOpenPost(post)}
            aria-label="View post"
            id="view-{post.id}"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View
          </button>
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
                      <span class="stl-comment-author">{c.author ?? "Anonymous"}</span>
                      <span class="stl-comment-text">{c.body}</span>
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

        <!-- Date stamp -->
        <div class="stl-date-strip">
          <time datetime={post.created_at}>{formatDateTime(post.created_at)}</time>
        </div>
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

  .stl-media-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    cursor: pointer;
    background: var(--surface);
    outline: none;
  }

  .stl-media {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
  }

  .stl-media-wrap:hover .stl-media,
  .stl-media-wrap:focus-visible .stl-media {
    transform: scale(1.025);
  }

  .stl-media-video-thumb {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .stl-media-video-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .stl-play-badge {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.3);
  }

  .stl-play-badge svg { color: #fff; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5)); }

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
    cursor: pointer;
    outline: none;
  }

  .stl-caption-author {
    font-weight: 700;
    margin-right: 2px;
    color: var(--text);
  }

  .stl-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 10px 6px;
  }

  .stl-actions-spacer { flex: 1; }

  .stl-action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 8px;
    border-radius: 8px;
    color: var(--muted);
    transition: color 0.18s, background 0.18s, transform 0.18s;
    cursor: pointer;
  }

  .stl-action-btn:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .stl-action-btn:active { transform: scale(0.88); }
  .stl-action-btn.stl-liked { color: #ff5577; }
  .stl-action-btn.stl-active { color: var(--accent); }
  .stl-action-icon { display: flex; align-items: center; }

  .stl-action-count {
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1;
  }

  .stl-heart-icon {
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .stl-action-btn.stl-liked .stl-heart-icon { transform: scale(1.18); }

  .stl-map-btn,
  .stl-open-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.18s, background 0.18s, transform 0.18s;
    letter-spacing: 0.02em;
  }

  .stl-map-btn {
    color: var(--accent);
    border: 1px solid rgba(217, 160, 102, 0.28);
    background: rgba(217, 160, 102, 0.08);
    margin-right: 4px;
  }

  .stl-map-btn:hover { background: rgba(217, 160, 102, 0.16); border-color: var(--accent); }
  .stl-map-btn:active, .stl-open-btn:active { transform: scale(0.93); }

  .stl-open-btn {
    color: var(--muted);
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
  }

  .stl-open-btn:hover { color: var(--text); background: rgba(255,255,255,0.08); }

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
  }

  .stl-comment-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    font-size: 0.84rem;
    line-height: 1.4;
  }

  .stl-comment-author { font-weight: 700; color: var(--text); font-size: 0.8rem; }
  .stl-comment-text { color: var(--text); word-break: break-word; }
  .stl-comment-time { font-size: 0.68rem; color: var(--muted); white-space: nowrap; }

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