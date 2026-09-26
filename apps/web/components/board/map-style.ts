import { type GeoJSONSource, type Map as MapLibreMap, type MapOptions, setWorkerUrl } from "maplibre-gl";
import { circleRing } from "@/lib/geo";

// MapLibre v6 cannot locate its worker through the bundler; it is copied
// into public/ by scripts/copy-maplibre-worker.mjs on every dev and build.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const RADIUS_VOLUME_M = 260;

type Point = { lat: number; lng: number };

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function collection<T>(features: T[]) {
  return { type: "FeatureCollection" as const, features };
}

// Greyscale and inverted (brightness-min above brightness-max inverts), so
// the city reads as part of the board's dark housing and the only colour on
// the plane comes from what is placed on it.
export function boardMapStyle(): Exclude<MapOptions["style"], string | undefined> {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      { id: "housing", type: "background", paint: { "background-color": token("--housing") } },
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: {
          "raster-saturation": -1,
          "raster-brightness-min": 0.62,
          "raster-brightness-max": 0.06,
          "raster-contrast": 0.15,
        },
      },
    ],
  };
}

// MapLibre positions a marker by writing an inline transform on the element
// it is given, so the rotation that makes the diamond sits on a child.
export function homeDiamondElement({ draggable = false } = {}): HTMLElement {
  const holder = document.createElement("div");
  holder.className = draggable ? "cursor-grab p-2" : "pointer-events-none";
  holder.setAttribute("aria-hidden", "true");
  const diamond = document.createElement("span");
  diamond.className = draggable
    ? "block h-4 w-4 rotate-45 border-2 border-housing bg-stock"
    : "block h-3 w-3 rotate-45 border-2 border-housing bg-stock";
  holder.append(diamond);
  return holder;
}

// The travel radius as a translucent volume of reachable ground rather than
// a flat ring, with a crisp edge line so its boundary stays legible.
export function addRadiusLayers(map: MapLibreMap) {
  map.addSource("radius", { type: "geojson", data: collection([]) });
  map.addLayer({
    id: "radius-edge",
    type: "line",
    source: "radius",
    paint: { "line-color": token("--stock"), "line-opacity": 0.55, "line-width": 1.5 },
  });
  map.addLayer({
    id: "radius-volume",
    type: "fill-extrusion",
    source: "radius",
    paint: {
      "fill-extrusion-color": token("--stock"),
      "fill-extrusion-height": RADIUS_VOLUME_M,
      "fill-extrusion-opacity": 0.12,
    },
  });
}

export function setRadius(map: MapLibreMap, origin: Point, radiusKm: number | undefined) {
  const features = radiusKm
    ? [
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Polygon" as const, coordinates: [circleRing(origin, radiusKm)] },
        },
      ]
    : [];
  (map.getSource("radius") as GeoJSONSource).setData(collection(features));
}
