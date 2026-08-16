<script lang="ts">
  import * as maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import type { Post } from "$lib/api";

  interface Props {
    posts: Post[];
    activePostId: string | null;
    showConnectors?: boolean;
    onSelectPost: (post: Post) => void;
  }

  let { posts, activePostId, showConnectors = false, onSelectPost }: Props = $props();

  const darkStyle: maplibregl.StyleSpecification = {
    version: 8,
    sources: {
      "carto-dark": {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
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
        maxzoom: 19,
      },
    ],
  };

  interface MapParams {
    posts: Post[];
    activePostId: string | null;
    showConnectors: boolean;
    onSelectPost: (post: Post) => void;
  }

  function mapAction(node: HTMLElement, params: MapParams) {
    let currentPosts = params.posts;
    let currentActiveId = params.activePostId;
    let currentShowConnectors = params.showConnectors;
    let selectCallback = params.onSelectPost;
    let markers: { id: string; marker: maplibregl.Marker; el: HTMLElement }[] = [];
    let isMapLoaded = false;
    let hasPositioned = false;

    // Create SVG overlay for guaranteed 100% connector line rendering
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "map-connectors-svg");

    const pathPrev = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathPrev.setAttribute("class", "connector-prev");

    const pathNextGlow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathNextGlow.setAttribute("class", "connector-next-glow");

    const pathNext = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathNext.setAttribute("class", "connector-next");

    svg.appendChild(pathPrev);
    svg.appendChild(pathNextGlow);
    svg.appendChild(pathNext);
    node.appendChild(svg);

    const map = new maplibregl.Map({
      container: node,
      style: darkStyle,
      center: [0, 20],
      zoom: 2,
      interactive: true,
      attributionControl: false,
      maxTileCacheSize: 250,
      fadeDuration: 100,
    });

    function updateConnectors() {
      if (!map || !currentShowConnectors) {
        pathPrev.setAttribute("d", "");
        pathNext.setAttribute("d", "");
        pathNextGlow.setAttribute("d", "");
        return;
      }

      const vp = currentPosts.filter(
        (p) => p.lat != null && p.lng != null && !(Number(p.lat) === 0 && Number(p.lng) === 0),
      );

      if (vp.length < 2) {
        pathPrev.setAttribute("d", "");
        pathNext.setAttribute("d", "");
        pathNextGlow.setAttribute("d", "");
        return;
      }

      let ai = vp.findIndex((p) => p.id === currentActiveId);
      if (ai === -1) ai = 0;

      // vp is sorted created_at DESC: vp[0] is most recent, vp[last] is oldest.
      let pPrev1: Post | null = null;
      let pPrev2: Post | null = null;
      let pNext1: Post | null = null;
      let pNext2: Post | null = null;

      // Previous in time (from older moment to current) — subtle dashed connector
      if (ai + 1 < vp.length) {
        pPrev1 = vp[ai + 1];
        pPrev2 = vp[ai];
      }

      // Next in time (from current moment to newer moment) — prominent solid connector
      // For the most recent item (ai === 0), there is no next moment in the future.
      if (ai > 0) {
        pNext1 = vp[ai];
        pNext2 = vp[ai - 1];
      }

      if (pPrev1 && pPrev2) {
        const pt1 = map.project([Number(pPrev1.lng), Number(pPrev1.lat)]);
        const pt2 = map.project([Number(pPrev2.lng), Number(pPrev2.lat)]);
        pathPrev.setAttribute("d", `M ${pt1.x} ${pt1.y} L ${pt2.x} ${pt2.y}`);
      } else {
        pathPrev.setAttribute("d", "");
      }

      if (pNext1 && pNext2) {
        const pt1 = map.project([Number(pNext1.lng), Number(pNext1.lat)]);
        const pt2 = map.project([Number(pNext2.lng), Number(pNext2.lat)]);
        const d = `M ${pt1.x} ${pt1.y} L ${pt2.x} ${pt2.y}`;
        pathNext.setAttribute("d", d);
        pathNextGlow.setAttribute("d", d);
      } else {
        pathNext.setAttribute("d", "");
        pathNextGlow.setAttribute("d", "");
      }
    }

    let cameraTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastTargetId: string | null = null;

    function queueCameraMove(targetLng: number, targetLat: number, targetId: string) {
      if (hasPositioned && lastTargetId === targetId) return;
      if (cameraTimeout) clearTimeout(cameraTimeout);
      cameraTimeout = setTimeout(() => {
        if (!map) return;
        lastTargetId = targetId;
        if (!hasPositioned) {
          map.jumpTo({ center: [targetLng, targetLat], zoom: 14, pitch: 30 });
          hasPositioned = true;
        } else {
          map.flyTo({
            center: [targetLng, targetLat],
            zoom: 14,
            pitch: 30,
            speed: 0.8,
            curve: 1.2,
            essential: true,
          });
        }
      }, 100);
    }

    function sync() {
      if (!map) return;

      const vp = currentPosts.filter(
        (p) => p.lat != null && p.lng != null && !(Number(p.lat) === 0 && Number(p.lng) === 0),
      );

      // If post list IDs changed, rebuild markers; otherwise only update active class
      const currentIds = currentPosts.map((p) => p.id).join(",");
      const existingIds = markers.map((m) => m.id).join(",");

      if (currentIds !== existingIds) {
        markers.forEach((m) => m.marker.remove());
        markers = [];

        currentPosts.forEach((post) => {
          if (post.lat == null || post.lng == null) return;
          const lat = Number(post.lat);
          const lng = Number(post.lng);
          if (lat === 0 && lng === 0) return;

          const el = document.createElement("div");
          el.className = "map-marker";
          if (post.id === currentActiveId) el.classList.add("active");

          el.addEventListener("click", (e) => {
            e.stopPropagation();
            selectCallback(post);
          });

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);

          markers.push({ id: post.id, marker, el });
        });
      } else {
        // Fast path: just update active CSS class without touching the DOM tree
        markers.forEach((m) => {
          if (m.id === currentActiveId) {
            m.el.classList.add("active");
          } else {
            m.el.classList.remove("active");
          }
        });
      }

      updateConnectors();

      // Camera navigation
      const target = currentPosts.find((p) => p.id === currentActiveId) ?? vp[0];
      if (target?.lat != null && target?.lng != null) {
        const targetLng = Number(target.lng);
        const targetLat = Number(target.lat);
        if (targetLat !== 0 || targetLng !== 0) {
          queueCameraMove(targetLng, targetLat, target.id);
        }
      }
    }

    map.on("load", () => {
      isMapLoaded = true;
      sync();
    });

    map.on("move", updateConnectors);
    map.on("resize", updateConnectors);

    return {
      update(newParams: MapParams) {
        currentPosts = newParams.posts;
        currentActiveId = newParams.activePostId;
        currentShowConnectors = newParams.showConnectors;
        selectCallback = newParams.onSelectPost;
        sync();
      },
      destroy() {
        if (cameraTimeout) clearTimeout(cameraTimeout);
        markers.forEach((m) => m.marker.remove());
        markers = [];
        svg.remove();
        map.remove();
      },
    };
  }
</script>

<div class="map-bg-wrapper" aria-hidden="true">
  <div class="map-container" use:mapAction={{ posts, activePostId, showConnectors, onSelectPost }}></div>
  <div class="map-overlay-vignette"></div>
</div>

<style>
  .map-bg-wrapper {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }
  .map-container {
    width: 100%;
    height: 100%;
    position: relative;
  }
  .map-overlay-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      circle at 50% 40%,
      rgba(9, 9, 11, 0.2) 0%,
      rgba(9, 9, 11, 0.72) 100%
    );
  }

  :global(.map-connectors-svg) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }
  :global(.connector-prev) {
    stroke: var(--accent, #d9a066);
    stroke-width: 1.5px;
    stroke-dasharray: 4 4;
    stroke-linecap: round;
    opacity: 0.3;
  }
  :global(.connector-next-glow) {
    stroke: #ffaa44;
    stroke-width: 5px;
    stroke-linecap: round;
    opacity: 0.15;
    filter: blur(2px);
  }
  :global(.connector-next) {
    stroke: #ffb366;
    stroke-width: 2.5px;
    stroke-linecap: round;
    opacity: 0.8;
  }

  :global(.map-marker) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent, #d9a066);
    border: 2.5px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 10px var(--accent, #d9a066), 0 2px 6px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    transition:
      transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.25s,
      border-color 0.25s,
      box-shadow 0.25s;
    z-index: 2;
  }
  :global(.map-marker:hover) {
    transform: scale(1.3);
    box-shadow: 0 0 16px var(--accent, #d9a066), 0 3px 8px rgba(0, 0, 0, 0.8);
  }
  :global(.map-marker.active) {
    transform: scale(1.8);
    background: #ffffff;
    border-color: var(--accent, #d9a066);
    box-shadow: 0 0 20px #ffffff, 0 0 28px var(--accent, #d9a066);
    z-index: 10;
  }
</style>
