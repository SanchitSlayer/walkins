"use client";

import type { ReactNode } from "react";
import { DeskShell } from "@/components/board/desk-shell";
import { MembershipGate } from "@/lib/membership";
import { StandingNotices } from "@/lib/standing";
import { UnreadProvider, useUnread } from "@/lib/unread";

function EmployerShell({ children }: { children: ReactNode }) {
  const { unread, outcomesDue } = useUnread();
  // The live arrivals board (Phase 5) is the one employer screen that gets
  // the full departure-board treatment; everything here is desk density.
  const nav = [
    { href: "/employer/drives", label: "drives" },
    { href: "/employer/messages", label: "messages", count: unread },
    { href: "/employer/outcomes", label: "outcomes", count: outcomesDue },
    { href: "/employer/analytics", label: "analytics" },
    { href: "/employer/billing", label: "billing" },
    { href: "/employer/people", label: "people" },
    { href: "/employer/verification", label: "verification" },
  ] as const;
  return (
    <DeskShell role="EMPLOYER" label="employerDesk" nav={nav}>
      <MembershipGate>
        <StandingNotices>{children}</StandingNotices>
      </MembershipGate>
    </DeskShell>
  );
}

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <UnreadProvider>
      <EmployerShell>{children}</EmployerShell>
    </UnreadProvider>
  );
}
