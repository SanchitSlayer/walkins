"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";

const NAV = [
  { href: "/admin/verification", label: "verification" },
  { href: "/admin/moderation", label: "moderation" },
  { href: "/admin/drives", label: "drives" },
  { href: "/admin/retention", label: "retention" },
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
