import { headers } from "next/headers";
import { cache } from "react";
import type { DriveSearchPage, PublicDriveDetail } from "@walkins/shared";
import { API_INTERNAL_URL as API_URL } from "./api-internal-url";

// The API limits public reads per visitor address. Called from the Next
// server, every request would otherwise come from the server's own address
// and share one allowance, so the visitor's is passed on, as the /api proxy
// does for requests from the browser.
async function fromVisitor(path: string): Promise<Response> {
  const visitor = (await headers()).get("x-forwarded-for");
  return fetch(`${API_URL}${path}`, { cache: "no-store", headers: visitor ? { "X-Forwarded-For": visitor } : {} });
}

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

  const response = await fromVisitor(`/drives/search?${query.toString()}`);
  if (!response.ok) {
    return { items: [], nextCursor: null };
  }
  return response.json();
}

export type CityRow = { id: string; name: string; state: string; centerLat: number; centerLng: number };

// cache() shares one answer per request between a page and its
// generateMetadata, which both need the same city, role or drive.
export const listCitiesOnServer = cache(async (): Promise<CityRow[]> => {
  const response = await fromVisitor("/cities");
  return response.ok ? response.json() : [];
});

export async function getCityCenterByName(name: string): Promise<CityRow | null> {
  const cities = await listCitiesOnServer();
  return cities.find((city) => city.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export const getRoleBySlugOnServer = cache(async (slug: string): Promise<{ title: string; slug: string } | null> => {
  const response = await fromVisitor("/roles");
  const roles: { title: string; slug: string }[] = response.ok ? await response.json() : [];
  return roles.find((role) => role.slug === slug) ?? null;
});

export const getPublicDriveOnServer = cache(async (driveId: string): Promise<PublicDriveDetail | null> => {
  const response = await fromVisitor(`/drives/${driveId}/public`);
  if (!response.ok) {
    return null;
  }
  return response.json();
});
