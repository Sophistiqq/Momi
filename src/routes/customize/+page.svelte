<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    loadShare,
    dropShare,
    uploadShare,
    type PendingShare,
  } from "$lib/share";
  import { fetchPeople } from "$lib/api";
  import { initSession } from "$lib/session.svelte";
  import exifr from "exifr";
  import * as maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";

  const id = new URLSearchParams(window.location.search).get("id");

  let share = $state<PendingShare | null>(null);
  let failed = $state(false);
  let previews = $state<{ url: string; isVideo: boolean }[]>([]);
  let postDate = $state(toLocalDatetimeString(new Date()));
  let caption = $state("");
  let location = $state("");
  let lat = $state<number | null>(null);
  let lng = $state<number | null>(null);
  let locationNote = $state("");
  let detecting = $state(false);
  let posting = $state(false);
  let error = $state("");
  let objectUrls: string[] = [];
  let activeIndex = $state(0);
  let detected = $state(false);
  let mentioned = $state(false);
  let otherName = $state<string | null>(null);
  let carouselEl = $state<HTMLDivElement | undefined>();

  // Map pin picker state
  let showMapModal = $state(false);
  let pickerMapContainer: HTMLDivElement | undefined = $state();
  let pickerMap: maplibregl.Map | null = null;
  let pickerMarker: maplibregl.Marker | null = null;
  let pickerTempLat = $state<number>(0);
  let pickerTempLng = $state<number>(0);

  function openMapModal() {
    pickerTempLat = lat ?? 14.5995;
    pickerTempLng = lng ?? 120.9842;
    showMapModal = true;
  }

  function closeMapModal() {
    showMapModal = false;
    pickerMarker?.remove();
    pickerMarker = null;
    pickerMap?.remove();
    pickerMap = null;
  }

  async function confirmMapLocation() {
    lat = pickerTempLat;
    lng = pickerTempLng;
    detected = true;
    locationNote = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    closeMapModal();

    // Reverse geocode to get a readable name for the pinned location
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.display_name) {
          location = data.display_name;
        }
      }
    } catch {}
  }

  $effect(() => {
    if (showMapModal && pickerMapContainer && !pickerMap) {
      const darkStyle: maplibregl.StyleSpecification = {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
              "https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
          },
        },
        layers: [
          {
            id: "carto-dark-layer",
            type: "raster",
            source: "carto-dark",
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      };

      pickerMap = new maplibregl.Map({
        container: pickerMapContainer,
        style: darkStyle,
        center: [pickerTempLng, pickerTempLat],
        zoom: lat != null ? 14 : 4,
      });

      const el = document.createElement("div");
      el.className = "picker-pin";
      pickerMarker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([pickerTempLng, pickerTempLat])
        .addTo(pickerMap);

      pickerMarker.on("dragend", () => {
        const lngLat = pickerMarker!.getLngLat();
        pickerTempLat = lngLat.lat;
        pickerTempLng = lngLat.lng;
      });

      pickerMap.on("click", (e) => {
        pickerTempLat = e.lngLat.lat;
        pickerTempLng = e.lngLat.lng;
        pickerMarker?.setLngLat(e.lngLat);
      });
    }
  });

  function toLocalDatetimeString(date: Date): string {
    const pad = (num: number) => String(num).padStart(2, "0");
    const YYYY = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const DD = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
  }

  function parseDateValue(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    if (typeof val === "string") {
      const formatted = val.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
      const d = new Date(formatted);
      if (!isNaN(d.getTime())) return d;
    }
    if (typeof val === "number" && val > 0) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  onMount(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      await initSession();
      if (id) {
        share = await loadShare(id);
        if (share && share.files?.length) {
          objectUrls = share.files.map((f) => URL.createObjectURL(f.blob));
          previews = share.files.map((f, i) => ({
            url: objectUrls[i],
            isVideo: f.type.startsWith("video"),
          }));
          caption = share.text || "";
          detectMetadata();
          cleanup = () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
        } else {
          failed = true;
        }
      } else {
        // Direct manual creation mode
        share = { text: "", files: [] };
      }
    })();
    // Who can be @mentioned: the other half of the journal.
    fetchPeople()
      .then((p) => (otherName = p.other))
      .catch(() => {});
    return () => {
      if (cleanup) cleanup();
    };
  });

  function onFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const newFiles: { name: string; type: string; blob: Blob }[] = [];
    const newPreviews: { url: string; isVideo: boolean }[] = [];

    Array.from(input.files).forEach((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      newFiles.push({
        name: file.name,
        type: file.type,
        blob: file,
      });
      newPreviews.push({
        url,
        isVideo: file.type.startsWith("video"),
      });
    });

    share = {
      text: caption,
      files: [...(share?.files || []), ...newFiles],
    };
    previews = [...previews, ...newPreviews];

    detectMetadata();
    input.value = "";
  }

  function removeFile(index: number) {
    if (!share) return;
    URL.revokeObjectURL(previews[index].url);
    previews = previews.filter((_, i) => i !== index);
    share.files = share.files.filter((_, i) => i !== index);
    if (activeIndex >= previews.length) {
      activeIndex = Math.max(0, previews.length - 1);
    }
  }

  let locationResults = $state<{ display_name: string; lat: string; lon: string }[]>([]);
  let searchingLoc = $state(false);
  let showLocSuggestions = $state(false);
  let searchTimeout: any;

  function onLocInput(val: string) {
    location = val;
    lat = null;
    lng = null;
    detected = false;
    clearTimeout(searchTimeout);
    if (!val || val.trim().length < 2) {
      locationResults = [];
      showLocSuggestions = false;
      return;
    }
    searchTimeout = setTimeout(async () => {
      searchingLoc = true;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(val.trim())}&limit=5`,
          { headers: { Accept: "application/json" } },
        );
        if (res.ok) {
          locationResults = await res.json();
          showLocSuggestions = locationResults.length > 0;
        }
      } catch (e) {
        console.warn("Location search error", e);
      } finally {
        searchingLoc = false;
      }
    }, 350);
  }

  function selectLocation(item: { display_name: string; lat: string; lon: string }) {
    location = item.display_name;
    lat = parseFloat(item.lat);
    lng = parseFloat(item.lon);
    detected = true;
    showLocSuggestions = false;
    locationResults = [];
    locationNote = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  // Pull GPS and date from photo EXIF metadata across uploaded files.
  async function detectMetadata() {
    if (!share || !share.files?.length) return;
    detecting = true;
    try {
      let foundGps = false;
      let foundDate = false;

      for (const f of share.files) {
        // Date detection
        if (!foundDate) {
          try {
            const meta = await exifr.parse(f.blob, {
              tiff: true,
              xmp: true,
              icc: false,
              jfif: false,
            });
            const rawDate = meta?.DateTimeOriginal || meta?.CreateDate || meta?.ModifyDate;
            const parsed = parseDateValue(rawDate);
            if (parsed) {
              postDate = toLocalDatetimeString(parsed);
              foundDate = true;
            }
          } catch {}

          if (!foundDate && (f.blob as any).lastModified) {
            const parsed = parseDateValue((f.blob as any).lastModified);
            if (parsed) {
              postDate = toLocalDatetimeString(parsed);
              foundDate = true;
            }
          }
        }

        // GPS detection
        if (!foundGps) {
          try {
            const gps = await exifr.gps(f.blob);
            const rawLat = Number(gps?.latitude);
            const rawLng = Number(gps?.longitude);

            if (Number.isFinite(rawLat) && Number.isFinite(rawLng)) {
              lat = rawLat;
              lng = rawLng;
              locationNote = `${rawLat.toFixed(5)}, ${rawLng.toFixed(5)}`;
              location = locationNote;
              detected = true;
              foundGps = true;
              try {
                const res = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${rawLat}&lon=${rawLng}`,
                  { headers: { Accept: "application/json" } },
                );
                if (res.ok) {
                  const data = await res.json();
                  if (data?.display_name) {
                    location = data.display_name;
                  }
                }
              } catch (e) {
                console.warn("Reverse geocode failed", e);
              }
            }
          } catch {}
        }

        if (foundGps && foundDate) break;
      }

      if (!foundGps && !lat) {
        locationNote = "No GPS in photo — search or pin on map.";
      }
    } catch {
      if (!lat) locationNote = "No GPS found in photo.";
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
    const slides = el.querySelectorAll(".cap-slide");
    const slide = slides[i] as HTMLElement | undefined;
    if (!slide) return;
    const target = slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }

  // Which slide is centered is driven by the carousel's own scroll position.
  function onScroll() {
    const el = carouselEl;
    if (!el) return;
    const slides = el.querySelectorAll(".cap-slide");
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
    location = "";
    lat = null;
    lng = null;
    detected = false;
    locationNote = "";
  }

  async function post(e: SubmitEvent) {
    e.preventDefault();
    if (posting || !share) return;
    if (!share.files?.length) {
      error = "Please choose at least one photo or video.";
      return;
    }
    if (!location.trim()) {
      error = "Location is required for the timeline map.";
      return;
    }
    posting = true;
    error = "";
    try {
      // If coordinates weren't set yet (e.g. user typed custom place name without picking dropdown),
      // do a quick geocode lookup to ensure lat/lng are populated.
      let finalLat = lat;
      let finalLng = lng;
      if (finalLat == null || finalLng == null) {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(location.trim())}&limit=1`,
            { headers: { Accept: "application/json" } },
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.[0]?.lat && data?.[0]?.lon) {
              finalLat = parseFloat(data[0].lat);
              finalLng = parseFloat(data[0].lon);
            }
          }
        } catch {}
      }

      const isoDate = new Date(postDate).toISOString();
      const mentions = mentioned && otherName ? [otherName] : [];
      await uploadShare(
        share,
        caption.trim(),
        location.trim(),
        isoDate,
        finalLat ?? 0,
        finalLng ?? 0,
        mentions,
      );
      if (id) {
        await dropShare(id);
      }
      goto("/");
    } catch {
      error = "Upload failed — check your connection and try again.";
    } finally {
      posting = false;
    }
  }

  async function discard() {
    if (id) await dropShare(id);
    goto("/");
  }
</script>

<header class="topbar">
  <h1 class="logo logo-lg">Moments</h1>
  <div class="topbar-right">
    <button class="btn btn-ghost" onclick={discard} disabled={posting}
      >Cancel</button
    >
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
        {#if previews.length === 0}
          <div class="file-picker-box">
            <input
              type="file"
              id="file-input"
              accept="image/*,video/*"
              multiple
              onchange={onFilesSelected}
              style="display: none;"
            />
            <label for="file-input" class="file-picker-label">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Add Photos & Videos</span>
            </label>
          </div>
        {:else}
          <div class="cap-carousel" bind:this={carouselEl} onscroll={onScroll}>
            {#each previews as p, i (p.url)}
              <div class="cap-slide">
                {#if p.isVideo}
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video src={p.url} controls playsinline></video>
                {:else}
                  <img src={p.url} alt="Preview {i + 1}" />
                {/if}

                <button
                  type="button"
                  class="cap-remove-btn"
                  onclick={() => removeFile(i)}
                  title="Remove item"
                  aria-label="Remove item"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>

                {#if previews.length > 1}
                  <div class="cap-reorder">
                    <button
                      type="button"
                      class="btn-control"
                      disabled={i === 0}
                      onclick={() => moveItem(i, -1)}
                      title="Move left"
                      aria-label="Move left">‹</button
                    >
                    <button
                      type="button"
                      class="btn-control"
                      disabled={i === previews.length - 1}
                      onclick={() => moveItem(i, 1)}
                      title="Move right"
                      aria-label="Move right">›</button
                    >
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="add-more-row">
            <input
              type="file"
              id="add-more-input"
              accept="image/*,video/*"
              multiple
              onchange={onFilesSelected}
              style="display: none;"
            />
            <label for="add-more-input" class="btn btn-ghost" style="font-size: 0.85rem; padding: 6px 12px;">
              + Add more photos/videos
            </label>
          </div>
        {/if}
        {#if previews.length > 1}
          <div class="dots cap-dots">
            {#each previews as p, i (p.url)}
              <button
                class:active={i === activeIndex}
                aria-label="Go to item {i + 1}"
                onclick={() => goTo(i)}
              ></button>
            {/each}
          </div>
        {/if}

        <label class="cap-label" for="caption">Caption</label>
        <textarea
          class="input"
          id="caption"
          bind:value={caption}
          rows={3}
          placeholder="Write a caption…"
          autocomplete="off"
        ></textarea>

        <label class="cap-label" for="date">Date & Time</label>
        <input
          class="input"
          id="date"
          type="datetime-local"
          bind:value={postDate}
          required
        />

        <label class="cap-label" for="loc">
          Location <span style="color: var(--accent);">*</span>
          {#if detected}<span class="cap-badge">selected</span>{/if}
          {#if detecting}<span class="cap-hint">detecting…</span>{/if}
          {#if searchingLoc}<span class="cap-hint">searching…</span>{/if}
          {#if locationNote}<span class="cap-hint">{locationNote}</span>{/if}
        </label>
        <div class="loc-input-container">
          <div class="loc-input-wrapper">
            <svg
              class="loc-pin-icon"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M8 1.5a5 5 0 0 1 5 5c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 5-5z"
              /><circle cx="8" cy="6.5" r="1.8" /></svg
            >
            <input
              class="input loc-text-input"
              id="loc"
              value={location}
              oninput={(e) => onLocInput((e.target as HTMLInputElement).value)}
              placeholder="Search address or tap map to pin…"
              autocomplete="off"
              enterkeyhint="done"
              required
            />
            {#if location}
              <button
                type="button"
                class="loc-clear"
                onclick={clearLocation}
                aria-label="Clear location"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg
                >
              </button>
            {/if}
            <button
              type="button"
              class="btn-pin-map"
              onclick={openMapModal}
              title="Pin on Map"
              aria-label="Pin on Map"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                <line x1="8" y1="2" x2="8" y2="18"></line>
                <line x1="16" y1="6" x2="16" y2="22"></line>
              </svg>
              <span>Map</span>
            </button>
          </div>

          {#if showLocSuggestions && locationResults.length > 0}
            <div class="loc-dropdown">
              {#each locationResults as item}
                <button
                  type="button"
                  class="loc-item"
                  onclick={() => selectLocation(item)}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    style="flex-shrink: 0; margin-top: 2px;"
                  >
                    <path d="M8 1.5a5 5 0 0 1 5 5c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 5-5z" />
                    <circle cx="8" cy="6.5" r="1.8" />
                  </svg>
                  <span>{item.display_name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if otherName}
          <label class="cap-label" for="mention-chip">Mention someone</label>
          <button
            type="button"
            id="mention-chip"
            class="chip"
            class:on={mentioned}
            onclick={() => (mentioned = !mentioned)}
          >
            @{otherName}
          </button>
        {/if}

        {#if error}<p class="auth-error">{error}</p>{/if}

        <div class="cap-actions">
          <button class="btn btn-primary" type="submit" disabled={posting}>
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    {/if}
  </div>
</main>

{#if showMapModal}
  <div class="map-modal-overlay">
    <div class="map-modal">
      <div class="map-modal-header">
        <div>
          <h3>Pin Location on Map</h3>
          <p class="map-modal-subtitle">Tap or drag the pin to your exact spot</p>
        </div>
        <button type="button" class="icon-btn" onclick={closeMapModal} aria-label="Close">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div class="map-modal-canvas-wrapper">
        <div class="map-modal-canvas" bind:this={pickerMapContainer}></div>
        <div class="map-modal-crosshair"></div>
      </div>

      <div class="map-modal-footer">
        <span class="coord-tag">{pickerTempLat.toFixed(5)}, {pickerTempLng.toFixed(5)}</span>
        <div class="map-modal-actions">
          <button type="button" class="btn btn-ghost" onclick={closeMapModal}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={confirmMapLocation}>Set Location</button>
        </div>
      </div>
    </div>
  </div>
{/if}

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
  .cap-carousel::-webkit-scrollbar {
    display: none;
  }
  .cap-slide {
    position: relative;
    flex: 0 0 78%;
    scroll-snap-align: center;
    aspect-ratio: 1 / 1;
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
  .cap-remove-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(18, 18, 22, 0.72);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: background 0.18s, color 0.18s, transform 0.18s;
  }
  .cap-remove-btn:hover {
    background: var(--danger, #ff5e5e);
    color: #fff;
    border-color: transparent;
    transform: scale(1.08);
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
    transition:
      background 0.2s,
      opacity 0.2s;
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
