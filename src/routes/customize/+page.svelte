<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadShare, dropShare, uploadShare, type PendingShare } from '$lib/share';
  import { fetchPeople } from '$lib/api';
  import { initSession } from '$lib/session.svelte';
  import exifr from 'exifr';

  const id = new URLSearchParams(window.location.search).get('id');

  let share = $state<PendingShare | null>(null);
  let failed = $state(false);
  let previews = $state<{ url: string; isVideo: boolean }[]>([]);
  let postDate = $state(toLocalDatetimeString(new Date()));
  let caption = $state('');
  let location = $state('');
  let lat = $state<number | null>(null);
  let lng = $state<number | null>(null);
  let locationNote = $state('');
  let detecting = $state(false);
  let posting = $state(false);
  let error = $state('');
  let objectUrls: string[] = [];
  let activeIndex = $state(0);
  let detected = $state(false);
  let mentioned = $state(false);
  let otherName = $state<string | null>(null);
  let carouselEl = $state<HTMLDivElement | undefined>();

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
    // Who can be @mentioned: the other half of the journal.
    fetchPeople()
      .then((p) => (otherName = p.other))
      .catch(() => {});
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
        lat = gps.latitude;
        lng = gps.longitude;
        locationNote = `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
        location = locationNote;
        detected = true;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${gps.latitude}&lon=${gps.longitude}`,
            { headers: { Accept: 'application/json' } }
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.display_name) {
              location = data.display_name;
            }
          }
        } catch (e) {
          console.warn('Reverse geocode failed', e);
        }
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
    // Keep the moved slide in focus.
    goTo(targetIndex);
  }

  function goTo(i: number) {
    const el = carouselEl;
    if (!el) return;
    const slides = el.querySelectorAll('.cap-slide');
    const slide = slides[i] as HTMLElement | undefined;
    if (!slide) return;
    const target = slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }

  // Which slide is centered is driven by the carousel's own scroll position.
  function onScroll() {
    const el = carouselEl;
    if (!el) return;
    const slides = el.querySelectorAll('.cap-slide');
    const cx = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((s, i) => {
      const slide = s as HTMLElement;
      const center = slide.offsetLeft + slide.offsetWidth / 2;
      const dist = Math.abs(center - cx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    activeIndex = best;
  }

  function clearLocation() {
    location = '';
    lat = null;
    lng = null;
    detected = false;
    locationNote = '';
  }

  async function post(e: SubmitEvent) {
    e.preventDefault();
    if (posting || !share || !id) return;
    posting = true;
    error = '';
    try {
      const isoDate = new Date(postDate).toISOString();
      const mentions = mentioned && otherName ? [otherName] : [];
      await uploadShare(share, caption.trim(), location.trim(), isoDate, lat, lng, mentions);
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
      <div class="skel-cap" role="status" aria-label="Loading share">
        <div class="skel-line" style="width: 45%; height: 20px;"></div>
        <div class="skel-media" style="height: 170px;"></div>
        <div class="skel-line" style="width: 92%;"></div>
        <div class="skel-line" style="width: 68%;"></div>
        <div class="skel-btn"></div>
      </div>
    {:else}
      <form onsubmit={post}>
        <div class="cap-carousel" bind:this={carouselEl} onscroll={onScroll}>
          {#each previews as p, i (p.url)}
            <div class="cap-slide">
              {#if p.isVideo}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={p.url} controls playsinline></video>
              {:else}
                <img src={p.url} alt="Preview {i + 1}" />
              {/if}
              {#if previews.length > 1}
                <div class="cap-reorder">
                  <button type="button" class="btn-control" disabled={i === 0} onclick={() => moveItem(i, -1)} title="Move left" aria-label="Move left">‹</button>
                  <button type="button" class="btn-control" disabled={i === previews.length - 1} onclick={() => moveItem(i, 1)} title="Move right" aria-label="Move right">›</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if previews.length > 1}
          <div class="dots cap-dots">
            {#each previews as p, i (p.url)}
              <button class:active={i === activeIndex} aria-label="Go to item {i + 1}" onclick={() => goTo(i)}></button>
            {/each}
          </div>
        {/if}

        <label class="cap-label" for="caption">Caption</label>
        <textarea class="input" id="caption" bind:value={caption} rows={3} placeholder="Write a caption…" autocomplete="off"></textarea>

        <label class="cap-label" for="date">Date & Time</label>
        <input class="input" id="date" type="datetime-local" bind:value={postDate} required />

        <label class="cap-label" for="loc">
          Location
          {#if detected}<span class="cap-badge">from photo</span>{/if}
          {#if detecting}<span class="cap-hint">detecting…</span>{/if}
          {#if locationNote}<span class="cap-hint">{locationNote}</span>{/if}
        </label>
        <div class="loc-input">
          <svg class="loc-pin" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5a5 5 0 0 1 5 5c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 5-5z"/><circle cx="8" cy="6.5" r="1.8"/></svg>
          <input class="input" id="loc" bind:value={location} oninput={() => { lat = null; lng = null; detected = false; }} placeholder="Add a place…" autocomplete="off" enterkeyhint="done" />
          {#if location}
            <button type="button" class="loc-clear" onclick={clearLocation} aria-label="Clear location">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          {/if}
        </div>

        {#if otherName}
          <label class="cap-label" for="mention-chip">Mention someone</label>
          <button type="button" id="mention-chip" class="chip" class:on={mentioned} onclick={() => (mentioned = !mentioned)}>
            @{otherName}
          </button>
        {/if}

        {#if error}<p class="auth-error">{error}</p>{/if}

        <div class="cap-actions">
          <button class="btn btn-primary" type="submit" disabled={posting}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    {/if}
  </div>
</main>

<style>
  .cap-carousel {
    position: relative;
    display: flex;
    gap: 10px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    padding: 2px 0 10px;
  }
  .cap-carousel::-webkit-scrollbar { display: none; }
  .cap-slide {
    position: relative;
    flex: 0 0 78%;
    scroll-snap-align: center;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: #000;
  }
  .cap-slide img,
  .cap-slide video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cap-reorder {
    position: absolute;
    bottom: 8px;
    left: 50%;
    translate: -50% 0;
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
    font-size: 1.05rem;
    width: 32px;
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
  .cap-dots {
    margin: 4px 0 12px;
  }
</style>
