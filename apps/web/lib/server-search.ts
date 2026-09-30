import type { DriveSearchPage, PublicDriveDetail } from "@walkins/shared";
import { API_INTERNAL_URL as API_URL } from "./api-internal-url";

// Plain, unauthenticated fetch for the server-rendered initial page load.
// Deliberately does not forward the refresh cookie: rotating a refresh
// token from a Server Component has no way to write the new token back to
// the browser, so the next real client request would look like a replay of
// a consumed token. The client-side JobsSearchClient upgrades to the
// candidate's real home location after hydration instead, through the
// normal api-client rotation flow.
export async function searchDrivesOnServer(params: {
  city?: string;
  role?: string;
  radiusKm?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
}): Promise<DriveSearchPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  const response = await fetch(`${API_URL}/drives/search?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    return { items: [], nextCursor: null };
  }
  return response.json();
}

export type CityRow = { id: string; name: string; state: string; centerLat: number; centerLng: number };

export async function listCitiesOnServer(): Promise<CityRow[]> {
  const response = await fetch(`${API_URL}/cities`, { cache: "no-store" });
  return response.ok ? response.json() : [];
}

export async function getCityCenterByName(name: string): Promise<CityRow | null> {
  const cities = await listCitiesOnServer();
  return cities.find((city) => city.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export async function getPublicDriveOnServer(driveId: string): Promise<PublicDriveDetail | null> {
  const response = await fetch(`${API_URL}/drives/${driveId}/public`, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  return response.json();
}
