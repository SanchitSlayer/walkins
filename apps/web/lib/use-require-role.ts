"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiClient } from "./api-client";
import { isNetworkError, lastSession, rememberSession } from "./offline";

export function useRequireRole(role: "EMPLOYER" | "CANDIDATE" | "ADMIN"): boolean {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      let currentRole = apiClient.getCurrentRole();
      if (!currentRole) {
        try {
          currentRole = (await apiClient.restoreSession())?.role ?? null;
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          // No signal, so the session can't be checked. Fall back to the role
          // this device last had: the offline pages only show what is already
          // on it, and anything they send is checked by the server later.
          currentRole = lastSession()?.role ?? null;
        }
      }
      if (currentRole && apiClient.isAuthenticated()) {
        rememberSession({ userId: apiClient.getCurrentUserId(), role: currentRole });
      }
      if (cancelled) return;
      if (currentRole !== role) {
        // The path only: on /checkin the hash can carry a check-in code,
        // which has no business in a query string.
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setReady(true);
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router, role, pathname]);

  return ready;
}
