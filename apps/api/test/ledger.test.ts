import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceOf, ledgerAccount, postTransaction, type Prisma, prisma, UnbalancedTransactionError } from "@walkins/db";

// These go straight at the database with raw SQL, past every check in
// application code, to prove the rules hold on their own. They run against
// the test database (test/setup.ts): ledger rows can never be deleted.
const run = randomUUID().slice(0, 8);
let a: string;
let b: string;
let c: string;
let usd: string;

function entry(tx: Prisma.TransactionClient, txnId: string, accountId: string, direction: "DEBIT" | "CREDIT", amountPaise: number) {
  return tx.$executeRaw`
    INSERT INTO ledger_entries (id, "txnId", "accountId", direction, "amountPaise", reason)
    VALUES (${randomUUID()}, ${txnId}, ${accountId}, ${direction}::"LedgerDirection", ${amountPaise}, 'PROMO_GRANT')
  `;
}

// Fires the deferred balance trigger now instead of at COMMIT, as
// postTransaction does, so its error reaches the caller.
function checkNow(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SET CONSTRAINTS "ledger_entries_balanced" IMMEDIATE`;
}

async function entriesFor(txnId: string) {
  return prisma.ledgerEntry.count({ where: { txnId } });
}

beforeAll(async () => {
  a = await ledgerAccount(prisma, "PLATFORM", `test-${run}-a`);
  b = await ledgerAccount(prisma, "PLATFORM", `test-${run}-b`);
  c = await ledgerAccount(prisma, "PLATFORM", `test-${run}-c`);
  usd = await ledgerAccount(prisma, "PLATFORM", `test-${run}-usd`, "USD");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the database's ledger rules", () => {
  it("rejects an unbalanced transaction and keeps none of it", async () => {
    const txnId = `test:${run}:unbalanced`;
    await expect(
      prisma.$transaction(async (tx) => {
        await entry(tx, txnId, a, "DEBIT", 500);
        await checkNow(tx);
      }),
    ).rejects.toThrow(/unbalanced: debits 500 paise, credits 0 paise/);
    expect(await entriesFor(txnId)).toBe(0);

    await expect(
      prisma.$transaction(async (tx) => {
        await entry(tx, txnId, a, "DEBIT", 500);
        await entry(tx, txnId, b, "CREDIT", 499);
        await checkNow(tx);
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await entriesFor(txnId)).toBe(0);
  });

  // Pins down the Prisma behaviour postTransaction works around. Left to
  // commit, the database still refuses the write, but Prisma reports
  // success. If a Prisma upgrade starts reporting it, this test fails, and
  // the workaround can be reconsidered.
  it("still refuses an unbalanced write left to commit, though Prisma reports success", async () => {
    const txnId = `test:${run}:at-commit`;
    await expect(prisma.$transaction(async (tx) => entry(tx, txnId, a, "DEBIT", 500))).resolves.toBe(1);
    expect(await entriesFor(txnId)).toBe(0);
  });

  it("accepts a balanced transaction, and computes balance as credits minus debits", async () => {
    const before = [await balanceOf(prisma, a), await balanceOf(prisma, b)];
    const txnId = `test:${run}:balanced`;
    await prisma.$transaction(async (tx) => {
      await entry(tx, txnId, a, "DEBIT", 1_250);
      await entry(tx, txnId, b, "CREDIT", 1_000);
      await entry(tx, txnId, c, "CREDIT", 250);
      await checkNow(tx);
    });
    expect(await entriesFor(txnId)).toBe(3);
    expect(await balanceOf(prisma, a)).toBe(before[0] - 1_250);
    expect(await balanceOf(prisma, b)).toBe(before[1] + 1_000);
  });

  it("rejects a later unbalanced leg added to a transaction that already balanced", async () => {
    const txnId = `test:${run}:extended`;
    await prisma.$transaction(async (tx) => {
      await entry(tx, txnId, a, "DEBIT", 300);
      await entry(tx, txnId, b, "CREDIT", 300);
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await entry(tx, txnId, c, "CREDIT", 50);
        await checkNow(tx);
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await entriesFor(txnId)).toBe(2);
  });

  it("refuses to update, delete or truncate an entry", async () => {
    const txnId = `test:${run}:immutable`;
    await prisma.$transaction(async (tx) => {
      await entry(tx, txnId, a, "DEBIT", 700);
      await entry(tx, txnId, b, "CREDIT", 700);
    });
    await expect(prisma.$executeRaw`UPDATE ledger_entries SET "amountPaise" = 1 WHERE "txnId" = ${txnId}`).rejects.toThrow(
      /ledger_entries is append-only: UPDATE is not allowed/,
    );
    await expect(prisma.$executeRaw`DELETE FROM ledger_entries WHERE "txnId" = ${txnId}`).rejects.toThrow(
      /ledger_entries is append-only: DELETE is not allowed/,
    );
    await expect(prisma.$executeRaw`TRUNCATE ledger_entries`).rejects.toThrow(/append-only: TRUNCATE is not allowed/);
    await expect(prisma.ledgerEntry.deleteMany({ where: { txnId } })).rejects.toThrow(/append-only/);
    expect(await entriesFor(txnId)).toBe(2);
  });

  it("holds accounts and prices to the same rule", async () => {
    await expect(prisma.$executeRaw`UPDATE ledger_accounts SET currency = 'USD' WHERE id = ${a}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE pricing_rules SET "pricePaise" = 1`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM pricing_rules`).rejects.toThrow(/append-only/);
  });

  it("rejects zero, negative and fractional amounts", async () => {
    const txnId = `test:${run}:amounts`;
    await expect(prisma.$transaction(async (tx) => entry(tx, txnId, a, "DEBIT", 0))).rejects.toThrow(/ledger_entries_amount_positive/);
    await expect(prisma.$transaction(async (tx) => entry(tx, txnId, a, "DEBIT", -5))).rejects.toThrow(/ledger_entries_amount_positive/);
    await expect(
      prisma.$executeRaw`INSERT INTO ledger_entries (id, "txnId", "accountId", direction, "amountPaise", reason)
        VALUES (${randomUUID()}, ${txnId}, ${a}, 'DEBIT', 10.5, 'PROMO_GRANT')`,
    ).rejects.toThrow();
    expect(await entriesFor(txnId)).toBe(0);
  });

  it("rejects a transaction that mixes currencies even when the numbers balance", async () => {
    const txnId = `test:${run}:currencies`;
    await expect(
      prisma.$transaction(async (tx) => {
        await entry(tx, txnId, a, "DEBIT", 100);
        await entry(tx, txnId, usd, "CREDIT", 100);
        await checkNow(tx);
      }),
    ).rejects.toThrow(/mixes currencies/);
    expect(await entriesFor(txnId)).toBe(0);
  });
});

describe("postTransaction", () => {
  it("posts once per txnId and reports a repeat as already posted", async () => {
    const txnId = `test:${run}:once`;
    const legs = [
      { accountId: a, direction: "DEBIT" as const, amountPaise: 200 },
      { accountId: b, direction: "CREDIT" as const, amountPaise: 200 },
    ];
    await expect(prisma.$transaction((tx) => postTransaction(tx, { txnId, reason: "PROMO_GRANT", legs }))).resolves.toBe(true);
    await expect(prisma.$transaction((tx) => postTransaction(tx, { txnId, reason: "PROMO_GRANT", legs }))).resolves.toBe(false);
    expect(await entriesFor(txnId)).toBe(2);
  });

  it("refuses unbalanced legs and non-integer paise before reaching the database", async () => {
    const txnId = `test:${run}:guard`;
    await expect(
      prisma.$transaction((tx) =>
        postTransaction(tx, {
          txnId,
          reason: "PROMO_GRANT",
          legs: [
            { accountId: a, direction: "DEBIT", amountPaise: 100 },
            { accountId: b, direction: "CREDIT", amountPaise: 99 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(UnbalancedTransactionError);
    await expect(
      prisma.$transaction((tx) =>
        postTransaction(tx, {
          txnId,
          reason: "PROMO_GRANT",
          legs: [
            { accountId: a, direction: "DEBIT", amountPaise: 99.5 },
            { accountId: b, direction: "CREDIT", amountPaise: 99.5 },
          ],
        }),
      ),
    ).rejects.toThrow(/not a positive whole number of paise/);
    expect(await entriesFor(txnId)).toBe(0);
  });
});
