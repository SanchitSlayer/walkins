"use client";

import { useEffect, useState } from "react";
import { type AdminRetention, OUTCOME_MIN_RECORDED } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { RetentionTable } from "@/components/outcome-figures";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

// Thirty-day retention by employer, across the platform, with the same
// coverage rules employers see for their own roles.
export default function RetentionPage() {
  const t = useTranslations("admin.retention");
  const errorText = useErrorText();
  const { formatTime } = useFormat();
  const [data, setData] = useState<AdminRetention | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.adminRetention().then(setData, (err) => setError(errorText(err, "admin.retention.loadFailed")));
  }, []);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 max-w-3xl text-housing-muted">{t("intro", { min: OUTCOME_MIN_RECORDED })}</p>
        {data?.refreshedAt && <p className="type-meta text-housing-muted">{t("refreshed", { time: formatTime(data.refreshedAt) })}</p>}
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {data && <RetentionTable rows={data.byEmployer} keyHeading={t("employer")} />}
    </div>
  );
}
