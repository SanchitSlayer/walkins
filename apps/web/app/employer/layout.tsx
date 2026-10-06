"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";

// The live arrivals board (Phase 5) is the one employer screen that gets the
// full departure-board treatment; everything here is desk density.
const NAV = [
  { href: "/employer/drives", label: "Drives" },
  { href: "/employer/analytics", label: "Analytics" },
  { href: "/employer/billing", label: "Billing" },
];

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <DeskShell role="EMPLOYER" label="Operations desk" nav={NAV}>
      {children}
    </DeskShell>
  );
}
