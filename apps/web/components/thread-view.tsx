"use client";

import { type FormEvent, useState } from "react";
import { MESSAGE_MAX_LENGTH, REPORT_REASONS, type Thread, type ThreadMessage } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardSelect } from "@/components/board/field";
import { NeverPay } from "@/components/never-pay";
import { usePersonName } from "@/components/person-name";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

type Side = "company" | "candidate";
type Reason = (typeof REPORT_REASONS.MESSAGE)[number];

// The candidate's thread sits on the board's paper; the company's is desk
// density on the housing. Everything else is the same conversation.
const LOOK = {
  candidate: { panel: "bg-stock text-ink p-4 sm:p-5", muted: "text-ink-muted", rule: "border-ink-muted", surface: "stock" as const },
  company: { panel: "text-stock", muted: "text-housing-muted", rule: "border-housing-line", surface: "housing" as const },
};

function ReportMessage({ message, side }: { message: ThreadMessage; side: Side }) {
  const t = useTranslations("thread.report");
  const reasons = useTranslations("report.reason");
  const errorText = useErrorText();
  const look = LOOK[side];
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>(message.moneyFlag ? "ASKS_FOR_MONEY" : "ABUSIVE");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.reportMessage(message.id, { reason });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "thread.report.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className={cn("type-meta", look.muted)}>{t("sent")}</p>;
  if (!open) {
    return (
      <button type="button" className={cn("type-meta justify-self-start underline underline-offset-4", look.muted)} onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <BoardSelect surface={look.surface} aria-label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as Reason)} className="w-auto">
        {REPORT_REASONS.MESSAGE.map((r) => (
          <option key={r} value={r}>
            {reasons(r)}
          </option>
        ))}
      </BoardSelect>
      <BoardButton surface={look.surface} className="min-h-9 px-3" disabled={busy} onClick={send}>
        {t("send")}
      </BoardButton>
      <BoardButton surface={look.surface} variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => setOpen(false)}>
        {t("cancel")}
      </BoardButton>
      {error && <span className="type-meta text-closing-lamp">{error}</span>}
    </div>
  );
}

// A conversation about one application. Messages are plain text, never
// turned into links, and every one from the other side can be reported.
export function ThreadView({ thread, side, onSend }: { thread: Thread; side: Side; onSend: (body: string) => Promise<void> }) {
  const t = useTranslations("thread");
  const all = useTranslations();
  const errorText = useErrorText();
  const personName = usePersonName();
  const { dayLabel, formatTime } = useFormat();
  const look = LOOK[side];
  const mine = side === "company" ? "COMPANY" : "CANDIDATE";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(draft.trim());
      setDraft("");
    } catch (err) {
      setError(errorText(err, "thread.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const author = (m: ThreadMessage) =>
    m.side === "CANDIDATE" ? (side === "candidate" ? t("you") : thread.candidateName) : t("fromCompany", { name: m.sender ? personName(m.sender) : "", company: thread.drive.companyName });

  return (
    <div className="grid gap-4">
      <div className={cn("grid gap-3", look.panel)}>
        {thread.messages.length === 0 ? (
          <p className={cn("type-body", look.muted)}>{side === "candidate" ? t("emptyCandidate") : t("emptyCompany", { name: thread.candidateName })}</p>
        ) : (
          <ol className="grid gap-3">
            {thread.messages.map((m) => (
              <li key={m.id} className={cn("grid gap-1 border-l-2 pl-3", m.side === mine ? look.rule : "border-filling-lamp", m.side === mine && side === "candidate" && "ml-8")}>
                {m.moneyFlag && (
                  <p role="note" className="type-meta border-l-4 border-closing-lamp pl-2 font-semibold">
                    {side === "candidate" ? t("flaggedCandidate") : t("flaggedCompany")}
                  </p>
                )}
                <p className={cn("type-meta", look.muted)}>
                  {author(m)} · {dayLabel(new Date(m.createdAt), now)} {formatTime(m.createdAt)}
                  {m.delivery && ` · ${t(`delivery.${m.delivery}`)}`}
                </p>
                {/* Plain text: whatever was typed, including any link, is shown and never made clickable. */}
                <p className="type-body whitespace-pre-wrap break-words">{m.body}</p>
                {m.side !== mine && <ReportMessage message={m} side={side} />}
              </li>
            ))}
          </ol>
        )}
      </div>

      {thread.canSend ? (
        <form onSubmit={send} className="grid gap-2">
          <label className="grid gap-1">
            <span className={cn("type-meta", side === "candidate" ? "text-housing-muted" : look.muted)}>{t("write")}</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              className="type-body w-full border border-housing-rule bg-housing-raised p-3 text-stock"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="type-meta text-housing-muted">{t("count", { count: draft.length, max: MESSAGE_MAX_LENGTH })}</span>
            <BoardButton type="submit" disabled={busy || !draft.trim()}>
              {busy ? t("sending") : t("send")}
            </BoardButton>
          </div>
          {error && (
            <p role="alert" className="type-meta text-closing-lamp">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div role="status" className="grid gap-1 border-l-4 border-pending-lamp bg-housing-raised p-3 text-stock">
          {thread.blockedBy.map((reason) => (
            <p key={reason} className="type-meta">
              {all(`errors.messages.blocked.${reason}`)}
            </p>
          ))}
        </div>
      )}

      <NeverPay />
    </div>
  );
}
