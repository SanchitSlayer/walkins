"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMembership } from "@/lib/membership";
import { useUnread } from "@/lib/unread";

// Shown where an employer comes back anyway, to make or submit their next
// drive: the one moment they are certainly here weeks after a hire. It asks,
// and never blocks; a gate would only send them elsewhere.
export function OutcomesPrompt() {
  const t = useTranslations("outcomes");
  const { outcomesDue } = useUnread();
  if (!useMembership().can("runDrives") || outcomesDue === 0) return null;
  return (
    <p className="type-meta border-l-4 border-filling-lamp bg-housing-raised p-3 text-stock">
      {t.rich("prompt", {
        count: outcomesDue,
        link: (chunks) => (
          <Link href="/employer/outcomes" className="underline underline-offset-4">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
