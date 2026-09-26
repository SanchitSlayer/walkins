"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { circleRing } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { addRadiusLayers, boardMapStyle, homeDiamondElement, setRadius } from "./map-style";

const KEY_STEP_DEG = 0.001;

type Props = {
  lat: number;
  lng: number;
  radiusKm: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
};

function radiusBounds(lat: number, lng: number, radiusKm: number) {
  const bounds = new LngLatBounds();
  for (const point of circleRing({ lat, lng }, radiusKm, 16)) bounds.extend(point);
  return bounds;
}

// Flat and north-up on purpose: this map is for placing one point
// precisely, and tilt or rotation only make that harder.
export default function PinMap({ lat, lng, radiusKm, onChange, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  // The loaded map itself rather than a flag: Fast Refresh re-runs effects with
  // state kept, so a flag would still read true while a freshly recreated map
  // has no sources yet.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: boardMapStyle(),
        bounds: radiusBounds(lat, lng, radiusKm),
        fitBoundsOptions: { padding: 32 },
        pitch: 0,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: false },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().setAttribute("aria-label", "Map for placing your home. The nearest city is written below it.");

    const element = homeDiamondElement({ draggable: true });
    element.tabIndex = 0;
    element.removeAttribute("aria-hidden");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", "Your home. Arrow keys move it; hold Shift to move further.");
    const marker = new Marker({ element, draggable: true, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
    marker.on("dragend", () => {
      const position = marker.getLngLat();
      onChangeRef.current(position.lat, position.lng);
    });
    element.addEventListener("keydown", (event) => {
      const step = KEY_STEP_DEG * (event.shiftKey ? 10 : 1);
      const moves: Record<string, [number, number]> = {
        ArrowUp: [step, 0],
        ArrowDown: [-step, 0],
        ArrowLeft: [0, -step],
        ArrowRight: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      const position = marker.getLngLat();
      onChangeRef.current(position.lat + move[0], position.lng + move[1]);
    });
    map.on("click", (event) => onChangeRef.current(event.lngLat.lat, event.lngLat.lng));
    map.on("load", () => {
      addRadiusLayers(map);
      setLoadedMap(map);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setLoadedMap(null);
    };
    // The map is created once; position and radius flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = loadedMap;
    if (!map || map !== mapRef.current) return;
    markerRef.current?.setLngLat([lng, lat]);
    setRadius(map, { lat, lng }, radiusKm);
    // Reframe only when the radius has outgrown the view, so moving the pin
    // or nudging the slider doesn't keep jumping the camera around.
    const target = radiusBounds(lat, lng, radiusKm);
    const view = map.getBounds();
    if (!view.contains(target.getNorthEast()) || !view.contains(target.getSouthWest())) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.fitBounds(target, { padding: 32, animate: !reduce });
    }
  }, [loadedMap, lat, lng, radiusKm]);

  if (failed) {
    return (
      <div className={cn("grid place-items-center border border-housing-line p-6 text-center", className)}>
        <p className="type-body max-w-xs text-housing-muted">
          The map needs WebGL, which this browser doesn&apos;t have, so your home can&apos;t be placed here.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className={cn("border border-housing-line", className)} role="region" aria-label="Home location map" />;
}
