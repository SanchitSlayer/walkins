"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Thread } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { ThreadView } from "@/components/thread-view";
import { PersonName } from "@/components/person-name";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";
import { useUnread } from "@/lib/unread";

const REFRESH_MS = 20_000;

// The company's side of a conversation with one candidate. Everyone at the
// company sees it; reading it reads it for the whole desk.
export default function CompanyThreadPage() {
  const t = useTranslations("thread");
  const errorText = useErrorText();
  const { dayLabel, formatDate, formatTime } = useFormat();
  const { refresh: refreshUnread } = useUnread();
  const { id: driveId, applicationId } = useParams<{ id: string; applicationId: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const show = useCallback(
    async (next: Thread) => {
      setThread(next);
      const last = next.messages.at(-1);
      if (last && next.unread > 0) {
        await apiClient.companyRead(applicationId, last.seq);
        refreshUnread();
      }
    },
    [applicationId, refreshUnread],
  );

  const load = useCallback(async () => {
    try {
      await show(await apiClient.companyThread(applicationId));
    } catch (err) {
      setError(errorText(err, "thread.loadFailed"));
    }
  }, [applicationId, show]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => clearInterval(refresh);
  }, [load]);

  return (
    <div className="grid max-w-3xl gap-5">
      <Link href={`/employer/drives/${driveId}/applicants`} className="type-meta text-housing-muted underline-offset-4 hover:underline">
        {t("backToApplicants")}
      </Link>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {thread && (
        <>
          <div className="grid gap-1">
            <h1 className="type-h2">{thread.candidateName}</h1>
            <p className="type-meta text-housing-muted">
              {t("about", { role: thread.drive.roleTitle })} · {t("closesOn", { day: formatDate(new Date(thread.closesAt)) })}
            </p>
            {/* Without Telegram, nothing reaches them until they next open the app. */}
            <p className={thread.telegramLinked ? "type-meta text-housing-muted" : "type-meta border-l-2 border-pending-lamp pl-2 text-stock"}>
              {thread.telegramLinked ? t("telegramLinked") : t("telegramNotLinked", { name: thread.candidateName })}
            </p>
            {thread.lastReadBy && (
              <p className="type-meta text-housing-muted">
                {t.rich("lastRead", {
                  day: dayLabel(new Date(thread.lastReadBy.at), now),
                  time: formatTime(thread.lastReadBy.at),
                  name: () => <PersonName person={thread.lastReadBy!.person} />,
                })}
              </p>
            )}
          </div>
          <ThreadView thread={thread} side="company" onSend={async (body) => show(await apiClient.companySend(applicationId, body))} />
        </>
      )}
    </div>
  );
}
