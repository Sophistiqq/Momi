<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadShare, dropShare, uploadShare, type PendingShare } from '$lib/share';
  import { initSession } from '$lib/session.svelte';
  import exifr from 'exifr';

  const id = new URLSearchParams(window.location.search).get('id');

  let share = $state<PendingShare | null>(null);
  let failed = $state(false);
  let previews = $state<{ url: string; isVideo: boolean }[]>([]);
  let postDate = $state(toLocalDatetimeString(new Date()));
  let caption = $state('');
  let location = $state('');
  let locationNote = $state('');
  let detecting = $state(false);
  let posting = $state(false);
  let error = $state('');
  let objectUrls: string[] = [];

  function toLocalDatetimeString(date: Date): string {
    const pad = (num: number) => String(num).padStart(2, '0');
    const YYYY = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const DD = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
  }

  onMount(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      await initSession();
      if (!id) {
        failed = true;
        return;
      }
      share = await loadShare(id);
      if (!share || !share.files?.length) {
        failed = true;
        return;
      }
      objectUrls = share.files.map((f) => URL.createObjectURL(f.blob));
      previews = share.files.map((f, i) => ({ url: objectUrls[i], isVideo: f.type.startsWith('video') }));
      caption = share.text || '';
      detectMetadata();
      cleanup = () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      if (cleanup) cleanup();
    };
  });

  // Pull GPS and date from the first photo's EXIF.
  // Manual overrides always win.
  async function detectMetadata() {
    if (!share) return;
    const img = share.files.find((f) => f.type.startsWith('image'));
    if (!img) return;
    detecting = true;
    try {
      const gps = await exifr.gps(img.blob);
      if (gps?.latitude != null && gps?.longitude != null) {
        locationNote = `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${gps.latitude}&lon=${gps.longitude}`,
          { headers: { Accept: 'application/json' } },
        );
        const data = await res.json().catch(() => null);
        location = data?.display_name || locationNote;
      } else {
        locationNote = 'No location found in photo.';
      }
    } catch {
      locationNote = 'Could not read photo metadata.';
    }

    try {
      const meta = await exifr.parse(img.blob);
      const rawDate = meta?.DateTimeOriginal || meta?.CreateDate || meta?.ModifyDate;
      if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
        postDate = toLocalDatetimeString(rawDate);
      }
    } catch {
      // Ignore EXIF date reading error
    } finally {
      detecting = false;
    }
  }

  function moveItem(index: number, direction: number) {
    if (!share) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= previews.length) return;

    // Swap in previews array
    const nextPreviews = [...previews];
    const temp = nextPreviews[index];
    nextPreviews[index] = nextPreviews[targetIndex];
    nextPreviews[targetIndex] = temp;
    previews = nextPreviews;

    // Swap in share.files array
    const nextFiles = [...share.files];
    const tempFile = nextFiles[index];
    nextFiles[index] = nextFiles[targetIndex];
    nextFiles[targetIndex] = tempFile;
    share.files = nextFiles;

    // Re-detect metadata from the new first image if location is still empty
    if (!location) {
      detectMetadata();
    }
  }

  async function post() {
    if (posting || !share || !id) return;
    posting = true;
    error = '';
    try {
      const isoDate = new Date(postDate).toISOString();
      await uploadShare(share, caption.trim(), location.trim(), isoDate);
      await dropShare(id);
      goto('/');
    } catch {
      error = 'Upload failed — check your connection and try again.';
    } finally {
      posting = false;
    }
  }

  async function discard() {
    if (id) await dropShare(id);
    goto('/');
  }
</script>

<header class="topbar">
  <h1 class="logo logo-lg">Moments</h1>
  <div class="topbar-right">
    <button class="btn btn-ghost" onclick={discard} disabled={posting}>Cancel</button>
  </div>
</header>

<main class="cap-page">
  <div class="cap-card">
    {#if failed}
      <h1 class="logo">Moments</h1>
      <p class="msg">Nothing came through — try sharing again.</p>
      <div class="cap-actions">
        <a class="btn btn-ghost" href="/">Done</a>
      </div>
    {:else if !share}
      <h1 class="logo">Moments</h1>
      <p class="msg">Loading…</p>
    {:else}
      <h1 class="logo">Moments</h1>
      <p class="msg">{previews.length} item{previews.length > 1 ? 's' : ''} ready to post</p>

      <div class="cap-previews">
        {#each previews as p, i (p.url)}
          <div class="preview-item">
            {#if p.isVideo}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={p.url} controls playsinline></video>
            {:else}
              <img src={p.url} alt="Preview {i + 1}" />
            {/if}
            <div class="preview-controls">
              <button
                type="button"
                class="btn-control"
                disabled={i === 0}
                onclick={() => moveItem(i, -1)}
                title="Move Up"
              >
                ▲
              </button>
              <button
                type="button"
                class="btn-control"
                disabled={i === previews.length - 1}
                onclick={() => moveItem(i, 1)}
                title="Move Down"
              >
                ▼
              </button>
            </div>
          </div>
        {/each}
      </div>

      <textarea class="input" bind:value={caption} rows={3} placeholder="Write a caption…"></textarea>

      <label class="cap-label" for="date">Date & Time</label>
      <input class="input" id="date" type="datetime-local" bind:value={postDate} />

      <label class="cap-label" for="loc">
        Location
        {#if detecting}<span class="cap-hint">detecting…</span>{/if}
        {#if locationNote}<span class="cap-hint">{locationNote}</span>{/if}
      </label>
      <input class="input" id="loc" bind:value={location} placeholder="Add a place…" />

      {#if error}<p class="auth-error">{error}</p>{/if}

      <div class="cap-actions">
        <button class="btn btn-primary" onclick={post} disabled={posting}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    {/if}
  </div>
</main>

<style>
  .preview-item {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .preview-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    padding: 4px;
    border-radius: 6px;
    z-index: 10;
  }
  .btn-control {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 0.75rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.2s, opacity 0.2s;
  }
  .btn-control:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
  }
  .btn-control:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
