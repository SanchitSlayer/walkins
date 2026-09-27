"use client";

import type {
  CandidateProfile,
  CreateDriveInput,
  CursorPage,
  DriveDetail,
  DriveSearchPage,
  EmployerDriveRow,
  OtpRequestInput,
  OtpVerifyInput,
  PublicDriveDetail,
  TelegramLink,
  UpdateCandidateProfileInput,
  UpdateDriveInput,
} from "@walkins/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Held in memory only (never localStorage) — refreshed via the httpOnly
// refresh cookie, which the browser sends automatically with credentials:
// "include". Lost on a full page reload by design; restoreSession() below
// re-establishes it from the cookie.
let accessToken: string | null = null;

type JwtPayload = { userId: string; role: string; companyId: string | null };

function decodeAccessToken(token: string): JwtPayload {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

// Single-flight: the refresh token rotates on every use and the API treats a
// second use of the same token as theft (revoking every session), so two
// components refreshing at once on page load must share one request.
let refreshing: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        accessToken = null;
        return false;
      }
      const data = await response.json();
      accessToken = data.accessToken;
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(path, options, false);
    }
  }

  return response;
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  // Nest sends an empty body (not the JSON literal "null") for a
  // controller returning null — .json() throws on that, so the fallback
  // must be null too, not {}, or an empty-but-truthy object silently masks
  // "no data" as "some data with no fields" for every caller downstream.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? `Request failed with status ${response.status}`);
  }
  return data as T;
}

export const apiClient = {
  async requestOtp(input: OtpRequestInput): Promise<{ devOtp?: string }> {
    return parseOrThrow(await request("/auth/otp/request", { method: "POST", body: JSON.stringify(input) }));
  },

  async verifyOtp(input: OtpVerifyInput): Promise<{ role: string; companyId: string | null }> {
    const data = await parseOrThrow<{ accessToken: string }>(
      await request("/auth/otp/verify", { method: "POST", body: JSON.stringify(input) }),
    );
    accessToken = data.accessToken;
    const payload = decodeAccessToken(data.accessToken);
    return { role: payload.role, companyId: payload.companyId };
  },

  async logout(): Promise<void> {
    await request("/auth/logout", { method: "POST" });
    accessToken = null;
  },

  // Re-establishes a session from the httpOnly refresh cookie after a page
  // load. Reuses a token already in memory rather than rotating again.
  async restoreSession(): Promise<{ role: string; companyId: string | null } | null> {
    const ok = accessToken !== null || (await refreshAccessToken());
    if (!ok || !accessToken) return null;
    const payload = decodeAccessToken(accessToken);
    return { role: payload.role, companyId: payload.companyId };
  },

  isAuthenticated(): boolean {
    return accessToken !== null;
  },

  getCurrentRole(): string | null {
    return accessToken ? decodeAccessToken(accessToken).role : null;
  },

  async createDrive(input: CreateDriveInput): Promise<DriveDetail> {
    return parseOrThrow(await request("/drives", { method: "POST", body: JSON.stringify(input) }));
  },

  async updateDrive(id: string, input: UpdateDriveInput): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`, { method: "PATCH", body: JSON.stringify(input) }));
  },

  async submitDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}/submit`, { method: "POST" }));
  },

  async deleteDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`, { method: "DELETE" }));
  },

  async getDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`));
  },

  async listMyDrives(cursor?: string): Promise<CursorPage<EmployerDriveRow>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return parseOrThrow(await request(`/drives/mine${query}`));
  },

  async listRoles(): Promise<{ id: string; title: string; slug: string }[]> {
    return parseOrThrow(await request("/roles"));
  },

  async listCities(): Promise<{ id: string; name: string; state: string; centerLat: number; centerLng: number }[]> {
    return parseOrThrow(await request("/cities"));
  },

  async getMyProfile(): Promise<CandidateProfile | null> {
    return parseOrThrow(await request("/candidates/me"));
  },

  async updateMyProfile(input: UpdateCandidateProfileInput): Promise<CandidateProfile> {
    return parseOrThrow(await request("/candidates/me", { method: "PATCH", body: JSON.stringify(input) }));
  },

  async createTelegramLink(): Promise<TelegramLink> {
    return parseOrThrow(await request("/candidates/me/telegram-link", { method: "POST" }));
  },

  async getPublicDrive(id: string): Promise<PublicDriveDetail> {
    return parseOrThrow(await request(`/drives/${id}/public`));
  },

  async searchDrives(
    params: { city?: string; role?: string; radiusKm?: number; fromDate?: string; toDate?: string; cursor?: string },
  ): Promise<DriveSearchPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const qs = query.toString();
    return parseOrThrow(await request(`/drives/search${qs ? `?${qs}` : ""}`));
  },
};
