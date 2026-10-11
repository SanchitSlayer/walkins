"use client";

import { useCallback, useEffect, useState } from "react";
import type { FailedJob } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

export default function FailedJobsPage() {
  const t = useTranslations("admin.jobs");
  const errorText = useErrorText();
  const { dayLabel, formatTime } = useFormat();
  const [jobs, setJobs] = useState<FailedJob[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setJobs(await apiClient.adminFailedJobs()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.jobs.loadFailed")));
  }, [load]);

  async function retry(job: FailedJob) {
    if (!confirm(t("retryConfirm", { queue: job.queue, id: job.id }))) return;
    setBusy(`${job.queue}:${job.id}`);
    setError(null);
    try {
      await apiClient.adminRetryJob(job.queue, job.id);
      setNotice(t("retried", { queue: job.queue, id: job.id }));
      await load();
    } catch (err) {
      setError(errorText(err, "admin.jobs.retryFailed"));
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      {notice && (
        <p role="status" className="type-meta text-live-lamp">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!jobs ? (
        <p role="status" className="type-meta text-housing-muted">
          {t("loading")}
        </p>
      ) : jobs.length === 0 ? (
        <p className="type-body text-housing-muted">{t("none")}</p>
      ) : (
        <ul className="grid gap-3">
          {jobs.map((job) => (
            <li key={`${job.queue}:${job.id}`} className="grid gap-2 border border-housing-rule p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="type-meta">
                  <span className="type-board-md">{job.queue}</span> · {job.name} · <span className="font-mono">{job.id}</span>
                </p>
                <p className="type-meta text-housing-muted">
                  {t("failedAt", {
                    when: job.failedAt ? t("at", { day: dayLabel(new Date(job.failedAt), now), time: formatTime(job.failedAt) }) : t("unknownTime"),
                    attempts: job.attemptsMade,
                  })}
                </p>
              </div>
              <p className="type-meta text-closing-lamp">{job.failedReason}</p>
              <pre className="type-meta overflow-x-auto bg-housing-raised p-2 text-housing-muted">{JSON.stringify(job.data)}</pre>
              <div>
                <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === `${job.queue}:${job.id}`} onClick={() => retry(job)}>
                  {t("retry")}
                </BoardButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
