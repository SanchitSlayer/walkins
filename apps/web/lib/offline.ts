"use client";

import type { CheckIn, MyApplications } from "@walkins/shared";
import { ApiError, apiClient } from "./api-client";

// What a candidate's phone keeps so a dead signal at the venue doesn't stop
// check-in: their pass (the last list of their drives) and any scans made
// while offline. Kept in localStorage on this device only, and wiped on
// logout, since phones get shared.
const PASS_KEY = "walkins:pass";
const QUEUE_KEY = "walkins:queued-checkins";
const SESSION_KEY = "walkins:last-session";
const SYNC_TAG = "walkins-checkins";
export const FLUSHED_EVENT = "walkins:checkins-flushed";

// userId is whoever was signed in on this device when the scan was made, so
// a scan is never sent as someone else who later logs in on the same phone.
export type QueuedCheckIn = {
  id: string;
  userId: string | null;
  code: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
};

export type FlushResult =
  | { item: QueuedCheckIn; status: "sent"; checkIn: CheckIn }
  | { item: QueuedCheckIn; status: "refused"; message: string };

// Storage can be unavailable (private browsing, storage blocked or full);
// offline support then simply isn't there, and the online path still works.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not stored; see read().
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove; see read().
  }
}

// fetch rejects with a TypeError only when the request never got an answer.
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export function savePass(applications: MyApplications) {
  write(PASS_KEY, { savedAt: new Date().toISOString(), applications });
}

export function loadPass(): { savedAt: string; applications: MyApplications } | null {
  return read(PASS_KEY);
}

export function rememberSession(session: { userId: string | null; role: string }) {
  write(SESSION_KEY, session);
}

export function lastSession(): { userId: string | null; role: string } | null {
  return read(SESSION_KEY);
}

export function forgetDevice() {
  remove(PASS_KEY);
  remove(QUEUE_KEY);
  remove(SESSION_KEY);
}

export function queuedCheckIns(): QueuedCheckIn[] {
  return read<QueuedCheckIn[]>(QUEUE_KEY) ?? [];
}

export async function queueCheckIn(scan: Omit<QueuedCheckIn, "id" | "capturedAt" | "userId">) {
  const queued: QueuedCheckIn = {
    ...scan,
    id: crypto.randomUUID(),
    userId: lastSession()?.userId ?? null,
    capturedAt: new Date().toISOString(),
  };
  write(QUEUE_KEY, [...queuedCheckIns(), queued]);
  // Where Background Sync exists (Chromium; not Safari on iOS) the service
  // worker wakes an open page when the network returns. It never sends the
  // scan itself: that would mean refreshing the session outside the page,
  // which races the page's own refresh and logs the candidate out.
  const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
  const sync = (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)?.sync;
  await sync?.register(SYNC_TAG).catch(() => undefined);
}

let flushing: Promise<FlushResult[]> | null = null;

// Sends queued scans one at a time through the normal API client. Single-
// flight, so a reconnect and a page load don't both send the same scan. A
// scan leaves the queue once the server has answered it either way; it stays
// if the network is still down or the candidate isn't logged in.
export function flushCheckIns(): Promise<FlushResult[]> {
  flushing ??= (async () => {
    const results: FlushResult[] = [];
    try {
      // Nothing can be sent without a session, and a scan made by another
      // account on this phone is dropped rather than sent as this one.
      const session = await apiClient.restoreSession().catch(() => null);
      if (!session) return results;
      const userId = apiClient.getCurrentUserId();
      for (const item of queuedCheckIns()) {
        if (item.userId !== userId) {
          write(QUEUE_KEY, queuedCheckIns().filter((queued) => queued.id !== item.id));
          continue;
        }
        try {
          // Always a walk-in: the server ignores it for someone with a
          // booking, and an offline phone couldn't ask the question anyway.
          const result = await apiClient.checkIn({
            code: item.code,
            lat: item.lat,
            lng: item.lng,
            accuracy: item.accuracy,
            capturedAt: new Date(item.capturedAt),
            walkIn: true,
          });
          results.push(
            result.outcome === "needs_registration"
              ? { item, status: "refused", message: "This check-in needs registering at the desk" }
              : { item, status: "sent", checkIn: result.checkIn },
          );
        } catch (err) {
          if (isNetworkError(err) || (err instanceof ApiError && err.status === 401)) break;
          results.push({ item, status: "refused", message: err instanceof Error ? err.message : "Check-in was refused" });
        }
        write(
          QUEUE_KEY,
          queuedCheckIns().filter((queued) => queued.id !== item.id),
        );
      }
    } finally {
      flushing = null;
    }
    if (results.length) window.dispatchEvent(new CustomEvent<FlushResult[]>(FLUSHED_EVENT, { detail: results }));
    return results;
  })();
  return flushing;
}
