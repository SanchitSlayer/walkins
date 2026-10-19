"use client";

import { type ChangeEvent, type FormEvent, useState } from "react";
import { submitVerificationSchema, VERIFICATION_DOCUMENT_MAX_BYTES, VERIFICATION_DOCUMENT_TYPES, VERIFICATION_DOCUMENTS_MAX } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useMembership } from "@/lib/membership";
import { useStanding } from "@/lib/standing";
import { useErrorText, useIssueText } from "@/lib/use-error-text";

type Document = { name: string; key: string };

function SubmitForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const t = useTranslations("verification.form");
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [gstin, setGstin] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setError(null);
    const tooLarge = files.find((f) => f.size > VERIFICATION_DOCUMENT_MAX_BYTES);
    if (tooLarge) {
      setError(t("tooLarge", { name: tooLarge.name }));
      return;
    }
    setUploading(true);
    try {
      for (const file of files.slice(0, VERIFICATION_DOCUMENTS_MAX - documents.length)) {
        const key = await apiClient.uploadVerificationDocument(file);
        setDocuments((current) => [...current, { name: file.name, key }]);
      }
    } catch (err) {
      setError(errorText(err, "verification.form.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = submitVerificationSchema.safeParse({ gstin, documentKeys: documents.map((d) => d.key) });
    if (!parsed.success) {
      setError(issueText(parsed.error.errors[0]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.submitVerification(parsed.data);
      await onSubmitted();
    } catch (err) {
      setError(errorText(err, "verification.form.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-xl gap-4 border border-housing-rule p-4">
      <h2 className="type-h3">{t("heading")}</h2>
      <BoardField label={t("gstin")} hint={t("gstinHint")}>
        <BoardInput board value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} autoCapitalize="characters" autoComplete="off" className="uppercase" />
      </BoardField>
      <BoardField label={t("documents")} hint={t("documentsHint", { max: VERIFICATION_DOCUMENTS_MAX })}>
        <input
          type="file"
          accept={VERIFICATION_DOCUMENT_TYPES.join(",")}
          multiple
          onChange={add}
          disabled={uploading || documents.length >= VERIFICATION_DOCUMENTS_MAX}
          className="type-meta"
        />
      </BoardField>
      {documents.length > 0 && (
        <ul className="grid gap-1">
          {documents.map((d) => (
            <li key={d.key} className="type-meta flex flex-wrap items-center gap-3">
              <span>{d.name}</span>
              <button type="button" className="underline underline-offset-4" onClick={() => setDocuments((current) => current.filter((x) => x.key !== d.key))}>
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading && <p className="type-meta text-housing-muted">{t("uploading")}</p>}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div>
        <BoardButton type="submit" disabled={busy || uploading}>
          {busy ? t("sending") : t("send")}
        </BoardButton>
      </div>
    </form>
  );
}

export default function VerificationPage() {
  const t = useTranslations("verification");
  const { formatDate } = useFormat();
  const { can, membership } = useMembership();
  const { standing, reload } = useStanding();

  if (!standing) return <p className="type-meta text-housing-muted">{t("loading")}</p>;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-board-md mt-2">{t(`status.${standing.verificationStatus}`, { company: membership.company.name })}</p>
        <p className="type-body mt-2 max-w-2xl text-housing-muted">{t(`explain.${standing.verificationStatus}`)}</p>
        <p className="type-meta mt-2 max-w-2xl text-housing-muted">{t("howChecked")}</p>
      </div>

      {standing.canSubmit && !standing.suspended && (can("manageCompany") ? <SubmitForm onSubmitted={reload} /> : <p className="type-meta text-housing-muted">{t("ownerOnly")}</p>)}

      {standing.submissions.length > 0 && (
        <section aria-labelledby="history-heading" className="grid gap-2">
          <h2 id="history-heading" className="type-h3">
            {t("history")}
          </h2>
          <ul className="border-t border-housing-line">
            {standing.submissions.map((s) => (
              <li key={s.id} className="grid gap-1 border-b border-housing-line py-3">
                <p className="type-body">
                  {t(`submission.${s.status}`)} <span className="type-board-sm text-housing-muted">{s.gstin}</span>
                </p>
                <p className="type-meta text-housing-muted">
                  {t("sentLine", { day: formatDate(new Date(s.createdAt)), name: s.submittedBy ?? "", documents: s.documentCount })}
                </p>
                {s.rejectionReason && <p className="type-meta">{t(`rejection.${s.rejectionReason}`)}</p>}
                {s.decisionNote && <p className="type-meta">{t("reviewerNote", { note: s.decisionNote })}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
