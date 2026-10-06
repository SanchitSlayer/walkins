import { type LedgerDirection, type LedgerOwnerType, type LedgerReason, Prisma, type PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// Platform accounts, named by ownerId. Under the one rule that every balance
// is credits minus debits, accounts holding money for the platform read
// negative: gateway is money received through the payment gateway,
// promotions is credit the platform has given away.
export const PLATFORM_ACCOUNT = {
  revenue: "revenue",
  gateway: "gateway",
  promotions: "promotions",
} as const;

export const CHECK_IN_PRICE_EVENT = "CHECK_IN_VERIFIED";

export type Leg = { accountId: string; direction: LedgerDirection; amountPaise: number };

export class UnbalancedTransactionError extends Error {
  name = "UnbalancedTransactionError";
}

// Sums come back from Postgres as bigint, which JSON can't carry. Paise above
// 2^53 would lose precision as a JS number, so they are refused rather than
// rounded.
export function toPaise(value: bigint | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${value} paise is outside the range this system handles exactly`);
  return n;
}

export async function ledgerAccount(db: Db, ownerType: LedgerOwnerType, ownerId: string, currency = "INR"): Promise<string> {
  const account = await db.ledgerAccount.upsert({
    where: { ownerType_ownerId_currency: { ownerType, ownerId, currency } },
    create: { ownerType, ownerId, currency },
    update: {},
    select: { id: true },
  });
  return account.id;
}

// The database checks balance and append-only on its own; checking here too
// gives a readable error before the commit-time trigger gives a generic one.
// Returns false when txnId was already posted, which is how a retried charge
// or a repeated webhook becomes a no-op.
export async function postTransaction(
  tx: Prisma.TransactionClient,
  input: { txnId: string; reason: LedgerReason; refType?: string; refId?: string; legs: Leg[] },
): Promise<boolean> {
  for (const leg of input.legs) {
    if (!Number.isSafeInteger(leg.amountPaise) || leg.amountPaise <= 0) {
      throw new UnbalancedTransactionError(`${input.txnId}: ${leg.amountPaise} is not a positive whole number of paise`);
    }
  }
  const total = (direction: LedgerDirection) =>
    input.legs.filter((l) => l.direction === direction).reduce((sum, l) => sum + l.amountPaise, 0);
  if (total("DEBIT") !== total("CREDIT")) {
    throw new UnbalancedTransactionError(`${input.txnId}: debits ${total("DEBIT")} paise, credits ${total("CREDIT")} paise`);
  }

  if (await tx.ledgerEntry.findFirst({ where: { txnId: input.txnId }, select: { id: true } })) return false;
  await tx.ledgerEntry.createMany({
    data: input.legs.map((leg) => ({
      txnId: input.txnId,
      accountId: leg.accountId,
      direction: leg.direction,
      amountPaise: leg.amountPaise,
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
    })),
  });
  // The balance trigger is deferred to commit, and Prisma's interactive
  // transactions don't report an error raised at COMMIT: the rows are rolled
  // back, but the call resolves as if it succeeded. Checking now turns a
  // violation into an ordinary error inside the transaction, which Prisma
  // does report (see test/ledger.test.ts).
  await tx.$executeRaw`SET CONSTRAINTS "ledger_entries_balanced" IMMEDIATE`;
  return true;
}

// Two writers racing on the same txnId: the loser's insert hits the unique
// index, which aborts its transaction, so callers check for this outside it.
export function isDuplicatePosting(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function balanceOf(db: Db, accountId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ balancePaise: bigint }[]>`
    SELECT "balancePaise" FROM ledger_balances WHERE "accountId" = ${accountId}
  `;
  return row ? toPaise(row.balancePaise) : 0;
}

export async function companyBalance(db: Db, companyId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ balancePaise: bigint }[]>`
    SELECT "balancePaise" FROM ledger_balances WHERE "ownerType" = 'COMPANY' AND "ownerId" = ${companyId} AND currency = 'INR'
  `;
  return row ? toPaise(row.balancePaise) : 0;
}

// The price in effect at a moment, so a charge made late still uses the price
// from when the show-up happened.
export async function priceAt(db: Db, event: string, at: Date): Promise<number | null> {
  const rule = await db.pricingRule.findFirst({
    where: { event, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
    select: { pricePaise: true },
  });
  return rule?.pricePaise ?? null;
}
