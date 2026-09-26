"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { type GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import type { DriveSearchResult } from "@walkins/shared";
import { circleRing, squareRing } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { deriveBoardState, stateToken } from "./board-state";
import { addRadiusLayers, boardMapStyle, collection, homeDiamondElement, setRadius, token } from "./map-style";

const PITCH = 50;
const BEARING = -12;
const PILLAR_HALF_SIDE_M = 280;
const PILLAR_MIN_M = 800;
const PILLAR_MAX_M = 3600;

type Point = { lat: number; lng: number };

// origin is the viewer's home when known; the drive detail page shows a
// single pillar with no home or radius, so both are optional.
type Props = {
  drives: DriveSearchResult[];
  now: Date;
  origin?: Point;
  radiusKm?: number;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  className?: string;
};

// A pillar's full height is its headcount; the lower, unlit part is seats
// already taken and the lit upper part, in the state's lamp colour, is seats
// still open. Heights scale against drives still in play (an ended drive
// shouldn't set the scale) on a square root, so one very large drive cannot
// flatten every other pillar to the minimum.
function pillarFeatures(drives: DriveSearchResult[], now: Date) {
  const states = new Map(drives.map((d) => [d.id, deriveBoardState(d, now)]));
  const inPlay = drives.filter((d) => states.get(d.id) !== "expired" && states.get(d.id) !== "cancelled");
  const maxCapacity = Math.max(1, ...(inPlay.length ? inPlay : drives).map((d) => d.capacity));
  const unlit = token("--housing-rule");

  return drives.flatMap((drive) => {
    const state = states.get(drive.id)!;
    const scale = Math.min(1, Math.sqrt(drive.capacity / maxCapacity));
    const total = PILLAR_MIN_M + (PILLAR_MAX_M - PILLAR_MIN_M) * scale;
    const open = state === "expired" || state === "cancelled" ? 0 : Math.max(0, drive.capacity - drive.bookedCount);
    const litBase = total * (1 - open / Math.max(1, drive.capacity));
    const geometry = {
      type: "Polygon" as const,
      coordinates: [squareRing({ lat: drive.venueLat, lng: drive.venueLng }, PILLAR_HALF_SIDE_M)],
    };
    const parts = [
      { base: 0, height: litBase, color: unlit },
      { base: litBase, height: total, color: token(stateToken(state, "housing")) },
    ];
    return parts
      .filter((part) => part.height > part.base)
      .map((part) => ({ type: "Feature" as const, properties: { id: drive.id, ...part }, geometry }));
  });
}

function selectionFeatures(drives: DriveSearchResult[], selectedId: string | null) {
  const drive = drives.find((d) => d.id === selectedId);
  if (!drive) return [];
  return [
    {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [drive.venueLng, drive.venueLat] },
    },
  ];
}

export default function CityPlane({ drives, now, origin, radiusKm, selectedId, onSelect, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  // The loaded map itself rather than a flag: Fast Refresh re-runs effects with
  // state kept, so a flag would still read true while a freshly recreated map
  // has no sources yet.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;

    const center = origin ?? { lat: drives[0]?.venueLat ?? 0, lng: drives[0]?.venueLng ?? 0 };
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: boardMapStyle(),
        center: [center.lng, center.lat],
        zoom: 11,
        pitch: PITCH,
        bearing: BEARING,
        attributionControl: { compact: false },
      });
    } catch {
      // No WebGL (old device, disabled GPU): the list beside the map carries
      // every drive, so the page stays complete without the plane.
      setFailed(true);
      return;
    }

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.getCanvas().setAttribute("aria-label", "Map of drives. Everything shown here is also written out on this page.");

    map.on("load", () => {
      map.addSource("pillars", { type: "geojson", data: collection([]) });
      map.addSource("selection", { type: "geojson", data: collection([]) });

      addRadiusLayers(map);
      map.addLayer({
        id: "pillars",
        type: "fill-extrusion",
        source: "pillars",
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "selection",
        type: "circle",
        source: "selection",
        paint: {
          "circle-radius": 16,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": token("--stock"),
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "map",
        },
      });

      map.on("click", "pillars", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current?.(id);
      });
      map.on("mouseenter", "pillars", () => {
        if (onSelectRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "pillars", () => {
        map.getCanvas().style.cursor = "";
      });

      setLoadedMap(map);
    });

    // MapLibre only tracks window resizes; on phones the map starts hidden
    // behind the list/map toggle and must resize when it becomes visible.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      setLoadedMap(null);
    };
    // The map is created once; data changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = loadedMap;
    if (!map || map !== mapRef.current) return;
    (map.getSource("pillars") as GeoJSONSource).setData(collection(pillarFeatures(drives, now)));
  }, [loadedMap, drives, now]);

  useEffect(() => {
    const map = loadedMap;
    if (!map || map !== mapRef.current) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!origin) return;
    setRadius(map, origin, radiusKm);
    // Just the diamond: a text label over the origin covered the nearest
    // pillars. The legend under the map says in words what it and the ring are.
    markerRef.current = new Marker({ element: homeDiamondElement(), anchor: "center" })
      .setLngLat([origin.lng, origin.lat])
      .addTo(map);
  }, [loadedMap, origin, radiusKm]);

  // The camera reframes only when what is being shown changes, never on a
  // clock tick or a selection, so it doesn't undo the user's own panning.
  useEffect(() => {
    const map = loadedMap;
    if (!map || map !== mapRef.current) return;
    const bounds = new LngLatBounds();
    if (origin) bounds.extend([origin.lng, origin.lat]);
    for (const drive of drives) bounds.extend([drive.venueLng, drive.venueLat]);
    if (origin && radiusKm) for (const point of circleRing(origin, radiusKm, 16)) bounds.extend(point);
    if (bounds.isEmpty()) return;
    // A lone pillar is always drawn at full height, which only fits in frame
    // from further out; framing a spread of drives can come in closer.
    const maxZoom = drives.length > 1 || origin ? 13.5 : 11.75;
    map.fitBounds(bounds, { padding: 56, maxZoom, pitch: PITCH, bearing: BEARING, animate: false });
  }, [loadedMap, drives, origin, radiusKm]);

  useEffect(() => {
    const map = loadedMap;
    if (!map || map !== mapRef.current) return;
    (map.getSource("selection") as GeoJSONSource).setData(collection(selectionFeatures(drives, selectedId)));
  }, [loadedMap, drives, selectedId]);

  if (failed) {
    return (
      <div className={cn("grid place-items-center border border-housing-line p-6 text-center", className)}>
        <p className="type-body max-w-xs text-housing-muted">
          The map needs WebGL, which this browser doesn&apos;t have. Everything on it is also written out on this page.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className={cn("border border-housing-line", className)} role="region" aria-label="Map of drives" />;
}
