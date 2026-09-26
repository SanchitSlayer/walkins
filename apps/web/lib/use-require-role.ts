"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "./api-client";

export function useRequireRole(role: "EMPLOYER" | "CANDIDATE"): boolean {
  const router = useRouter();
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
        router.replace("/login");
        return;
      }
      setReady(true);
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router, role]);

  return ready;
}

export function useRequireEmployer(): boolean {
  return useRequireRole("EMPLOYER");
}

export function useRequireCandidate(): boolean {
  return useRequireRole("CANDIDATE");
}
