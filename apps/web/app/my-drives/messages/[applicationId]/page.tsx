"use client";

import { Link } from "@/lib/navigation";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Thread } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useRequireRole } from "@/lib/use-require-role";
import { Masthead } from "@/components/board/masthead";
import { ThreadView } from "@/components/thread-view";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

// How often an open thread looks for replies. Telegram is the fast path; this
// only keeps a page left open from going stale.
const REFRESH_MS = 20_000;

// The candidate's side of a conversation with the company. The Telegram copy
// of every company message links here.
export default function CandidateThreadPage() {
  const t = useTranslations("thread");
  const errorText = useErrorText();
  const { formatDate } = useFormat();
  const ready = useRequireRole("CANDIDATE");
  const { applicationId } = useParams<{ applicationId: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read up to the newest message on screen, never further.
  const show = useCallback(
    async (next: Thread) => {
      setThread(next);
      const last = next.messages.at(-1);
      if (last && next.unread > 0) await apiClient.myRead(applicationId, last.seq);
    },
    [applicationId],
  );

  const load = useCallback(async () => {
    try {
      await show(await apiClient.myThread(applicationId));
    } catch (err) {
      setError(errorText(err, "thread.loadFailed"));
    }
  }, [applicationId, show]);

  useEffect(() => {
    if (!ready) return;
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => clearInterval(refresh);
  }, [ready, load]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8 sm:px-6">
        <Link href="/my-drives" className="type-meta text-housing-muted underline-offset-4 hover:underline">
          {t("backToDrives")}
        </Link>
        {error && (
          <p role="alert" className="type-meta text-closing-lamp">
            {error}
          </p>
        )}
        {thread && (
          <>
            <div>
              <h1 className="type-h2">{t("withCompany", { company: thread.drive.companyName })}</h1>
              <p className="type-meta mt-1 text-housing-muted">
                {t("about", { role: thread.drive.roleTitle })} · {t("closesOn", { day: formatDate(new Date(thread.closesAt)) })}
              </p>
            </div>
            <ThreadView thread={thread} side="candidate" onSend={async (body) => show(await apiClient.mySend(applicationId, body))} />
          </>
        )}
      </main>
    </div>
  );
}
