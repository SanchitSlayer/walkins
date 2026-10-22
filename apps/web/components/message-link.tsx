"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ThreadList } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useTranslations } from "next-intl";

// One drive's conversations, so every row on a page can say whether its
// candidate has written. Fetched once per page, not per row.
export function useDriveThreads(driveId: string): ThreadList | null {
  const [list, setList] = useState<ThreadList | null>(null);
  useEffect(() => {
    apiClient.companyThreads(driveId).then(setList, () => {});
  }, [driveId]);
  return list;
}

export function MessageLink({ driveId, applicationId, threads }: { driveId: string; applicationId: string; threads: ThreadList | null }) {
  const t = useTranslations("messagesDesk");
  const unread = threads?.threads.find((c) => c.applicationId === applicationId)?.unread ?? 0;
  return (
    <Link href={`/employer/drives/${driveId}/messages/${applicationId}`} className="type-meta justify-self-start underline underline-offset-4">
      {unread > 0 ? t("rowUnread", { count: unread }) : t("row")}
    </Link>
  );
}
