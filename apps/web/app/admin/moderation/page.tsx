"use client";

import { useCallback, useEffect, useState } from "react";
import type { Moderate, ModerationQueue, ModerationTarget, Thread } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardInput } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

type Act = (input: Moderate, question?: string) => Promise<void>;

function Reporter({ reporter }: { reporter: ModerationTarget["reports"][number]["reporter"] }) {
  const t = useTranslations("admin.moderation.reporter");
  const record = { total: reporter.total, dismissed: reporter.dismissed, actioned: reporter.actioned };
  return (
    <span className={reporter.total > 1 && reporter.dismissed * 2 >= reporter.total ? "text-closing-lamp" : "text-housing-muted"}>
      {reporter.kind === "account" ? t("account", { name: reporter.name ?? "", ...record }) : reporter.kind === "system" ? t("system") : t("network", record)}
    </span>
  );
}

// The whole conversation behind a reported message. Opening it is audited on
// the server, every time, so it is fetched only when asked for.
function Conversation({ threadId }: { threadId: string }) {
  const t = useTranslations("admin.moderation.conversation");
  const errorText = useErrorText();
  const { formatDate, formatTime } = useFormat();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!thread) {
    return (
      <div className="grid gap-1">
        <button
          type="button"
          className="type-meta justify-self-start underline underline-offset-4"
          onClick={() => apiClient.adminThread(threadId).then(setThread, (err) => setError(errorText(err, "errors.generic")))}
        >
          {t("open")}
        </button>
        {error && <span className="type-meta text-closing-lamp">{error}</span>}
      </div>
    );
  }
  return (
    <ol className="grid gap-2 border-l-2 border-housing-line pl-3">
      <li className="type-meta text-housing-muted">{t("audited")}</li>
      {thread.messages.map((m) => (
        <li key={m.id} className="grid gap-0.5">
          <span className="type-meta text-housing-muted">
            {t("line", { side: m.side, sender: m.sender?.name ?? thread.candidateName, day: formatDate(new Date(m.createdAt)), time: formatTime(m.createdAt) })}
            {m.moneyFlag && ` · ${t("flagged")}`}
          </span>
          <span className="type-meta whitespace-pre-wrap break-words">{m.body}</span>
        </li>
      ))}
    </ol>
  );
}

function Target({ target, act, busy }: { target: ModerationTarget; act: Act; busy: boolean }) {
  const t = useTranslations("admin.moderation");
  const reasons = useTranslations("report.reason");
  const { formatDate, formatTime } = useFormat();
  const [note, setNote] = useState("");
  // A thread's actions reach the drive and company it belongs to.
  const drive = target.targetType === "DRIVE" || target.targetType === "THREAD";
  const base = { targetType: target.targetType, targetId: target.targetId, note: note.trim() || undefined } as const;

  return (
    <li className="grid gap-3 border border-housing-rule p-4">
      <div>
        <p className="type-h3">
          {target.title} <span className="type-meta text-housing-muted">{target.subtitle}</span>
        </p>
        <p className="type-meta text-housing-muted">
          {t("summary", {
            kind: target.targetType,
            status: target.driveStatus ?? "",
            verification: target.verificationStatus ?? "",
            companySuspended: target.companySuspended ? "yes" : "no",
          })}
        </p>
        <p className="type-board-sm mt-1">
          {t("counts", { accounts: target.accountReporters, network: target.networkReporters, overflow: target.overflow })}
        </p>
        <p className="type-meta">
          {Object.entries(target.reasons)
            .map(([reason, count]) => t("reasonCount", { reason: reasons(reason as never), count }))
            .join(" · ")}
        </p>
      </div>

      {target.targetType === "THREAD" && <Conversation threadId={target.targetId} />}

      <ul className="grid gap-2 border-t border-housing-line pt-2">
        {target.reports.map((r) => (
          <li key={r.id} className="type-meta grid gap-0.5">
            <span>
              {reasons(r.reason)} · {formatDate(new Date(r.createdAt))} {formatTime(r.createdAt)} · <Reporter reporter={r.reporter} />
            </span>
            {r.message && (
              <span className="whitespace-pre-wrap break-words border-l-2 border-closing-lamp pl-2">
                {t("message", { side: r.message.side, sender: r.message.sender, body: r.message.body })}
              </span>
            )}
            {r.details && <span className="whitespace-pre-wrap text-housing-muted">{t("said", { details: r.details })}</span>}
          </li>
        ))}
      </ul>

      <div className="grid gap-2 border-t border-housing-line pt-3">
        <BoardInput aria-label={t("note")} placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex flex-wrap gap-2">
          <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => act({ ...base, kind: "DISMISS" })}>
            {t("dismiss")}
          </BoardButton>
          <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => act({ ...base, kind: "WARN" }, t("warnConfirm", { kind: target.targetType }))}>
            {t("warn")}
          </BoardButton>
          {drive && target.driveStatus !== "SUSPENDED" && (
            <BoardButton className="min-h-9 px-3" disabled={busy} onClick={() => act({ ...base, kind: "SUSPEND_DRIVE" }, t("suspendDriveConfirm", { title: target.title }))}>
              {t("suspendDrive")}
            </BoardButton>
          )}
          {drive && !target.companySuspended && (
            <BoardButton className="min-h-9 px-3" disabled={busy} onClick={() => act({ ...base, kind: "SUSPEND_COMPANY" }, t("suspendCompanyConfirm", { company: target.companyName ?? "" }))}>
              {t("suspendCompany")}
            </BoardButton>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ModerationPage() {
  const t = useTranslations("admin.moderation");
  const errorText = useErrorText();
  const { formatDate, formatTime } = useFormat();
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setQueue(await apiClient.adminModerationQueue()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.moderation.loadFailed")));
  }, [load]);

  const act: Act = async (input, question) => {
    if (question && !confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      setQueue(await apiClient.adminModerate(input));
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 max-w-3xl text-housing-muted">{t("intro")}</p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!queue ? (
        !error && <p className="type-meta text-housing-muted">{t("loading")}</p>
      ) : (
        <>
          <section aria-labelledby="open-heading" className="grid gap-3">
            <h2 id="open-heading" className="type-h3">
              {t("open", { count: queue.targets.length })}
            </h2>
            {queue.targets.length === 0 ? (
              <p className="type-meta text-housing-muted">{t("nothingOpen")}</p>
            ) : (
              <ul className="grid gap-4">
                {queue.targets.map((target) => (
                  <Target key={`${target.targetType}:${target.targetId}`} target={target} act={act} busy={busy} />
                ))}
              </ul>
            )}
          </section>

          {queue.suspended.length > 0 && (
            <section aria-labelledby="suspended-heading" className="grid gap-2">
              <h2 id="suspended-heading" className="type-h3">
                {t("suspended", { count: queue.suspended.length })}
              </h2>
              <ul className="border-t border-housing-line">
                {queue.suspended.map((s) => (
                  <li key={`${s.kind}:${s.id}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-housing-line py-2">
                    <span className="type-meta">{t("suspendedRow", { kind: s.kind, title: s.title, day: formatDate(new Date(s.since)) })}</span>
                    <BoardButton
                      variant="quiet"
                      className="min-h-9 px-3"
                      disabled={busy}
                      onClick={() =>
                        act({ kind: s.kind === "DRIVE" ? "LIFT_DRIVE" : "LIFT_COMPANY", targetType: s.kind, targetId: s.id }, t("liftConfirm", { kind: s.kind, title: s.title }))
                      }
                    >
                      {t("lift")}
                    </BoardButton>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {queue.recent.length > 0 && (
            <section aria-labelledby="recent-heading" className="grid gap-2">
              <h2 id="recent-heading" className="type-h3">
                {t("recent")}
              </h2>
              <ul className="grid gap-1">
                {queue.recent.map((a) => (
                  <li key={a.id} className="type-meta text-housing-muted">
                    {t("recentRow", { kind: a.kind, target: a.target, admin: a.admin, day: formatDate(new Date(a.createdAt)), time: formatTime(a.createdAt) })}
                    {a.note && ` ${t("said", { details: a.note })}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
