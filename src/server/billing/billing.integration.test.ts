/**
 * The credit ledger against the local Postgres. Skipped when it is unreachable. Every user is
 * unique to the run and removed afterwards.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { databaseReachable } from "@/server/test-support/script-fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("billing (integration)", async () => {
  const billing = await import("@/server/billing");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { creditLedger } = await import("@/server/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { createGenerationFixtures } = await import("@/server/test-support/generation-fixtures");
  const fixtures = createGenerationFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeDb();
  });

  async function ledgerSum(userId: string): Promise<number> {
    const [row] = await getDb()
      .select({ sum: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId));
    return row?.sum ?? 0;
  }

  async function userWithProject() {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    return { userId, projectId };
  }

  it("the skip-confirmation preference is off by default and belongs to its user", async () => {
    const { userId } = await userWithProject();
    const other = await fixtures.newUser();
    expect(await billing.getSkipCreditConfirm(userId)).toBe(false);
    expect(await billing.setSkipCreditConfirm(userId, true)).toBe(true);
    expect(await billing.getSkipCreditConfirm(userId)).toBe(true);
    expect(await billing.getSkipCreditConfirm(other)).toBe(false);
    expect(await billing.setSkipCreditConfirm(userId, false)).toBe(false);
    expect(await billing.getSkipCreditConfirm(userId)).toBe(false);
    // An unknown user has nothing to change.
    expect(await billing.setSkipCreditConfirm("no-such-user", true)).toBe(false);
  });

  it("grants, reserves, settles and refunds; the balance is the ledger's sum", async () => {
    const { userId, projectId } = await userWithProject();
    expect(await billing.getBalance(userId)).toBe(0);
    expect(await billing.grantCredits({ userId, amount: 100, note: "welcome" })).toBe(100);
    expect(await billing.grantCredits({ userId, amount: 5 })).toBe(105);

    const g1 = await fixtures.insertGeneration({ userId, projectId });
    const g2 = await fixtures.insertGeneration({ userId, projectId });
    await billing.reserve({ userId, generationId: g1, amount: 30 });
    await billing.reserve({ userId, generationId: g2, amount: 20 });
    expect(await billing.getBalance(userId)).toBe(55);
    await billing.settle({ generationId: g1 });
    await billing.refund({ generationId: g2 });
    expect(await billing.getBalance(userId)).toBe(75);
    expect(await ledgerSum(userId)).toBe(75);

    const page1 = await billing.listLedger(userId, { limit: 4 });
    expect(page1.items.map((e) => e.type)).toEqual(["refund", "settle", "reserve", "reserve"]);
    expect(page1.items[0]).toMatchObject({ amount: 20, generationId: g2 });
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await billing.listLedger(userId, { limit: 4, cursor: page1.nextCursor });
    expect(page2.items.map((e) => [e.type, e.amount])).toEqual([
      ["grant", 5],
      ["grant", 100],
    ]);
    expect(page2.nextCursor).toBeNull();
  });

  it("validates amounts and users", async () => {
    const { userId, projectId } = await userWithProject();
    for (const amount of [0, -5, 1.5, Number.NaN, billing.MAX_GRANT + 1]) {
      await expect(billing.grantCredits({ userId, amount })).rejects.toBeInstanceOf(
        billing.BillingInputError,
      );
    }
    await expect(
      billing.grantCredits({ userId: "no-such-user-xyz", amount: 1 }),
    ).rejects.toBeInstanceOf(billing.BillingInputError);
    const g = await fixtures.insertGeneration({ userId, projectId });
    await expect(billing.reserve({ userId, generationId: g, amount: -1 })).rejects.toBeInstanceOf(
      billing.BillingInputError,
    );
    await expect(billing.settle({ generationId: g })).rejects.toBeInstanceOf(
      billing.BillingInputError,
    );
    await expect(billing.listLedger(userId, { cursor: "nonsense" })).rejects.toBeInstanceOf(
      billing.BillingInputError,
    );
    expect(await billing.getBalance(userId)).toBe(0);
  });

  it("refuses a reservation the balance does not cover, saying what is needed", async () => {
    const { userId, projectId } = await userWithProject();
    await billing.grantCredits({ userId, amount: 3 });
    const g = await fixtures.insertGeneration({ userId, projectId });
    const error = await billing.reserve({ userId, generationId: g, amount: 4 }).catch((e) => e);
    expect(error).toBeInstanceOf(billing.InsufficientCreditsError);
    expect(error).toMatchObject({ balance: 3, needed: 4 });
    expect(error.message).toContain("4 credits");
    expect(await billing.getBalance(userId)).toBe(3);
  });

  it("lets exactly the covered reservations through when 20 race for 5", async () => {
    const { userId, projectId } = await userWithProject();
    await billing.grantCredits({ userId, amount: 50 });
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => fixtures.insertGeneration({ userId, projectId })),
    );
    const results = await Promise.allSettled(
      ids.map((generationId) => billing.reserve({ userId, generationId, amount: 10 })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(5);
    expect(refused).toHaveLength(15);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(billing.InsufficientCreditsError);
    }
    expect(await billing.getBalance(userId)).toBe(0);
    expect(await ledgerSum(userId)).toBe(0);
  });

  it("makes settle and refund idempotent and mutually exclusive, also under races", async () => {
    const { userId, projectId } = await userWithProject();
    await billing.grantCredits({ userId, amount: 40 });
    const a = await fixtures.insertGeneration({ userId, projectId });
    const b = await fixtures.insertGeneration({ userId, projectId });
    const c = await fixtures.insertGeneration({ userId, projectId });
    for (const generationId of [a, b, c]) {
      await billing.reserve({ userId, generationId, amount: 10 });
      // A repeated reservation is a no-op.
      await billing.reserve({ userId, generationId, amount: 10 });
    }
    expect(await billing.getBalance(userId)).toBe(10);

    await billing.settle({ generationId: a });
    await billing.settle({ generationId: a });
    await expect(billing.refund({ generationId: a })).rejects.toBeInstanceOf(
      billing.BillingInputError,
    );

    await billing.refund({ generationId: b });
    await billing.refund({ generationId: b });
    await expect(billing.settle({ generationId: b })).rejects.toBeInstanceOf(
      billing.BillingInputError,
    );
    expect(await billing.getBalance(userId)).toBe(20);

    // Concurrent settle and refund of one generation: exactly one wins.
    const race = await Promise.allSettled([
      billing.settle({ generationId: c }),
      billing.refund({ generationId: c }),
      billing.refund({ generationId: c }),
    ]);
    const entries = await getDb()
      .select({ type: creditLedger.type })
      .from(creditLedger)
      .where(eq(creditLedger.generationId, c));
    const closing = entries.filter((e) => e.type !== "reserve");
    expect(closing).toHaveLength(1);
    expect(race.some((r) => r.status === "fulfilled")).toBe(true);
    const balance = await billing.getBalance(userId);
    expect(balance).toBe(closing[0]?.type === "refund" ? 30 : 20);
    expect(await ledgerSum(userId)).toBe(balance);
  });
});
