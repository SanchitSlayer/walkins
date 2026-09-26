"use client";

import { useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { fixDefaultIcon } from "./fix-default-icon";

type Props = {
  lat: number;
  lng: number;
  radiusKm: number;
  onChange: (lat: number, lng: number) => void;
};

function ClickToMove({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function ProfileMap({ lat, lng, radiusKm, onChange }: Props) {
  useEffect(() => {
    fixDefaultIcon();
  }, []);

  return (
    <MapContainer center={[lat, lng]} zoom={12} style={{ height: "400px", width: "100%", borderRadius: "0.5rem" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker
        position={[lat, lng]}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const position = e.target.getLatLng();
            onChange(position.lat, position.lng);
          },
        }}
      />
      <Circle center={[lat, lng]} radius={radiusKm * 1000} pathOptions={{ color: "#2563eb", fillOpacity: 0.08 }} />
      <ClickToMove onChange={onChange} />
    </MapContainer>
  );
}
