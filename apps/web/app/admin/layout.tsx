"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";

const NAV = [
  { href: "/admin/companies", label: "Verification" },
  { href: "/admin/drives", label: "Drives" },
  { href: "/admin/jobs", label: "Failed jobs" },
  { href: "/admin/ledger", label: "Ledger" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <DeskShell role="ADMIN" label="Admin" nav={NAV}>
      {children}
    </DeskShell>
  );
}
