"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminCompany, VerificationOutcome } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

const STATUS_CLASS: Record<AdminCompany["verificationStatus"], string> = {
  PENDING: "text-pending-lamp",
  VERIFIED: "text-live-lamp",
  REJECTED: "text-closing-lamp",
};

export default function VerificationPage() {
  const t = useTranslations("admin.companies");
  const status = useTranslations("admin.verificationStatus");
  const errorText = useErrorText();
  const { formatPaise } = useFormat();
  const [companies, setCompanies] = useState<AdminCompany[] | null>(null);
  const [last, setLast] = useState<VerificationOutcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setCompanies(await apiClient.adminCompanies()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.companies.loadFailed")));
  }, [load]);

  async function decide(company: AdminCompany, decision: "check" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      const given = prompt(t("rejectPrompt", { company: company.name }));
      if (given === null) return;
      reason = given.trim() || undefined;
    }
    setBusy(company.id);
    setError(null);
    try {
      setLast(await apiClient.adminVerifyCompany(company.id, { decision, reason }));
      await load();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      {last?.provider && (
        <p role="status" className="type-meta border-l-4 border-pending-lamp bg-housing-raised p-3">
          {t("providerSaid", { company: last.company.name, provider: last.provider.name, status: status(last.provider.status), reason: last.provider.reason })}
        </p>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!companies ? (
        <p role="status" className="type-meta text-housing-muted">
          {t("loading")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead>
              <tr className="type-meta border-b border-housing-rule text-housing-muted">
                <th className="py-2 pr-4 font-normal">{t("company")}</th>
                <th className="py-2 pr-4 font-normal">{t("gstin")}</th>
                <th className="py-2 pr-4 font-normal">{t("status")}</th>
                <th className="py-2 pr-4 text-right font-normal">{t("balance")}</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="type-meta border-b border-housing-line">
                  <td className="py-2 pr-4">
                    {c.name}
                    <span className="text-housing-muted">
                      {" "}
                      · {c.cityName} · {c.contactPhone}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono">{c.gstin ?? <span className="text-housing-muted">{t("noGstin")}</span>}</td>
                  <td className={cn("py-2 pr-4", STATUS_CLASS[c.verificationStatus])}>{status(c.verificationStatus)}</td>
                  <td className={cn("type-board-md py-2 pr-4 text-right", c.balancePaise < 0 && "text-closing-lamp")}>
                    {formatPaise(c.balancePaise)}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <BoardButton className="min-h-9 px-3" disabled={busy === c.id} onClick={() => decide(c, "check")}>
                        {t("check")}
                      </BoardButton>
                      <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === c.id} onClick={() => decide(c, "reject")}>
                        {t("reject")}
                      </BoardButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
