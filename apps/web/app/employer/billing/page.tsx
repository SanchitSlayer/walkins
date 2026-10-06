"use client";

import { useCallback, useEffect, useState } from "react";
import {
  dayLabel,
  formatPaise,
  formatTime,
  type LedgerEntryView,
  MAX_TOP_UP_PAISE,
  MIN_TOP_UP_PAISE,
  type TopUpOrder,
  type Wallet,
} from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { cn } from "@/lib/utils";

const PRESETS_RUPEES = [1_000, 5_000, 10_000];

const REASON: Record<LedgerEntryView["reason"], string> = {
  TOP_UP: "Top-up",
  CHECK_IN_CHARGE: "Verified check-in",
  PROMO_GRANT: "Launch credit",
};

type RazorpayResponse = { razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCheckout = { open: () => void; on: (event: string, handler: (r: { error: { description: string } }) => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay's checkout couldn't be loaded. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

// What the mock gateway puts where Razorpay's checkout window would be, so a
// demo needs no network. Both outcomes go through the same signed webhook and
// confirmation as a real payment.
function MockCheckout({ order, onDone }: { order: TopUpOrder; onDone: (outcome: "success" | "failure" | "cancel") => void }) {
  return (
    <div className="grid gap-3 border-l-4 border-pending-lamp bg-housing-raised p-4">
      <p className="type-meta text-housing-muted">Mock payment gateway: no money moves and nothing leaves this machine.</p>
      <p className="type-body">
        Pay <span className="type-board-md">{formatPaise(order.amountPaise)}</span> to Walkins
      </p>
      <div className="flex flex-wrap gap-3">
        <BoardButton onClick={() => onDone("success")}>Pay</BoardButton>
        <BoardButton variant="quiet" onClick={() => onDone("failure")}>
          Decline the payment
        </BoardButton>
        <BoardButton variant="quiet" onClick={() => onDone("cancel")}>
          Cancel
        </BoardButton>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rupees, setRupees] = useState("5000");
  const [order, setOrder] = useState<TopUpOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWallet(await apiClient.getWallet());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your balance");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function finish(orderId: string, paymentId: string, signature: string) {
    const status = await apiClient.confirmTopUp(orderId, paymentId, signature);
    setOrder(null);
    if (status.status === "CAPTURED") setNotice(`Payment received. Your balance is ${formatPaise(status.balancePaise)}.`);
    else if (status.status === "FAILED") setError(status.failureReason ?? "The payment failed. Nothing was charged.");
    else setNotice("Payment received; it will show in your balance once the payment gateway confirms it.");
    await load();
  }

  async function startTopUp() {
    const amountPaise = Math.round(Number(rupees)) * 100;
    setError(null);
    setNotice(null);
    if (!Number.isInteger(amountPaise) || amountPaise < MIN_TOP_UP_PAISE || amountPaise > MAX_TOP_UP_PAISE) {
      setError(`Top up between ${formatPaise(MIN_TOP_UP_PAISE)} and ${formatPaise(MAX_TOP_UP_PAISE)}.`);
      return;
    }
    setBusy(true);
    try {
      const created = await apiClient.createTopUp(amountPaise);
      if (created.gateway === "mock") {
        setOrder(created);
        return;
      }
      await loadRazorpay();
      const checkout = new window.Razorpay!({
        key: created.keyId,
        order_id: created.gatewayOrderId,
        amount: created.amountPaise,
        currency: created.currency,
        name: "Walkins",
        description: "Wallet top-up",
        handler: (response: RazorpayResponse) =>
          finish(created.orderId, response.razorpay_payment_id, response.razorpay_signature).catch((err) =>
            setError(err instanceof Error ? err.message : "Couldn't confirm the payment"),
          ),
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.on("payment.failed", (r) => setError(`The payment failed: ${r.error.description}`));
      checkout.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the top-up");
    } finally {
      setBusy(false);
    }
  }

  async function mockDone(outcome: "success" | "failure" | "cancel") {
    if (!order) return;
    if (outcome === "cancel") {
      setOrder(null);
      return;
    }
    setBusy(true);
    try {
      const paid = await apiClient.mockCheckout(order.orderId, outcome);
      await finish(order.orderId, paid.gatewayPaymentId, paid.signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete the payment");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <p role="status" className="type-meta text-housing-muted">
        {error ?? "Loading your balance"}
      </p>
    );
  }

  const now = new Date();
  const price = wallet.pricePerCheckInPaise;

  return (
    <div className="grid gap-8">
      <h1 className="type-h2">Billing</h1>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <h2 className="type-meta text-housing-muted">Balance</h2>
          <p className={cn("type-board-lg", wallet.balancePaise < 0 && "text-closing-lamp")}>{formatPaise(wallet.balancePaise)}</p>
          {price !== null && (
            <p className="type-meta text-housing-muted">
              {formatPaise(price)} per verified check-in. You are charged only when someone actually arrives: a scan
              inside the venue&apos;s geofence, a walk-in, someone you mark present, or a flagged check-in once you
              confirm it. Applications and alerts are free.
            </p>
          )}
          {!wallet.canGoLive && (
            <p role="alert" className="type-meta border-l-4 border-closing-lamp bg-housing-raised p-3 text-stock">
              {wallet.balancePaise < 0
                ? `Your balance is ${formatPaise(wallet.balancePaise)}: check-ins at live drives were recorded and charged after it ran out.`
                : `Your balance is below the ${formatPaise(price ?? 0)} cost of one check-in.`}{" "}
              New drives can&apos;t go live until you top up. Drives already live keep running.
            </p>
          )}
        </div>

        <div className="grid content-start gap-3 border border-housing-rule p-4">
          <h2 className="type-h3">Top up</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS_RUPEES.map((preset) => (
              <BoardButton
                key={preset}
                variant={rupees === String(preset) ? "primary" : "quiet"}
                className="min-h-9 px-3"
                onClick={() => setRupees(String(preset))}
                disabled={busy || !!order}
              >
                {formatPaise(preset * 100)}
              </BoardButton>
            ))}
          </div>
          <BoardField label="Amount (₹, whole rupees)">
            <BoardInput
              board
              type="number"
              inputMode="numeric"
              min={MIN_TOP_UP_PAISE / 100}
              max={MAX_TOP_UP_PAISE / 100}
              step={1}
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              disabled={busy || !!order}
            />
          </BoardField>
          {order ? (
            <MockCheckout order={order} onDone={mockDone} />
          ) : (
            <div>
              <BoardButton onClick={startTopUp} disabled={busy}>
                {busy ? "Opening checkout" : "Continue to payment"}
              </BoardButton>
            </div>
          )}
          {notice && (
            <p role="status" className="type-meta text-live-lamp">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="type-meta text-closing-lamp">
              {error}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="statement-heading" className="grid gap-3">
        <h2 id="statement-heading" className="type-h3">
          Statement
        </h2>
        {wallet.entries.length === 0 ? (
          <p className="type-body text-housing-muted">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="type-meta border-b border-housing-rule text-housing-muted">
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">What</th>
                  <th className="py-2 pr-4 font-normal">Reference</th>
                  <th className="py-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {wallet.entries.map((entry) => {
                  const credit = entry.direction === "CREDIT";
                  return (
                    <tr key={entry.id} className="type-meta border-b border-housing-line">
                      <td className="whitespace-nowrap py-2 pr-4">
                        {dayLabel(new Date(entry.createdAt), now)}, {formatTime(entry.createdAt)}
                      </td>
                      <td className="py-2 pr-4">{REASON[entry.reason]}</td>
                      <td className="py-2 pr-4 font-mono text-housing-muted">{entry.refId ?? "—"}</td>
                      <td className={cn("type-board-md whitespace-nowrap py-2 text-right", credit ? "text-live-lamp" : "text-stock")}>
                        {credit ? "+" : "−"}
                        {formatPaise(entry.amountPaise)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
