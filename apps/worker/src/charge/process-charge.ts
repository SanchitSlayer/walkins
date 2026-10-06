import { UnrecoverableError } from "bullmq";
import {
  CHECK_IN_PRICE_EVENT,
  isDuplicatePosting,
  ledgerAccount,
  PLATFORM_ACCOUNT,
  postTransaction,
  priceAt,
  prisma,
} from "@walkins/db";
import { type ChargeJob, formatPaise } from "@walkins/shared";

// One verified show-up, one charge: the company's wallet is debited and the
// platform's revenue credited, at the price in effect when the person
// arrived. The txnId is the check-in's, so a retry, a redelivered job or the
// sweep re-queueing it can never charge twice. The wallet may go negative
// here: the show-up happened and is owed, and refusing to record it would let
// a billing state reach the person at the gate.
export async function processCharge({ data }: { data: ChargeJob }): Promise<string> {
  const checkIn = await prisma.checkIn.findUnique({
    where: { id: data.checkInId },
    include: { application: { select: { drive: { select: { companyId: true } } } } },
  });
  if (!checkIn) return "check-in no longer exists";
  if (!checkIn.isValid) return "not charged: waiting for the employer to confirm it";

  const price = await priceAt(prisma, CHECK_IN_PRICE_EVENT, checkIn.scannedAt);
  if (price === null) {
    const first = await prisma.pricingRule.findFirst({ where: { event: CHECK_IN_PRICE_EVENT }, orderBy: { effectiveFrom: "asc" } });
    if (first && first.effectiveFrom > checkIn.scannedAt) return "not charged: the check-in predates billing";
    throw new UnrecoverableError(`No ${CHECK_IN_PRICE_EVENT} price is in effect at ${checkIn.scannedAt.toISOString()}`);
  }
  if (price === 0) return "not charged: check-ins were free at the time";

  const companyId = checkIn.application.drive.companyId;
  try {
    const posted = await prisma.$transaction(async (tx) =>
      postTransaction(tx, {
        txnId: `charge:checkin:${checkIn.id}`,
        reason: "CHECK_IN_CHARGE",
        refType: "check_in",
        refId: checkIn.id,
        legs: [
          { accountId: await ledgerAccount(tx, "COMPANY", companyId), direction: "DEBIT", amountPaise: price },
          { accountId: await ledgerAccount(tx, "PLATFORM", PLATFORM_ACCOUNT.revenue), direction: "CREDIT", amountPaise: price },
        ],
      }),
    );
    return posted ? `charged ${formatPaise(price)}` : "already charged";
  } catch (err) {
    if (isDuplicatePosting(err)) return "already charged";
    throw err;
  }
}
