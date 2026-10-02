// Keeps the candidate's pass and the check-in page usable with no signal.
//
// Only two pages and the files they load are cached, always network first:
// a fresh copy whenever the network answers, the cached one only when it
// doesn't. Nothing under /api is touched, and queued scans are never sent
// from here (see lib/offline.ts for why the page sends them).
const CACHE = "walkins-pass-v1";
const PASS_PAGES = ["/checkin", "/my-drives"];
const SYNC_TAG = "walkins-checkins";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Static files only when a pass page asked for them, so the cache doesn't
// collect every chunk of every page visited.
async function requestedByPassPage(event) {
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  return client ? PASS_PAGES.includes(new URL(client.url).pathname) : false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const passPage = request.mode === "navigate" && PASS_PAGES.includes(url.pathname);
  const staticFile = url.pathname.startsWith("/_next/static/");
  // Everything else, /api included, goes to the network as if this worker
  // didn't exist.
  if (!passPage && !staticFile) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok && (passPage || (await requestedByPassPage(event)))) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: passPage });
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});

// Background Sync (Chromium only) fires when the network returns, even with
// the tab in the background. It only tells open pages to send their queue.
self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    (async () => {
      for (const page of await self.clients.matchAll({ type: "window" })) page.postMessage({ type: "flush-checkins" });
    })(),
  );
});
