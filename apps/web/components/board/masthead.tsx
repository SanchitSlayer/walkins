"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { forgetDevice } from "@/lib/offline";

const NAV_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  CANDIDATE: [
    { href: "/my-drives", label: "Your drives" },
    { href: "/profile", label: "Your profile" },
  ],
  EMPLOYER: [{ href: "/employer/drives", label: "Your drives" }],
  ADMIN: [{ href: "/admin", label: "Admin" }],
};

export function LogoutButton({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logOut() {
    setPending(true);
    try {
      await apiClient.logout();
      forgetDevice();
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
      className="type-meta min-h-11 whitespace-nowrap text-housing-muted underline-offset-4 hover:text-stock hover:underline disabled:opacity-60"
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
  return (
    <nav aria-label="Account" className="flex items-center gap-5">
      {(NAV_BY_ROLE[role] ?? []).map((link) => (
        <Link key={link.href} href={link.href} className="type-meta whitespace-nowrap text-stock underline-offset-4 hover:underline">
          {link.label}
        </Link>
      ))}
      <LogoutButton onLoggedOut={() => setRole(null)} />
    </nav>
  );
}

export function Masthead({ context }: { context?: string }) {
  return (
    <header className="border-b border-housing-line bg-housing-raised text-stock">
      {/* On a narrow phone the account links drop to their own row rather
          than squeezing the city name to a letter. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
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
