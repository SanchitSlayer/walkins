"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FlaggedMessage, ThreadList } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { PersonName } from "@/components/person-name";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useMembership } from "@/lib/membership";
import { useStanding } from "@/lib/standing";
import { useErrorText } from "@/lib/use-error-text";

// For owners: what the money-request tripwire caught from their own people.
// It is a tripwire, not a screen, so this list is the company's chance to
// see a rogue recruiter, not proof that everyone else is clean.
function Flagged() {
  const t = useTranslations("messagesDesk.flagged");
  const errorText = useErrorText();
  const { dayLabel, formatTime } = useFormat();
  const { reload } = useStanding();
  const [flagged, setFlagged] = useState<FlaggedMessage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const load = useCallback(async () => setFlagged(await apiClient.flaggedMessages()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "messagesDesk.flagged.loadFailed")));
  }, [load]);

  async function reviewed(messageId: string) {
    setBusy(messageId);
    setError(null);
    try {
      await apiClient.reviewFlaggedMessage(messageId);
      await Promise.all([load(), reload()]);
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  if (!flagged || flagged.length === 0) return null;
  return (
    <section id="flagged" aria-labelledby="flagged-heading" className="grid gap-3 border-l-4 border-closing-lamp bg-housing-raised p-4">
      <h2 id="flagged-heading" className="type-h3">
        {t("heading", { count: flagged.length })}
      </h2>
      <p className="type-meta text-housing-muted">{t("explain")}</p>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <ul className="grid gap-3">
        {flagged.map((f) => (
          <li key={f.messageId} className="grid gap-1 border-t border-housing-line pt-3">
            <p className="type-meta text-housing-muted">
              {t.rich("line", {
                role: f.roleTitle,
                candidate: f.candidateName,
                day: dayLabel(new Date(f.createdAt), now),
                time: formatTime(f.createdAt),
                name: () => <PersonName person={f.sender} />,
              })}
            </p>
            <p className="type-body whitespace-pre-wrap break-words">{f.body}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/employer/drives/${f.driveId}/messages/${f.applicationId}`} className="type-meta underline underline-offset-4">
                {t("open")}
              </Link>
              <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy !== null} onClick={() => reviewed(f.messageId)}>
                {t("reviewed")}
              </BoardButton>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Every conversation the company has, newest first. One unread count for the
// whole desk.
export default function MessagesPage() {
  const t = useTranslations("messagesDesk");
  const errorText = useErrorText();
  const { dayLabel, formatTime } = useFormat();
  const { can } = useMembership();
  const [list, setList] = useState<ThreadList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    apiClient.companyThreads().then(setList, (err) => setError(errorText(err, "messagesDesk.loadFailed")));
  }, []);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      {can("managePeople") && <Flagged />}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {list &&
        (list.threads.length === 0 ? (
          <p className="type-meta text-housing-muted">{t("none")}</p>
        ) : (
          <ul className="border-t border-housing-line">
            {list.threads.map((thread) => (
              <li key={thread.applicationId} className="relative grid gap-1 border-b border-housing-line py-3 hover:bg-housing-raised sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="min-w-0">
                  <Link href={`/employer/drives/${thread.driveId}/messages/${thread.applicationId}`} className="type-body font-semibold after:absolute after:inset-0">
                    {thread.candidateName}
                  </Link>
                  <span className="type-meta block text-housing-muted">{thread.roleTitle}</span>
                </span>
                <span className="type-board-sm whitespace-nowrap text-housing-muted">
                  {thread.unread > 0 && <span className="mr-2 bg-filling-lamp px-1.5 text-ink">{t("unread", { count: thread.unread })}</span>}
                  {dayLabel(new Date(thread.lastMessageAt), now)} {formatTime(thread.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
