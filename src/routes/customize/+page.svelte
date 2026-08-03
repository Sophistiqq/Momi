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
  let caption = $state('');
  let location = $state('');
  let locationNote = $state('');
  let detecting = $state(false);
  let posting = $state(false);
  let error = $state('');
  let objectUrls: string[] = [];

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
      detectLocation();
      cleanup = () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      if (cleanup) cleanup();
    };
  });

  // Pull GPS from the first photo's EXIF and reverse-geocode it into a place
  // name. Manual override always wins (the field stays editable).
  async function detectLocation() {
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
    } finally {
      detecting = false;
    }
  }

  async function post() {
    if (posting || !share || !id) return;
    posting = true;
    error = '';
    try {
      await uploadShare(share, caption.trim(), location.trim());
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
        {#each previews as p, i (i)}
          {#if p.isVideo}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={p.url} controls playsinline></video>
          {:else}
            <img src={p.url} alt="Preview {i + 1}" />
          {/if}
        {/each}
      </div>

      <textarea class="input" bind:value={caption} rows={3} placeholder="Write a caption…"></textarea>

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
