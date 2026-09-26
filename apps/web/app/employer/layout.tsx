"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/board/masthead";
import { useRequireRole } from "@/lib/use-require-role";
import { cn } from "@/lib/utils";

// The operations desk: the same housing and type as the public board, but
// quieter and denser, because employers work here rather than browse. The
// live arrivals board (Phase 5) joins this nav and is the one employer screen
// that gets the full departure-board treatment.
const NAV = [{ href: "/employer/drives", label: "Drives" }];

export default function EmployerLayout({ children }: { children: ReactNode }) {
  const ready = useRequireRole("EMPLOYER");
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-housing text-stock">
      <header className="border-b border-housing-line bg-housing-raised">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="type-h3">
              Walkins
            </Link>
            <span className="type-board-md text-housing-muted">Operations desk</span>
          </div>
          <nav aria-label="Employer">
            <ul className="flex gap-6">
              {NAV.map((item) => {
                const current = pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "type-meta inline-block border-b-2 py-1",
                        current ? "border-stock text-stock" : "border-transparent text-housing-muted hover:text-stock",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {ready && (
            <div className="ml-auto">
              <LogoutButton />
            </div>
          )}
        </div>
      </header>
      {ready && <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>}
    </div>
  );
}
