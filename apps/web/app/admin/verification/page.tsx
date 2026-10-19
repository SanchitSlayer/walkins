"use client";

import { useCallback, useEffect, useState } from "react";
import { type AdminSubmission, type VerificationRejection, verificationRejectionSchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

const STATUS_CLASS: Record<AdminSubmission["status"], string> = {
  AWAITING_REVIEW: "text-pending-lamp",
  APPROVED: "text-live-lamp",
  REJECTED: "text-closing-lamp",
};

// The admin decides; the provider only advises. Its advice is shown for
// what it is: the mock checks a GSTIN's format and looks nothing up.
function Decide({ submission, onDecided }: { submission: AdminSubmission; onDecided: () => Promise<void> }) {
  const t = useTranslations("admin.verification");
  const reasons = useTranslations("verification.rejection");
  const errorText = useErrorText();
  const [reason, setReason] = useState<VerificationRejection>("DOCUMENT_UNREADABLE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (decision === "approve" && !confirm(t("approveConfirm", { company: submission.companyName }))) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.adminDecideSubmission(
        submission.id,
        decision === "approve" ? { decision, note: note.trim() || undefined } : { decision, reason, note: note.trim() || undefined },
      );
      await onDecided();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 border-t border-housing-line pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <BoardField label={t("rejectBecause")}>
          <BoardSelect value={reason} onChange={(e) => setReason(e.target.value as VerificationRejection)}>
            {verificationRejectionSchema.options.map((r) => (
              <option key={r} value={r}>
                {reasons(r)}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
        <BoardField label={t("note")} hint={t("noteHint")}>
          <BoardInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </BoardField>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BoardButton className="min-h-9 px-3" disabled={busy} onClick={() => decide("approve")}>
          {t("approve")}
        </BoardButton>
        <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => decide("reject")}>
          {t("reject")}
        </BoardButton>
      </div>
    </div>
  );
}

export default function VerificationReviewPage() {
  const t = useTranslations("admin.verification");
  const status = useTranslations("admin.submissionStatus");
  const provider = useTranslations("admin.provider");
  const reasons = useTranslations("verification.rejection");
  const errorText = useErrorText();
  const { formatDate } = useFormat();
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setSubmissions(await apiClient.adminVerificationQueue()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.verification.loadFailed")));
  }, [load]);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 max-w-3xl text-housing-muted">{t("intro")}</p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!submissions ? (
        !error && <p className="type-meta text-housing-muted">{t("loading")}</p>
      ) : submissions.length === 0 ? (
        <p className="type-meta text-housing-muted">{t("none")}</p>
      ) : (
        <ul className="grid gap-4">
          {submissions.map((s) => (
            <li key={s.id} className="grid gap-2 border border-housing-rule p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="type-h3">{s.companyName}</p>
                <span className={cn("type-board-sm", STATUS_CLASS[s.status])}>{status(s.status)}</span>
              </div>
              <p className="type-meta text-housing-muted">
                {t("line", { city: s.cityName, phone: s.contactPhone, day: formatDate(new Date(s.createdAt)), name: s.submittedBy ?? "" })}
              </p>
              <p className="type-board-md font-mono">{s.gstin}</p>
              {s.provider && <p className="type-meta">{t("providerSaid", { provider: s.provider.name, verdict: provider(s.provider.code as never, s.provider.params as never) })}</p>}
              {s.documents.length === 0 ? (
                <p className="type-meta text-housing-muted">{t("noDocuments")}</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {s.documents.map((d, i) => (
                    <li key={d.key}>
                      <a href={d.url} target="_blank" rel="noreferrer" className="type-meta underline underline-offset-4">
                        {t("document", { n: i + 1 })}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {s.history.length > 0 && <p className="type-meta text-housing-muted">{t("earlier", { count: s.history.length })}</p>}
              {s.status === "AWAITING_REVIEW" ? (
                <Decide submission={s} onDecided={load} />
              ) : (
                <p className="type-meta text-housing-muted">
                  {t("decided", { name: s.decidedBy ?? "", day: s.decidedAt ? formatDate(new Date(s.decidedAt)) : "" })}
                  {s.rejectionReason && ` ${reasons(s.rejectionReason)}`}
                  {s.decisionNote && ` ${t("noteSaid", { note: s.decisionNote })}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
