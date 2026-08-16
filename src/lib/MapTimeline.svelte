<script lang="ts">
  import * as maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import type { FeatureCollection } from "geojson";
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

  const emptyFC: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  function pointFeature(id: string, lng: number, lat: number) {
    return {
      type: "Feature" as const,
      properties: { id },
      geometry: { type: "Point" as const, coordinates: [lng, lat] },
    };
  }

  function lineFeature(kind: string, a: Post, b: Post) {
    return {
      type: "Feature" as const,
      properties: { kind },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [Number(a.lng), Number(a.lat)],
          [Number(b.lng), Number(b.lat)],
        ],
      },
    };
  }

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
    let isMapLoaded = false;
    let hasPositioned = false;
    let cursorPointer = false;

    const map = new maplibregl.Map({
      container: node,
      style: darkStyle,
      center: [0, 20],
      zoom: 2,
      interactive: true,
      attributionControl: false,
      maxTileCacheSize: 50,
      fadeDuration: 100,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });

    function updateConnectors() {
      if (!map || !isMapLoaded) return;
      const source = map.getSource("connectors");
      if (!source) return;

      if (!currentShowConnectors) {
        (source as maplibregl.GeoJSONSource).setData(emptyFC);
        return;
      }

      const vp = currentPosts.filter(
        (p) => p.lat != null && p.lng != null && !(Number(p.lat) === 0 && Number(p.lng) === 0),
      );

      if (vp.length < 2) {
        (source as maplibregl.GeoJSONSource).setData(emptyFC);
        return;
      }

      let ai = vp.findIndex((p) => p.id === currentActiveId);
      if (ai === -1) ai = 0;

      // vp is sorted created_at DESC: vp[0] is most recent, vp[last] is oldest.
      const features: ReturnType<typeof lineFeature>[] = [];

      // Previous in time (from older moment to current) — subtle dashed connector
      if (ai + 1 < vp.length) {
        features.push(lineFeature("prev", vp[ai + 1], vp[ai]));
      }

      // Next in time (from current moment to newer moment) — prominent solid connector
      // For the most recent item (ai === 0), there is no next moment in the future.
      if (ai > 0) {
        features.push(lineFeature("next", vp[ai], vp[ai - 1]));
      }

      (source as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
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
          map.jumpTo({ center: [targetLng, targetLat], zoom: 14, pitch: 0 });
          hasPositioned = true;
        } else {
          map.flyTo({
            center: [targetLng, targetLat],
            zoom: 14,
            pitch: 0,
            speed: 0.8,
            curve: 1.2,
            essential: true,
          });
        }
      }, 100);
    }

    function sync() {
      if (!map || !isMapLoaded) return;

      const vp = currentPosts.filter(
        (p) => p.lat != null && p.lng != null && !(Number(p.lat) === 0 && Number(p.lng) === 0),
      );

      // All points in one GeoJSON source — rendered on the GPU, no DOM nodes.
      (map.getSource("posts") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: vp.map((p) =>
          pointFeature(p.id, Number(p.lng), Number(p.lat)),
        ),
      });

      // Active highlight via cheap filter swap instead of per-marker DOM updates.
      const activeFilter: maplibregl.FilterSpecification = ["==", ["get", "id"], currentActiveId ?? ""];
      map.setFilter("posts-active", activeFilter);
      map.setFilter("posts-active-halo", activeFilter);

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
      map.addSource("connectors", { type: "geojson", data: emptyFC });

      map.addLayer({
        id: "connector-prev",
        type: "line",
        source: "connectors",
        filter: ["==", ["get", "kind"], "prev"],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "#d9a066",
          "line-width": 1.5,
          "line-dasharray": [4, 4],
          "line-opacity": 0.3,
        },
      });

      // Glow without SVG blur: a wide, translucent stroke under the core line.
      map.addLayer({
        id: "connector-next-glow",
        type: "line",
        source: "connectors",
        filter: ["==", ["get", "kind"], "next"],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "#ffaa44",
          "line-width": 7,
          "line-opacity": 0.15,
        },
      });

      map.addLayer({
        id: "connector-next",
        type: "line",
        source: "connectors",
        filter: ["==", ["get", "kind"], "next"],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "#ffb366",
          "line-width": 2.5,
          "line-opacity": 0.8,
        },
      });

      map.addSource("posts", { type: "geojson", data: emptyFC });

      map.addLayer({
        id: "posts-points",
        type: "circle",
        source: "posts",
        paint: {
          "circle-radius": 6.5,
          "circle-color": "#d9a066",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "rgba(255, 255, 255, 0.85)",
        },
      });

      map.addLayer({
        id: "posts-active-halo",
        type: "circle",
        source: "posts",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": 15,
          "circle-color": "rgba(255, 255, 255, 0.15)",
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(217, 160, 102, 0.35)",
        },
      });

      map.addLayer({
        id: "posts-active",
        type: "circle",
        source: "posts",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": 11,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#d9a066",
        },
      });

      map.on("click", "posts-points", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (!id) return;
        const post = currentPosts.find((p) => p.id === id);
        if (post) selectCallback(post);
      });

      map.on("mousemove", "posts-points", () => {
        if (!cursorPointer) {
          cursorPointer = true;
          map.getCanvas().style.cursor = "pointer";
        }
      });
      map.on("mouseleave", "posts-points", () => {
        if (cursorPointer) {
          cursorPointer = false;
          map.getCanvas().style.cursor = "";
        }
      });

      isMapLoaded = true;
      sync();
    });

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
</style>
