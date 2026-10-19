"use client";

import { type FormEvent, useState } from "react";
import { REPORT_REASONS } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

type Reason = (typeof REPORT_REASONS.DRIVE)[number];

// Open to anyone, signed in or not: the person most likely to spot a scam
// is someone who hasn't signed up. "website" is a field no person sees; a
// script that fills it is thanked and ignored.
export function ReportDrive({ driveId }: { driveId: string }) {
  const t = useTranslations("report.drive");
  const reasons = useTranslations("report.reason");
  const errorText = useErrorText();
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError(t("chooseReason"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.reportDrive(driveId, { reason, details: details.trim() || undefined, website: website || undefined });
      setSent(true);
    } catch (err) {
      setError(errorText(err, "report.drive.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="report" aria-labelledby="report-heading" className="grid gap-3 border border-housing-rule p-5 scroll-mt-6">
      <h2 id="report-heading" className="type-h3">
        {t("heading")}
      </h2>
      {sent ? (
        <p role="status" className="type-body">
          {t("thanks")}
        </p>
      ) : (
        <form onSubmit={send} noValidate className="grid gap-3">
          <p className="type-meta text-housing-muted">{t("intro")}</p>
          <fieldset className="grid gap-2">
            <legend className="type-meta text-housing-muted">{t("whatsWrong")}</legend>
            {REPORT_REASONS.DRIVE.map((r) => (
              <label key={r} className="type-body flex min-h-11 items-center gap-3 border border-housing-rule px-3">
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                {reasons(r)}
              </label>
            ))}
          </fieldset>
          <BoardField label={t("details")} hint={t("detailsHint")}>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              className="type-body w-full border border-housing-rule bg-housing-raised p-3 text-stock"
            />
          </BoardField>
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="absolute -left-[9999px] h-px w-px"
          />
          {error && (
            <p role="alert" className="type-meta text-closing-lamp">
              {error}
            </p>
          )}
          <div>
            <BoardButton type="submit" disabled={busy}>
              {busy ? t("sending") : t("send")}
            </BoardButton>
          </div>
        </form>
      )}
    </section>
  );
}
