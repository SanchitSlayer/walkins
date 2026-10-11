"use client";

import { useCallback, useEffect, useState } from "react";
import type { LedgerExplorer, PricingRuleView } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

function Pricing() {
  const t = useTranslations("admin.pricing");
  const errorText = useErrorText();
  const { dayLabel, formatPaise, formatTime } = useFormat();
  const [rules, setRules] = useState<PricingRuleView[] | null>(null);
  const [rupees, setRupees] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRules(await apiClient.adminPricing()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.pricing.loadFailed")));
  }, [load]);

  async function add() {
    const pricePaise = Math.round(Number(rupees) * 100);
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 || rupees.trim() === "") {
      setError(t("enterPrice"));
      return;
    }
    if (!confirm(t("confirm", { price: formatPaise(pricePaise) }))) return;
    setError(null);
    try {
      await apiClient.adminCreatePricing({ pricePaise });
      setRupees("");
      await load();
    } catch (err) {
      setError(errorText(err, "admin.pricing.setFailed"));
    }
  }

  const now = new Date();
  return (
    <section aria-labelledby="pricing-heading" className="grid gap-3">
      <h2 id="pricing-heading" className="type-h3">
        {t("heading")}
      </h2>
      <p className="type-meta text-housing-muted">{t("intro")}</p>
      <ul className="type-meta grid">
        {rules?.map((r, i) => (
          <li key={r.id} className="flex gap-4 border-b border-housing-line py-1.5">
            <span className="type-board-md w-24">{formatPaise(r.pricePaise)}</span>
            <span className="text-housing-muted">
              {t("from", {
                day: dayLabel(new Date(r.effectiveFrom), now),
                time: formatTime(r.effectiveFrom),
                current: i === 0 && new Date(r.effectiveFrom) <= now ? "yes" : "no",
              })}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <BoardField label={t("newPrice")} className="w-40">
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.01} value={rupees} onChange={(e) => setRupees(e.target.value)} />
        </BoardField>
        <BoardButton onClick={add}>{t("set")}</BoardButton>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
    </section>
  );
}

export default function LedgerPage() {
  const t = useTranslations("admin.ledger");
  const errorText = useErrorText();
  const { dayLabel, formatPaise, formatTime } = useFormat();
  const [data, setData] = useState<LedgerExplorer | null>(null);
  const [filter, setFilter] = useState<{ accountId?: string; txnId?: string }>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .adminLedger(filter)
      .then(setData)
      .catch((err) => setError(errorText(err, "admin.ledger.loadFailed")));
  }, [filter]);

  const now = new Date();
  const accounts = new Map(data?.accounts.map((a) => [a.accountId, a]));
  // Platform accounts are named by their role (revenue, gateway, promotions).
  const accountLabel = (a: LedgerExplorer["accounts"][number] | undefined) =>
    a && (a.ownerType === "PLATFORM" ? t("platformAccount", { name: a.ownerName }) : a.ownerName);
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className={cn("type-meta", data.unbalancedTxnCount === 0 ? "text-live-lamp" : "text-closing-lamp")}>
            {data.unbalancedTxnCount === 0 ? t("balanced") : t("unbalanced", { count: data.unbalancedTxnCount })}
          </p>

          <section aria-labelledby="accounts-heading" className="grid gap-2">
            <h2 id="accounts-heading" className="type-h3">
              {t("accounts")}
            </h2>
            <table className="w-full border-collapse text-left">
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.accountId} className={cn("type-meta border-b border-housing-line", filter.accountId === a.accountId && "bg-housing-raised")}>
                    <td className="py-1.5 pr-4">
                      <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setFilter({ accountId: a.accountId })}>
                        {accountLabel(a)}
                      </button>
                    </td>
                    <td className="py-1.5 pr-4 text-housing-muted">{a.currency}</td>
                    <td className={cn("type-board-md py-1.5 text-right", a.balancePaise < 0 && "text-housing-muted")}>{formatPaise(a.balancePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="entries-heading" className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="entries-heading" className="type-h3">
                {t("entries")}
              </h2>
              {(filter.accountId || filter.txnId) && (
                <BoardButton variant="quiet" className="min-h-9 px-3" onClick={() => setFilter({})}>
                  {filter.txnId ? t("showAllTxn", { txn: filter.txnId }) : t("showAllAccount")}
                </BoardButton>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-left">
                <thead>
                  <tr className="type-meta border-b border-housing-rule text-housing-muted">
                    <th className="py-2 pr-4 font-normal">{t("when")}</th>
                    <th className="py-2 pr-4 font-normal">{t("transaction")}</th>
                    <th className="py-2 pr-4 font-normal">{t("account")}</th>
                    <th className="py-2 pr-4 font-normal">{t("reason")}</th>
                    <th className="py-2 pr-4 text-right font-normal">{t("debit")}</th>
                    <th className="py-2 text-right font-normal">{t("credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id} className="type-meta border-b border-housing-line">
                      <td className="whitespace-nowrap py-1.5 pr-4">
                        {t("at", { day: dayLabel(new Date(e.createdAt), now), time: formatTime(e.createdAt) })}
                      </td>
                      <td className="py-1.5 pr-4 font-mono">
                        <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setFilter({ txnId: e.txnId })}>
                          {e.txnId}
                        </button>
                      </td>
                      <td className="py-1.5 pr-4">{accountLabel(accounts.get(e.accountId)) ?? e.accountName}</td>
                      <td className="py-1.5 pr-4 text-housing-muted">{t(`reasons.${e.reason}`)}</td>
                      <td className="type-board-md py-1.5 pr-4 text-right">{e.direction === "DEBIT" ? formatPaise(e.amountPaise) : ""}</td>
                      <td className="type-board-md py-1.5 text-right">{e.direction === "CREDIT" ? formatPaise(e.amountPaise) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <Pricing />
    </div>
  );
}
