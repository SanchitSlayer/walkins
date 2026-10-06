"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/board/masthead";
import { useRequireRole } from "@/lib/use-require-role";
import { cn } from "@/lib/utils";

// The operations desk: the same housing and type as the public board, but
// quieter and denser, because people work here rather than browse. Employers
// and admins share it; only the nav and the role differ.
export function DeskShell({
  role,
  label,
  nav,
  children,
}: {
  role: "EMPLOYER" | "ADMIN";
  label: string;
  nav: { href: string; label: string }[];
  children: ReactNode;
}) {
  const ready = useRequireRole(role);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-housing text-stock">
      <header className="border-b border-housing-line bg-housing-raised">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="type-h3">
              Walkins
            </Link>
            <span className="type-board-md text-housing-muted">{label}</span>
          </div>
          <nav aria-label={label}>
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {nav.map((item) => {
                const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
