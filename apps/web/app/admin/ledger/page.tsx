"use client";

import { useCallback, useEffect, useState } from "react";
import { dayLabel, formatPaise, formatTime, type LedgerExplorer, type PricingRuleView } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { cn } from "@/lib/utils";

function Pricing() {
  const [rules, setRules] = useState<PricingRuleView[] | null>(null);
  const [rupees, setRupees] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRules(await apiClient.adminPricing()), []);
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Couldn't load prices"));
  }, [load]);

  async function add() {
    const pricePaise = Math.round(Number(rupees) * 100);
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 || rupees.trim() === "") {
      setError("Enter a price in rupees");
      return;
    }
    if (!confirm(`Charge ${formatPaise(pricePaise)} per verified check-in from now on? Earlier check-ins keep the price they had.`)) return;
    setError(null);
    try {
      await apiClient.adminCreatePricing({ pricePaise });
      setRupees("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the price");
    }
  }

  const now = new Date();
  return (
    <section aria-labelledby="pricing-heading" className="grid gap-3">
      <h2 id="pricing-heading" className="type-h3">
        Price per verified check-in
      </h2>
      <p className="type-meta text-housing-muted">
        Prices are rows, never edits: a new price takes effect from now and every check-in is charged at the price in
        effect when the person arrived.
      </p>
      <ul className="type-meta grid">
        {rules?.map((r, i) => (
          <li key={r.id} className="flex gap-4 border-b border-housing-line py-1.5">
            <span className="type-board-md w-24">{formatPaise(r.pricePaise)}</span>
            <span className="text-housing-muted">
              from {dayLabel(new Date(r.effectiveFrom), now)}, {formatTime(r.effectiveFrom)}
              {i === 0 && new Date(r.effectiveFrom) <= now ? " · current" : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <BoardField label="New price (₹)" className="w-40">
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.01} value={rupees} onChange={(e) => setRupees(e.target.value)} />
        </BoardField>
        <BoardButton onClick={add}>Set price</BoardButton>
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
  const [data, setData] = useState<LedgerExplorer | null>(null);
  const [filter, setFilter] = useState<{ accountId?: string; txnId?: string }>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .adminLedger(filter)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the ledger"));
  }, [filter]);

  const now = new Date();
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">Ledger</h1>
        <p className="type-meta mt-1 text-housing-muted">
          Append-only and double-entry: every transaction&apos;s debits equal its credits, which the database checks on
          commit. Balance is always credits minus debits, so platform accounts that hold money read negative.
        </p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className={cn("type-meta", data.unbalancedTxnCount === 0 ? "text-live-lamp" : "text-closing-lamp")}>
            {data.unbalancedTxnCount === 0
              ? "Every transaction balances."
              : `${data.unbalancedTxnCount} transactions don't balance. This should be impossible; investigate before anything else.`}
          </p>

          <section aria-labelledby="accounts-heading" className="grid gap-2">
            <h2 id="accounts-heading" className="type-h3">
              Accounts
            </h2>
            <table className="w-full border-collapse text-left">
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.accountId} className={cn("type-meta border-b border-housing-line", filter.accountId === a.accountId && "bg-housing-raised")}>
                    <td className="py-1.5 pr-4">
                      <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setFilter({ accountId: a.accountId })}>
                        {a.ownerName}
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
                Entries
              </h2>
              {(filter.accountId || filter.txnId) && (
                <BoardButton variant="quiet" className="min-h-9 px-3" onClick={() => setFilter({})}>
                  Show all ({filter.txnId ? `transaction ${filter.txnId}` : "one account"} shown)
                </BoardButton>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-left">
                <thead>
                  <tr className="type-meta border-b border-housing-rule text-housing-muted">
                    <th className="py-2 pr-4 font-normal">When</th>
                    <th className="py-2 pr-4 font-normal">Transaction</th>
                    <th className="py-2 pr-4 font-normal">Account</th>
                    <th className="py-2 pr-4 font-normal">Reason</th>
                    <th className="py-2 pr-4 text-right font-normal">Debit</th>
                    <th className="py-2 text-right font-normal">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id} className="type-meta border-b border-housing-line">
                      <td className="whitespace-nowrap py-1.5 pr-4">
                        {dayLabel(new Date(e.createdAt), now)}, {formatTime(e.createdAt)}
                      </td>
                      <td className="py-1.5 pr-4 font-mono">
                        <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setFilter({ txnId: e.txnId })}>
                          {e.txnId}
                        </button>
                      </td>
                      <td className="py-1.5 pr-4">{e.accountName}</td>
                      <td className="py-1.5 pr-4 text-housing-muted">{e.reason.toLowerCase().replace(/_/g, " ")}</td>
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
