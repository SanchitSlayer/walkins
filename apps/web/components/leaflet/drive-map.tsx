"use client";

import { useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DriveSearchResult } from "@walkins/shared";
import { fixDefaultIcon } from "./fix-default-icon";

type Props = {
  origin?: { lat: number; lng: number };
  radiusKm?: number;
  drives: DriveSearchResult[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

function dotIcon(color: string, size: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function DriveMap({ origin, radiusKm, drives, selectedId = null, onSelect }: Props) {
  useEffect(() => {
    fixDefaultIcon();
  }, []);

  const homeIcon = dotIcon("#dc2626", 18);
  const driveIcon = dotIcon("#2563eb", 14);
  const selectedDriveIcon = dotIcon("#f59e0b", 20);

  const center = origin ?? (drives[0] ? { lat: drives[0].venueLat, lng: drives[0].venueLng } : { lat: 0, lng: 0 });

  return (
    <MapContainer center={[center.lat, center.lng]} zoom={12} style={{ height: "500px", width: "100%", borderRadius: "0.5rem" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {origin && <Marker position={[origin.lat, origin.lng]} icon={homeIcon} />}
      {origin && radiusKm && (
        <Circle center={[origin.lat, origin.lng]} radius={radiusKm * 1000} pathOptions={{ color: "#dc2626", fillOpacity: 0.05 }} />
      )}
      {drives.map((drive) => (
        <Marker
          key={drive.id}
          position={[drive.venueLat, drive.venueLng]}
          icon={drive.id === selectedId ? selectedDriveIcon : driveIcon}
          eventHandlers={onSelect ? { click: () => onSelect(drive.id) } : undefined}
        />
      ))}
    </MapContainer>
  );
}
