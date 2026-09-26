export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
