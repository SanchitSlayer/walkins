"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiClient } from "./api-client";

export function useRequireRole(role: "EMPLOYER" | "CANDIDATE"): boolean {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      let currentRole = apiClient.getCurrentRole();
      if (!currentRole) {
        const session = await apiClient.restoreSession();
        currentRole = session?.role ?? null;
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
