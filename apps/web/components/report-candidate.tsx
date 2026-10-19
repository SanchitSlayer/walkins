"use client";

import { useState } from "react";
import { REPORT_REASONS } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardSelect } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

type Reason = (typeof REPORT_REASONS.CANDIDATE)[number];

// Reporting someone who applied. It goes to Walkins, never to the candidate,
// and changes nothing for them until an admin has looked.
export function ReportCandidate({ applicationId, name }: { applicationId: string; name: string }) {
  const t = useTranslations("report.candidate");
  const reasons = useTranslations("report.reason");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("ABUSIVE");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.reportCandidate({ applicationId, reason, details: details.trim() || undefined });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "report.candidate.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p role="status" className="type-meta text-housing-muted">{t("sent")}</p>;
  if (!open) {
    return (
      <button type="button" className="type-meta justify-self-start text-housing-muted underline underline-offset-4" onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }
  return (
    <div className="grid max-w-sm gap-2 border border-housing-rule p-3">
      <p className="type-meta">{t("question", { name })}</p>
      <BoardSelect aria-label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
        {REPORT_REASONS.CANDIDATE.map((r) => (
          <option key={r} value={r}>
            {reasons(r)}
          </option>
        ))}
      </BoardSelect>
      <textarea
        aria-label={t("details")}
        placeholder={t("details")}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={500}
        rows={2}
        className="type-meta w-full border border-housing-rule bg-housing-raised p-2 text-stock"
      />
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BoardButton className="min-h-9 px-3" disabled={busy} onClick={send}>
          {busy ? t("sending") : t("send")}
        </BoardButton>
        <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => setOpen(false)}>
          {t("cancel")}
        </BoardButton>
      </div>
    </div>
  );
}
