"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";
import { MembershipGate } from "@/lib/membership";
import { StandingNotices } from "@/lib/standing";

// The live arrivals board (Phase 5) is the one employer screen that gets the
// full departure-board treatment; everything here is desk density.
const NAV = [
  { href: "/employer/drives", label: "drives" },
  { href: "/employer/analytics", label: "analytics" },
  { href: "/employer/billing", label: "billing" },
  { href: "/employer/people", label: "people" },
  { href: "/employer/verification", label: "verification" },
] as const;

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <DeskShell role="EMPLOYER" label="employerDesk" nav={NAV}>
      <MembershipGate>
        <StandingNotices>{children}</StandingNotices>
      </MembershipGate>
    </DeskShell>
  );
}
