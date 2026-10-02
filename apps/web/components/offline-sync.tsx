"use client";

import { useEffect } from "react";
import { flushCheckIns, queuedCheckIns } from "@/lib/offline";

// Mounted once for the whole app: whatever page is open when the signal
// comes back sends any check-ins queued while it was gone.
export function OfflineSync() {
  useEffect(() => {
    const flush = () => {
      if (queuedCheckIns().length) flushCheckIns();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "flush-checkins") flush();
    };

    navigator.serviceWorker
      ?.register("/sw.js")
      .catch((err) => console.warn("walkins: offline support unavailable", err));
    navigator.serviceWorker?.addEventListener("message", onMessage);
    window.addEventListener("online", flush);
    flush();

    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.removeEventListener("online", flush);
    };
  }, []);

  return null;
}
