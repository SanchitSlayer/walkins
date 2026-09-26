export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Closed [lng, lat] ring of points at a true great-circle distance from the
// centre; a circle drawn in raw degrees would be an ellipse at India's latitudes.
export function circleRing(center: { lat: number; lng: number }, radiusKm: number, steps = 64): [number, number][] {
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  const angular = (radiusKm * 1000) / EARTH_RADIUS_M;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 =
      lng1 +
      Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([toDeg(lng2), toDeg(lat2)]);
  }
  return ring;
}

export function squareRing(center: { lat: number; lng: number }, halfSideMeters: number): [number, number][] {
  const dLat = toDeg(halfSideMeters / EARTH_RADIUS_M);
  const dLng = dLat / Math.cos(toRad(center.lat));
  const { lat, lng } = center;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

export function nearestCity<T extends { centerLat: number; centerLng: number }>(
  point: { lat: number; lng: number },
  cities: T[],
): T {
  return cities.reduce((nearest, city) =>
    haversineDistanceKm(point.lat, point.lng, city.centerLat, city.centerLng) <
    haversineDistanceKm(point.lat, point.lng, nearest.centerLat, nearest.centerLng)
      ? city
      : nearest,
  );
}
