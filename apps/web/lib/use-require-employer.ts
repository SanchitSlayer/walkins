"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "./api-client";

export function useRequireEmployer(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      let role = apiClient.getCurrentRole();
      if (!role) {
        const session = await apiClient.restoreSession();
        role = session?.role ?? null;
      }
      if (cancelled) return;
      if (role !== "EMPLOYER") {
        router.replace("/login");
        return;
      }
      setReady(true);
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return ready;
}
