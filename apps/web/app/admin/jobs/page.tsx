"use client";

import { useCallback, useEffect, useState } from "react";
import { dayLabel, type FailedJob, formatTime } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";

export default function FailedJobsPage() {
  const [jobs, setJobs] = useState<FailedJob[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setJobs(await apiClient.adminFailedJobs()), []);
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Couldn't load failed jobs"));
  }, [load]);

  async function retry(job: FailedJob) {
    if (!confirm(`Retry ${job.queue} job ${job.id}? It runs again from the start.`)) return;
    setBusy(`${job.queue}:${job.id}`);
    setError(null);
    try {
      await apiClient.adminRetryJob(job.queue, job.id);
      setNotice(`${job.queue} job ${job.id} queued again.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't retry it");
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">Failed jobs</h1>
        <p className="type-meta mt-1 text-housing-muted">
          Jobs that used up their retries, from every queue. Retrying is safe: alerts claim before sending, and charges
          and top-ups are keyed so a second run changes nothing.
        </p>
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
          Loading failed jobs
        </p>
      ) : jobs.length === 0 ? (
        <p className="type-body text-housing-muted">No failed jobs in any queue.</p>
      ) : (
        <ul className="grid gap-3">
          {jobs.map((job) => (
            <li key={`${job.queue}:${job.id}`} className="grid gap-2 border border-housing-rule p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="type-meta">
                  <span className="type-board-md">{job.queue}</span> · {job.name} · <span className="font-mono">{job.id}</span>
                </p>
                <p className="type-meta text-housing-muted">
                  {job.failedAt ? `${dayLabel(new Date(job.failedAt), now)}, ${formatTime(job.failedAt)}` : "time unknown"} · {job.attemptsMade}{" "}
                  {job.attemptsMade === 1 ? "attempt" : "attempts"}
                </p>
              </div>
              <p className="type-meta text-closing-lamp">{job.failedReason}</p>
              <pre className="type-meta overflow-x-auto bg-housing-raised p-2 text-housing-muted">{JSON.stringify(job.data)}</pre>
              <div>
                <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === `${job.queue}:${job.id}`} onClick={() => retry(job)}>
                  Retry
                </BoardButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
