"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";

// The live arrivals board (Phase 5) is the one employer screen that gets the
// full departure-board treatment; everything here is desk density.
const NAV = [
  { href: "/employer/drives", label: "drives" },
  { href: "/employer/analytics", label: "analytics" },
  { href: "/employer/billing", label: "billing" },
] as const;

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <DeskShell role="EMPLOYER" label="employerDesk" nav={NAV}>
      {children}
    </DeskShell>
  );
}
