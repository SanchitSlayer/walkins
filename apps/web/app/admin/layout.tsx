"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";

const NAV = [
  { href: "/admin/companies", label: "verification" },
  { href: "/admin/drives", label: "drives" },
  { href: "/admin/jobs", label: "failedJobs" },
  { href: "/admin/ledger", label: "ledger" },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <DeskShell role="ADMIN" label="adminDesk" nav={NAV}>
      {children}
    </DeskShell>
  );
}
