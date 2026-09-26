"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

const NAV_BY_ROLE: Record<string, { href: string; label: string }> = {
  CANDIDATE: { href: "/profile", label: "Your profile" },
  EMPLOYER: { href: "/employer/drives", label: "Your drives" },
};

export function LogoutButton({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logOut() {
    setPending(true);
    try {
      await apiClient.logout();
      onLoggedOut?.();
      router.push("/");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logOut}
      disabled={pending}
      className="type-meta min-h-11 text-housing-muted underline-offset-4 hover:text-stock hover:underline disabled:opacity-60"
    >
      {pending ? "Logging out" : "Log out"}
    </button>
  );
}

function SessionNav() {
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    apiClient.restoreSession().then((session) => setRole(session?.role ?? null));
  }, []);

  // Width is reserved while the session resolves so the masthead doesn't shift.
  if (role === undefined) {
    return <span className="inline-block w-24" aria-hidden />;
  }
  if (!role) {
    return (
      <Link href="/login" className="type-meta text-stock underline-offset-4 hover:underline">
        Log in
      </Link>
    );
  }
  const link = NAV_BY_ROLE[role];
  return (
    <nav aria-label="Account" className="flex items-center gap-5">
      {link && (
        <Link href={link.href} className="type-meta text-stock underline-offset-4 hover:underline">
          {link.label}
        </Link>
      )}
      <LogoutButton onLoggedOut={() => setRole(null)} />
    </nav>
  );
}

export function Masthead({ context }: { context?: string }) {
  return (
    <header className="border-b border-housing-line bg-housing-raised text-stock">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link href="/" className="type-h3 shrink-0">
            Walkins
          </Link>
          {context && <span className="type-board-md truncate text-housing-muted">{context}</span>}
        </div>
        <SessionNav />
      </div>
    </header>
  );
}
